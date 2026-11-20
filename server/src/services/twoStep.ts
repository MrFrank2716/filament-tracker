import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';
import { env } from '@/env';
import { hashSecret, newPairingCode, normalizePairingCode } from '@/services/tokens';

/**
 * Two-step sign-in with an authenticator app: time-based one-time codes as in RFC 6238 (6 digits, a new one
 * every 30 seconds, HMAC-SHA1, which is what every authenticator app speaks), and single-use recovery codes
 * for a lost phone.
 */

export const CODE_DIGITS = 6;
const STEP_SECONDS = 30;
/** A code from the step before or after is taken too: phones' clocks drift, and typing takes time. */
const DRIFT_STEPS = 1;
export const RECOVERY_CODES = 10;

// ---- Base32, the form authenticator apps take a secret in ---------------------

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(bytes: Uint8Array): string {
  let bits = 0;
  let value = 0;
  let text = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      text += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) text += BASE32[(value << (5 - bits)) & 31];
  return text;
}

export function base32Decode(text: string): Buffer {
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of text.toUpperCase().replace(/[\s=-]/g, '')) {
    const index = BASE32.indexOf(char);
    if (index === -1) throw new Error('Not base32');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

// ---- Codes --------------------------------------------------------------------

export const stepAt = (now: number): number => Math.floor(now / 1000 / STEP_SECONDS);

/** The code for one 30-second step (RFC 4226 on the step number). */
export function codeFor(secret: Uint8Array, step: number, digits = CODE_DIGITS): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const mac = createHmac('sha1', secret).update(counter).digest();
  const offset = mac[mac.length - 1] & 15;
  const number = mac.readUInt32BE(offset) & 0x7fffffff;
  return String(number % 10 ** digits).padStart(digits, '0');
}

const sameText = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));

/**
 * The step a typed code belongs to, or null when it is wrong. A step at or before `lastStep` never matches,
 * so a code that was just used (or one from before it) cannot be used again by someone who saw it typed.
 */
export function matchingStep(secret: Uint8Array, typed: string, lastStep: number | null, now = Date.now()): number | null {
  const code = typed.replace(/\s/g, '');
  if (!/^\d+$/.test(code) || code.length !== CODE_DIGITS) return null;
  const current = stepAt(now);
  let found: number | null = null;
  // Every candidate is compared, whichever matches, so the time taken says nothing about which did.
  for (let step = current - DRIFT_STEPS; step <= current + DRIFT_STEPS; step += 1) {
    if (sameText(codeFor(secret, step), code) && (lastStep === null || step > lastStep)) found ??= step;
  }
  return found;
}

export const newSecret = (): Buffer => randomBytes(20);

/** What the QR code holds: the link an authenticator app reads to add the account. */
export function authenticatorLink(email: string, secret: Uint8Array): string {
  const label = encodeURIComponent(`Wrkbench:${email}`);
  return `otpauth://totp/${label}?secret=${base32Encode(secret)}&issuer=Wrkbench&algorithm=SHA1&digits=${CODE_DIGITS}&period=${STEP_SECONDS}`;
}

// ---- Keeping the secret ---------------------------------------------------------

// Its own key, made from JWT_SECRET, so the stored secret is useless without the server's settings.
const storageKey = () => Buffer.from(hkdfSync('sha256', env.JWT_SECRET, 'wrkbench', 'two-step-secret', 32));

export function sealSecret(secret: Uint8Array): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', storageKey(), iv);
  const data = Buffer.concat([cipher.update(secret), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), data.toString('base64url')].join('.');
}

/** Null when it cannot be opened: damaged, or sealed under a JWT_SECRET that has since been changed. */
export function openSecret(sealed: string): Buffer | null {
  const [version, iv, tag, data] = sealed.split('.');
  if (version !== 'v1' || !iv || !tag || !data) return null;
  try {
    const decipher = createDecipheriv('aes-256-gcm', storageKey(), Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]);
  } catch {
    return null;
  }
}

// ---- Recovery codes -------------------------------------------------------------

/** Ten codes like "ABCD-EFGH-JKMN" to show once, with the hashes to store. */
export function newRecoveryCodes(): Array<{ code: string; hash: string }> {
  return Array.from({ length: RECOVERY_CODES }, () => {
    const code = newPairingCode();
    return { code, hash: recoveryHash(code) };
  });
}

/** Typed with or without dashes, in either case. The prefix keeps these apart from every other stored hash. */
export const recoveryHash = (typed: string): string => hashSecret(`recovery:${normalizePairingCode(typed)}`);

/** Whether what was typed is the shape of an authenticator code, as opposed to a recovery code. */
export const looksLikeAppCode = (typed: string): boolean => /^\d{6}$/.test(typed.replace(/\s/g, ''));
