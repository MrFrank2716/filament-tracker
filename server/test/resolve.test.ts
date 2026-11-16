import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp } from '@/app';
import { signToken } from '@/auth';
import { prisma } from '@/db';

/** These go through the real HTTP app, because who may see what is decided by its guards. */
let base: string;
let close: () => Promise<void>;
let memberToken: string;
let strangerToken: string;
let workspaceId: string;
let itemId: string;
let archivedId: string;
let locationId: string;

const get = async (path: string, token: string) => {
  const response = await fetch(`${base}${path}`, { headers: { Authorization: `Bearer ${token}` } });
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
};

beforeAll(async () => {
  const server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  close = () => new Promise((resolve) => server.close(() => resolve()));

  const member = await prisma.user.create({ data: { email: 'member@example.test', name: 'Member', passwordHash: 'x' } });
  const stranger = await prisma.user.create({ data: { email: 'stranger@example.test', name: 'Stranger', passwordHash: 'x' } });
  memberToken = signToken(member);
  strangerToken = signToken(stranger);
  const workspace = await prisma.workspace.create({ data: { name: 'Shop', members: { create: { userId: member.id, role: 'viewer' } } } });
  workspaceId = workspace.id;
  const type = await prisma.itemType.create({ data: { workspaceId, name: 'Filament' } });
  locationId = (await prisma.location.create({ data: { workspaceId, name: 'Shelf A' } })).id;
  itemId = (await prisma.item.create({ data: { workspaceId, itemTypeId: type.id, name: 'PLA Black', fields: {} } })).id;
  archivedId = (await prisma.item.create({ data: { workspaceId, itemTypeId: type.id, name: 'Old spool', fields: {}, archived: true } })).id;
});
afterAll(async () => {
  await close();
  await prisma.$disconnect();
});

describe('resolving the id on a label', () => {
  it('tells a member which workspace an item or location is in', async () => {
    expect(await get(`/resolve/item/${itemId}`, memberToken)).toEqual({ status: 200, body: { workspaceId, archived: false, name: 'PLA Black' } });
    expect(await get(`/resolve/location/${locationId}`, memberToken)).toEqual({ status: 200, body: { workspaceId, archived: false, name: 'Shelf A' } });
  });

  it('says when a spool is no longer in stock', async () => {
    expect((await get(`/resolve/item/${archivedId}`, memberToken)).body.archived).toBe(true);
  });

  it('tells someone outside the workspace nothing, and needs a sign-in', async () => {
    expect((await get(`/resolve/item/${itemId}`, strangerToken)).status).toBe(404);
    expect((await get(`/resolve/location/${locationId}`, strangerToken)).status).toBe(404);
    expect((await get('/resolve/item/nope', memberToken)).status).toBe(404);
    expect((await get(`/resolve/item/${itemId}`, 'not-a-token')).status).toBe(401);
  });
});
