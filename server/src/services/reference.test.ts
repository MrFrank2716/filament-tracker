import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadFilaments } from '@/reference/filaments';
import { normalizeFields } from '@/routes/items';
import type { z } from 'zod';
import { addFromReference, inchLabel, itemDrafts, referenceAddInput } from '@/services/reference';
import { importSnapshot, snapshotSchema } from '@/services/snapshot';

/**
 * Runs against a real, migrated SQLite database in a temporary folder, because the point of
 * this service is how it meets existing workspace data: renamed categories, old option lists,
 * fields whose type the user changed.
 */

const serverDir = fileURLToPath(new URL('../..', import.meta.url));
let dir: string;
let db: PrismaClient;
let userId: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'wrkbench-reference-'));
  const url = `file:${join(dir, 'test.db')}`;
  execFileSync('npx', ['prisma', 'migrate', 'deploy'], { cwd: serverDir, env: { ...process.env, DATABASE_URL: url }, stdio: 'pipe', shell: process.platform === 'win32' });
  db = new PrismaClient({ datasourceUrl: url });
}, 60_000);

afterAll(async () => {
  await db?.$disconnect();
  rmSync(dir, { recursive: true, force: true });
});

async function workspace(name: string): Promise<string> {
  userId ??= (await db.user.create({ data: { email: 'test@example.test', name: 'Test', passwordHash: 'x' } })).id;
  return (await db.workspace.create({ data: { name, members: { create: { userId, role: 'owner' } } } })).id;
}

/** Takes the request body as a client would send it, defaults and all. */
const add = (workspaceId: string, input: z.input<typeof referenceAddInput>) =>
  db.$transaction((tx) => addFromReference(tx, workspaceId, referenceAddInput.parse(input), userId));

describe('pure helpers', () => {
  it('writes imperial lengths as fractions of an inch', () => {
    expect(inchLabel(12.7)).toBe('1/2"');
    expect(inchLabel(25.4)).toBe('1"');
    expect(inchLabel(31.75)).toBe('1-1/4"');
    expect(inchLabel(9.53)).toBe('3/8"');
  });

  it('names fasteners by size, length, standard and grade', () => {
    const drafts = itemDrafts([{ kind: 'fastener', id: 'fx-iso4762', size: 'M3', lengths: [8, 12], material: 0, count: 100 }]);
    expect(drafts.map((d) => d.name)).toEqual(['M3 × 8 mm socket cap screw, ISO 4762, A2-70', 'M3 × 12 mm socket cap screw, ISO 4762, A2-70']);
    expect(drafts[0]).toMatchObject({ unit: 'pcs', quantity: 100, fields: { kind: 'Screw', size: 'M3', length: 8, thread_pitch: 0.5, drive: 'Hex socket' } });
  });

  it('tracks liquids by volume and abrasives by the piece', () => {
    const [oil] = itemDrafts([{ kind: 'finish', id: 'fn-danish-oil', variants: ['500 ml'], count: 2 }]);
    expect(oil).toMatchObject({ unit: 'ml', quantity: 1000, capacity: 500 });
    const [disc] = itemDrafts([{ kind: 'finish', id: 'fn-disc-125', variants: ['P120'], count: 50 }]);
    expect(disc).toMatchObject({ unit: 'pcs', quantity: 50, capacity: null, fields: { grit: 120 } });
  });

  it('refuses options an entry does not have', () => {
    expect(() => itemDrafts([{ kind: 'fastener', id: 'fx-iso4762', size: 'M3', lengths: [7], material: 0, count: 0 }])).toThrow(/not listed/);
    expect(() => itemDrafts([{ kind: 'sheet', id: 'sh-mdf', thicknesses: [5], width: 600, length: 400, count: 1 }])).toThrow(/not listed/);
  });

  it('caps how many items one request can add', () => {
    const line = loadFilaments().lines.find((l) => l.colours.length >= 20)!;
    const pick = { kind: 'filament' as const, id: line.id, colours: line.colours.slice(0, 20).map(([n]) => n), weight: line.weights[0].g, diameter: line.diameters[0], count: 20 };
    expect(() => itemDrafts([pick])).toThrow(/at most 300/);
  });
});

describe('adding machines', () => {
  it('creates the machine, its type and schedules, attachments with slots, and specs', async () => {
    const ws = await workspace('Machines');
    const result = await add(ws, { picks: [{ kind: 'machine', id: 'mc-bambu-lab-p1s', attachments: ['ams-2-pro', 'ams-ht'] }] });
    expect(result.machines.map((m) => m.name)).toEqual(['Bambu Lab P1S']);
    expect(result.subUnits).toBe(2);

    const machine = await db.machine.findFirstOrThrow({ where: { workspaceId: ws }, include: { machineType: true, subUnits: { include: { slots: true } } } });
    expect(machine).toMatchObject({ manufacturer: 'Bambu Lab', model: 'P1S' });
    expect(machine.machineType?.name).toBe('3D printer');
    expect(machine.specs).toEqual([{ label: 'Build volume', value: '256 × 256 × 256', unit: 'mm' }]);
    expect(machine.subUnits.map((s) => [s.name, s.slots.length]).sort()).toEqual([['AMS 2 Pro', 4], ['AMS HT', 1]]);
    expect(await db.maintenanceTask.count({ where: { workspaceId: ws, machineTypeId: machine.machineTypeId } })).toBeGreaterThan(0);
  });

  it('numbers a second machine of the same model and leaves the type\'s schedules alone', async () => {
    const ws = await workspace('Twice');
    await add(ws, { picks: [{ kind: 'machine', id: 'mc-bambu-lab-a1' }] });
    const tasksBefore = await db.maintenanceTask.count({ where: { workspaceId: ws } });
    const again = await add(ws, { picks: [{ kind: 'machine', id: 'mc-bambu-lab-a1' }] });
    expect(again.machines[0].name).toBe('Bambu Lab A1 2');
    expect(await db.maintenanceTask.count({ where: { workspaceId: ws } })).toBe(tasksBefore);
    expect(await db.machineType.count({ where: { workspaceId: ws } })).toBe(1);
  });

  it('gives generic equipment its own schedules and adds dryers as standalone hardware', async () => {
    const ws = await workspace('Generic');
    await add(ws, { picks: [{ kind: 'machine', id: 'mc-bandsaw' }, { kind: 'machine', id: 'mc-filament-dryer-four-spools' }] });
    const saw = await db.machine.findFirstOrThrow({ where: { workspaceId: ws }, include: { maintenanceTasks: true } });
    expect(saw.manufacturer).toBe('');
    expect(saw.maintenanceTasks.map((t) => t.name)).toContain('Check blade tension and tracking');
    const dryer = await db.subUnit.findFirstOrThrow({ where: { workspaceId: ws }, include: { slots: true } });
    expect(dryer).toMatchObject({ machineId: null, kind: 'Filament dryer' });
    expect(dryer.slots).toHaveLength(4);
  });
});

describe('adding items to existing workspaces', () => {
  it('extends an old filament category with new fields and the options it needs', async () => {
    const ws = await workspace('Old filament');
    // A category as it was created before the catalogue existed.
    await importSnapshot(db, ws, snapshotSchema.parse({
      units: [{ ref: 'u-g', name: 'Grams', symbol: 'g' }],
      itemTypes: [{
        ref: 't', name: 'Filament', defaultUnit: 'u-g',
        fields: [
          { key: 'material', label: 'Material', fieldType: 'select', options: ['PLA', 'PETG', 'ABS'], required: true },
          { key: 'colour', label: 'Colour', fieldType: 'color' },
          { key: 'brand', label: 'Brand', fieldType: 'text' },
        ],
      }],
    }), userId);

    const line = loadFilaments().lines.find((l) => l.material === 'PCTG' && l.colours.length >= 2)!;
    const result = await add(ws, { picks: [{ kind: 'filament', id: line.id, colours: line.colours.slice(0, 2).map(([n]) => n), weight: line.weights[0].g, diameter: line.diameters[0] }] });
    expect(result.items).toBe(2);
    expect(await db.itemType.count({ where: { workspaceId: ws } })).toBe(1);

    const type = await db.itemType.findFirstOrThrow({ where: { workspaceId: ws }, include: { fields: true } });
    const material = type.fields.find((f) => f.key === 'material')!;
    expect(material.options).toEqual(['PLA', 'PETG', 'ABS', 'PCTG']); // only what was needed, appended
    expect(type.fields.map((f) => f.key)).toEqual(expect.arrayContaining(['density', 'nozzle_temp', 'spool_weight']));

    // What the edit form would send back must pass the same validation as a hand-made item.
    const items = await db.item.findMany({ where: { workspaceId: ws } });
    for (const item of items) {
      expect(item.quantity).toBe(line.weights[0].g);
      expect(() => normalizeFields(type.fields, item.fields as Record<string, string | number>)).not.toThrow();
    }
    expect(await db.stockMovement.count({ where: { workspaceId: ws, reason: 'initial' } })).toBe(2);
  });

  it('uses a renamed category when asked, and skips items it already has', async () => {
    const ws = await workspace('Renamed');
    await importSnapshot(db, ws, snapshotSchema.parse({ itemTypes: [{ ref: 't', name: 'Hardware', fields: [{ key: 'kind', label: 'Kind', fieldType: 'text' }] }] }), userId);
    const hardware = await db.itemType.findFirstOrThrow({ where: { workspaceId: ws } });
    const pick = { kind: 'fastener' as const, id: 'fx-iso4762', size: 'M3', lengths: [8, 10], count: 50 };

    const first = await add(ws, { itemTypeId: hardware.id, picks: [pick] });
    expect(first).toMatchObject({ items: 2, skipped: [], category: { id: hardware.id, name: 'Hardware' } });
    expect(await db.itemType.count({ where: { workspaceId: ws } })).toBe(1);

    const second = await add(ws, { itemTypeId: hardware.id, picks: [pick] });
    expect(second.items).toBe(0);
    expect(second.skipped).toHaveLength(2);
  });

  it('drops a value whose field the user changed to another type', async () => {
    const ws = await workspace('Changed type');
    await importSnapshot(db, ws, snapshotSchema.parse({ itemTypes: [{ ref: 't', name: 'Sheet stock', fields: [{ key: 'thickness', label: 'Thickness', fieldType: 'color' }] }] }), userId);
    await add(ws, { picks: [{ kind: 'sheet', id: 'sh-mdf', thicknesses: [6], width: 600, length: 400, count: 3 }] });
    const item = await db.item.findFirstOrThrow({ where: { workspaceId: ws } });
    expect(item.fields).not.toHaveProperty('thickness');
    expect(item.fields).toMatchObject({ material: 'MDF', width: 600, length: 400 });
    expect(item.quantity).toBe(3);
  });

  it('refuses, and adds nothing, when the category has a required field it cannot fill', async () => {
    const ws = await workspace('Required');
    await importSnapshot(db, ws, snapshotSchema.parse({ itemTypes: [{ ref: 't', name: 'Endmill', fields: [{ key: 'bin', label: 'Bin number', fieldType: 'text', required: true }] }] }), userId);
    await expect(add(ws, { picks: [{ kind: 'endmill', id: 'em-flat-3-2f-3' }] })).rejects.toThrow(/requires Bin number/);
    expect(await db.item.count({ where: { workspaceId: ws } })).toBe(0);
    // The fields the failed add would have created were rolled back too.
    expect(await db.customField.count({ where: { itemType: { workspaceId: ws } } })).toBe(1);
  });

  it('says which items it made, and marks them as fitting a machine when asked', async () => {
    const ws = await workspace('From a printer');
    const machine = await db.machine.create({ data: { workspaceId: ws, name: 'P1S' } });
    const line = loadFilaments().lines[0];
    const result = await add(ws, { picks: [{ kind: 'filament', id: line.id, colours: [line.colours[0][0]], weight: line.weights[0].g, diameter: line.diameters[0] }], machineIds: [machine.id] });
    expect(result.itemIds).toHaveLength(1);
    const item = await db.item.findUniqueOrThrow({ where: { id: result.itemIds[0] }, include: { compatibleMachines: true } });
    expect(item.compatibleMachines.map((m) => m.id)).toEqual([machine.id]);
    // A machine from another workspace is refused, and nothing is added.
    const other = await db.machine.create({ data: { workspaceId: await workspace('Elsewhere'), name: 'X' } });
    await expect(add(ws, { picks: [{ kind: 'filament', id: line.id, colours: [line.colours[0][0]], weight: line.weights[0].g, diameter: line.diameters[0] }], machineIds: [other.id] })).rejects.toThrow();
    expect(await db.item.count({ where: { workspaceId: ws } })).toBe(1);
  });

  it('refuses a mix of item kinds in one request', async () => {
    const ws = await workspace('Mixed');
    await expect(add(ws, { picks: [{ kind: 'endmill', id: 'em-flat-3-2f-3' }, { kind: 'sheet', id: 'sh-mdf', thicknesses: [6], width: 600, length: 400 }] })).rejects.toThrow(/one kind/);
  });
});
