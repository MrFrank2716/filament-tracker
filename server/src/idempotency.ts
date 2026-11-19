import { createHash } from 'node:crypto';
import type { RequestHandler } from 'express';
import { HttpError } from '@/http';
import { UNDO_HEADER } from '@/services/activity';

/**
 * Idempotency keys, so that sending the same request twice makes one record, not two.
 *
 * The web app gives every POST an `Idempotency-Key` and sends the same key again when it never heard back
 * (the connection dropped after the server had done the work, say). The first time a key is seen the request
 * runs as usual and its answer is remembered; the same key again gets that answer back without anything
 * running twice. Only successful answers are kept: a request that failed can simply be tried again.
 *
 * Kept in memory, per signed-in user, for an hour. That covers the retry of a dropped connection, which is what
 * it is for; it does not survive a restart, and assumes one server process, as the rest of the app does.
 * Requests without the header behave exactly as before.
 */

export const IDEMPOTENCY_HEADER = 'Idempotency-Key';
export const REPLAYED_HEADER = 'Idempotent-Replayed';

const KEEP_MS = 60 * 60 * 1000;
const MAX_KEPT = 5000;
const KEY_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

interface Answer {
  status: number;
  body: unknown;
  undoId: string | undefined;
}

interface Kept {
  /** Fingerprint of the request body, so a key reused for something else is refused rather than answered wrongly. */
  bodyHash: string;
  expires: number;
  /** Resolves with the answer, or with null when the request failed and may be tried again. */
  answer: Promise<Answer | null>;
}

const kept = new Map<string, Kept>();

function forgetOld(now: number): void {
  for (const [id, entry] of kept) {
    // A Map keeps insertion order, so the oldest come first.
    if (entry.expires > now && kept.size <= MAX_KEPT) break;
    kept.delete(id);
  }
}

/** For tests: start with nothing remembered. */
export function forgetIdempotencyKeys(): void {
  kept.clear();
}

/** Mount after the sign-in check: keys are remembered per user. */
export const idempotent: RequestHandler = async (req, res, next) => {
  const key = req.get(IDEMPOTENCY_HEADER);
  if (req.method !== 'POST' || key === undefined) return next();
  if (!KEY_PATTERN.test(key)) throw new HttpError(400, 'Idempotency-Key must be 8 to 128 letters, digits, hyphens or underscores');

  const now = Date.now();
  forgetOld(now);
  const id = `${req.userId}\n${req.originalUrl}\n${key}`;
  const bodyHash = createHash('sha256').update(JSON.stringify(req.body ?? null)).digest('hex');

  const earlier = kept.get(id);
  if (earlier && earlier.expires > now) {
    if (earlier.bodyHash !== bodyHash) throw new HttpError(422, 'This Idempotency-Key was already used for a different request');
    // Still running (a double send): wait for the one answer rather than doing the work twice.
    const answer = await earlier.answer;
    if (answer) {
      res.setHeader(REPLAYED_HEADER, 'true');
      if (answer.undoId) res.setHeader(UNDO_HEADER, answer.undoId);
      if (answer.body === undefined) res.status(answer.status).end();
      else res.status(answer.status).json(answer.body);
      return;
    }
    // The first try failed and was forgotten: fall through and run this one as the first.
  }

  let body: unknown;
  const json = res.json.bind(res);
  res.json = (value: unknown) => {
    body = value;
    return json(value);
  };
  let settle: (answer: Answer | null) => void = () => undefined;
  const entry: Kept = { bodyHash, expires: now + KEEP_MS, answer: new Promise((resolve) => (settle = resolve)) };
  kept.set(id, entry);
  const done = (answer: Answer | null) => {
    if (!answer && kept.get(id) === entry) kept.delete(id);
    settle(answer);
  };
  res.once('finish', () => {
    const ok = res.statusCode >= 200 && res.statusCode < 300;
    const undoId = res.getHeader(UNDO_HEADER);
    done(ok ? { status: res.statusCode, body, undoId: typeof undoId === 'string' ? undoId : undefined } : null);
  });
  // The connection went before an answer was sent: nothing to replay.
  res.once('close', () => {
    if (!res.writableFinished) done(null);
  });
  next();
};
