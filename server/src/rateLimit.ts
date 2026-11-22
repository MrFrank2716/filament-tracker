import type { Request, RequestHandler } from 'express';
import { rateLimit as expressRateLimit } from 'express-rate-limit';

const TOO_MANY = 'Too many requests from this connection. Please try again later.';

/**
 * A limit of `max` requests per `windowMs` for each client address, for the routes that take something
 * guessable or that anyone can reach without an account. Built on express-rate-limit, the limiter that
 * code scanners recognise, with its counts held in this process.
 *
 * Counts per client address, so behind a hosting proxy TRUST_PROXY must be set or every visitor shares the
 * proxy's address. Being in this process only is fine while the app runs as a single instance.
 *
 * Every answer says how much of the allowance is left (the standard RateLimit headers), and a refusal says
 * when to try again (Retry-After).
 *
 * `per` counts by something else, such as the signed-in user, for routes that only members reach, with the
 * `message` to give instead.
 */
export function rateLimit(max: number, windowMs: number, per?: { key: (req: Request) => string; message: string }): RequestHandler {
  return expressRateLimit({
    windowMs,
    limit: max,
    ...(per ? { keyGenerator: per.key } : {}),
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    // The same shape as every other error the API gives, so the web app and displays show it as they always have.
    handler: (_req, res) => {
      res.status(429).json({ error: per?.message ?? TOO_MANY });
    },
  });
}

/**
 * An allowance for one long-lived connection: `capacity` messages at once, refilled at `perSecond`.
 * Returns a function that says whether the next message is allowed.
 */
export function tokenBucket(capacity: number, perSecond: number): () => boolean {
  let tokens = capacity;
  let last = Date.now();
  return () => {
    const now = Date.now();
    tokens = Math.min(capacity, tokens + ((now - last) / 1000) * perSecond);
    last = now;
    if (tokens < 1) return false;
    tokens -= 1;
    return true;
  };
}
