import { describe, expect, it } from 'vitest';
import type { Catalog } from '@/hooks/useCatalog';
import { cannotTag, fromOpenSpool, stickerTag, toOpenSpool } from '@/lib/openspool';
import { matchScore, newSpoolFrom } from '@/lib/spoolMatch';
import type { Item } from '@/lib/types';

const field = (key: string, fieldType: string, options: string[] = []) => ({ id: key, key, label: key, fieldType, unit: '', options, required: false, showInList: true, isSizeDimension: false, sortOrder: 0 });
const filament = { id: 't1', name: 'Filament', defaultUnitId: 'g', fields: [
  field('material', 'select', ['PLA', 'PETG', 'ABS', 'Other']), field('colour', 'color'), field('colour_name', 'text'), field('brand', 'text'), field('nozzle_temp', 'text'),
] };
const screws = { id: 't2', name: 'Fixing', defaultUnitId: null, fields: [field('thread', 'text')] };
const catalog = {
  types: [filament, screws],
  typeById: new Map<string, unknown>([['t1', filament], ['t2', screws]]),
  unitById: new Map([['g', { id: 'g', name: 'Grams', symbol: 'g', decimals: 0 }]]),
} as unknown as Catalog;
const spool = (fields: Item['fields'], over: Partial<Item> = {}) => ({ id: 'i1', itemTypeId: 't1', name: 'Spool', tagId: null, fields, ...over }) as Item;

describe('writing an OpenSpool record for a spool in stock', () => {
  it('carries material, colour, brand and nozzle range in the format\'s own spelling', () => {
    expect(toOpenSpool(spool({ material: 'PETG', colour: '#1f6feb', brand: 'Polymaker', nozzle_temp: '230-250' }), catalog)).toEqual({
      protocol: 'openspool', version: '1.0', type: 'PETG', color_hex: '1F6FEB', brand: 'Polymaker', min_temp: '230', max_temp: '250',
    });
  });

  it('falls back to "Generic", white and the usual range for the material', () => {
    expect(toOpenSpool(spool({ material: 'PLA' }), catalog)).toMatchObject({ type: 'PLA', color_hex: 'FFFFFF', brand: 'Generic', min_temp: '190', max_temp: '220' });
    expect(toOpenSpool(spool({ material: 'ABS', nozzle_temp: 255 }), catalog)).toMatchObject({ min_temp: '255', max_temp: '255' });
  });

  it('refuses what is not a spool, and a material with no known temperature', () => {
    const screw = { id: 'i2', itemTypeId: 't2', name: 'M3', tagId: null, fields: { thread: 'M3' } } as unknown as Item;
    expect(toOpenSpool(screw, catalog)).toBeNull();
    expect(cannotTag(screw, catalog)).toMatch(/Only filament spools/);
    expect(toOpenSpool(spool({ material: 'Other' }), catalog)).toBeNull();
    expect(cannotTag(spool({ material: 'Other' }), catalog)).toMatch(/nozzle temperature/);
    expect(cannotTag(spool({ material: 'PLA' }), catalog)).toBeNull();
  });
});

describe('reading an OpenSpool record', () => {
  const record = { protocol: 'openspool', version: '1.0', type: 'PLA', color_hex: 'FFAABB', brand: 'Generic', min_temp: '220', max_temp: '240' };

  it('becomes the same shape a printer reports a tray in', () => {
    expect(fromOpenSpool(record)).toEqual({
      state: 'loaded', material: 'PLA', subType: null, colour: '#ffaabb', colours: [], brand: null, tagId: null,
      remainingPercent: null, spoolWeightGrams: null, nozzleTemp: [220, 240],
    });
  });

  it('is lenient about spelling and gives up only when no material is named', () => {
    expect(fromOpenSpool({ type: 'petg', color_hex: '#00ff00ff', min_temp: 250, max_temp: 230 })).toMatchObject({ material: 'petg', colour: '#00ff00', nozzleTemp: [230, 250] });
    expect(fromOpenSpool({ type: 'PLA', color_hex: 'nope' })).toMatchObject({ colour: null, nozzleTemp: null });
    expect(fromOpenSpool({ color_hex: 'FFAABB' })).toBeNull();
  });

  it('fills in a new spool, with a material the workspace does not list becoming "Other"', () => {
    expect(newSpoolFrom(fromOpenSpool({ ...record, brand: 'Polymaker' })!, catalog)).toMatchObject({
      itemTypeId: 't1', name: 'Polymaker PLA Light red', capacity: 1000, quantity: 1000,
      fields: { material: 'PLA', colour: '#ffaabb', brand: 'Polymaker', nozzle_temp: '220-240' },
    });
    expect(newSpoolFrom(fromOpenSpool({ ...record, type: 'PVA' })!, catalog).fields).toMatchObject({ material: 'Other' });
  });

  it('ranks stock against it like against a tray', () => {
    const tag = fromOpenSpool(record)!;
    expect(matchScore(spool({ material: 'PLA', colour: '#ffa8b8' }), tag, catalog)).toBe(2);
    expect(matchScore(spool({ material: 'PLA', colour: '#000000' }), tag, catalog)).toBe(0);
    expect(matchScore(spool({ material: 'PETG', colour: '#ffaabb' }), tag, catalog)).toBe(0);
  });

  it('round-trips what it writes', () => {
    const written = toOpenSpool(spool({ material: 'PETG', colour: '#1f6feb', brand: 'Polymaker', nozzle_temp: '230-250' }), catalog)!;
    expect(fromOpenSpool({ ...written })).toMatchObject({ material: 'PETG', colour: '#1f6feb', brand: 'Polymaker', nozzleTemp: [230, 250] });
  });
});

describe('a sticker\'s serial', () => {
  it('is kept as NFC and its hexadecimal digits', () => {
    expect(stickerTag('04:a1:b2:c3:d4:e5:f6')).toBe('NFC04A1B2C3D4E5F6');
    expect(stickerTag('04A1B2C3')).toBe('NFC04A1B2C3');
  });
  it('is ignored when there is none worth keeping', () => {
    expect(stickerTag('')).toBeNull();
    expect(stickerTag(null)).toBeNull();
    expect(stickerTag('0:1')).toBeNull();
  });
});
