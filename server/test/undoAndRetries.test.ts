import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/db';
import { member, startApp } from './http';

let app: Awaited<ReturnType<typeof startApp>>;
let operator: string;
let admin: string;
let workspaceId: string;
let itemId: string;
let typeId: string;
const ws = (path: string) => `/workspaces/${workspaceId}${path}`;
const quantity = async () => (await prisma.item.findUniqueOrThrow({ where: { id: itemId } })).quantity;

beforeAll(async () => {
  app = await startApp();
  workspaceId = (await prisma.workspace.create({ data: { name: 'Shop' } })).id;
  operator = await member('operator@example.test', workspaceId, 'operator');
  admin = await member('admin@example.test', workspaceId, 'admin');
  typeId = (await prisma.itemType.create({ data: { workspaceId, name: 'Filament' } })).id;
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

describe('sending the same request twice', () => {
  const key = (name: string) => ({ 'Idempotency-Key': `test-key-${name}` });
  const named = (name: string) => prisma.item.count({ where: { workspaceId, name } });

  it('makes one record when the key is the same, and gives the same answer back', async () => {
    const body = { name: 'PETG Blue', itemTypeId: typeId };
    const first = await app.raw('POST', ws('/items'), admin, body, key('one'));
    const again = await app.raw('POST', ws('/items'), admin, body, key('one'));
    expect(first.status).toBe(201);
    expect(first.headers.get('idempotent-replayed')).toBeNull();
    expect(again.status).toBe(201);
    expect(again.headers.get('idempotent-replayed')).toBe('true');
    expect(((await again.json()) as { id: string }).id).toBe(((await first.json()) as { id: string }).id);
    expect(await named('PETG Blue')).toBe(1);
    // Written down once, too.
    expect(await prisma.activityLog.count({ where: { workspaceId, action: 'item.create', summary: { contains: 'PETG Blue' } } })).toBe(1);
  });

  it('does the work once when both arrive at the same moment', async () => {
    const body = { name: 'ASA Grey', itemTypeId: typeId };
    const both = await Promise.all([app.raw('POST', ws('/items'), admin, body, key('pair')), app.raw('POST', ws('/items'), admin, body, key('pair'))]);
    expect(both.map((response) => response.status)).toEqual([201, 201]);
    expect(await named('ASA Grey')).toBe(1);
  });

  it('takes stock away once, and still offers the undo on the repeat', async () => {
    const before = await quantity();
    const change = { mode: 'delta', value: -25 };
    const first = await app.raw('POST', ws(`/items/${itemId}/adjust`), admin, change, key('use'));
    const again = await app.raw('POST', ws(`/items/${itemId}/adjust`), admin, change, key('use'));
    expect(await quantity()).toBe(before - 25);
    expect(again.headers.get('x-undo-activity')).toBe(first.headers.get('x-undo-activity'));
  });

  it('makes two records for two keys, or for no key at all', async () => {
    const body = { name: 'TPU Red', itemTypeId: typeId };
    await app.raw('POST', ws('/items'), admin, body, key('a'));
    await app.raw('POST', ws('/items'), admin, body, key('b'));
    await app.raw('POST', ws('/items'), admin, body);
    await app.raw('POST', ws('/items'), admin, body);
    expect(await named('TPU Red')).toBe(4);
  });

  it('keeps one member\'s key apart from another\'s', async () => {
    const body = { mode: 'delta', value: -1 };
    const before = await quantity();
    await app.raw('POST', ws(`/items/${itemId}/adjust`), admin, body, key('shared'));
    await app.raw('POST', ws(`/items/${itemId}/adjust`), operator, body, key('shared'));
    expect(await quantity()).toBe(before - 2);
  });

  it('refuses a key that was used for something else', async () => {
    await app.raw('POST', ws('/items'), admin, { name: 'PLA White', itemTypeId: typeId }, key('reused'));
    const other = await app.raw('POST', ws('/items'), admin, { name: 'PLA Green', itemTypeId: typeId }, key('reused'));
    expect(other.status).toBe(422);
    expect(await named('PLA Green')).toBe(0);
  });

  it('does not remember a failure: the same key can be tried again', async () => {
    const refused = await app.raw('POST', ws('/items'), admin, { name: '', itemTypeId: typeId }, key('retry'));
    expect(refused.status).toBe(400);
    const again = await app.raw('POST', ws('/items'), admin, { name: '', itemTypeId: typeId }, key('retry'));
    expect(again.status).toBe(400);
    expect(again.headers.get('idempotent-replayed')).toBeNull();
  });

  it('turns away a key that is not one', async () => {
    const response = await app.raw('POST', ws('/items'), admin, { name: 'Nylon', itemTypeId: typeId }, { 'Idempotency-Key': 'no' });
    expect(response.status).toBe(400);
    expect(await named('Nylon')).toBe(0);
  });
});
