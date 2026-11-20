import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/db';
import { env } from '@/env';
import { freeBytes, removeOldRequestFiles, storeBytes, storedPath, uploadRoot, workspaceUploadBytes } from '@/services/uploads';
import { startApp } from './http';

let app: Awaited<ReturnType<typeof startApp>>;
let base: string;
const defaults = { max: env.UPLOAD_MAX_WORKSPACE_MB, free: env.UPLOAD_MIN_FREE_MB };

beforeAll(async () => {
  app = await startApp();
  base = app.base;
});
afterEach(() => {
  env.UPLOAD_MAX_WORKSPACE_MB = defaults.max;
  env.UPLOAD_MIN_FREE_MB = defaults.free;
});
afterAll(() => app.close());

let made = 0;
async function workspaceWithLink() {
  made += 1;
  return prisma.workspace.create({ data: { name: `Workshop ${made}`, requestToken: `request-token-${made}` } });
}

/** Send a job request the way the public page does: a form with files. */
async function submit(token: string, bytes: number) {
  const form = new FormData();
  form.set('requesterName', 'Outside Person');
  form.set('requesterEmail', 'outside@example.test');
  form.set('title', 'A bracket');
  form.append('files', new Blob([new Uint8Array(bytes)]), 'bracket.stl');
  const response = await fetch(`${base}/public/requests/${token}`, { method: 'POST', body: form });
  return { status: response.status, body: (await response.json()) as { error?: string; trackToken?: string } };
}
const filesOnDisk = (workspaceId: string) => readdir(path.join(uploadRoot, workspaceId)).catch(() => [] as string[]);

describe('room for uploaded files', () => {
  it('keeps test uploads out of the project folder', () => {
    expect(uploadRoot.startsWith(process.env.TEST_DB_DIR!)).toBe(true);
  });

  it('refuses a request that would take a workspace past its allowance, and leaves nothing behind', async () => {
    const workspace = await workspaceWithLink();
    env.UPLOAD_MAX_WORKSPACE_MB = 1000 / (1024 * 1024); // 1000 bytes
    expect((await submit(workspace.requestToken!, 600)).status).toBe(201);
    expect(await workspaceUploadBytes(workspace.id)).toBe(600);

    const refused = await submit(workspace.requestToken!, 600);
    expect(refused.status).toBe(507);
    expect(refused.body.error).toMatch(/cannot take files at the moment/);
    expect(await filesOnDisk(workspace.id)).toHaveLength(1);
    expect(await prisma.jobRequest.count({ where: { workspaceId: workspace.id } })).toBe(1);

    // What still fits is still taken, and one workshop's files do not count against another's.
    expect((await submit(workspace.requestToken!, 300)).status).toBe(201);
    const other = await workspaceWithLink();
    expect((await submit(other.requestToken!, 600)).status).toBe(201);
  });

  it('refuses uploads before writing anything when the disk is nearly full', async () => {
    const workspace = await workspaceWithLink();
    expect(await freeBytes()).toBeGreaterThan(0);
    expect(await freeBytes(path.join(uploadRoot, 'not', 'made', 'yet'))).toBeGreaterThan(0);
    env.UPLOAD_MIN_FREE_MB = 999_999; // more than any test machine has free
    const refused = await submit(workspace.requestToken!, 100);
    expect(refused.status).toBe(507);
    expect(await filesOnDisk(workspace.id)).toHaveLength(0);
    env.UPLOAD_MIN_FREE_MB = 0;
    expect((await submit(workspace.requestToken!, 100)).status).toBe(201);
  });
});

describe('tidying up old request files', () => {
  it('deletes the files of requests finished long ago, and nothing else', async () => {
    const workspace = await workspaceWithLink();
    const now = new Date('2026-11-20T12:00:00Z');
    const daysAgo = (days: number) => new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    let n = 0;
    async function request(status: string, updatedAt: Date) {
      n += 1;
      const storedName = await storeBytes(workspace.id, new Uint8Array(10));
      const row = await prisma.jobRequest.create({
        data: { workspaceId: workspace.id, title: `Request ${n}`, requesterName: 'Outside', requesterEmail: 'outside@example.test', status, trackToken: `track-${made}-${n}`, updatedAt, files: { create: { name: 'part.stl', storedName, size: 10 } } },
      });
      return { id: row.id, storedName };
    }
    const oldRejected = await request('rejected', daysAgo(100));
    const oldDone = await request('done', daysAgo(91));
    const recentDone = await request('done', daysAgo(30));
    const oldPending = await request('pending', daysAgo(400));
    const oldApproved = await request('approved', daysAgo(400));

    expect(await removeOldRequestFiles(0, now)).toBe(0);
    expect(await removeOldRequestFiles(90, now)).toBe(2);

    const left = await filesOnDisk(workspace.id);
    expect(left.sort()).toEqual([recentDone.storedName, oldPending.storedName, oldApproved.storedName].sort());
    for (const gone of [oldRejected, oldDone]) {
      expect(await prisma.jobRequestFile.count({ where: { requestId: gone.id } })).toBe(0);
      // The request itself, and so its history, stays.
      expect(await prisma.jobRequest.findUnique({ where: { id: gone.id } })).not.toBeNull();
    }
    expect(await prisma.jobRequestFile.count({ where: { requestId: recentDone.id } })).toBe(1);
    expect(storedPath(workspace.id, recentDone.storedName).startsWith(uploadRoot)).toBe(true);
    expect(await removeOldRequestFiles(90, now)).toBe(0);
  });
});
