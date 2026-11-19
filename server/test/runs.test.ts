import { existsSync, readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Doc } from '@filament-tracker/protocol';
import { simDocument, simFleet, type SimPrinter } from '@filament-tracker/protocol/fixtures';
import { prisma } from '@/db';
import { syncFeeders } from '@/integrations/amsSync';
import { bambuAdapter, readBambu } from '@/integrations/bambu/normalize';
import { reconcileRun, thumbnailRunFor, type JobFileReader, type RunTarget } from '@/integrations/runs';
import { plateFor, readSliceInfo, SLICE_INFO } from '@/integrations/threemf';
import { removeWorkspaceUploads, storedPath } from '@/services/uploads';

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
const file: JobFileReader = async () => ({ entries: { [SLICE_INFO]: SLICE } });
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
afterAll(async () => {
  await removeWorkspaceUploads(target.workspaceId);
  await prisma.$disconnect();
});

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

  it('reads only whole tags and attributes, as before', () => {
    const plates = readSliceInfo(`<plate><filaments/><filament_x id="9" used_g="1"/>
      <filament tray_id="7" id="2" xused_g="99" used_g="3.5" type="PETG"/></plate><plate>unclosed`);
    expect(plates).toEqual([{ index: 1, seconds: null, filaments: [{ id: 2, material: 'PETG', colour: null, grams: 3.5 }] }]);
  });

  it('stays quick on a file made to be slow to read', () => {
    const crafted = [
      '<plate>'.repeat(60_000),
      `<plate>${'<metadata'.repeat(40_000)}</plate>`,
      `<plate><filament ${'id="'.repeat(80_000)}></plate>`,
    ];
    const started = performance.now();
    for (const xml of crafted) readSliceInfo(xml);
    // The old regexes took several seconds on the first of these alone.
    expect(performance.now() - started).toBeLessThan(500);
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

  it('places filaments from the fuller mapping, the outside holders, and the mapping repeated in status', async () => {
    const x2d = JSON.parse(readFileSync(new URL('./fixtures/x2d.json', import.meta.url), 'utf8')) as Doc;
    const one = `<config><plate><metadata key="index" value="1"/><filament id="1" type="PLA" color="#161616" used_g="12.5"/></plate></config>`;
    const reader: JobFileReader = async () => ({ entries: { [SLICE_INFO]: one } });
    const machine = await prisma.machine.create({ data: { workspaceId: target.workspaceId, name: 'X2D' } });
    const bridge = await prisma.bridge.findFirstOrThrow();
    const link = await prisma.printerLink.create({ data: { workspaceId: target.workspaceId, machineId: machine.id, bridgeId: bridge.id, serial: 'SERIAL0000000001', host: '192.168.1.8' } });
    const x2dTarget: RunTarget = { ...target, linkId: link.id, machineId: machine.id, machineName: 'X2D', serial: 'SERIAL0000000001' };
    await reconcileRun(x2dTarget, readBambu(x2d), x2d, reader, new Date(T0 + 30 * HOUR));
    const run = await prisma.printerRun.findFirstOrThrow({ where: { printerLinkId: link.id } });
    // The real announcement said filament 1 comes from feeder 0, tray 1: the second slot.
    expect(run.filaments).toMatchObject([{ id: 1, grams: 12.5, feeder: 'ams:0', position: 2 }]);

    // The same print with its announcement missed: the mapping in the status report gives the same answer.
    const missed = { ...x2d, job: undefined } as unknown as Doc;
    await prisma.printerRun.deleteMany({ where: { printerLinkId: link.id } });
    await reconcileRun(x2dTarget, readBambu(missed), missed, reader, new Date(T0 + 31 * HOUR));
    expect((await prisma.printerRun.findFirstOrThrow({ where: { printerLinkId: link.id } })).filaments).toMatchObject([{ feeder: 'ams:0', position: 2 }]);
  });

  it('does not charge a print cancelled while it was still being prepared, even with the last print\'s 100 % on screen', async () => {
    // Seen on a real printer: the print before finished at 100 %, and those figures are still shown while the
    // next one is prepared. Cancelling then used to charge the whole print.
    await prisma.printerRun.updateMany({ where: { endedAt: null }, data: { endedAt: new Date(), outcome: 'unseen' } });
    const before = await stock(black.id);
    printer.state = 'PREPARE'; printer.job = { name: 'cover', percent: 100, remainingMinutes: 0, layer: 100, totalLayers: 100 };
    await step(file, T0 + 40 * HOUR);
    const job = await prisma.job.findFirstOrThrow({ where: { name: 'cover' }, include: { usages: true } });
    // While it runs the job shows what the file says: both spools, and the slicer's ten minutes.
    expect(job.usages.length).toBe(2);
    expect(job.durationHours).toBeCloseTo(0.17);
    printer.state = 'FAILED'; printer.job.percent = 0; printer.job.layer = 0;
    const cancelled = { ...doc(), print: { ...(doc().print as object), print_error: 50348044 } } as Doc;
    await reconcileRun(target, readBambu(cancelled), cancelled, file, new Date(T0 + 40 * HOUR + 10_000));
    expect(await prisma.job.findFirstOrThrow({ where: { name: 'cover' } })).toMatchObject({ status: 'failed', failureReason: 'Cancelled at the printer' });
    expect(await stock(black.id)).toBe(before);
  });

  it('keeps the slicer\'s picture of the plate with the print, and nothing that is not a PNG', async () => {
    await prisma.printerRun.updateMany({ where: { endedAt: null }, data: { endedAt: new Date(), outcome: 'unseen' } });
    const png = new Uint8Array(64);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const asked: string[][] = [];
    const reader = (images: Record<string, Uint8Array>, entries: Record<string, string> = { [SLICE_INFO]: SLICE }): JobFileReader => async (names) => {
      asked.push(names);
      return { entries, images };
    };

    printer.state = 'RUNNING'; printer.job = { name: 'bowl', percent: 5, remainingMinutes: 30, layer: 5, totalLayers: 100 };
    await step(reader({ 'Metadata/plate_1.png': png }), T0 + 44 * HOUR);
    // One request for the summary and the picture of the plate being printed, so the file is downloaded once.
    expect(asked).toEqual([[SLICE_INFO, 'Metadata/plate_1.png']]);
    const run = await prisma.printerRun.findFirstOrThrow({ where: { name: 'bowl' } });
    expect(run.usageSource).toBe('file');
    expect(run.thumbnail).toMatch(/^[0-9a-f]{32}$/);
    expect(new Uint8Array(readFileSync(storedPath(target.workspaceId, run.thumbnail)))).toEqual(png);
    expect(await thumbnailRunFor(target.linkId, 'bowl.gcode.3mf')).toBe(run.id);
    expect(await thumbnailRunFor(target.linkId, 'something else')).toBeNull();
    await prisma.printerRun.updateMany({ where: { endedAt: null }, data: { endedAt: new Date(), outcome: 'unseen' } });

    // Bytes that are not a PNG are not kept, whatever they were called.
    printer.job = { name: 'bowl two', percent: 5, remainingMinutes: 30, layer: 5, totalLayers: 100 };
    await step(reader({ 'Metadata/plate_1.png': new TextEncoder().encode('<svg onload="alert(1)"/>') }), T0 + 45 * HOUR);
    const plain = await prisma.printerRun.findFirstOrThrow({ where: { name: 'bowl two' } });
    expect(plain).toMatchObject({ usageSource: 'file', thumbnail: '' });
    expect(await thumbnailRunFor(target.linkId, 'bowl two')).toBeNull();
    await prisma.printerRun.updateMany({ where: { endedAt: null }, data: { endedAt: new Date(), outcome: 'unseen' } });

    // A summary that cannot be read does not cost the print its picture; it arrives on a later look.
    printer.job = { name: 'bowl three', percent: 5, remainingMinutes: 30, layer: 5, totalLayers: 100 };
    await step(noFile, T0 + 46 * HOUR);
    expect(await prisma.printerRun.findFirstOrThrow({ where: { name: 'bowl three' } })).toMatchObject({ thumbnail: '' });
    await step(reader({ 'Metadata/plate_1.png': png }, {}), T0 + 46 * HOUR + 60_000);
    const late = await prisma.printerRun.findFirstOrThrow({ where: { name: 'bowl three' } });
    expect(late.usageSource).toBe('');
    expect(existsSync(storedPath(target.workspaceId, late.thumbnail))).toBe(true);
    await prisma.printerRun.updateMany({ where: { endedAt: null }, data: { endedAt: new Date(), outcome: 'unseen' } });
  });

  it('keeps a running job\'s time in step with what the printer says is left', async () => {
    printer.state = 'RUNNING'; printer.job = { name: 'clip', percent: 10, remainingMinutes: 45, layer: 10, totalLayers: 100 };
    await step(file, T0 + 50 * HOUR);
    await step(file, T0 + 50.25 * HOUR);
    // A quarter of an hour gone and 45 minutes to go.
    expect((await prisma.job.findFirstOrThrow({ where: { name: 'clip' } })).durationHours).toBe(1);
    await prisma.printerRun.updateMany({ where: { endedAt: null }, data: { endedAt: new Date(), outcome: 'unseen' } });
  });

  it('follows a laser job as a job, without fetching a file or charging filament', async () => {
    const h2d = JSON.parse(readFileSync(new URL('./fixtures/h2d-laser.json', import.meta.url), 'utf8')) as Doc;
    const machine = await prisma.machine.create({ data: { workspaceId: target.workspaceId, name: 'H2D' } });
    const bridge = await prisma.bridge.findFirstOrThrow();
    const link = await prisma.printerLink.create({ data: { workspaceId: target.workspaceId, machineId: machine.id, bridgeId: bridge.id, serial: 'SERIAL0000000002', host: '192.168.1.7' } });
    const h2dTarget: RunTarget = { ...target, linkId: link.id, machineId: machine.id, machineName: 'H2D', serial: 'SERIAL0000000002' };
    let asked = 0;
    const reader: JobFileReader = async () => {
      asked += 1;
      return null;
    };
    await reconcileRun(h2dTarget, readBambu(h2d), h2d, reader, new Date(T0 + 60 * HOUR));
    const job = await prisma.job.findFirstOrThrow({ where: { name: 'sample_laser_job' }, include: { usages: true } });
    expect(job).toMatchObject({ status: 'in_progress', source: 'printer', machineId: machine.id });
    expect(job.notes).toMatch(/^Laser or cutting job, Laser 40W/);
    expect(job.usages).toHaveLength(0);
    expect(asked).toBe(0);
    // It ends like any other job: finished, with the real time.
    const done = JSON.parse(JSON.stringify(h2d)) as { print: Record<string, unknown> };
    done.print.gcode_state = 'FINISH';
    await reconcileRun(h2dTarget, readBambu(done as unknown as Doc), done as unknown as Doc, reader, new Date(T0 + 60.1 * HOUR));
    expect(await prisma.job.findUniqueOrThrow({ where: { id: job.id } })).toMatchObject({ status: 'completed', durationHours: 0.1 });
  });

  it('never opens a record for a finished print left on the screen', async () => {
    await prisma.printerRun.updateMany({ where: { endedAt: null }, data: { endedAt: new Date(), outcome: 'unseen' } });
    const jobs = await prisma.job.count();
    printer.state = 'FINISH';
    await step(file, T0 + 20 * HOUR);
    expect(await prisma.job.count()).toBe(jobs);
  });
});
