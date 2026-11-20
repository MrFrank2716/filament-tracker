import bcrypt from 'bcryptjs';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { signResetToken, signToken, signTwoStepChallenge } from '@/auth';
import { prisma } from '@/db';
import { authenticatorLink, base32Decode, base32Encode, codeFor, matchingStep, openSecret, sealSecret, stepAt } from '@/services/twoStep';
import { startApp } from './http';

describe('authenticator codes', () => {
  // The test values printed in RFC 6238, appendix B (SHA-1, 8 digits).
  const secret = Buffer.from('12345678901234567890');
  it.each([
    [59, '94287082'],
    [1111111109, '07081804'],
    [1111111111, '14050471'],
    [1234567890, '89005924'],
    [2000000000, '69279037'],
    [20000000000, '65353130'],
  ])('gives the published code at %i seconds', (seconds, code) => {
    expect(codeFor(secret, stepAt(seconds * 1000), 8)).toBe(code);
  });

  it('writes and reads a secret the way authenticator apps do', () => {
    // RFC 4648's own examples, without padding.
    expect(base32Encode(Buffer.from('foobar'))).toBe('MZXW6YTBOI');
    expect(base32Decode('MZXW6YTBOI').toString()).toBe('foobar');
    expect(base32Decode('mzxw 6ytb oi').toString()).toBe('foobar');
    expect(base32Decode(base32Encode(secret))).toEqual(secret);
    expect(authenticatorLink('a+b@workshop.test', secret)).toBe(
      'otpauth://totp/Wrkbench%3Aa%2Bb%40workshop.test?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=Wrkbench&algorithm=SHA1&digits=6&period=30',
    );
  });

  it('takes the current code and its neighbours, but nothing older, and no code twice', () => {
    const now = 1_700_000_000_000;
    const step = stepAt(now);
    expect(matchingStep(secret, codeFor(secret, step), null, now)).toBe(step);
    expect(matchingStep(secret, ` ${codeFor(secret, step).slice(0, 3)} ${codeFor(secret, step).slice(3)} `, null, now)).toBe(step);
    expect(matchingStep(secret, codeFor(secret, step - 1), null, now)).toBe(step - 1);
    expect(matchingStep(secret, codeFor(secret, step + 1), null, now)).toBe(step + 1);
    expect(matchingStep(secret, codeFor(secret, step - 2), null, now)).toBeNull();
    // Once a code is used, it and the one before it are finished.
    expect(matchingStep(secret, codeFor(secret, step), step, now)).toBeNull();
    expect(matchingStep(secret, codeFor(secret, step - 1), step, now)).toBeNull();
    expect(matchingStep(secret, codeFor(secret, step + 1), step, now)).toBe(step + 1);
    expect(matchingStep(secret, '12345', null, now)).toBeNull();
    expect(matchingStep(secret, 'abcdef', null, now)).toBeNull();
  });

  it('stores the secret so that the database alone cannot give it back', () => {
    const sealed = sealSecret(secret);
    expect(sealed).not.toContain(base32Encode(secret));
    expect(sealed).not.toContain(secret.toString('base64url'));
    expect(openSecret(sealed)).toEqual(secret);
    expect(sealSecret(secret)).not.toBe(sealed); // a fresh seal each time
    const [version, iv, tag, data] = sealed.split('.');
    const flipped = Buffer.from(data, 'base64url');
    flipped[0] ^= 1;
    expect(openSecret([version, iv, tag, flipped.toString('base64url')].join('.'))).toBeNull();
    expect(openSecret('nonsense')).toBeNull();
  });
});

describe('two-step sign-in', () => {
  const PASSWORD = 'correct horse battery';
  let app: Awaited<ReturnType<typeof startApp>>;
  const printed: string[] = [];
  let clock = 1_800_000_000_000;

  beforeAll(async () => {
    vi.spyOn(console, 'log').mockImplementation((...parts: unknown[]) => void printed.push(parts.join(' ')));
    app = await startApp();
  });
  afterEach(() => {
    printed.length = 0;
    vi.useRealTimers();
  });
  afterAll(async () => {
    vi.restoreAllMocks();
    await app.close();
  });

  /** Hold the clock still (only Date: timers and the network carry on), so a code is the same one a moment later. */
  const freeze = (at = (clock += 10 * 60_000)) => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(at);
    return at;
  };
  const mailsTo = (to: string, subject: RegExp) => printed.filter((text) => text.includes(`To: ${to}`) && subject.test(text)).length;

  async function account(email: string) {
    const user = await prisma.user.create({ data: { email, name: 'Careful', passwordHash: await bcrypt.hash(PASSWORD, 4), emailVerifiedAt: new Date() } });
    return { user, token: signToken(user) };
  }
  const post = (path: string, token: string, body: unknown) => app.call('POST', path, token, body);
  const login = (email: string, password = PASSWORD) => post('/auth/login', '', { email, password });
  /** Turn it on the way the settings page does. Returns the secret the app would hold, and the session it leaves. */
  async function turnOn(email: string) {
    const { token } = await account(email);
    const setup = await post('/auth/two-step/setup', token, { password: PASSWORD });
    expect(setup.status).toBe(200);
    const secret = base32Decode(setup.body?.secret as string);
    const enabled = await post('/auth/two-step/enable', token, { code: codeFor(secret, stepAt(Date.now())) });
    expect(enabled.status).toBe(200);
    return { secret, token: enabled.body?.token as string, oldToken: token, recoveryCodes: enabled.body?.recoveryCodes as string[] };
  }
  const codeNow = (secret: Buffer, stepsAhead = 0) => codeFor(secret, stepAt(Date.now()) + stepsAhead);

  it('is turned on with a password and a first code, and signs other devices out', async () => {
    freeze();
    const { user, token } = await account('setup@workshop.test');
    expect((await post('/auth/two-step/setup', token, { password: 'not my password' })).status).toBe(400);
    const setup = await post('/auth/two-step/setup', token, { password: PASSWORD });
    expect(setup.body?.link).toMatch(/^otpauth:\/\/totp\/Wrkbench%3Asetup%40workshop\.test\?secret=[A-Z2-7]{32}&/);
    // Until a code proves the app works, nothing has changed for signing in.
    expect((await login('setup@workshop.test')).body?.token).toBeTruthy();
    expect(((await app.call('GET', '/auth/me', token)).body?.user as { twoStep: boolean }).twoStep).toBe(false);

    const secret = base32Decode(setup.body?.secret as string);
    expect((await post('/auth/two-step/enable', token, { code: '000000' })).status).toBe(400);
    const enabled = await post('/auth/two-step/enable', token, { code: codeNow(secret) });
    expect(enabled.status).toBe(200);
    expect((enabled.body?.user as { twoStep: boolean }).twoStep).toBe(true);
    expect(enabled.body?.recoveryCodes).toHaveLength(10);
    expect(new Set(enabled.body?.recoveryCodes as string[]).size).toBe(10);
    expect((await app.call('GET', '/auth/me', token)).status).toBe(401); // the old session
    expect((await app.call('GET', '/auth/me', enabled.body?.token as string)).status).toBe(200);
    expect(mailsTo('setup@workshop.test', /Two-step sign-in is now on/)).toBe(1);

    // What is stored is neither the secret nor the codes.
    const stored = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(stored.totpSecret).not.toContain(setup.body?.secret as string);
    const hashes = (await prisma.recoveryCode.findMany({ where: { userId: user.id } })).map((row) => row.codeHash);
    for (const code of enabled.body?.recoveryCodes as string[]) expect(hashes).not.toContain(code);
    expect((await app.call('GET', '/auth/two-step', enabled.body?.token as string)).body).toEqual({ enabled: true, recoveryCodesLeft: 10 });
  });

  it('then asks for a code after the password, and gives no sign-in until it has one', async () => {
    freeze();
    const { secret } = await turnOn('signin@workshop.test');
    freeze(); // later: the code used to turn it on is long gone
    const first = await login('signin@workshop.test');
    expect(first.status).toBe(200);
    expect(first.body?.twoStep).toBe(true);
    expect(first.body?.token).toBeUndefined();
    expect(first.body?.user).toBeUndefined();
    const challenge = first.body?.challenge as string;
    // The challenge is not a sign-in, and a sign-in is not a challenge.
    expect((await app.call('GET', '/auth/me', challenge)).status).toBe(401);

    expect((await post('/auth/login/two-step', '', { challenge, code: '000000' })).status).toBe(401);
    const done = await post('/auth/login/two-step', '', { challenge, code: codeNow(secret) });
    expect(done.status).toBe(200);
    expect((await app.call('GET', '/auth/me', done.body?.token as string)).status).toBe(200);
    expect((await post('/auth/login/two-step', '', { challenge: done.body?.token, code: codeNow(secret, 1) })).status).toBe(401);

    // The same code again, even with a fresh challenge, is refused: someone watching the screen gains nothing.
    const again = await login('signin@workshop.test');
    expect((await post('/auth/login/two-step', '', { challenge: again.body?.challenge, code: codeNow(secret) })).status).toBe(401);
    expect((await post('/auth/login/two-step', '', { challenge: again.body?.challenge, code: codeNow(secret, 1) })).status).toBe(200);
    // A wrong password never reaches the second step.
    expect((await login('signin@workshop.test', 'wrong password')).status).toBe(401);
  });

  it('takes a recovery code once, in any case and with or without dashes, and says so by email', async () => {
    freeze();
    const { recoveryCodes } = await turnOn('lostphone@workshop.test');
    freeze();
    const challenge = async () => (await login('lostphone@workshop.test')).body?.challenge as string;
    const typed = recoveryCodes[0].toLowerCase().replaceAll('-', ' ');
    const done = await post('/auth/login/two-step', '', { challenge: await challenge(), code: typed });
    expect(done.status).toBe(200);
    expect(mailsTo('lostphone@workshop.test', /recovery code was used/)).toBe(1);
    expect(printed.join('\n')).toContain('You have 9 recovery codes left');
    expect((await post('/auth/login/two-step', '', { challenge: await challenge(), code: recoveryCodes[0] })).status).toBe(401);
    expect((await post('/auth/login/two-step', '', { challenge: await challenge(), code: recoveryCodes[1] })).status).toBe(200);
    // Someone else's recovery code is no use here.
    const other = await turnOn('neighbour@workshop.test');
    expect((await post('/auth/login/two-step', '', { challenge: await challenge(), code: other.recoveryCodes[0] })).status).toBe(401);
  });

  it('locks the second step after five wrong codes, even for the right one', async () => {
    freeze();
    const { secret } = await turnOn('guessed@workshop.test');
    freeze();
    const challenge = (await login('guessed@workshop.test')).body?.challenge as string;
    for (let i = 0; i < 5; i++) expect((await post('/auth/login/two-step', '', { challenge, code: `00000${i}` })).status).toBe(401);
    const locked = await post('/auth/login/two-step', '', { challenge, code: codeNow(secret) });
    expect(locked.status).toBe(429);
    expect(locked.body?.error).toMatch(/Too many wrong codes/);
  });

  it('refuses a challenge that is too old, or from before the password changed', async () => {
    freeze();
    const { secret } = await turnOn('slow@workshop.test');
    const start = freeze();
    const challenge = (await login('slow@workshop.test')).body?.challenge as string;
    freeze(start + 6 * 60_000);
    const late = await post('/auth/login/two-step', '', { challenge, code: codeNow(secret) });
    expect(late.status).toBe(401);
    expect(late.body?.error).toMatch(/took too long/);

    const user = await prisma.user.findUniqueOrThrow({ where: { email: 'slow@workshop.test' } });
    const stale = signTwoStepChallenge(user);
    await prisma.user.update({ where: { id: user.id }, data: { tokenVersion: { increment: 1 } } });
    expect((await post('/auth/login/two-step', '', { challenge: stale, code: codeNow(secret) })).status).toBe(401);
  });

  it('is not got round by a password reset link', async () => {
    freeze();
    const { secret } = await turnOn('inbox@workshop.test');
    freeze();
    const user = await prisma.user.findUniqueOrThrow({ where: { email: 'inbox@workshop.test' } });
    const reset = await post('/auth/reset', '', { token: signResetToken(user), password: 'a brand new password' });
    expect(reset.status).toBe(200);
    expect(reset.body).toEqual({ twoStep: true });
    const first = await login('inbox@workshop.test', 'a brand new password');
    expect(first.body?.token).toBeUndefined();
    expect((await post('/auth/login/two-step', '', { challenge: first.body?.challenge, code: codeNow(secret) })).status).toBe(200);
  });

  it('is turned off, or given new recovery codes, only with the password and a code', async () => {
    freeze();
    const { secret, token, recoveryCodes } = await turnOn('settings@workshop.test');
    freeze();
    expect((await post('/auth/two-step/disable', token, { password: 'wrong', code: codeNow(secret) })).status).toBe(400);
    // A 400, not a 401: the web app reads a 401 from a signed-in request as "your session ended" and signs out.
    expect((await post('/auth/two-step/disable', token, { password: PASSWORD, code: '000000' })).status).toBe(400);
    expect((await post('/auth/two-step/recovery-codes', token, { password: PASSWORD, code: '000000' })).status).toBe(400);

    const fresh = await post('/auth/two-step/recovery-codes', token, { password: PASSWORD, code: codeNow(secret) });
    expect(fresh.status).toBe(200);
    expect(fresh.body?.recoveryCodes).toHaveLength(10);
    // The old set is finished.
    const challenge = (await login('settings@workshop.test')).body?.challenge as string;
    expect((await post('/auth/login/two-step', '', { challenge, code: recoveryCodes[0] })).status).toBe(401);

    const off = await post('/auth/two-step/disable', token, { password: PASSWORD, code: codeNow(secret, 1) });
    expect(off.status).toBe(200);
    expect((off.body?.user as { twoStep: boolean }).twoStep).toBe(false);
    expect(mailsTo('settings@workshop.test', /turned off/)).toBe(1);
    expect((await login('settings@workshop.test')).body?.token).toBeTruthy();
    const stored = await prisma.user.findUniqueOrThrow({ where: { email: 'settings@workshop.test' } });
    expect(stored).toMatchObject({ totpSecret: null, totpEnabledAt: null, totpLastStep: null });
    expect(await prisma.recoveryCode.count({ where: { userId: stored.id } })).toBe(0);
    expect((await post('/auth/two-step/disable', token, { password: PASSWORD, code: codeNow(secret, 1) })).status).toBe(409);
  });

  it('is not offered to guests, and cannot be turned on twice', async () => {
    const guest = await post('/auth/guest', '', undefined);
    expect((await post('/auth/two-step/setup', guest.body?.token as string, { password: 'anything' })).status).toBe(400);
    freeze();
    const { token } = await turnOn('twice@workshop.test');
    expect((await post('/auth/two-step/setup', token, { password: PASSWORD })).status).toBe(409);
    expect((await post('/auth/two-step/enable', token, { code: '123456' })).status).toBe(409);
    expect((await app.call('GET', '/auth/two-step', '')).status).toBe(401);
  });
});
