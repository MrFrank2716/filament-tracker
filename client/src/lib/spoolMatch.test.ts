import { describe, expect, it } from 'vitest';
import type { Catalog } from '@/hooks/useCatalog';
import { nearestColour } from '@/components/reference/ReferencePicker';
import { colourWord, newSpoolFrom } from '@/lib/spoolMatch';
import type { Detected } from '@/lib/types';

const field = (key: string, fieldType: string, options: string[] = []) => ({ id: key, key, label: key, fieldType, unit: '', options, required: false, showInList: true, isSizeDimension: false, sortOrder: 0 });
const catalog = {
  types: [{ id: 't1', name: 'Filament', defaultUnitId: 'g', fields: [
    field('material', 'select', ['PLA', 'PLA-CF', 'PETG', 'ABS', 'PA', 'PA-CF', 'Other']), field('colour', 'color'), field('colour_name', 'text'),
    field('brand', 'text'), field('diameter', 'number'), field('nozzle_temp', 'text'),
  ] }],
  unitById: new Map([['g', { id: 'g', name: 'Grams', symbol: 'g', decimals: 0 }]]),
} as unknown as Catalog;
const tray = (over: Partial<Detected>): Detected => ({ state: 'loaded', material: 'ABS', subType: null, colour: '#ffffff', colours: [], brand: null, tagId: null, remainingPercent: null, spoolWeightGrams: null, ...over });

describe('filling in a new spool from what the printer reads', () => {
  it('fills everything it can for a spool without a tag, assuming a usual full spool', () => {
    expect(newSpoolFrom(tray({ nozzleTemp: [240, 270], diameter: 1.75 }), catalog, 'm1')).toEqual({
      itemTypeId: 't1', unitId: 'g', name: 'ABS White', capacity: 1000, quantity: 1000, compatibleMachineIds: ['m1'], tagId: null,
      fields: { material: 'ABS', colour: '#ffffff', colour_name: 'White', diameter: 1.75, nozzle_temp: '240-270' },
    });
  });
  it('uses the size and amount left that a tagged spool reports', () => {
    const spool = newSpoolFrom(tray({ material: 'PLA', subType: 'PLA Basic', colour: '#000000', brand: 'Bambu Lab', tagId: 'AB12', remainingPercent: 82, spoolWeightGrams: 1000 }), catalog);
    expect(spool).toMatchObject({ name: 'PLA Basic Black', capacity: 1000, quantity: 820, tagId: 'AB12' });
    expect(spool.fields).toMatchObject({ material: 'PLA', brand: 'Bambu Lab', colour_name: 'Black' });
  });
  it('finds the nearest material the category offers', () => {
    const material = (over: Partial<Detected>) => newSpoolFrom(tray(over), catalog).fields?.material;
    expect(material({ material: 'PETG', subType: 'PETG HF' })).toBe('PETG');
    expect(material({ material: 'PA-CF', subType: 'PAHT-CF' })).toBe('PA-CF');
    expect(material({ material: 'PLA-CF' })).toBe('PLA-CF');
    expect(material({ material: 'TPU' })).toBe('Other');
  });
  it('names colours plainly', () => {
    expect(['#000000', '#ffffff', '#c12e1f', '#1f6feb', '#0a2989', '#f5c518'].map(colourWord)).toEqual(['Black', 'White', 'Red', 'Blue', 'Dark blue', 'Yellow']);
  });
  it('picks the catalogue colour that looks most like the printer\'s', () => {
    const colours: [string, string][] = [['Jet Black', '#101010'], ['Signal Red', '#c8102e'], ['Sky Blue', '#3a8dde']];
    expect(nearestColour(colours, '#1f6feb')).toBe('Sky Blue');
    expect(nearestColour(colours, '#000000')).toBe('Jet Black');
    // A mid blue is a blue, not the grey that happens to be as bright (seen with a real catalogue line).
    expect(nearestColour([['Blue', '#0000cd'], ['Solid Grey', '#70708a'], ['Solid Blue', '#1c2f7a']], '#1f6feb')).not.toBe('Solid Grey');
    expect(nearestColour([['Grey', '#808080'], ['Red', '#cc0000']], '#8a8a8a')).toBe('Grey');
    expect(nearestColour(colours, null)).toBeNull();
    expect(nearestColour([], '#000000')).toBeNull();
  });
});
