import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/db';
import { member, startApp } from './http';

let app: Awaited<ReturnType<typeof startApp>>;
let viewer: string;
let admin: string;
let stranger: string;
let workspaceId: string;
const ws = (path: string) => `/workspaces/${workspaceId}${path}`;
const sizes = (body: Record<string, unknown> | null) =>
  Object.fromEntries(Object.entries(body ?? {}).flatMap(([key, value]) => (Array.isArray(value) ? [[key, value.length]] : [])));

beforeAll(async () => {
  app = await startApp();
  workspaceId = (await prisma.workspace.create({ data: { name: 'Shop' } })).id;
  viewer = await member('viewer@example.test', workspaceId, 'viewer');
  admin = await member('admin@example.test', workspaceId, 'admin');
  stranger = await member('stranger@example.test', null);
  const unit = await prisma.unit.create({ data: { workspaceId, name: 'Gram', symbol: 'g' } });
  const supplier = await prisma.supplier.create({ data: { workspaceId, name: 'Spool Co' } });
  const shelf = await prisma.location.create({ data: { workspaceId, name: 'Shelf A' } });
  const type = await prisma.itemType.create({ data: { workspaceId, name: 'Filament', defaultUnitId: unit.id } });
  const machineType = await prisma.machineType.create({ data: { workspaceId, name: 'Printer' } });
  const machine = await prisma.machine.create({ data: { workspaceId, name: 'Printer 1', machineTypeId: machineType.id, locationId: shelf.id } });
  await prisma.item.create({
    data: { workspaceId, itemTypeId: type.id, name: 'PLA Black', quantity: 800, unitId: unit.id, supplierId: supplier.id, locationId: shelf.id, fields: {} },
  });
  await prisma.maintenanceTask.create({ data: { workspaceId, name: 'Clean the bed', machineId: machine.id, intervalDays: 30 } });
  const project = await prisma.project.create({ data: { workspaceId, name: 'Shop fit-out' } });
  await prisma.job.create({ data: { workspaceId, name: 'Bracket', machineId: machine.id, projectId: project.id } });
});
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe('choosing what to export', () => {
  const everything = { units: 1, suppliers: 1, locations: 1, itemTypes: 1, machineTypes: 1, machines: 1, items: 1, subUnits: 0, maintenanceTasks: 1, projects: 1, jobs: 1 };
  const nothing = Object.fromEntries(Object.keys(everything).map((key) => [key, 0]));

  it('exports the whole workspace when nothing is chosen', async () => {
    const all = await app.call('GET', ws('/export'), viewer);
    expect(all.status).toBe(200);
    expect(sizes(all.body)).toEqual(everything);
  });

  it('exports only the chosen parts', async () => {
    expect(sizes((await app.call('GET', ws('/export?include=suppliers'), viewer)).body)).toEqual({ ...nothing, suppliers: 1 });
    expect(sizes((await app.call('GET', ws('/export?include=units,locations'), viewer)).body)).toEqual({ ...nothing, units: 1, locations: 1 });
  });

  it('adds what a chosen part needs', async () => {
    expect(sizes((await app.call('GET', ws('/export?include=inventory'), viewer)).body)).toEqual({
      ...nothing, items: 1, itemTypes: 1, units: 1, suppliers: 1, locations: 1,
    });
    expect(sizes((await app.call('GET', ws('/export?include=maintenance'), viewer)).body)).toEqual({
      ...nothing, maintenanceTasks: 1, machineTypes: 1, machines: 1, locations: 1,
    });
  });

  it('refuses an unknown or empty choice, and anyone outside the workspace', async () => {
    expect((await app.call('GET', ws('/export?include=inventory,passwords'), viewer)).status).toBe(400);
    expect((await app.call('GET', ws('/export?include='), viewer)).status).toBe(400);
    expect((await app.call('GET', ws('/export?include=inventory'), stranger)).status).toBe(404);
  });

  it('clears links into a part that was left out', async () => {
    const item = await prisma.item.findFirstOrThrow({ where: { workspaceId } });
    const machine = await prisma.machine.findFirstOrThrow({ where: { workspaceId } });
    await prisma.item.update({ where: { id: item.id }, data: { compatibleMachines: { connect: { id: machine.id } } } });
    const tray = await prisma.subUnit.create({ data: { workspaceId, name: 'Tray', machineId: machine.id, readings: [], slots: { create: { position: 1, itemId: item.id } } } });
    type Body = { items: Array<{ compatibleMachines: string[] }>; subUnits: Array<{ slots: Array<{ item: string | null }> }> };
    const read = async (query: string) => (await app.call('GET', ws(`/export${query}`), viewer)).body as unknown as Body;
    try {
      const full = await app.call('GET', ws('/export'), viewer);
      expect(full.status, JSON.stringify(full.body)).toBe(200);
      expect((await read('')).items[0].compatibleMachines).toEqual([machine.id]);
      expect((await read('')).subUnits[0].slots[0].item).toBe(item.id);
      expect((await read('?include=inventory')).items[0].compatibleMachines).toEqual([]);
      expect((await read('?include=machines')).subUnits[0].slots[0].item).toBeNull();
    } finally {
      await prisma.subUnit.delete({ where: { id: tray.id } });
      await prisma.item.update({ where: { id: item.id }, data: { compatibleMachines: { set: [] } } });
    }
  });

  it('gives a file that imports whole into another workspace', async () => {
    const copyId = (await prisma.workspace.create({ data: { name: 'Copy' } })).id;
    const owner = await member('copy@example.test', copyId, 'admin');
    const { body } = await app.call('GET', ws('/export?include=inventory'), admin);
    const imported = await app.call('POST', `/workspaces/${copyId}/import`, owner, body);
    expect(imported.status).toBe(200);
    expect(imported.body?.summary).toMatchObject({ items: 1, itemTypes: 1, units: 1, suppliers: 1, locations: 1, machines: 0, jobs: 0 });
    const item = await prisma.item.findFirstOrThrow({ where: { workspaceId: copyId }, include: { unit: true, supplier: true, location: true } });
    expect([item.unit?.symbol, item.supplier?.name, item.location?.name]).toEqual(['g', 'Spool Co', 'Shelf A']);
  });
});

describe('personal preferences', () => {
  const order = ['overview', 'inventory', 'locations', 'jobs', 'maintenance', 'machines', 'reorder', 'activity', 'settings'];
  const user = (response: { body: Record<string, unknown> | null }) => response.body?.user as Record<string, unknown>;

  it('opens the daily report by itself until the person turns that off', async () => {
    expect(user(await app.call('GET', '/auth/me', viewer)).dailyReportAuto).toBe(true);
    expect(user(await app.call('PATCH', '/auth/me/preferences', viewer, { dailyReportAuto: false })).dailyReportAuto).toBe(false);
    expect(user(await app.call('GET', '/auth/me', viewer)).dailyReportAuto).toBe(false);
    expect(user(await app.call('GET', '/auth/me', admin)).dailyReportAuto).toBe(true);
    expect((await app.call('PATCH', '/auth/me/preferences', viewer, { dailyReportAuto: 'no' })).status).toBe(400);
  });

  it('saves pages hidden on the desktop and on a phone separately', async () => {
    const layout = { order, tabBar: ['overview', 'jobs'], hiddenDesktop: ['activity'], hiddenPhone: ['reorder', 'machines'] };
    const saved = await app.call('PATCH', '/auth/me/navigation', viewer, { layout });
    expect(saved.status).toBe(200);
    expect(user(saved).navigation).toEqual(layout);
  });

  it('still takes a layout saved before pages could be hidden', async () => {
    const saved = await app.call('PATCH', '/auth/me/navigation', viewer, { layout: { order, tabBar: ['overview'] } });
    expect(user(saved).navigation).toEqual({ order, tabBar: ['overview'], hiddenDesktop: [], hiddenPhone: [] });
  });

  it('will not hide Settings, or a page that is in the tab bar', async () => {
    const base = { order, tabBar: ['overview', 'jobs'] };
    expect((await app.call('PATCH', '/auth/me/navigation', viewer, { layout: { ...base, hiddenDesktop: ['settings'] } })).status).toBe(400);
    expect((await app.call('PATCH', '/auth/me/navigation', viewer, { layout: { ...base, hiddenPhone: ['settings'] } })).status).toBe(400);
    expect((await app.call('PATCH', '/auth/me/navigation', viewer, { layout: { ...base, hiddenPhone: ['jobs'] } })).status).toBe(400);
    expect((await app.call('PATCH', '/auth/me/navigation', viewer, { layout: { ...base, hiddenDesktop: ['jobs', 'jobs'] } })).status).toBe(400);
  });
});

describe('custom field keys', () => {
  const field = (key: string) => ({ key, label: 'Odd one', fieldType: 'text' });

  it('refuses the names every JavaScript object already has, by hand or in an import', async () => {
    for (const key of ['__proto__', 'constructor', 'prototype']) {
      const created = await app.call('POST', ws('/item-types'), admin, { name: `Type ${key}`, fields: [field(key)] });
      expect(created.status).toBe(400);
      expect(created.body?.error).toMatch(/reserved/);
      const imported = await app.call('POST', ws('/import'), admin, { itemTypes: [{ ref: 't-odd', name: 'Odd', fields: [field(key)] }] });
      expect(imported.status).toBe(400);
    }
    expect((await app.call('POST', ws('/item-types'), admin, { name: 'Fine', fields: [field('constructor_2')] })).status).toBe(201);
  });
});
