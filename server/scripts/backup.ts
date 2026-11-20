/**
 * Backups from the command line, for whoever runs the server:
 *
 *   npm run db:backup                      make a backup now (the app can stay running)
 *   npm run db:backups                     list the copies in the bucket
 *   npm run db:restore -- latest           put the newest copy back   (stop the app first)
 *   npm run db:restore -- <name>           put one copy back          (stop the app first)
 *
 * All of them use the BACKUP_S3_ settings. The app makes its own backup every night; see the Self-hosting guide.
 */
import { prisma } from '@/db';
import { backupBucket, listBackups, restoreBackup, runBackup } from '@/services/backup';

const [command, which] = process.argv.slice(2);
const bucket = backupBucket();
if (!bucket) {
  console.error('Backups are not set up: set BACKUP_S3_ENDPOINT, BACKUP_S3_BUCKET, BACKUP_S3_ACCESS_KEY_ID and BACKUP_S3_SECRET_ACCESS_KEY.');
  process.exit(1);
}

const megabytes = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

try {
  if (command === 'now') {
    const result = await runBackup(bucket, { db: prisma });
    console.log(`Saved ${result.key} (${megabytes(result.bytes)}), ${result.uploadsAdded} new uploaded file(s), ${result.removed} old cop${result.removed === 1 ? 'y' : 'ies'} removed.`);
  } else if (command === 'list') {
    const copies = await listBackups(bucket);
    if (copies.length === 0) console.log('There are no backups in the bucket yet.');
    for (const copy of copies) console.log(`${copy.key.slice('db/'.length, -'.db.gz'.length)}  ${megabytes(copy.size)}`);
  } else if (command === 'restore' && which) {
    const result = await restoreBackup(bucket, which);
    console.log(`Restored ${result.key}: ${result.users} account(s), ${result.workspaces} workspace(s), ${result.uploadsFetched} uploaded file(s) fetched.`);
    if (result.setAside) console.log(`The database that was here is kept at ${result.setAside}.`);
    console.log('Run "npm run db:deploy" before starting the app, in case the copy is from an older version.');
  } else {
    console.error('Use: npm run db:backup | npm run db:backups | npm run db:restore -- <latest or a name from db:backups>');
    process.exitCode = 1;
  }
} catch (cause) {
  console.error(cause instanceof Error ? cause.message : cause);
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
