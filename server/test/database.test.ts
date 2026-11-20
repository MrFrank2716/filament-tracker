import { afterAll, describe, expect, it } from 'vitest';
import { prisma, useWriteAheadLog } from '@/db';

afterAll(() => prisma.$disconnect());

const plan = async (sql: string) => (await prisma.$queryRawUnsafe<Array<{ detail: string }>>(`EXPLAIN QUERY PLAN ${sql}`)).map((row) => row.detail).join(' | ');

describe('the database', () => {
  it('switches to the write-ahead log and stays there for later connections', async () => {
    expect(await useWriteAheadLog()).toBe('wal');
    await prisma.$disconnect();
    const rows = await prisma.$queryRawUnsafe<Array<{ journal_mode: string }>>('PRAGMA journal_mode');
    expect(rows[0].journal_mode).toBe('wal');
  });

  it('still reads and writes afterwards', async () => {
    await useWriteAheadLog();
    const user = await prisma.user.create({ data: { email: 'wal@workshop.test', name: 'Wal', passwordHash: 'x' } });
    expect(await prisma.user.findUnique({ where: { id: user.id } })).toMatchObject({ email: 'wal@workshop.test' });
  });

  // Each of these was a walk through the whole table before its index was added.
  it.each([
    ['machines of a workspace', `SELECT * FROM "Machine" WHERE "workspaceId" = 'w'`, 'Machine_workspaceId_idx'],
    ['locations of a workspace', `SELECT * FROM "Location" WHERE "workspaceId" = 'w'`, 'Location_workspaceId_idx'],
    ['locations under a location', `SELECT * FROM "Location" WHERE "parentId" = 'l'`, 'Location_parentId_idx'],
    ['maintenance tasks of a workspace', `SELECT * FROM "MaintenanceTask" WHERE "workspaceId" = 'w'`, 'MaintenanceTask_workspaceId_idx'],
    ['hardware on a machine', `SELECT * FROM "SubUnit" WHERE "machineId" = 'm'`, 'SubUnit_machineId_idx'],
    ['members of a workspace', `SELECT * FROM "Membership" WHERE "workspaceId" = 'w'`, 'Membership_workspaceId_idx'],
    ['what a job used', `SELECT * FROM "JobUsage" WHERE "jobId" = 'j'`, 'JobUsage_jobId_idx'],
    ['files of a request', `SELECT * FROM "JobRequestFile" WHERE "requestId" = 'r'`, 'JobRequestFile_requestId_idx'],
    ['parts used in a service', `SELECT * FROM "MaintenancePart" WHERE "logId" = 'l'`, 'MaintenancePart_logId_idx'],
    ['jobs finished in a period', `SELECT * FROM "Job" WHERE "workspaceId" = 'w' AND "completedAt" >= 0`, 'Job_workspaceId_completedAt_idx'],
    ['stock changes of a workspace, newest first', `SELECT * FROM "StockMovement" WHERE "workspaceId" = 'w' ORDER BY "createdAt" DESC`, 'StockMovement_workspaceId_createdAt_idx'],
  ])('looks up %s through an index', async (_what, sql, index) => {
    expect(await plan(sql)).toContain(index);
  });
});

describe('changes made at the same moment', () => {
  it('all go through, one after another', async () => {
    const { singleConnection } = await import('@/db');
    expect(singleConnection('file:/data/app.db')).toBe('file:/data/app.db?connection_limit=1');
    expect(singleConnection('file:/data/app.db?connection_limit=3')).toBe('file:/data/app.db?connection_limit=3');

    const workspace = await prisma.workspace.create({ data: { name: 'Busy workshop' } });
    const type = await prisma.itemType.create({ data: { workspaceId: workspace.id, name: 'Filament' } });
    const item = await prisma.item.create({ data: { workspaceId: workspace.id, itemTypeId: type.id, name: 'PLA Black', quantity: 0, fields: {} } });
    const { moveStock } = await import('@/services/stock');
    // Each reads the level and then writes it, as a stock change from the app does.
    await Promise.all(Array.from({ length: 40 }, () => prisma.$transaction((tx) => moveStock(tx, { workspaceId: workspace.id, itemId: item.id, delta: 1, reason: 'restock' }))));
    expect((await prisma.item.findUniqueOrThrow({ where: { id: item.id } })).quantity).toBe(40);
    expect(await prisma.stockMovement.count({ where: { itemId: item.id } })).toBe(40);
  });
});
