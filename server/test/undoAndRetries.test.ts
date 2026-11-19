import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/db';
import { member, startApp } from './http';

let app: Awaited<ReturnType<typeof startApp>>;
let operator: string;
let admin: string;
let workspaceId: string;
let itemId: string;
const ws = (path: string) => `/workspaces/${workspaceId}${path}`;
const quantity = async () => (await prisma.item.findUniqueOrThrow({ where: { id: itemId } })).quantity;

beforeAll(async () => {
  app = await startApp();
  workspaceId = (await prisma.workspace.create({ data: { name: 'Shop' } })).id;
  operator = await member('operator@example.test', workspaceId, 'operator');
  admin = await member('admin@example.test', workspaceId, 'admin');
  const typeId = (await prisma.itemType.create({ data: { workspaceId, name: 'Filament' } })).id;
  itemId = (await prisma.item.create({ data: { workspaceId, itemTypeId: typeId, name: 'PLA Black', quantity: 1000, fields: {} } })).id;
});
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe('offering undo straight after a stock change', () => {
  it('tells an admin which activity entry the change became, and undoing that entry puts the stock back', async () => {
    const changed = await app.raw('POST', ws(`/items/${itemId}/adjust`), admin, { mode: 'delta', value: -120 });
    expect(changed.status).toBe(200);
    const undoId = changed.headers.get('x-undo-activity');
    expect(undoId).toBeTruthy();
    expect(await quantity()).toBe(880);
    const entry = await prisma.activityLog.findUniqueOrThrow({ where: { id: undoId! } });
    expect(entry.action).toBe('item.adjust');

    expect((await app.call('POST', ws(`/activity/${undoId}/undo`), admin)).status).toBe(204);
    expect(await quantity()).toBe(1000);
  });

  it('does not offer it to an operator, who may not undo', async () => {
    const changed = await app.raw('POST', ws(`/items/${itemId}/adjust`), operator, { mode: 'delta', value: -10 });
    expect(changed.status).toBe(200);
    expect(changed.headers.get('x-undo-activity')).toBeNull();
  });

  it('does not offer it for a change that moved no stock', async () => {
    const renamed = await app.raw('PATCH', ws(`/items/${itemId}`), admin, { notes: 'Opened in March' });
    expect(renamed.status).toBe(200);
    expect(renamed.headers.get('x-undo-activity')).toBeNull();
  });
});
