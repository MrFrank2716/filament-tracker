import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Doc } from '@filament-tracker/protocol';
import { simDocument, simFleet, type SimPrinter } from '@filament-tracker/protocol/fixtures';
import { prisma } from '@/db';
import { syncFeeders } from '@/integrations/amsSync';
import { bambuAdapter, readBambu } from '@/integrations/bambu/normalize';
import { reconcileRun, type JobFileReader, type RunTarget } from '@/integrations/runs';
import { plateFor, readSliceInfo, SLICE_INFO } from '@/integrations/threemf';

const SLICE = `<config>
<plate><metadata key="index" value="1"/><metadata key="prediction" value="600"/>
 <filament id="1" type="PLA" color="#000000" used_m="9.8" used_g="29.20"/>
 <filament id="3" type="PLA" color="#FFFFFF" used_m="3.1" used_g="9.20"/></plate>
<plate><metadata key="index" value="2"/><filament id="1" type="PLA" color="#000000" used_g="5.00"/></plate>
</config>`;

let target: RunTarget;
let printer: SimPrinter;
let black: { id: string };
let white: { id: string };
const file: JobFileReader = async () => ({ [SLICE_INFO]: SLICE });
const noFile: JobFileReader = async () => null;
/** The document as the bridge would hold it: status plus the "print starting" announcement. */
const doc = (): Doc => ({ ...simDocument(printer), job: { subtask_name: printer.job?.name, param: 'Metadata/plate_1.gcode', use_ams: true, ams_mapping: [0, -1, 1] } });
const step = (read: JobFileReader, at: number) => reconcileRun(target, readBambu(doc()), doc(), read, new Date(at));
const stock = async (id: string) => (await prisma.item.findUniqueOrThrow({ where: { id } })).quantity;
const T0 = Date.UTC(2026, 10, 15, 12);
const HOUR = 3_600_000;

beforeAll(async () => {
  printer = simFleet()[0];
  printer.job = { name: 'bracket_v3', percent: 0, remainingMinutes: 60, layer: 0, totalLayers: 100 };
  const workspace = await prisma.workspace.create({ data: { name: 'Test' } });
  const grams = await prisma.unit.create({ data: { workspaceId: workspace.id, name: 'Grams', symbol: 'g' } });
  const type = await prisma.itemType.create({ data: { workspaceId: workspace.id, name: 'Filament' } });
  const machine = await prisma.machine.create({ data: { workspaceId: workspace.id, name: 'X1C' } });
  const bridge = await prisma.bridge.create({ data: { workspaceId: workspace.id, name: 'B', capabilities: [] } });
  const link = await prisma.printerLink.create({ data: { workspaceId: workspace.id, machineId: machine.id, bridgeId: bridge.id, serial: printer.serial, host: '192.168.1.9' } });
  target = { linkId: link.id, workspaceId: workspace.id, machineId: machine.id, machineName: 'X1C', serial: printer.serial, adapter: bambuAdapter };
  const item = (name: string) => prisma.item.create({ data: { workspaceId: workspace.id, itemTypeId: type.id, unitId: grams.id, name, quantity: 500, unitCost: 0.02, fields: {} } });
  black = await item('PLA Black');
  white = await item('PLA White');
  // AMS 1: black in slot 1, white in slot 2.
  await syncFeeders(target, readBambu(simDocument(printer)), new Map());
  const unit = await prisma.subUnit.findFirstOrThrow({ where: { externalId: `bambu:${printer.serial}:ams:0` }, include: { slots: true } });
  await prisma.slot.update({ where: { id: unit.slots.find((slot) => slot.position === 1)!.id }, data: { itemId: black.id } });
  await prisma.slot.update({ where: { id: unit.slots.find((slot) => slot.position === 2)!.id }, data: { itemId: white.id } });
});
afterAll(() => prisma.$disconnect());

describe('reading the sliced file', () => {
  it('reads each plate, keeps skipped filament numbers, and picks the plate being printed', () => {
    const plates = readSliceInfo(SLICE);
    expect(plates.map((plate) => plate.index)).toEqual([1, 2]);
    expect(plates[0].filaments).toEqual([
      { id: 1, material: 'PLA', colour: '#000000', grams: 29.2 },
      { id: 3, material: 'PLA', colour: '#ffffff', grams: 9.2 },
    ]);
    expect(plateFor(plates, 2)?.filaments[0].grams).toBe(5);
    expect(plateFor(plates, null)).toBeNull();
    expect(readSliceInfo('not xml at all')).toEqual([]);
  });
});

describe('following a print', () => {
  it('makes a job when a print starts, with what it will use from each spool', async () => {
    printer.state = 'RUNNING';
    await step(file, T0);
    const job = await prisma.job.findFirstOrThrow({ where: { workspaceId: target.workspaceId }, include: { usages: true } });
    expect(job).toMatchObject({ name: 'bracket_v3', status: 'in_progress', source: 'printer', machineId: target.machineId });
    // Filament 1 feeds from tray 0 (black), filament 3 from tray 1 (white); filament 2 is not used.
    expect(job.usages.map((usage) => [usage.itemId, usage.quantity]).sort()).toEqual([[black.id, 29.2], [white.id, 9.2]].sort());
    expect((await prisma.machine.findUniqueOrThrow({ where: { id: target.machineId } })).status).toBe('in_use');
  });

  it('does nothing new however many times the same state is reported', async () => {
    printer.job!.percent = 40; printer.job!.layer = 40;
    await step(file, T0 + 1000);
    await step(file, T0 + 2000);
    expect(await prisma.job.count({ where: { workspaceId: target.workspaceId } })).toBe(1);
    expect(await prisma.printerRun.count()).toBe(1);
    expect(await stock(black.id)).toBe(500);
  });

  it('finishes the job once when the print ends: real run time, stock taken, logged as the printer', async () => {
    printer.state = 'FINISH'; printer.job!.percent = 100; printer.job!.layer = 100;
    await step(file, T0 + 2 * HOUR);
    await step(file, T0 + 2 * HOUR + 5000); // the printer keeps saying "finished" until the next print
    const job = await prisma.job.findFirstOrThrow({ where: { workspaceId: target.workspaceId } });
    expect(job).toMatchObject({ status: 'completed', durationHours: 2 });
    expect(await stock(black.id)).toBeCloseTo(470.8);
    expect(await stock(white.id)).toBeCloseTo(490.8);
    expect(await prisma.stockMovement.count({ where: { jobId: job.id } })).toBe(2);
    expect(await prisma.printerRun.count({ where: { endedAt: null } })).toBe(0);
    const log = await prisma.activityLog.findFirstOrThrow({ where: { action: 'printer.job' } });
    expect(log).toMatchObject({ userId: null, userName: 'X1C' });
    expect(log.summary).toContain('29.2 g of PLA Black');
    expect((await prisma.machine.findUniqueOrThrow({ where: { id: target.machineId } })).status).toBe('ready');
  });

  it('charges a cancelled print for how far it got, and says so', async () => {
    printer.state = 'RUNNING'; printer.job = { name: 'lid', percent: 0, remainingMinutes: 60, layer: 0, totalLayers: 100 };
    await step(file, T0 + 3 * HOUR);
    printer.job.layer = 50; printer.job.percent = 50;
    await step(file, T0 + 3.5 * HOUR);
    printer.state = 'FAILED';
    const cancelled = { ...doc(), print: { ...(doc().print as object), print_error: 50348044 } };
    await reconcileRun(target, readBambu(cancelled), cancelled, file, new Date(T0 + 3.6 * HOUR));
    const job = await prisma.job.findFirstOrThrow({ where: { name: 'lid' } });
    expect(job).toMatchObject({ status: 'failed', failureReason: 'Cancelled at the printer' });
    expect(await stock(black.id)).toBeCloseTo(470.8 - 14.6);
  });

  it('joins the job a member already made with the same name, and leaves a member\'s own finish alone', async () => {
    const planned = await prisma.job.create({ data: { workspaceId: target.workspaceId, machineId: target.machineId, name: 'Gear.3mf' } });
    printer.state = 'RUNNING'; printer.job = { name: 'gear', percent: 0, remainingMinutes: 60, layer: 0, totalLayers: 10 };
    await step(noFile, T0 + 5 * HOUR);
    expect((await prisma.job.findUniqueOrThrow({ where: { id: planned.id } })).status).toBe('in_progress');
    expect(await prisma.job.count({ where: { name: 'gear' } })).toBe(0);
    // A member finishes it by hand before the printer reports the end.
    await prisma.job.update({ where: { id: planned.id }, data: { status: 'completed', completedAt: new Date(T0 + 6 * HOUR), durationHours: 1 } });
    printer.state = 'FINISH';
    await step(noFile, T0 + 6.1 * HOUR);
    expect((await prisma.job.findUniqueOrThrow({ where: { id: planned.id } })).durationHours).toBe(1);
  });

  it('does not guess when a print ended while nobody was listening', async () => {
    printer.state = 'RUNNING'; printer.job = { name: 'vase', percent: 10, remainingMinutes: 60, layer: 1, totalLayers: 10 };
    await step(file, T0 + 8 * HOUR);
    const before = await stock(black.id);
    // Next thing heard: a different print already running.
    printer.job = { name: 'hook', percent: 5, remainingMinutes: 30, layer: 1, totalLayers: 10 };
    await step(noFile, T0 + 12 * HOUR);
    const vase = await prisma.job.findFirstOrThrow({ where: { name: 'vase' } });
    expect(vase.status).toBe('in_progress');
    expect(vase.failureReason).toMatch(/finish the job by hand/);
    expect(await stock(black.id)).toBe(before);
    expect((await prisma.job.findFirstOrThrow({ where: { name: 'hook' } })).status).toBe('in_progress');
  });

  it('never opens a record for a finished print left on the screen', async () => {
    await prisma.printerRun.updateMany({ where: { endedAt: null }, data: { endedAt: new Date(), outcome: 'unseen' } });
    const jobs = await prisma.job.count();
    printer.state = 'FINISH';
    await step(file, T0 + 20 * HOUR);
    expect(await prisma.job.count()).toBe(jobs);
  });
});
