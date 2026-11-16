import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/db';
import { member, startApp } from './http';

let app: Awaited<ReturnType<typeof startApp>>;
let viewer: string;
let operator: string;
let admin: string;
let stranger: string;
let workspaceId: string;
let typeId: string;
let itemId: string;
let archivedId: string;
let shelfId: string;
const ws = (path: string) => `/workspaces/${workspaceId}${path}`;
const locationOf = async (id: string) => (await prisma.item.findUniqueOrThrow({ where: { id } })).locationId;

beforeAll(async () => {
  app = await startApp();
  workspaceId = (await prisma.workspace.create({ data: { name: 'Shop' } })).id;
  viewer = await member('viewer@example.test', workspaceId, 'viewer');
  operator = await member('operator@example.test', workspaceId, 'operator');
  admin = await member('admin@example.test', workspaceId, 'admin');
  stranger = await member('stranger@example.test', null);
  typeId = (await prisma.itemType.create({ data: { workspaceId, name: 'Filament' } })).id;
  shelfId = (await prisma.location.create({ data: { workspaceId, name: 'Shelf A' } })).id;
  itemId = (await prisma.item.create({ data: { workspaceId, itemTypeId: typeId, name: 'PLA Black', fields: {} } })).id;
  archivedId = (await prisma.item.create({ data: { workspaceId, itemTypeId: typeId, name: 'Old spool', fields: {}, archived: true } })).id;
});
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe('resolving the id on a label', () => {
  it('tells a member which workspace an item or location is in', async () => {
    expect(await app.call('GET', `/resolve/item/${itemId}`, viewer)).toEqual({ status: 200, body: { workspaceId, archived: false, name: 'PLA Black' } });
    expect(await app.call('GET', `/resolve/location/${shelfId}`, viewer)).toEqual({ status: 200, body: { workspaceId, archived: false, name: 'Shelf A' } });
  });

  it('says when a spool is no longer in stock', async () => {
    expect((await app.call('GET', `/resolve/item/${archivedId}`, viewer)).body?.archived).toBe(true);
  });

  it('tells someone outside the workspace nothing, and needs a sign-in', async () => {
    expect((await app.call('GET', `/resolve/item/${itemId}`, stranger)).status).toBe(404);
    expect((await app.call('GET', `/resolve/location/${shelfId}`, stranger)).status).toBe(404);
    expect((await app.call('GET', '/resolve/item/nope', viewer)).status).toBe(404);
    expect((await app.call('GET', `/resolve/item/${itemId}`, 'not-a-token')).status).toBe(401);
  });
});

describe('putting things away', () => {
  it('lets an operator move items to a location, and logs it as one line', async () => {
    const second = await prisma.item.create({ data: { workspaceId, itemTypeId: typeId, name: 'PETG Blue', fields: {} } });
    const moved = await app.call('POST', ws('/items/move'), operator, { itemIds: [itemId, second.id], locationId: shelfId });
    expect(moved).toEqual({ status: 200, body: { moved: 2 } });
    expect(await locationOf(itemId)).toBe(shelfId);
    expect(await locationOf(second.id)).toBe(shelfId);
    const log = await prisma.activityLog.findFirstOrThrow({ where: { workspaceId }, orderBy: { createdAt: 'desc' } });
    expect(log.summary).toBe('Moved 2 items to Shelf A');
    // Moving what is already there changes nothing.
    expect((await app.call('POST', ws('/items/move'), operator, { itemIds: [itemId], locationId: shelfId })).body).toEqual({ moved: 0 });
    expect((await app.call('POST', ws('/items/move'), operator, { itemIds: [itemId], locationId: null })).body).toEqual({ moved: 1 });
    expect(await locationOf(itemId)).toBeNull();
  });

  it('refuses viewers, and items or locations from another workspace', async () => {
    expect((await app.call('POST', ws('/items/move'), viewer, { itemIds: [itemId], locationId: shelfId })).status).toBe(403);
    const other = await prisma.workspace.create({ data: { name: 'Other' } });
    const theirs = await prisma.location.create({ data: { workspaceId: other.id, name: 'Their shelf' } });
    expect((await app.call('POST', ws('/items/move'), operator, { itemIds: [itemId], locationId: theirs.id })).status).toBe(400);
    expect((await app.call('POST', ws('/items/move'), operator, { itemIds: ['not-an-item'], locationId: shelfId })).status).toBe(400);
  });

  it('lets an operator tag a spool but not edit it', async () => {
    const tagged = await app.call('PUT', ws(`/items/${itemId}/tag`), operator, { tagId: 'nfc04a1b2c3' });
    expect(tagged.body?.tagId).toBe('NFC04A1B2C3');
    expect((await app.call('PATCH', ws(`/items/${itemId}`), operator, { name: 'Renamed' })).status).toBe(403);
    expect((await app.call('PUT', ws(`/items/${itemId}/tag`), viewer, { tagId: null })).status).toBe(403);
    expect((await app.call('PUT', ws(`/items/${itemId}/tag`), operator, { tagId: null })).body?.tagId).toBeNull();
  });
});

describe('deleting a location', () => {
  it('moves what was inside it up one level', async () => {
    const room = await prisma.location.create({ data: { workspaceId, name: 'Room' } });
    const cabinet = await prisma.location.create({ data: { workspaceId, name: 'Cabinet', parentId: room.id } });
    const drawer = await prisma.location.create({ data: { workspaceId, name: 'Drawer', parentId: cabinet.id } });
    const stored = await prisma.item.create({ data: { workspaceId, itemTypeId: typeId, name: 'In the cabinet', fields: {}, locationId: cabinet.id } });
    expect((await app.call('DELETE', ws(`/locations/${cabinet.id}`), operator)).status).toBe(403);
    expect((await app.call('DELETE', ws(`/locations/${cabinet.id}`), admin)).status).toBe(204);
    expect((await prisma.location.findUniqueOrThrow({ where: { id: drawer.id } })).parentId).toBe(room.id);
    expect(await locationOf(stored.id)).toBeNull();
  });
});
