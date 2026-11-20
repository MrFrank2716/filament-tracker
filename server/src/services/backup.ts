import { createReadStream, createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, readdir, rename, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pipeline } from 'node:stream/promises';
import { createGunzip, createGzip } from 'node:zlib';
import { PrismaClient } from '@prisma/client';
import { env } from '@/env';
import { alertOperator } from '@/services/mail';
import { openBucket, type Bucket } from '@/services/s3';
import { uploadRoot } from '@/services/uploads';

/**
 * Backups to storage somewhere else, so losing the server's disk does not lose the workshop's data.
 *
 * Each run writes one compressed copy of the whole database (`db/<time>.db.gz`) and adds any uploaded file the
 * bucket does not hold yet (`uploads/<workspace>/<name>`). Old database copies are thinned out to the newest of
 * each recent day and week. Uploaded files are never removed from the bucket: a server that came back up with
 * an empty disk must not be able to empty the backup as well.
 */

const DB_PREFIX = 'db/';
const UPLOAD_PREFIX = 'uploads/';

/** The bucket backups go to, or null when backups are not set up. */
export function backupBucket(): Bucket | null {
  if (!env.BACKUP_S3_ENDPOINT || !env.BACKUP_S3_BUCKET || !env.BACKUP_S3_ACCESS_KEY_ID || !env.BACKUP_S3_SECRET_ACCESS_KEY) return null;
  return openBucket({
    endpoint: env.BACKUP_S3_ENDPOINT,
    bucket: env.BACKUP_S3_BUCKET,
    region: env.BACKUP_S3_REGION,
    accessKeyId: env.BACKUP_S3_ACCESS_KEY_ID,
    secretAccessKey: env.BACKUP_S3_SECRET_ACCESS_KEY,
  });
}

/** Where the database file is. A relative `file:` address is taken from the folder of schema.prisma, as Prisma does. */
export function databaseFile(url: string = env.DATABASE_URL): string {
  if (!url.startsWith('file:')) throw new Error('DATABASE_URL must be a file: address');
  const file = url.slice('file:'.length).split('?')[0];
  const prismaDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../prisma');
  return path.resolve(prismaDir, file);
}

/** A complete, consistent copy of the database in one new file, taken while the app carries on. */
export async function snapshotDatabase(db: PrismaClient, dest: string): Promise<void> {
  await rm(dest, { force: true });
  // VACUUM INTO takes a text literal, not a parameter. The path is one we built; quotes are doubled all the same.
  await db.$executeRawUnsafe(`VACUUM INTO '${dest.replaceAll("'", "''")}'`);
}

/** "ok" from SQLite's own check, and the tables every Wrkbench database has. Throws with the reason otherwise. */
export async function assertUsableDatabase(file: string): Promise<{ users: number; workspaces: number }> {
  const db = new PrismaClient({ datasourceUrl: `file:${file}` });
  try {
    const check = await db.$queryRawUnsafe<Array<{ integrity_check: string }>>('PRAGMA integrity_check');
    if (check[0]?.integrity_check !== 'ok') throw new Error(`the copy is damaged (${check[0]?.integrity_check ?? 'no answer'})`);
    const [users, workspaces] = await Promise.all([db.user.count(), db.workspace.count()]);
    return { users, workspaces };
  } finally {
    await db.$disconnect();
  }
}

// ---- Names and what to keep -------------------------------------------------

/** `db/2026-11-20T03-04-05Z.db.gz`: sorts by time, and has no character a shell or a web address minds. */
export const backupKey = (at: Date): string => `${DB_PREFIX}${at.toISOString().slice(0, 19).replaceAll(':', '-')}Z.db.gz`;

export function backupTime(key: string): Date | null {
  const match = /^db\/(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})Z\.db\.gz$/.exec(key);
  if (!match) return null;
  const at = new Date(`${match[1]}T${match[2]}:${match[3]}:${match[4]}Z`);
  return Number.isNaN(at.getTime()) ? null : at;
}

const dayOf = (at: Date) => at.toISOString().slice(0, 10);
/** The Monday that starts the week, so every day of one week gives the same answer. */
const weekOf = (at: Date) => dayOf(new Date(at.getTime() - ((at.getUTCDay() + 6) % 7) * 24 * 60 * 60 * 1000));

/**
 * Which database copies can go: everything except the newest copy of each of the last `daily` days that have
 * one, and the newest of each of the last `weekly` weeks. Names this code did not make are left alone.
 */
export function expiredBackups(keys: string[], keep: { daily: number; weekly: number }): string[] {
  const dated = keys
    .map((key) => ({ key, at: backupTime(key) }))
    .filter((entry): entry is { key: string; at: Date } => entry.at !== null)
    .sort((a, b) => b.at.getTime() - a.at.getTime());
  const kept = new Set<string>();
  const newestPer = (bucketOf: (at: Date) => string, count: number) => {
    const seen = new Set<string>();
    for (const { key, at } of dated) {
      const bucket = bucketOf(at);
      if (seen.has(bucket)) continue;
      if (seen.size >= count) break;
      seen.add(bucket);
      kept.add(key);
    }
  };
  newestPer(dayOf, keep.daily);
  newestPer(weekOf, keep.weekly);
  return dated.filter(({ key }) => !kept.has(key)).map(({ key }) => key);
}

// ---- One backup -------------------------------------------------------------

async function filesUnder(root: string): Promise<string[]> {
  const entries = await readdir(root, { recursive: true, withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  return entries.filter((entry) => entry.isFile()).map((entry) => path.relative(root, path.join(entry.parentPath, entry.name)).split(path.sep).join('/'));
}

export interface BackupResult {
  key: string;
  bytes: number;
  uploadsAdded: number;
  removed: number;
}

interface BackupOptions {
  db: PrismaClient;
  uploads?: string;
  now?: Date;
  keep?: { daily: number; weekly: number };
}

export async function runBackup(bucket: Bucket, { db, uploads = uploadRoot, now = new Date(), keep }: BackupOptions): Promise<BackupResult> {
  const work = await mkdtemp(path.join(tmpdir(), 'wrkbench-backup-'));
  try {
    const copy = path.join(work, 'copy.db');
    const packed = `${copy}.gz`;
    await snapshotDatabase(db, copy);
    // Never send a copy that could not be restored.
    await assertUsableDatabase(copy);
    await pipeline(createReadStream(copy), createGzip(), createWriteStream(packed));
    const key = backupKey(now);
    await bucket.putFile(key, packed);

    const held = new Set((await bucket.list(UPLOAD_PREFIX)).map((object) => object.key));
    let uploadsAdded = 0;
    for (const name of await filesUnder(uploads)) {
      if (held.has(`${UPLOAD_PREFIX}${name}`)) continue;
      await bucket.putFile(`${UPLOAD_PREFIX}${name}`, path.join(uploads, name));
      uploadsAdded += 1;
    }

    // Only after the new copy is safely there.
    const expired = expiredBackups(
      (await bucket.list(DB_PREFIX)).map((object) => object.key),
      keep ?? { daily: env.BACKUP_KEEP_DAILY, weekly: env.BACKUP_KEEP_WEEKLY },
    ).filter((old) => old !== key);
    for (const old of expired) await bucket.remove(old);

    return { key, bytes: (await stat(packed)).size, uploadsAdded, removed: expired.length };
  } finally {
    await rm(work, { recursive: true, force: true });
  }
}

/** The database copies in the bucket, newest first. */
export async function listBackups(bucket: Bucket): Promise<Array<{ key: string; at: Date; size: number }>> {
  return (await bucket.list(DB_PREFIX))
    .map((object) => ({ key: object.key, at: backupTime(object.key), size: object.size }))
    .filter((entry): entry is { key: string; at: Date; size: number } => entry.at !== null)
    .sort((a, b) => b.at.getTime() - a.at.getTime());
}

// ---- Putting a backup back --------------------------------------------------

export interface RestoreResult {
  key: string;
  users: number;
  workspaces: number;
  uploadsFetched: number;
  /** Where the database that was there before now is, or null when there was none. */
  setAside: string | null;
}

/** The files SQLite keeps beside a database while it is open or after a crash. They belong with it. */
const SIDE_FILES = ['', '-wal', '-shm', '-journal'];

/**
 * Replace the database with a copy from the bucket, and fetch any uploaded file that is missing here.
 * `which` is "latest" or the name of one copy, with or without the `db/` in front.
 * The app must not be running: this is for the start-up step and the command line, never a request.
 * The copy is checked before anything is touched, and the database it replaces is moved aside, not deleted.
 */
export async function restoreBackup(bucket: Bucket, which: string, target = { database: databaseFile(), uploads: uploadRoot }): Promise<RestoreResult> {
  const available = await listBackups(bucket);
  const wanted = which === 'latest' ? available[0] : available.find(({ key }) => key === which || key === `${DB_PREFIX}${which}` || key === `${DB_PREFIX}${which}.db.gz`);
  if (!wanted) throw new Error(which === 'latest' ? 'There are no backups in the bucket' : `There is no backup called "${which}"`);

  const dir = path.dirname(target.database);
  await mkdir(dir, { recursive: true });
  const incoming = `${target.database}.restoring`;
  const work = await mkdtemp(path.join(tmpdir(), 'wrkbench-restore-'));
  try {
    const packed = path.join(work, 'copy.db.gz');
    await bucket.getFile(wanted.key, packed);
    await pipeline(createReadStream(packed), createGunzip(), createWriteStream(incoming));
    const counts = await assertUsableDatabase(incoming);
    // The check opened it as a database, which can leave side files of its own.
    for (const suffix of SIDE_FILES.slice(1)) await rm(`${incoming}${suffix}`, { force: true });

    let setAside: string | null = null;
    if (await stat(target.database).then(() => true, () => false)) {
      const aside = path.join(dir, 'pre-restore');
      await mkdir(aside, { recursive: true });
      setAside = path.join(aside, `${backupKey(new Date()).slice(DB_PREFIX.length, -'.db.gz'.length)}.db`);
      for (const suffix of SIDE_FILES) await rename(`${target.database}${suffix}`, `${setAside}${suffix}`).catch(() => undefined);
    }
    await rename(incoming, target.database);

    const here = new Set(await filesUnder(target.uploads));
    let uploadsFetched = 0;
    for (const object of await bucket.list(UPLOAD_PREFIX)) {
      const name = object.key.slice(UPLOAD_PREFIX.length);
      // A name from the bucket must stay inside the upload folder.
      const dest = path.resolve(target.uploads, name);
      if (!name || here.has(name) || !dest.startsWith(`${path.resolve(target.uploads)}${path.sep}`)) continue;
      await mkdir(path.dirname(dest), { recursive: true });
      await bucket.getFile(object.key, dest);
      uploadsFetched += 1;
    }
    return { key: wanted.key, ...counts, uploadsFetched, setAside };
  } finally {
    await rm(incoming, { force: true });
    await rm(work, { recursive: true, force: true });
  }
}

// ---- Every night ------------------------------------------------------------

const HOUR = 60 * 60 * 1000;
/** A little under a day, so an hourly look does not let it slip to 25 hours. */
const BACKUP_EVERY_MS = 23.5 * HOUR;
const FIRST_LOOK_MS = 2 * 60 * 1000;

const megabytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

/**
 * Looks every hour and backs up when the newest copy in the bucket is a day old. Asking the bucket, not the
 * clock, means a restart neither skips a night nor makes an extra copy.
 */
export function scheduleBackups(db: PrismaClient): void {
  const bucket = backupBucket();
  if (!bucket) {
    console.log('Backups are off: set the BACKUP_S3_ settings to keep copies of the database and uploads somewhere else.');
    return;
  }
  let newest: number | null = null;
  let running = false;
  let lastAlert = 0;
  const look = async () => {
    if (running) return;
    running = true;
    try {
      newest ??= (await listBackups(bucket))[0]?.at.getTime() ?? 0;
      if (Date.now() - newest < BACKUP_EVERY_MS) return;
      const result = await runBackup(bucket, { db });
      newest = Date.now();
      console.log(`Backup ${result.key} saved (${megabytes(result.bytes)}, ${result.uploadsAdded} new uploaded file${result.uploadsAdded === 1 ? '' : 's'}, ${result.removed} old cop${result.removed === 1 ? 'y' : 'ies'} removed)`);
    } catch (cause) {
      const reason = cause instanceof Error ? cause.message : String(cause);
      console.error('Backup failed:', reason);
      // It is tried again every hour; one email a day is enough to say so.
      if (Date.now() - lastAlert > 24 * HOUR) {
        lastAlert = Date.now();
        alertOperator('Wrkbench could not make its backup', [
          'The backup of the database and uploaded files did not finish:',
          '',
          reason,
          '',
          'It will be tried again every hour. Until one succeeds, the newest copy in the bucket is getting older.',
        ]);
      }
    } finally {
      running = false;
    }
  };
  setTimeout(look, FIRST_LOOK_MS).unref();
  setInterval(look, HOUR).unref();
}
