import { describe, expect, it } from 'vitest';
import type { Catalog } from '@/hooks/useCatalog';
import { clampLabelSize, isLocalAddress, itemLabel, itemLink, locationLabel, locationLink, qrShape } from '@/lib/labels';
import type { Item, Location } from '@/lib/types';

const locations: Location[] = [
  { id: 'site', name: 'Unit 4', kind: 'Building', code: '', parentId: null },
  { id: 'room', name: 'Workshop', kind: 'Room', code: '', parentId: 'site' },
  { id: 'rack', name: 'Filament rack', kind: 'Shelf', code: 'LOC-014', parentId: 'room' },
];
const field = (key: string, fieldType: string) => ({ id: key, key, label: key, fieldType, unit: '', options: [], required: false, showInList: true, isSizeDimension: false });
const type = { id: 't1', name: 'Filament', fields: [field('material', 'text'), field('colour', 'color')] };
const catalog = { locations, typeById: new Map([['t1', type]]) } as unknown as Catalog;
const item = { id: 'abc123', itemTypeId: 't1', name: 'PLA Black', sku: '', locationId: 'rack', fields: { material: 'PLA', colour: '#000000' } } as unknown as Item;

describe('labels', () => {
  it('link to the item or location and nothing else', () => {
    expect(itemLink('https://shop.example', 'abc123')).toBe('https://shop.example/s/abc123');
    expect(locationLink('https://shop.example', 'rack')).toBe('https://shop.example/l/rack');
  });

  it('show what an item is and the nearest two steps of where it lives', () => {
    expect(itemLabel(item, catalog, 'https://shop.example')).toEqual({
      key: 'abc123', url: 'https://shop.example/s/abc123', title: 'PLA Black', lines: ['PLA', 'Workshop › Filament rack'],
    });
  });

  it('show a location\'s kind, its code and what it is inside', () => {
    expect(locationLabel(locations[2], locations, 'https://shop.example')).toEqual({
      key: 'rack', url: 'https://shop.example/l/rack', title: 'Filament rack', lines: ['Shelf', 'Unit 4 › Workshop'], code: 'LOC-014',
    });
    expect(locationLabel(locations[0], locations, 'https://shop.example').lines).toEqual(['Building']);
  });

  it('keep a typed size within what a label printer takes', () => {
    expect(clampLabelSize({ width: 62, height: 29 })).toEqual({ width: 62, height: 29 });
    expect(clampLabelSize({ width: 4, height: 900 })).toEqual({ width: 15, height: 150 });
    expect(clampLabelSize({ width: Number.NaN })).toEqual({ width: 62, height: 29 });
    expect(clampLabelSize(null)).toEqual({ width: 62, height: 29 });
  });

  it('warn about an address only this computer can open', () => {
    expect(isLocalAddress('http://localhost:5173')).toBe(true);
    expect(isLocalAddress('http://127.0.0.1:4000')).toBe(true);
    expect(isLocalAddress('https://shop.example')).toBe(false);
    expect(isLocalAddress('http://192.168.1.20:4000')).toBe(false);
  });
});

describe('the QR code', () => {
  const shape = qrShape('https://shop.example/s/cmwio79ma00027d3fwcqc5o9q');

  it('is a square with the three corner markers every reader looks for', () => {
    expect(shape.size).toBeGreaterThanOrEqual(21);
    expect((shape.size - 21) % 4).toBe(0);
    const corner = (row: number, column: number) => {
      // A 7 × 7 marker: dark ring, light ring, dark 3 × 3 middle.
      expect(shape.dark(row, column)).toBe(true);
      expect(shape.dark(row + 1, column + 1)).toBe(false);
      expect(shape.dark(row + 3, column + 3)).toBe(true);
      expect(shape.dark(row + 6, column + 6)).toBe(true);
    };
    corner(0, 0);
    corner(0, shape.size - 7);
    corner(shape.size - 7, 0);
  });

  it('draws exactly its dark modules', () => {
    let dark = 0;
    for (let row = 0; row < shape.size; row++) for (let column = 0; column < shape.size; column++) if (shape.dark(row, column)) dark++;
    const drawn = [...shape.path.matchAll(/h(\d+)v1/g)].reduce((total, match) => total + Number(match[1]), 0);
    expect(drawn).toBe(dark);
  });
});
