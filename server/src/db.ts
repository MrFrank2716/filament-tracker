import { PrismaClient, Prisma } from '@prisma/client';

/**
 * SQLite lets one connection write at a time. With several connections, two changes made at the same moment
 * each read first and then block the other from writing, until both give up with a timeout. One connection
 * makes them take turns instead: each waits a few milliseconds for the one before it. An address that already
 * says how many connections it wants is left as it is.
 */
export function singleConnection(url: string | undefined): string | undefined {
  if (!url?.startsWith('file:') || /[?&]connection_limit=/.test(url)) return url;
  return `${url}${url.includes('?') ? '&' : '?'}connection_limit=1`;
}

export const prisma = new PrismaClient({
  datasourceUrl: singleConnection(process.env.DATABASE_URL),
  // How long a change waits for its turn before giving up. Longer than the default 2 seconds, so a big import
  // going through does not fail the small changes queued behind it.
  transactionOptions: { maxWait: 10_000, timeout: 5_000 },
});

/**
 * Switch the database to SQLite's write-ahead log, once, when the server starts. With it, people reading are
 * not held up by someone writing, and a write is one append instead of a rewrite. The setting is kept in the
 * database file, so it only has to be asked for here and holds for every connection after.
 * Returns the mode now in use. Anything but "wal" (a disk that cannot do it, say) is not fatal: the app runs as before.
 */
export async function useWriteAheadLog(db: PrismaClient = prisma): Promise<string> {
  const rows = await db.$queryRawUnsafe<Array<{ journal_mode: string }>>('PRAGMA journal_mode = WAL');
  return rows[0]?.journal_mode ?? 'unknown';
}

/** Either the root client or an interactive transaction client. */
export type Db = PrismaClient | Prisma.TransactionClient;

export type Json = Prisma.InputJsonValue;
