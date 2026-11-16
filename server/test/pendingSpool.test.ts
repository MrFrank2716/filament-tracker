import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { simDocument, simFleet, type SimPrinter } from '@filament-tracker/protocol/fixtures';
import { prisma } from '@/db';
import { syncFeeders, type PendingSpool, type SyncTarget } from '@/integrations/amsSync';
import { bambuAdapter, readBambu } from '@/integrations/bambu/normalize';
import { armPendingSpool, bridgeConnected, cancelPendingSpool, ingestReport, resetRegistry, setLinkStatus, trackPrinterById, writesSettled } from '@/integrations/registry';
import { member, startApp } from './http';

/**
 * "Scan, then insert": a spool is scanned, then put in the printer; the one tray that changes is that spool.
 * The simulated X1C starts with AMS 1 = [tagged black PLA, tagged white PLA, untagged blue PETG, empty] and
 * AMS 2 = [tagged red PLA, empty, empty, empty].
 */
let target: SyncTarget;
let printer: SimPrinter;
let typeId: string;
const emptySince = new Map<string, number>();
const NOW = 5_000_000;
const sync = (pending: PendingSpool | null = null, now = NOW) => syncFeeders(target, readBambu(simDocument(printer)), emptySince, now, pending);
const scanned = (itemId: string): PendingSpool => ({ itemId, expiresAt: NOW + 120_000 });
const spool = (name: string, material: string, colour: string, tagId: string | null = null) =>
  prisma.item.create({ data: { workspaceId: target.workspaceId, itemTypeId: typeId, name, quantity: 500, fields: { material, colour }, tagId } });
/** The slot at a 1-based position of "AMS 1" or "AMS 2". */
const slotAt = async (unit: string, position: number) =>
  prisma.slot.findFirstOrThrow({ where: { position, subUnit: { workspaceId: target.workspaceId, name: unit } }, include: { item: true } });

beforeAll(async () => {
  printer = simFleet()[0];
  const workspace = await prisma.workspace.create({ data: { name: 'Test' } });
  typeId = (
    await prisma.itemType.create({
      data: { workspaceId: workspace.id, name: 'Filament', fields: { create: [
        { key: 'material', label: 'Material', fieldType: 'text', options: [] },
        { key: 'colour', label: 'Colour', fieldType: 'color', options: [] },
      ] } },
    })
  ).id;
  const machine = await prisma.machine.create({ data: { workspaceId: workspace.id, name: 'X1C' } });
  target = { workspaceId: workspace.id, machineId: machine.id, machineName: machine.name, serial: printer.serial, adapter: bambuAdapter };
  await sync();
});
afterAll(() => prisma.$disconnect());

describe('a scanned spool goes into the tray that changes next', () => {
  it('waits while nothing has been put in', async () => {
    const green = await spool('PLA Green', 'PLA', '#00aa00');
    expect((await sync(scanned(green.id))).pending).toBeNull();
    expect(await prisma.slot.count({ where: { itemId: green.id } })).toBe(0);
  });

  it('links it to the one tray that was loaded, and says so in the log', async () => {
    const green = await prisma.item.findFirstOrThrow({ where: { name: 'PLA Green' } });
    printer.feeders[0].trays[3] = { type: 'PLA', color: '00aa00' };
    const result = await sync(scanned(green.id));
    expect(result.pending).toEqual({ result: 'linked', place: 'AMS 1 slot 4', mismatch: false });
    const slot = await slotAt('AMS 1', 4);
    expect(slot).toMatchObject({ itemId: green.id, source: 'manual' });
    const log = await prisma.activityLog.findFirstOrThrow({ where: { action: 'printer.slots' }, orderBy: { createdAt: 'desc' } });
    expect(log.summary).toContain('Loaded PLA Green into AMS 1 slot 4: it was scanned just before going in');
    // The choice stands like one made by hand: the next look at the same tray leaves it alone.
    expect((await sync()).changed).toBe(false);
    expect((await slotAt('AMS 1', 4)).itemId).toBe(green.id);
  });

  it('links it even when the printer describes the tray as something else, and flags that', async () => {
    const white = await spool('PLA White (third party)', 'PLA', '#ffffff');
    // The tray still carries the preset of whatever was in it last.
    printer.feeders[1].trays[1] = { type: 'ABS', color: '101010' };
    expect((await sync(scanned(white.id))).pending).toEqual({ result: 'linked', place: 'AMS 2 slot 2', mismatch: true });
    expect((await slotAt('AMS 2', 2)).itemId).toBe(white.id);
  });

  it('moves the spool out of the slot it was in before', async () => {
    const green = await prisma.item.findFirstOrThrow({ where: { name: 'PLA Green' } });
    printer.feeders[1].trays[2] = { type: 'PLA', color: '00aa00' };
    await sync(scanned(green.id));
    expect((await slotAt('AMS 2', 3)).itemId).toBe(green.id);
    expect((await slotAt('AMS 1', 4)).itemId).toBeNull();
  });

  it('links nothing when two trays were loaded at once', async () => {
    const orange = await spool('PETG Orange', 'PETG', '#ff8800');
    printer.feeders[1].trays[3] = { type: 'PETG', color: 'ff8800' };
    printer.feeders[0].trays[2] = { type: 'PETG', color: 'ff8801' };
    expect((await sync(scanned(orange.id))).pending).toEqual({ result: 'dropped', reason: 'several' });
    expect(await prisma.slot.count({ where: { itemId: orange.id } })).toBe(0);
  });

  it('ignores a scan that has run out', async () => {
    const orange = await prisma.item.findFirstOrThrow({ where: { name: 'PETG Orange' } });
    printer.feeders[1].trays[3] = { type: 'PETG', color: 'ff0000' };
    expect((await sync({ itemId: orange.id, expiresAt: NOW - 1 })).pending).toBeNull();
    expect(await prisma.slot.count({ where: { itemId: orange.id } })).toBe(0);
  });

  it('lets a tag the printer reads win: that spool is loaded, and the scan keeps waiting', async () => {
    const orange = await prisma.item.findFirstOrThrow({ where: { name: 'PETG Orange' } });
    const tag = 'E'.repeat(32);
    const known = await spool('PLA Known', 'PLA', '#123456', tag);
    printer.feeders[1].trays[3] = { type: 'PLA', sub: 'PLA Basic', color: '123456', uuid: tag, remain: 80, weight: 1000 };
    expect((await sync(scanned(orange.id))).pending).toBeNull();
    expect((await slotAt('AMS 2', 4)).itemId).toBe(known.id);
  });

  it('teaches the spool a tag the printer reads and nothing in stock has yet', async () => {
    const orange = await prisma.item.findFirstOrThrow({ where: { name: 'PETG Orange' } });
    const tag = 'D'.repeat(32);
    printer.feeders[1].trays[1] = { type: 'PETG', sub: 'PETG HF', color: 'ff8800', uuid: tag, remain: 100, weight: 1000 };
    expect((await sync(scanned(orange.id))).pending).toMatchObject({ result: 'linked', place: 'AMS 2 slot 2' });
    expect((await prisma.item.findUniqueOrThrow({ where: { id: orange.id } })).tagId).toBe(tag);
  });

  it('notices a swap for a spool the printer describes the same way', async () => {
    const first = await spool('PETG Blue A', 'PETG', '#1f6feb');
    const second = await spool('PETG Blue B', 'PETG', '#1f6feb');
    const slot = await slotAt('AMS 1', 3);
    printer.feeders[0].trays[2] = { type: 'PETG', color: '1f6feb' };
    await sync();
    await prisma.slot.update({ where: { id: slot.id }, data: { itemId: first.id, source: 'manual' } });
    // Out: the tray reads empty, but too recently to unload what was there.
    const spec = printer.feeders[0].trays[2];
    printer.feeders[0].trays[2] = null;
    expect((await sync(scanned(second.id))).pending).toBeNull();
    expect((await slotAt('AMS 1', 3)).itemId).toBe(first.id);
    // In again a few seconds later, reading exactly as before: it is the scanned spool now.
    printer.feeders[0].trays[2] = spec;
    expect((await sync(scanned(second.id), NOW + 5_000)).pending).toMatchObject({ result: 'linked', place: 'AMS 1 slot 3', mismatch: false });
    expect((await slotAt('AMS 1', 3)).itemId).toBe(second.id);
  });

  it('gives up when the scanned item has been deleted meanwhile', async () => {
    printer.feeders[0].trays[3] = { type: 'TPU', color: '333333' };
    expect((await sync(scanned('gone'))).pending).toEqual({ result: 'dropped', reason: 'gone' });
  });
});

describe('through the live printer and the routes', () => {
  it('arms for a printer that is reporting, links when a tray is loaded, and is used once', async () => {
    const app = await startApp();
    const operator = await member('operator@example.test', target.workspaceId, 'operator');
    const viewer = await member('viewer@example.test', target.workspaceId, 'viewer');
    const path = `/workspaces/${target.workspaceId}/printers/by-machine/${target.machineId}/pending-spool`;
    const bridge = await prisma.bridge.create({ data: { workspaceId: target.workspaceId, name: 'B', capabilities: [] } });
    const link = await prisma.printerLink.create({ data: { workspaceId: target.workspaceId, machineId: target.machineId, bridgeId: bridge.id, serial: printer.serial, host: '192.168.1.9' } });
    const silver = await spool('PLA Silver', 'PLA', '#c0c0c0');
    await trackPrinterById(link.id);

    // Not reporting yet: there is no way to see a spool go in.
    expect((await app.call('PUT', path, operator, { itemId: silver.id })).status).toBe(409);
    expect(armPendingSpool(target.workspaceId, target.machineId, silver)).toBeNull();

    bridgeConnected(bridge.id);
    setLinkStatus(bridge.id, { printerId: link.id, link: 'online', codeState: 'ok' });
    ingestReport(bridge.id, { printerId: link.id, seq: 0, kind: 'full', data: simDocument(printer) });
    await new Promise((resolve) => setTimeout(resolve, 1800));
    await writesSettled();

    expect((await app.call('PUT', path, viewer, { itemId: silver.id })).status).toBe(403);
    expect((await app.call('PUT', path, operator, { itemId: 'nope' })).status).toBe(404);
    const armed = await app.call('PUT', path, operator, { itemId: silver.id });
    expect(armed.status).toBe(200);
    expect(Number(armed.body?.expiresAt)).toBeGreaterThan(Date.now() + 100_000);

    printer.feeders[1].trays[2] = { type: 'PLA', color: 'c0c0c0' };
    ingestReport(bridge.id, { printerId: link.id, seq: 1, kind: 'full', data: simDocument(printer) });
    await new Promise((resolve) => setTimeout(resolve, 1800));
    await writesSettled();
    expect((await slotAt('AMS 2', 3)).itemId).toBe(silver.id);
    // Used once: nothing is left to cancel, and the next tray change links nothing.
    expect(cancelPendingSpool(target.workspaceId, target.machineId)).toBe(false);

    // Armed again, then cancelled through the route.
    expect((await app.call('PUT', path, operator, { itemId: silver.id })).status).toBe(200);
    expect((await app.call('DELETE', path, operator)).status).toBe(204);
    expect(cancelPendingSpool(target.workspaceId, target.machineId)).toBe(false);

    await new Promise((resolve) => setTimeout(resolve, 300));
    resetRegistry();
    await app.close();
  });
});
