import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { simDocument, simFleet, type SimPrinter } from '@filament-tracker/protocol/fixtures';
import { prisma } from '@/db';
import { EMPTY_SETTLE_MS, syncFeeders, type SyncTarget } from '@/integrations/amsSync';
import { bambuAdapter, readBambu } from '@/integrations/bambu/normalize';
import { ingestReport, bridgeConnected, resetRegistry, statesForWorkspace, trackPrinterById, writesSettled } from '@/integrations/registry';

let target: SyncTarget;
let printer: SimPrinter;
let filamentTypeId: string;
const emptySince = new Map<string, number>();
const sync = (now?: number) => syncFeeders(target, readBambu(simDocument(printer)), emptySince, now);
const slots = async () =>
  (await prisma.subUnit.findMany({ where: { workspaceId: target.workspaceId }, orderBy: { name: 'asc' }, include: { slots: { orderBy: { position: 'asc' }, include: { item: true } } } }));
const spool = (name: string, material: string, colour: string, tagId: string | null = null) =>
  prisma.item.create({ data: { workspaceId: target.workspaceId, itemTypeId: filamentTypeId, name, quantity: 500, fields: { material, colour }, tagId } });

beforeAll(async () => {
  printer = simFleet()[0];
  const workspace = await prisma.workspace.create({ data: { name: 'Test' } });
  const type = await prisma.itemType.create({
    data: { workspaceId: workspace.id, name: 'Filament', fields: { create: [
      { key: 'material', label: 'Material', fieldType: 'text', options: [] },
      { key: 'colour', label: 'Colour', fieldType: 'color', options: [] },
    ] } },
  });
  filamentTypeId = type.id;
  const machine = await prisma.machine.create({ data: { workspaceId: workspace.id, name: 'X1C' } });
  target = { workspaceId: workspace.id, machineId: machine.id, machineName: machine.name, serial: printer.serial, adapter: bambuAdapter };
});
afterAll(() => prisma.$disconnect());

describe('syncing feeders and spools', () => {
  it('creates one unit per feeder with a slot per tray, once', async () => {
    expect((await sync()).changed).toBe(true);
    const units = await slots();
    // The outside spool holder is empty, so it gets no unit.
    expect(units.map((unit) => [unit.name, unit.kind, unit.slots.length])).toEqual([['AMS 1', 'AMS', 4], ['AMS 2', 'AMS', 4]]);
    expect(units[0].externalId).toBe(`bambu:${printer.serial}:ams:0`);
    expect((units[0].slots[0].detected as { material: string }).material).toBe('PLA');
    expect((await sync()).changed).toBe(false);
    expect(await prisma.subUnit.count()).toBe(2);
  });

  it('loads a spool it recognises by tag, moving it from wherever it was', async () => {
    const tag = readBambu(simDocument(printer)).feeders[0].trays[1].tagId!;
    const white = await spool('PLA White', 'PLA', '#ffffff', tag);
    // Swap the same white spool out and in again so the tray counts as changed.
    const original = printer.feeders[0].trays[1];
    printer.feeders[0].trays[1] = null;
    await sync(0);
    await sync(EMPTY_SETTLE_MS + 1);
    printer.feeders[0].trays[1] = original;
    await sync();
    const slot = (await slots())[0].slots[1];
    expect(slot.itemId).toBe(white.id);
    expect(slot.source).toBe('printer');
    const log = await prisma.activityLog.findFirst({ where: { action: 'printer.slots' }, orderBy: { createdAt: 'desc' } });
    expect(log).toMatchObject({ userId: null, userName: 'X1C' });
    expect(log?.summary).toContain('Loaded PLA White into AMS 1 slot 2');
  });

  it('leaves a member\'s choice alone until the tray changes, then keeps it only if it still fits', async () => {
    const petg = await spool('PETG Blue', 'PETG', '#1f6feb');
    const unit = (await slots())[0];
    const slot = unit.slots[2];
    await prisma.slot.update({ where: { id: slot.id }, data: { itemId: petg.id, source: 'manual' } });
    await sync();
    expect((await slots())[0].slots[2].itemId).toBe(petg.id);
    // Same material, nearly the same colour: still the same spool as far as anyone can tell.
    printer.feeders[0].trays[2] = { type: 'PETG', color: '2070e8' };
    await sync();
    expect((await slots())[0].slots[2].itemId).toBe(petg.id);
    // A different material cannot be the item that was there.
    printer.feeders[0].trays[2] = { type: 'ABS', color: '2070e8' };
    await sync();
    expect((await slots())[0].slots[2].itemId).toBeNull();
  });

  it('only unloads once a tray has stayed empty', async () => {
    const black = await spool('PLA Black', 'PLA', '#000000');
    const slot = (await slots())[0].slots[0];
    await prisma.slot.update({ where: { id: slot.id }, data: { itemId: black.id } });
    printer.feeders[0].trays[0] = null;
    const first = await sync(1_000_000);
    expect(first.retryInMs).toBeGreaterThan(0);
    expect((await slots())[0].slots[0].itemId).toBe(black.id);
    const second = await sync(1_000_000 + EMPTY_SETTLE_MS + 1);
    expect(second.retryInMs).toBeNull();
    expect((await slots())[0].slots[0].itemId).toBeNull();
  });

  it('never lets one item sit in two slots', async () => {
    const tag = 'F'.repeat(32);
    const roaming = await spool('Roaming', 'PLA', '#00ff00', tag);
    printer.feeders[1].trays[1] = { type: 'PLA', sub: 'PLA Basic', color: '00ff00', uuid: tag, remain: 50, weight: 1000 };
    await sync();
    printer.feeders[1].trays[1] = null;
    printer.feeders[1].trays[2] = { type: 'PLA', sub: 'PLA Basic', color: '00ff00', uuid: tag, remain: 50, weight: 1000 };
    await sync();
    const holding = (await prisma.slot.findMany({ where: { itemId: roaming.id }, include: { subUnit: true } }));
    expect(holding.map((slot) => [slot.subUnit.name, slot.position])).toEqual([['AMS 2', 3]]);
  });
});

describe('drying', () => {
  it('marks the spools in a feeder as dried the day its drying cycle ends', async () => {
    await prisma.customField.create({ data: { itemTypeId: filamentTypeId, key: 'last_dried', label: 'Last dried', fieldType: 'date', options: [] } });
    const nylon = await spool('PA Black', 'PA', '#111111');
    const unit = (await slots())[0];
    await prisma.slot.updateMany({ where: { subUnitId: unit.id, position: 4 }, data: { itemId: nylon.id } });
    printer.feeders[0].dryMinutes = 120;
    await sync();
    expect((await slots())[0].statusNote).toMatch(/^Drying, about 2 h left/);
    expect(((await prisma.item.findUniqueOrThrow({ where: { id: nylon.id } })).fields as Record<string, unknown>).last_dried).toBeUndefined();
    printer.feeders[0].dryMinutes = 0;
    await sync(Date.UTC(2026, 10, 16, 9));
    expect((await slots())[0].statusNote).toBe('');
    expect(((await prisma.item.findUniqueOrThrow({ where: { id: nylon.id } })).fields as Record<string, unknown>).last_dried).toBe('2026-11-16');
    const log = await prisma.activityLog.findFirstOrThrow({ where: { action: 'printer.slots' }, orderBy: { createdAt: 'desc' } });
    expect(log.summary).toContain('as dried today');
    // Nothing more happens while it stays idle.
    expect((await sync()).changed).toBe(false);
  });
});

describe('the live registry', () => {
  it('takes a full report, then patches, and asks to start over on a gap, without writing per report', async () => {
    const bridge = await prisma.bridge.create({ data: { workspaceId: target.workspaceId, name: 'B', capabilities: [] } });
    const machine = await prisma.machine.create({ data: { workspaceId: target.workspaceId, name: 'P1S' } });
    const p1s = simFleet()[1];
    const link = await prisma.printerLink.create({ data: { workspaceId: target.workspaceId, machineId: machine.id, bridgeId: bridge.id, serial: p1s.serial, host: '192.168.1.9' } });
    await trackPrinterById(link.id);
    bridgeConnected(bridge.id);

    expect(ingestReport(bridge.id, { printerId: link.id, seq: 0, kind: 'patch', data: {} })).toEqual({ ok: false, resync: true });
    expect(ingestReport(bridge.id, { printerId: link.id, seq: 0, kind: 'full', data: simDocument(p1s) })).toEqual({ ok: true });
    const before = (await prisma.printerLink.findUniqueOrThrow({ where: { id: link.id } })).lastStateAt;
    for (let seq = 1; seq <= 20; seq += 1) {
      expect(ingestReport(bridge.id, { printerId: link.id, seq, kind: 'patch', data: { print: { mc_percent: seq, gcode_state: 'RUNNING', subtask_name: 'cube' } } })).toEqual({ ok: true });
    }
    await writesSettled();
    // Twenty progress reports and not one write of the reading.
    expect((await prisma.printerLink.findUniqueOrThrow({ where: { id: link.id } })).lastStateAt).toEqual(before);
    const state = statesForWorkspace(target.workspaceId).find((entry) => entry.printerLinkId === link.id)!;
    expect(state.phase).toBe('printing');
    expect(state.print?.progress).toBe(20);
    // A duplicate is ignored; a jump ahead means something was lost.
    expect(ingestReport(bridge.id, { printerId: link.id, seq: 20, kind: 'patch', data: { print: { mc_percent: 99 } } })).toEqual({ ok: true });
    expect(ingestReport(bridge.id, { printerId: link.id, seq: 25, kind: 'patch', data: {} })).toEqual({ ok: false, resync: true });
    // Another bridge cannot speak for this printer.
    expect(ingestReport('someone-else', { printerId: link.id, seq: 0, kind: 'full', data: {} })).toEqual({ ok: true });
    expect(statesForWorkspace(target.workspaceId).find((entry) => entry.printerLinkId === link.id)!.print?.progress).toBe(20);
    // Let the print-following that those reports set off finish before the database goes away.
    await new Promise((resolve) => setTimeout(resolve, 300));
    resetRegistry();
  });
});
