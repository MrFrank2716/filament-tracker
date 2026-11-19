import bcrypt from 'bcryptjs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { signResetToken } from '@/auth';
import { prisma } from '@/db';
import { attemptCounter } from '@/rateLimit';
import { startApp } from './http';

describe('counting sign-in attempts per account', () => {
  const MIN = 60_000;

  it('allows the allowance, refuses the next, and forgets attempts once they are old', () => {
    const counter = attemptCounter(3, 15 * MIN);
    expect([0, 1, 2].map((i) => counter.attempt('a@x.test', i * MIN))).toEqual([true, true, true]);
    expect(counter.attempt('a@x.test', 3 * MIN)).toBe(false);
    // Each account has its own allowance.
    expect(counter.attempt('b@x.test', 3 * MIN)).toBe(true);
    // A refused attempt is not recorded, so the lock lifts 15 minutes after the first attempt.
    expect(counter.attempt('a@x.test', 15 * MIN)).toBe(true);
  });

  it('starts again once the account has proved who it is', () => {
    const counter = attemptCounter(2, 15 * MIN);
    counter.attempt('a@x.test', 0);
    counter.attempt('a@x.test', 1);
    expect(counter.attempt('a@x.test', 2)).toBe(false);
    counter.clear('a@x.test');
    expect(counter.attempt('a@x.test', 3)).toBe(true);
  });

  it('never forgets a busy account to make room for made-up ones', () => {
    const counter = attemptCounter(2, 15 * MIN);
    counter.attempt('victim@x.test', 0);
    counter.attempt('victim@x.test', 1);
    for (let i = 0; i < 6000; i++) counter.attempt(`made-up-${i}@x.test`, 2);
    expect(counter.attempt('victim@x.test', 3)).toBe(false);
  });
});

describe('signing in', () => {
  const email = 'guessed@example.test';
  const PASSWORD = 'correct horse battery';
  let app: Awaited<ReturnType<typeof startApp>>;
  let userId: string;

  beforeAll(async () => {
    app = await startApp();
    const user = await prisma.user.create({ data: { email, name: 'Guessed', passwordHash: await bcrypt.hash(PASSWORD, 4) } });
    userId = user.id;
  });
  afterAll(() => app.close());

  const login = (password: string) => app.call('POST', '/auth/login', '', { email, password });

  // Every /login here comes from one address, whose own limit is 20 per 15 minutes: this file stays under it.
  it('clears earlier mistakes once the right password is given', async () => {
    expect((await login('wrong password 1')).status).toBe(401);
    expect((await login(PASSWORD)).status).toBe(200);
  });

  it('takes new passwords of up to 72 bytes, and still signs in with a longer one set before that limit', async () => {
    const register = (address: string, password: string) => app.call('POST', '/auth/register', '', { email: address, password, name: 'New' });
    expect((await register('ascii72@example.test', 'a'.repeat(72))).status).toBe(201);
    const tooLong = await register('ascii73@example.test', 'a'.repeat(73));
    expect(tooLong.status).toBe(400);
    expect(tooLong.body?.error).toMatch(/at most 72 characters/);
    // 19 emoji are 19 characters but 76 bytes.
    expect((await register('emoji@example.test', '🔧'.repeat(19))).status).toBe(400);

    const user = await prisma.user.findUniqueOrThrow({ where: { email: 'ascii72@example.test' } });
    const tooLongReset = await app.call('POST', '/auth/reset', '', { token: signResetToken(user), password: 'b'.repeat(73) });
    expect(tooLongReset.status).toBe(400);

    const old = 'an old password from before the limit '.repeat(3);
    await prisma.user.create({ data: { email: 'longpass@example.test', name: 'Old', passwordHash: await bcrypt.hash(old, 4) } });
    expect((await app.call('POST', '/auth/login', '', { email: 'longpass@example.test', password: old })).status).toBe(200);
  });

  it('locks the account after 10 wrong passwords, even for the right one, until a password reset', async () => {
    for (let i = 0; i < 10; i++) expect((await login(`wrong password ${i}`)).status).toBe(401);
    const locked = await login(PASSWORD);
    expect(locked.status).toBe(429);
    expect(locked.body?.error).toMatch(/Too many sign-in attempts for this email/);

    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
    const reset = await app.call('POST', '/auth/reset', '', { token: signResetToken(user), password: 'a brand new password' });
    expect(reset.status).toBe(200);
    expect((await login('a brand new password')).status).toBe(200);
  });
});
