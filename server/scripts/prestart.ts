/**
 * Runs before the database is brought up to date and the app starts (the Docker image does this by itself):
 *
 *   npm run db:prepare
 *
 * 1. If RESTORE_BACKUP is set, puts that backup back, once for each value it is given.
 * 2. If an update is about to change the database, keeps a copy of it as it is now, beside it in
 *    `pre-migrate/`. A change to the database cannot be undone by going back to older code; the copy can.
 */
import { readdir, readFile, rm, stat, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { env } from '@/env';
import { backupBucket, databaseFile, restoreBackup, snapshotDatabase } from '@/services/backup';

const database = databaseFile();
const dataDir = path.dirname(database);
const KEEP_SNAPSHOTS = 2;

const exists = (file: string) => stat(file).then((found) => found.size > 0, () => false);

async function restoreIfAsked(): Promise<void> {
  const which = env.RESTORE_BACKUP;
  if (!which) return;
  // Remembered on the data disk, so a restart with the setting still there does not throw away newer work.
  const marker = path.join(dataDir, '.restored');
  const done = await readFile(marker, 'utf8').catch(() => '');
  if (done.split('\n')[0] === which) {
    console.log(`RESTORE_BACKUP=${which} was already put back (${done.split('\n')[1] ?? 'unknown copy'}). Remove the setting.`);
    return;
  }
  const bucket = backupBucket();
  if (!bucket) throw new Error('RESTORE_BACKUP is set, but the BACKUP_S3_ settings are not');
  console.log(`Putting back backup "${which}" ...`);
  const result = await restoreBackup(bucket, which);
  await writeFile(marker, `${which}\n${result.key}\n`);
  console.log(
    `Restored ${result.key}: ${result.users} account${result.users === 1 ? '' : 's'}, ${result.workspaces} workspace${result.workspaces === 1 ? '' : 's'}, ` +
      `${result.uploadsFetched} uploaded file${result.uploadsFetched === 1 ? '' : 's'} fetched.` +
      (result.setAside ? ` The database that was here is kept at ${result.setAside}.` : ''),
  );
  console.log('Now remove the RESTORE_BACKUP setting.');
}

async function snapshotBeforeUpdate(): Promise<void> {
  if (!(await exists(database))) return;
  const migrationsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../prisma/migrations');
  const known = (await readdir(migrationsDir, { withFileTypes: true })).filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  const db = new PrismaClient({ datasourceUrl: `file:${database}` });
  try {
    const applied = await db
      .$queryRawUnsafe<Array<{ migration_name: string }>>('SELECT migration_name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL')
      .catch(() => null);
    // No record of updates: a new or foreign file, with nothing of ours to protect yet.
    if (!applied) return;
    const have = new Set(applied.map((row) => row.migration_name));
    const pending = known.filter((name) => !have.has(name));
    if (pending.length === 0) return;

    const dir = path.join(dataDir, 'pre-migrate');
    await mkdir(dir, { recursive: true });
    const stamp = new Date().toISOString().slice(0, 19).replaceAll(':', '-');
    const copy = path.join(dir, `${stamp}Z-before-${pending[0]}.db`);
    await snapshotDatabase(db, copy);
    console.log(`${pending.length} database update${pending.length === 1 ? '' : 's'} to apply. The database as it is now is kept at ${copy}.`);

    const copies = (await readdir(dir)).filter((name) => name.endsWith('.db')).sort();
    for (const old of copies.slice(0, -KEEP_SNAPSHOTS)) await rm(path.join(dir, old), { force: true });
  } finally {
    await db.$disconnect();
  }
}

try {
  await restoreIfAsked();
} catch (cause) {
  // Starting on the wrong data would be worse than not starting.
  console.error('Could not put the backup back:', cause instanceof Error ? cause.message : cause);
  process.exit(1);
}
try {
  await snapshotBeforeUpdate();
} catch (cause) {
  // A full disk must not keep the site down: say so loudly and carry on. The nightly backup is the other way back.
  console.error('WARNING: could not keep a copy of the database before updating it:', cause instanceof Error ? cause.message : cause);
}
