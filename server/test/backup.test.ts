import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gunzipSync, gzipSync } from 'node:zlib';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/db';
import { assertUsableDatabase, backupKey, backupTime, expiredBackups, listBackups, restoreBackup, runBackup } from '@/services/backup';
import { openBucket, signRequest } from '@/services/s3';
import { startFakeBucket } from './fakeBucket';
import { startApp } from './http';

let work: string;
let fake: Awaited<ReturnType<typeof startFakeBucket>>;

beforeAll(async () => {
  work = await mkdtemp(path.join(tmpdir(), 'wrkbench-backup-test-'));
  await prisma.user.create({ data: { email: 'owner@workshop.test', name: 'Owner', passwordHash: 'x', memberships: { create: { role: 'owner', workspace: { create: { name: 'Demo workshop' } } } } } });
});
afterAll(async () => {
  await prisma.$disconnect();
  await rm(work, { recursive: true, force: true });
});
afterEach(async () => {
  await fake?.close();
});

describe('signing requests to the bucket', () => {
  // The worked examples from Amazon's own description of Signature Version 4 for S3.
  const keys = { region: 'us-east-1', accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY' };
  const now = new Date('2013-05-24T00:00:00Z');
  const empty = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

  it('gives the signature Amazon publishes for fetching an object', () => {
    const headers = signRequest(keys, { method: 'GET', url: new URL('https://examplebucket.s3.amazonaws.com/test.txt'), headers: { Range: 'bytes=0-9' }, payloadHash: empty, now });
    expect(headers.authorization).toBe(
      'AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE/20130524/us-east-1/s3/aws4_request, SignedHeaders=host;range;x-amz-content-sha256;x-amz-date, Signature=f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41',
    );
  });

  it('gives the signature Amazon publishes for listing a bucket, where the query is signed too', () => {
    const headers = signRequest(keys, { method: 'GET', url: new URL('https://examplebucket.s3.amazonaws.com/?max-keys=2&prefix=J'), payloadHash: empty, now });
    expect(headers.authorization).toContain('Signature=34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7');
  });
});

describe('which copies are kept', () => {
  it('names a copy after its time and reads the time back', () => {
    const at = new Date('2026-11-20T03:04:05Z');
    expect(backupKey(at)).toBe('db/2026-11-20T03-04-05Z.db.gz');
    expect(backupTime(backupKey(at))).toEqual(at);
    expect(backupTime('db/notes.txt')).toBeNull();
  });

  it('keeps the newest of each recent day and week, and leaves names it did not make alone', () => {
    const at = (day: string, hour = '03') => `db/${day}T${hour}-00-00Z.db.gz`;
    const keys = [
      at('2026-11-20'), at('2026-11-20', '01'), // Friday, twice
      at('2026-11-19'), at('2026-11-18'), at('2026-11-17'),
      at('2026-11-15'), // Sunday: the newest of the week before
      at('2026-11-10'),
      at('2026-11-03'), // two weeks further back
      'db/keep-me.txt',
    ];
    const gone = expiredBackups(keys, { daily: 3, weekly: 2 });
    // Days kept: 20th (03:00), 19th, 18th. Weeks kept: this one (the 20th) and the one before (the 15th).
    expect(gone.sort()).toEqual([at('2026-11-03'), at('2026-11-10'), at('2026-11-17'), at('2026-11-20', '01')].sort());
  });

  it('never drops the only copy there is', () => {
    expect(expiredBackups(['db/2020-01-01T00-00-00Z.db.gz'], { daily: 1, weekly: 0 })).toEqual([]);
  });
});

describe('a backup', () => {
  it('saves a whole, readable copy of the database and each uploaded file once', async () => {
    fake = await startFakeBucket();
    const bucket = openBucket(fake.config);
    const uploads = path.join(work, 'uploads-a');
    await mkdir(path.join(uploads, 'workspace1'), { recursive: true });
    await writeFile(path.join(uploads, 'workspace1', 'aaaa'), 'first file');

    const first = await runBackup(bucket, { db: prisma, uploads, now: new Date('2026-11-19T03:00:00Z'), keep: { daily: 7, weekly: 4 } });
    expect(first).toMatchObject({ key: 'db/2026-11-19T03-00-00Z.db.gz', uploadsAdded: 1, removed: 0 });
    expect(fake.objects.get('uploads/workspace1/aaaa')?.toString()).toBe('first file');

    // What is in the bucket opens as a database and holds what the live one holds.
    const copy = path.join(work, 'from-bucket.db');
    await writeFile(copy, gunzipSync(fake.objects.get(first.key)!));
    expect(await assertUsableDatabase(copy)).toEqual({ users: 1, workspaces: 1 });

    await writeFile(path.join(uploads, 'workspace1', 'bbbb'), 'second file');
    const puts = () => fake.requests.filter((line) => line.startsWith('PUT /backups/uploads/')).length;
    const before = puts();
    const second = await runBackup(bucket, { db: prisma, uploads, now: new Date('2026-11-20T03:00:00Z'), keep: { daily: 7, weekly: 4 } });
    expect(second.uploadsAdded).toBe(1);
    expect(puts() - before).toBe(1);
    expect((await listBackups(bucket)).map((entry) => entry.key)).toEqual(['db/2026-11-20T03-00-00Z.db.gz', 'db/2026-11-19T03-00-00Z.db.gz']);
  });

  it('thins out old copies once the new one is saved, and reads a list that comes in pages', async () => {
    fake = await startFakeBucket(2);
    const bucket = openBucket(fake.config);
    for (const day of ['01', '02', '03', '04', '05']) fake.objects.set(`db/2026-11-${day}T03-00-00Z.db.gz`, Buffer.from('old'));
    const result = await runBackup(bucket, { db: prisma, uploads: path.join(work, 'no-such-folder'), now: new Date('2026-11-06T03:00:00Z'), keep: { daily: 2, weekly: 1 } });
    expect(result.removed).toBe(4);
    expect([...fake.objects.keys()].sort()).toEqual(['db/2026-11-05T03-00-00Z.db.gz', 'db/2026-11-06T03-00-00Z.db.gz']);
  });

  it('works when the database folder has a quote in its name', async () => {
    const odd = path.join(work, "it's here");
    await mkdir(odd, { recursive: true });
    const { snapshotDatabase } = await import('@/services/backup');
    await snapshotDatabase(prisma, path.join(odd, 'copy.db'));
    expect((await assertUsableDatabase(path.join(odd, 'copy.db'))).users).toBe(1);
  });

  it('reports as it goes, so a long first backup does not look stuck', async () => {
    fake = await startFakeBucket();
    const uploads = path.join(work, 'uploads-many');
    await mkdir(path.join(uploads, 'workspace1'), { recursive: true });
    for (let i = 0; i < 120; i++) await writeFile(path.join(uploads, 'workspace1', `file${i}`), 'x');
    const lines: string[] = [];
    const result = await runBackup(openBucket(fake.config), { db: prisma, uploads, now: new Date('2026-11-21T03:00:00Z'), log: (line) => lines.push(line) });
    expect(result.uploadsAdded).toBe(120);
    expect(lines).toEqual([
      'Backup started',
      'Backup: database copy saved as db/2026-11-21T03-00-00Z.db.gz, 120 uploaded files to send',
      'Backup: sent 50 of 120 uploaded files',
      'Backup: sent 100 of 120 uploaded files',
    ]);
  });

  it('says why when the bucket refuses', async () => {
    fake = await startFakeBucket();
    const bucket = openBucket({ ...fake.config, secretAccessKey: 'wrong' });
    await expect(runBackup(bucket, { db: prisma, uploads: path.join(work, 'no-such-folder') })).rejects.toThrow(/403.*signature/);
    expect(fake.objects.size).toBe(0);
  });
});

describe('putting a backup back', () => {
  it('replaces the database, keeps the old one aside and fetches missing uploads', async () => {
    fake = await startFakeBucket();
    const bucket = openBucket(fake.config);
    const uploads = path.join(work, 'uploads-b');
    await mkdir(path.join(uploads, 'workspace1'), { recursive: true });
    await writeFile(path.join(uploads, 'workspace1', 'cccc'), 'a drawing');
    await runBackup(bucket, { db: prisma, uploads, now: new Date('2026-11-20T03:00:00Z') });
    // Something from outside that tries to climb out of the upload folder.
    fake.objects.set('uploads/../../escaped', Buffer.from('no'));

    const target = { database: path.join(work, 'restored', 'app.db'), uploads: path.join(work, 'restored', 'uploads') };
    await mkdir(path.dirname(target.database), { recursive: true });
    await writeFile(target.database, 'what was here before');

    const result = await restoreBackup(bucket, 'latest', target);
    expect(result).toMatchObject({ key: 'db/2026-11-20T03-00-00Z.db.gz', users: 1, workspaces: 1, uploadsFetched: 1 });
    expect(await assertUsableDatabase(target.database)).toEqual({ users: 1, workspaces: 1 });
    expect(await readFile(result.setAside!, 'utf8')).toBe('what was here before');
    expect(await readFile(path.join(target.uploads, 'workspace1', 'cccc'), 'utf8')).toBe('a drawing');
    await expect(stat(path.join(work, 'escaped'))).rejects.toThrow();

    // By name too, with or without the folder and ending.
    expect((await restoreBackup(bucket, '2026-11-20T03-00-00Z', target)).key).toBe('db/2026-11-20T03-00-00Z.db.gz');
    await expect(restoreBackup(bucket, '2001-01-01T00-00-00Z', target)).rejects.toThrow(/no backup called/);
  });

  it('leaves the database alone when the copy is damaged', async () => {
    fake = await startFakeBucket();
    const bucket = openBucket(fake.config);
    fake.objects.set('db/2026-11-20T03-00-00Z.db.gz', gzipSync(Buffer.from('this is not a database')));
    const target = { database: path.join(work, 'untouched', 'app.db'), uploads: path.join(work, 'untouched', 'uploads') };
    await mkdir(path.dirname(target.database), { recursive: true });
    await writeFile(target.database, 'still here');
    await expect(restoreBackup(bucket, 'latest', target)).rejects.toThrow();
    expect(await readFile(target.database, 'utf8')).toBe('still here');
    await expect(stat(`${target.database}.restoring`)).rejects.toThrow();
  });

  it('says so when the bucket is empty', async () => {
    fake = await startFakeBucket();
    await expect(restoreBackup(openBucket(fake.config), 'latest', { database: path.join(work, 'x.db'), uploads: work })).rejects.toThrow(/no backups/);
  });
});

describe('the health check', () => {
  it('answers ok while the database can be read', async () => {
    const app = await startApp();
    try {
      expect(await app.call('GET', '/health', '')).toEqual({ status: 200, body: { ok: true } });
    } finally {
      await app.close();
    }
  });
});
