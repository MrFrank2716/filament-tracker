/*
 * Idempotency keys for requests that create or change something (every POST).
 *
 * Each request gets a fresh key. When no answer comes back (the connection dropped, the server restarted) the
 * work may or may not have been done, so the key is remembered; pressing Save again sends the very same request
 * with the very same key, and the server answers from memory instead of making a second record. Once any answer
 * arrives the key is forgotten, and the next press is a new request.
 */

/**
 * How long an unanswered request's key is kept for a retry. Short on purpose: a retry comes within moments, and
 * the same request made again much later ("use another 10 g") is more likely meant as a new one.
 */
const KEEP_MS = 2 * 60 * 1000;

/** A random UUID. `crypto.randomUUID` only exists on HTTPS and localhost; Wrkbench also runs on plain HTTP on a local network. */
export function newKey(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = [...bytes].map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export interface KeyRing {
  /** The key to send with this request: the one from its unanswered earlier try, or a new one. */
  keyFor: (path: string, body: string) => string;
  /** An answer arrived (whatever it said): the next identical request is a new one. */
  answered: (path: string, body: string) => void;
  /** No answer arrived: keep the key for the retry. */
  unanswered: (path: string, body: string, key: string) => void;
}

export function createKeyRing(now: () => number = Date.now, makeKey: () => string = newKey): KeyRing {
  const waiting = new Map<string, { key: string; at: number }>();
  const name = (path: string, body: string) => `${path}\n${body}`;
  return {
    keyFor: (path, body) => {
      for (const [request, entry] of waiting) if (now() - entry.at > KEEP_MS) waiting.delete(request);
      return waiting.get(name(path, body))?.key ?? makeKey();
    },
    answered: (path, body) => {
      waiting.delete(name(path, body));
    },
    unanswered: (path, body, key) => {
      waiting.set(name(path, body), { key, at: now() });
    },
  };
}
