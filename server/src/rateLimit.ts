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
