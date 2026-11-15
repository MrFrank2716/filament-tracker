/**
 * What the bridge will not do, whatever the server asks.
 *
 * The bridge sits inside someone's network and takes instructions from a server outside it, so the limits live
 * here, in the program the workshop runs, not on the server:
 * - it only ever connects to literal private IPv4 addresses, on the printer's fixed port (never a name, never a
 *   port or URL chosen by the server);
 * - it has no way to send a printer anything but "report your status" (see bambu.ts);
 * - it cannot be told to run commands, read files, change its server or update itself.
 */

/** 10.x.x.x, 172.16-31.x.x or 192.168.x.x, written out in full. Not loopback, link-local or anything public. */
export function privateHost(host: string): boolean {
  const match = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!match) return false;
  const [a, b, c, d] = match.slice(1).map(Number);
  if ([a, b, c, d].some((part) => part > 255)) return false;
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
}

/** The most printers one bridge will hold, however many the server lists. */
export const MAX_PRINTERS = 64;
