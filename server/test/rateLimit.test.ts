import express from 'express';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { errorHandler } from '@/http';
import { rateLimit } from '@/rateLimit';

/** A tiny app with one limited route, so the limiter is tested as the real routes use it. */
let base: string;
let close: () => Promise<void>;

beforeAll(async () => {
  const app = express();
  app.post('/guess', rateLimit(3, 60_000), (_req, res) => {
    res.json({ ok: true });
  });
  app.get('/other', rateLimit(1, 60_000), (_req, res) => {
    res.json({ ok: true });
  });
  app.use(errorHandler);
  const server = app.listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  close = () => new Promise<void>((resolve) => server.close(() => resolve()));
});
afterAll(() => close());

describe('the per-address limit on guessable routes', () => {
  it('lets the allowance through, refuses the next with the usual error shape, and says when to come back', async () => {
    const answers = [];
    for (let i = 0; i < 4; i++) answers.push(await fetch(`${base}/guess`, { method: 'POST' }));
    expect(answers.map((answer) => answer.status)).toEqual([200, 200, 200, 429]);
    expect(await answers[3].json()).toEqual({ error: 'Too many requests from this connection. Please try again later.' });

    // What is left is reported on every answer, and a refusal says how long to wait.
    expect(answers[0].headers.get('ratelimit')).toMatch(/limit=3, remaining=2/);
    expect(Number(answers[3].headers.get('retry-after'))).toBeGreaterThan(0);
    expect(answers[3].headers.get('x-ratelimit-limit')).toBeNull();
  });

  it('counts each route on its own', async () => {
    // /guess is used up above; this one has its own allowance.
    expect((await fetch(`${base}/other`)).status).toBe(200);
    expect((await fetch(`${base}/other`)).status).toBe(429);
  });
});
