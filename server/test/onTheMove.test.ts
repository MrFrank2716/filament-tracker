import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { simDocument, simFleet, type SimPrinter } from '@filament-tracker/protocol/fixtures';
import { prisma } from '@/db';
import { EMPTY_SETTLE_MS, syncFeeders, type SyncTarget } from '@/integrations/amsSync';
import { bambuAdapter, readBambu } from '@/integrations/bambu/normalize';
import { decodeBambuTag } from '@/integrations/bambu/tag';
import { member, startApp } from './http';

/**
 * Tapping spools on a location display's reader: a tap tags a spool in or out of the display's location, a spool
 * taken out is "on the move", and a printer that reports a new spool is matched against the ones on the move.
 * Bambu Lab spools are known by the id in their own tag's data.
 */

/** The blocks of a Bambu tag, built from the documented layout. */
function bambuBlocks(spool: { type: string; detail: string; rgba: string; grams: number; trayId: string }): Record<string, string> {
  const textBlock = (value: string) => Buffer.concat([Buffer.from(value, 'ascii'), Buffer.alloc(16)]).subarray(0, 16).toString('hex');
  const colour = Buffer.alloc(16);
  Buffer.from(spool.rgba, 'hex').copy(colour, 0);
  colour.writeUInt16LE(spool.grams, 4);
  colour.writeFloatLE(1.75, 8);
  const temps = Buffer.alloc(16);
  temps.writeUInt16LE(55, 0); // drying temperature
  temps.writeUInt16LE(8, 2); // drying hours
  temps.writeUInt16LE(230, 8); // hottest nozzle
  temps.writeUInt16LE(190, 10); // coolest nozzle
  return { 1: textBlock('A00-K0'), 2: textBlock(spool.type), 4: textBlock(spool.detail), 5: colour.toString('hex'), 6: temps.toString('hex'), 9: spool.trayId.toLowerCase() };
}

const BLACK_TRAY = '8A80B54715804D048762FB1E45351D77';

describe('reading a Bambu tag', () => {
  it('reads the material, colour, weight and the spool\'s id', () => {
    expect(decodeBambuTag(bambuBlocks({ type: 'PLA', detail: 'PLA Basic', rgba: '1a2b3cff', grams: 1000, trayId: BLACK_TRAY }))).toEqual({
      state: 'loaded', material: 'PLA', subType: 'PLA Basic', colour: '#1a2b3c', colours: [], brand: 'Bambu Lab', tagId: BLACK_TRAY,
      remainingPercent: null, spoolWeightGrams: 1000, nozzleTemp: [190, 230], diameter: 1.75,
    });
  });

  it('takes an id written as text as it stands', () => {
    const blocks = bambuBlocks({ type: 'PETG', detail: 'PETG HF', rgba: 'ffffffff', grams: 1000, trayId: BLACK_TRAY });
    blocks[9] = Buffer.from('ab12cd34ef56ab78', 'ascii').toString('hex');
    expect(decodeBambuTag(blocks)?.tagId).toBe('AB12CD34EF56AB78');
  });

  it('refuses blocks that are not a spool tag', () => {
    const blocks = bambuBlocks({ type: 'PLA', detail: 'PLA Basic', rgba: '000000ff', grams: 1000, trayId: BLACK_TRAY });
    expect(decodeBambuTag({ ...blocks, 9: '0'.repeat(32) })).toBeNull();
    expect(decodeBambuTag({ ...blocks, 2: 'ff'.repeat(16) })).toBeNull();
    expect(decodeBambuTag({ 9: blocks[9] })).toBeNull();
    expect(decodeBambuTag({ ...blocks, 9: 'short' })).toBeNull();
  });

  it('leaves out values that make no sense', () => {
    const blocks = bambuBlocks({ type: 'PLA', detail: '', rgba: '000000ff', grams: 0, trayId: BLACK_TRAY });
    expect(decodeBambuTag({ ...blocks, 6: '0'.repeat(32) })).toMatchObject({ subType: null, spoolWeightGrams: null, nozzleTemp: null });
  });
});

let app: Awaited<ReturnType<typeof startApp>>;
let workspaceId: string;
let typeId: string;
let gramsId: string;
let admin: string;
let operator: string;
let drawerA: string;
let drawerB: string;
let insideA: string;
let token: string;
let deviceId: string;
const ws = (path: string) => `/workspaces/${workspaceId}${path}`;
const spool = (name: string, material: string, colour: string, extra: { tagId?: string; locationId?: string; outSince?: Date } = {}) =>
  prisma.item.create({ data: { workspaceId, itemTypeId: typeId, unitId: gramsId, name, quantity: 500, fields: { material, colour }, ...extra } });
const tap = (uid: string, blocks?: Record<string, string>) => app.call('POST', `/device/tag/${uid}/tap`, token, blocks ? { blocks } : {});
const itemNow = (id: string) => prisma.item.findUniqueOrThrow({ where: { id } });
const BLACK_BLOCKS = bambuBlocks({ type: 'PLA', detail: 'PLA Basic', rgba: '101010ff', grams: 1000, trayId: BLACK_TRAY });

beforeAll(async () => {
  app = await startApp();
  const workspace = await prisma.workspace.create({ data: { name: 'Taps' } });
  workspaceId = workspace.id;
  typeId = (
    await prisma.itemType.create({
      data: { workspaceId, name: 'Filament', fields: { create: [
        { key: 'material', label: 'Material', fieldType: 'text', options: [] },
        { key: 'colour', label: 'Colour', fieldType: 'color', options: [] },
      ] } },
    })
  ).id;
  gramsId = (await prisma.unit.create({ data: { workspaceId, name: 'Grams', symbol: 'g', decimals: 0 } })).id;
  drawerA = (await prisma.location.create({ data: { workspaceId, name: 'Drawer A' } })).id;
  insideA = (await prisma.location.create({ data: { workspaceId, name: 'Left side', parentId: drawerA } })).id;
  drawerB = (await prisma.location.create({ data: { workspaceId, name: 'Drawer B' } })).id;
  admin = await member('admin@taps.test', workspaceId, 'admin');
  operator = await member('operator@taps.test', workspaceId, 'operator');
  const made = await app.call('POST', ws('/devices'), admin, { name: 'Drawer display', locationId: drawerA });
  deviceId = made.body!.id as string;
  const paired = await app.call('POST', '/device/pair', '', { code: (made.body!.pairing as { code: string }).code, model: 'cyd-28-st7789+pn532', version: '0.2.0' });
  token = paired.body!.token as string;
});
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe('tapping a spool on a display', () => {
  it('takes a Bambu spool out of the display\'s location, then puts it back', async () => {
    const black = await spool('PLA Black', 'PLA', '#101010', { tagId: BLACK_TRAY, locationId: drawerA });

    const out = await tap('D2B9046C', BLACK_BLOCKS);
    expect(out.status).toBe(200);
    expect(out.body).toMatchObject({ known: true, uid: `T${BLACK_TRAY}`, message: 'Taken out: on the move', item: { name: 'PLA Black', here: false, location: null }, canPutAway: true });
    expect(await itemNow(black.id)).toMatchObject({ locationId: null });
    expect((await itemNow(black.id)).outSince).not.toBeNull();

    const back = await tap('D2B9046C', BLACK_BLOCKS);
    expect(back.body).toMatchObject({ known: true, message: 'Put away in Drawer A', item: { here: true, location: 'Drawer A' }, canPutAway: false });
    expect(await itemNow(black.id)).toMatchObject({ locationId: drawerA, outSince: null });
    const log = await prisma.activityLog.findMany({ where: { workspaceId, entityId: black.id }, orderBy: { createdAt: 'asc' } });
    expect(log.map((entry) => [entry.userName, entry.summary])).toEqual([
      ['Drawer display', 'Took PLA Black out of Drawer A: it is on the move'],
      ['Drawer display', 'Put PLA Black away in Drawer A'],
    ]);
  });

  it('answers later calls for that spool by the key it gave', async () => {
    const key = `T${BLACK_TRAY}`;
    expect((await app.call('GET', `/device/tag/${key}`, token)).body).toMatchObject({ known: true, uid: key, item: { name: 'PLA Black' } });
    expect((await tap('D2B9046C', BLACK_BLOCKS)).body).toMatchObject({ message: 'Taken out: on the move' });
    expect((await app.call('POST', `/device/tag/${key}/put-away`, token)).body).toMatchObject({ moved: 1 });
    const black = await prisma.item.findFirstOrThrow({ where: { workspaceId, name: 'PLA Black' } });
    expect(black).toMatchObject({ locationId: drawerA, outSince: null });
    // The chip's own id says nothing about a Bambu spool.
    expect((await app.call('GET', '/device/tag/D2B9046C', token)).body).toMatchObject({ known: false });
  });

  it('counts a spool kept inside the display\'s location as kept there', async () => {
    const nested = await spool('PLA Nested', 'PLA', '#222222', { tagId: 'NFC04A1B2C3D4E5F6', locationId: insideA });
    expect((await tap('04A1B2C3D4E5F6')).body).toMatchObject({ known: true, uid: '04A1B2C3D4E5F6', message: 'Taken out: on the move' });
    expect((await itemNow(nested.id)).outSince).not.toBeNull();
  });

  it('puts a spool from elsewhere away at the display', async () => {
    const white = await spool('PETG White', 'PETG', '#ffffff', { tagId: 'NFC0411223344', locationId: drawerB });
    expect((await tap('0411223344')).body).toMatchObject({ message: 'Put away in Drawer A', item: { here: true } });
    expect(await itemNow(white.id)).toMatchObject({ locationId: drawerA, outSince: null });
  });

  it('only shows the spool when changes from the display are switched off', async () => {
    await app.call('PATCH', ws(`/devices/${deviceId}`), admin, { canWrite: false });
    const white = await prisma.item.findFirstOrThrow({ where: { workspaceId, name: 'PETG White' } });
    const shown = await tap('0411223344');
    expect(shown.body).toMatchObject({ known: true, item: { here: true }, canPutAway: false });
    expect(shown.body).not.toHaveProperty('message');
    expect(await itemNow(white.id)).toMatchObject({ locationId: drawerA, outSince: null });
    // A Bambu spool it has not met is named on the card, and not kept for the inventory to ask about.
    const unknown = await tap('C0C0C0C0', bambuBlocks({ type: 'ABS', detail: 'ABS', rgba: '334455ff', grams: 1000, trayId: 'D'.repeat(32) }));
    expect(unknown.body).toEqual({ known: false, uid: `T${'D'.repeat(32)}`, canLink: false, message: 'Not in stock yet: Bambu Lab ABS.' });
    expect(await prisma.unknownTag.count({ where: { workspaceId } })).toBe(0);
    expect(await prisma.activityLog.count({ where: { workspaceId, action: 'device.unknown' } })).toBe(0);
    await app.call('PATCH', ws(`/devices/${deviceId}`), admin, { canWrite: true });
  });

  it('keeps a Bambu spool nothing is tied to for a member to settle, once', async () => {
    const blocks = bambuBlocks({ type: 'PLA', detail: 'PLA Matte', rgba: 'c12e1fff', grams: 1000, trayId: 'F'.repeat(32) });
    const first = await tap('AABBCCDD', blocks);
    expect(first.body).toEqual({ known: false, uid: `T${'F'.repeat(32)}`, canLink: true, message: 'Not in stock yet: Bambu Lab PLA Matte. Add it in Wrkbench.' });
    await tap('AABBCCDD', blocks);
    const waiting = await app.call('GET', ws('/unknown-tags'), operator);
    expect(waiting.body).toHaveLength(1);
    expect((waiting.body as unknown as Array<Record<string, unknown>>)[0]).toMatchObject({
      tagId: 'F'.repeat(32), detected: { material: 'PLA', subType: 'PLA Matte', colour: '#c12e1f', spoolWeightGrams: 1000 }, device: { name: 'Drawer display', locationId: drawerA },
    });
    expect(await prisma.activityLog.count({ where: { workspaceId, action: 'device.unknown' } })).toBe(1);
  });

  it('forgets it once the tag is tied to an item, here from the display itself', async () => {
    const red = await spool('PLA Matte Red', 'PLA', '#c12e1f', { locationId: drawerA });
    const linked = await app.call('POST', `/device/tag/T${'F'.repeat(32)}/link`, token, { itemId: red.id });
    expect(linked.status).toBe(200);
    expect((await itemNow(red.id)).tagId).toBe('F'.repeat(32));
    expect((await app.call('GET', ws('/unknown-tags'), operator)).body).toHaveLength(0);
  });

  it('lets an operator dismiss a read, and an admin-only write stays refused', async () => {
    await tap('A1A1A1A1', bambuBlocks({ type: 'TPU', detail: 'TPU 95A', rgba: '00ff00ff', grams: 500, trayId: 'E'.repeat(32) }));
    const [waiting] = (await app.call('GET', ws('/unknown-tags'), operator)).body as unknown as Array<{ id: string }>;
    expect((await app.call('DELETE', ws(`/unknown-tags/${waiting.id}`), operator)).status).toBe(204);
    expect((await app.call('GET', ws('/unknown-tags'), operator)).body).toHaveLength(0);
  });

  it('treats a sticker it does not know as before, and blocks that are not a spool as a plain chip', async () => {
    expect((await tap('0499887766')).body).toEqual({ known: false, uid: '0499887766', canLink: true });
    expect((await tap('AABBCCDD', { 9: '0'.repeat(32) })).body).toEqual({ known: false, uid: 'AABBCCDD', canLink: true });
    expect((await tap('nope')).status).toBe(400);
    expect((await app.call('POST', '/device/tag/AABBCCDD/tap', 'wbd_wrong', {})).status).toBe(401);
    expect((await app.call('GET', '/device/tag/TAB', token)).status).toBe(400);
  });

  it('putting a spool away by hand ends its being on the move', async () => {
    const out = await spool('PLA Out', 'PLA', '#123456', { outSince: new Date() });
    await app.call('POST', ws('/items/move'), operator, { itemIds: [out.id], locationId: drawerB });
    expect(await itemNow(out.id)).toMatchObject({ locationId: drawerB, outSince: null });
  });
});

describe('a spool on the move goes into a printer', () => {
  let target: SyncTarget;
  let printer: SimPrinter;
  const emptySince = new Map<string, number>();
  const NOW = 9_000_000;
  const sync = (now = NOW) => syncFeeders(target, readBambu(simDocument(printer)), emptySince, now);
  const slotAt = (unit: string, position: number) => prisma.slot.findFirstOrThrow({ where: { position, subUnit: { workspaceId, name: unit } }, include: { item: true } });
  const lastLog = async () => (await prisma.activityLog.findFirstOrThrow({ where: { workspaceId, action: 'printer.slots' }, orderBy: { createdAt: 'desc' } })).summary;

  beforeAll(async () => {
    // AMS 1 = [tagged black PLA, tagged white PLA, untagged blue PETG, empty]; AMS 2 = [tagged red PLA, empty, empty, empty].
    printer = simFleet()[0];
    const machine = await prisma.machine.create({ data: { workspaceId, name: 'X1C' } });
    target = { workspaceId, machineId: machine.id, machineName: machine.name, serial: printer.serial, adapter: bambuAdapter };
    await prisma.item.updateMany({ where: { workspaceId }, data: { outSince: null } });
    await sync();
  });

  it('loads the one spool on the move that fits what the printer reports', async () => {
    const green = await spool('PLA Green', 'PLA', '#00aa00', { outSince: new Date() });
    await spool('PETG Orange', 'PETG', '#ff8800', { outSince: new Date() });
    printer.feeders[0].trays[3] = { type: 'PLA', color: '00aa00' };
    expect((await sync()).changed).toBe(true);
    expect(await slotAt('AMS 1', 4)).toMatchObject({ itemId: green.id, source: 'manual' });
    expect((await itemNow(green.id)).outSince).toBeNull();
    expect(await lastLog()).toContain('Loaded PLA Green into AMS 1 slot 4: it was on the move');
    // Still out: it was not what went in.
    expect((await prisma.item.findFirstOrThrow({ where: { workspaceId, name: 'PETG Orange' } })).outSince).not.toBeNull();
  });

  it('loads none when two on the move fit', async () => {
    const first = await spool('PLA Yellow 1', 'PLA', '#ffee00', { outSince: new Date() });
    const second = await spool('PLA Yellow 2', 'PLA', '#ffee00', { outSince: new Date() });
    printer.feeders[1].trays[1] = { type: 'PLA', color: 'ffee00' };
    await sync();
    expect((await slotAt('AMS 2', 2)).itemId).toBeNull();
    expect(await lastLog()).toContain('2 spools on the move could be what went into AMS 2 slot 2');
    expect((await itemNow(first.id)).outSince).not.toBeNull();
    expect((await itemNow(second.id)).outSince).not.toBeNull();
    await prisma.item.updateMany({ where: { id: { in: [first.id, second.id] } }, data: { outSince: null } });
  });

  it('ignores a spool on the move that does not fit', async () => {
    printer.feeders[1].trays[2] = { type: 'ABS', color: '000000' };
    await sync();
    expect((await slotAt('AMS 2', 3)).itemId).toBeNull();
  });

  it('a spool the printer knows by its tag is no longer on the move', async () => {
    const tag = readBambu(simDocument(printer)).feeders[1].trays[0].tagId!;
    const red = await spool('PLA Red', 'PLA', '#ff0000', { tagId: tag, outSince: new Date() });
    const original = printer.feeders[1].trays[0];
    printer.feeders[1].trays[0] = null;
    await sync(NOW);
    await sync(NOW + EMPTY_SETTLE_MS + 1);
    printer.feeders[1].trays[0] = original;
    await sync(NOW + EMPTY_SETTLE_MS + 2);
    expect(await slotAt('AMS 2', 1)).toMatchObject({ itemId: red.id, source: 'printer' });
    expect((await itemNow(red.id)).outSince).toBeNull();
  });

  it('gives a spool on the move the tag the printer reads on it', async () => {
    const tagged = await spool('PLA Blue', 'PLA', '#0000ff', { outSince: new Date() });
    printer.feeders[1].trays[3] = { type: 'PLA', color: '0000ff', uuid: 'ABCDEF0123456789ABCDEF0123456789' };
    await sync(NOW + EMPTY_SETTLE_MS + 3);
    expect((await slotAt('AMS 2', 4)).itemId).toBe(tagged.id);
    expect(await itemNow(tagged.id)).toMatchObject({ tagId: 'ABCDEF0123456789ABCDEF0123456789', outSince: null });
  });

  it('a spool taken out of the printer with nowhere to be is on the move again, where a display has a reader', async () => {
    await prisma.device.update({ where: { id: deviceId }, data: { hasReader: true } });
    const green = await prisma.item.findFirstOrThrow({ where: { workspaceId, name: 'PLA Green' } });
    printer.feeders[0].trays[3] = null;
    const later = NOW + 10 * EMPTY_SETTLE_MS;
    await sync(later);
    expect((await itemNow(green.id)).outSince).toBeNull();
    await sync(later + EMPTY_SETTLE_MS + 1);
    expect((await slotAt('AMS 1', 4)).itemId).toBeNull();
    expect((await itemNow(green.id)).outSince).toEqual(new Date(later + EMPTY_SETTLE_MS + 1));
  });

  it('but one that has a place keeps it', async () => {
    const shelved = await spool('PLA Pink', 'PLA', '#ff66aa', { outSince: new Date() });
    printer.feeders[0].trays[3] = { type: 'PLA', color: 'ff66aa' };
    const later = NOW + 20 * EMPTY_SETTLE_MS;
    await sync(later);
    expect((await slotAt('AMS 1', 4)).itemId).toBe(shelved.id);
    await prisma.item.update({ where: { id: shelved.id }, data: { locationId: drawerB } });
    printer.feeders[0].trays[3] = null;
    await sync(later + 1);
    await sync(later + EMPTY_SETTLE_MS + 2);
    expect(await itemNow(shelved.id)).toMatchObject({ locationId: drawerB, outSince: null });
  });
});
