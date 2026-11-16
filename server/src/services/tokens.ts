import { createHash, randomBytes, randomInt } from 'node:crypto';

/**
 * Secrets for bridges. Both kinds are shown once and stored only as a SHA-256, which is enough because they
 * are long and random (a password would need a slow hash; these do not).
 */

/** The long-lived token a bridge signs in with. */
export const newBridgeToken = (): string => `wbb_${randomBytes(32).toString('base64url')}`;

/** The long-lived token a location display signs in with. Its own prefix, so neither kind passes for the other. */
export const newDeviceToken = (): string => `wbd_${randomBytes(32).toString('base64url')}`;

export const hashSecret = (value: string): string => createHash('sha256').update(value).digest('hex');

// No 0/O, 1/I/L or other look-alikes: the code is read off a screen and typed or pasted into a terminal.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** A one-time pairing code, shown as "ABCD-EFGH-JKMN". About 59 bits, good for the ten minutes it lives. */
export function newPairingCode(): string {
  const chars = Array.from({ length: 12 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
  return `${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8)}`;
}

/** Codes are compared without regard to case, dashes or spaces. */
export const normalizePairingCode = (raw: string): string => raw.toUpperCase().replace(/[^A-Z0-9]/g, '');
