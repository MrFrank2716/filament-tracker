import type { RequestHandler } from 'express';
import { HttpError } from '@/http';

/**
 * Small in-memory limiter for the routes anyone can reach without an account.
 *
 * Counts per client address, so behind a hosting proxy TRUST_PROXY must be set
 * or every visitor shares the proxy's address. It lives in this process only,
 * which is fine while the app runs as a single instance.
 */
export function rateLimit(max: number, windowMs: number): RequestHandler {
  const hits = new Map<string, number[]>();
  return (req, _res, next) => {
    const now = Date.now();
    const key = req.ip ?? 'unknown';
    const recent = (hits.get(key) ?? []).filter((at) => now - at < windowMs);
    if (recent.length >= max) throw new HttpError(429, 'Too many requests from this connection. Please try again later.');
    recent.push(now);
    hits.set(key, recent);
    if (hits.size > 5000) {
      for (const [other, times] of hits) if (!times.some((at) => now - at < windowMs)) hits.delete(other);
    }
    next();
  };
}

/**
 * Failed attempts per account, alongside the per-address limit: someone guessing one account's password
 * from many addresses is still stopped. `attempt` counts before the password is checked, so attempts made
 * in parallel all count; a right password then clears the count. Unknown accounts are counted the same
 * way, so a refusal says nothing about whether an account exists.
 */
export function attemptCounter(max: number, windowMs: number) {
  const attempts = new Map<string, number[]>();
  const recent = (key: string, now: number) => (attempts.get(key) ?? []).filter((at) => now - at < windowMs);
  return {
    /** Records one attempt, or returns false (recording nothing) when the account has used its allowance. */
    attempt(key: string, now = Date.now()): boolean {
      const times = recent(key, now);
      if (times.length >= max) return false;
      times.push(now);
      attempts.set(key, times);
      if (attempts.size > 5000) {
        // Only accounts with no recent attempts are forgotten, so a flood of made-up names cannot clear a real one.
        for (const [other, at] of attempts) if (!at.some((t) => now - t < windowMs)) attempts.delete(other);
      }
      return true;
    },
    /** Forget the account's attempts, once it has proved who it is: the right password, or a password reset. */
    clear(key: string): void {
      attempts.delete(key);
    },
  };
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
