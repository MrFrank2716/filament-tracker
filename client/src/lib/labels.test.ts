import { describe, expect, it } from 'vitest';
import type { Catalog } from '@/hooks/useCatalog';
import { clampLabelSize, isLocalAddress, itemLabel, itemLink, LABEL_PRESETS, labelCode, labelLayout, LINE_SCALE, locationLabel, locationLink, QR_QUIET_ZONE, qrShape, TEXT_MIN_MM } from '@/lib/labels';
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
      key: 'abc123', url: 'https://shop.example/s/abc123', title: 'PLA Black', details: 'PLA', place: 'Workshop › Filament rack',
    });
  });

  it('show a location\'s kind, its code and what it is inside', () => {
    expect(locationLabel(locations[2], locations, 'https://shop.example')).toEqual({
      key: 'rack', url: 'https://shop.example/l/rack', title: 'Filament rack', code: 'LOC-014', details: 'Shelf', place: 'Unit 4 › Workshop',
    });
    // Nothing it is inside, and no code: those parts are left out, not printed empty.
    expect(locationLabel(locations[0], locations, 'https://shop.example')).toEqual({ key: 'site', url: 'https://shop.example/l/site', title: 'Unit 4', details: 'Building' });
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

describe('dividing a label between its code and its text', () => {
  const sizes = [
    ...LABEL_PRESETS.map(({ width, height }) => ({ width, height })),
    { width: 30, height: 50 }, { width: 25, height: 25 }, { width: 20, height: 20 }, { width: 15, height: 15 },
    { width: 150, height: 150 }, { width: 150, height: 15 }, { width: 15, height: 150 }, { width: 100, height: 60 }, { width: 24, height: 60 },
  ];
  // A short address makes a code of 29 squares a side, a long one 37; both printer resolutions.
  const codes = [29, 37].flatMap((modules) => ([203, 300] as const).map((dpi) => ({ modules, dpi })));

  it('keeps everything inside the label and the code on whole printer dots, at every size', () => {
    for (const size of sizes) {
      for (const code of codes) {
        const layout = labelLayout(size, code);
        const name = `${size.width} × ${size.height}, ${code.modules} squares at ${code.dpi} dpi`;
        const inner = { width: size.width - layout.padding * 2, height: size.height - layout.padding * 2 };
        const dot = 25.4 / code.dpi;
        expect(layout.qr, name).toBeLessThanOrEqual(Math.min(inner.width, inner.height) + 0.01);
        expect(layout.text.width, name).toBeGreaterThanOrEqual(0);
        expect(layout.text.height, name).toBeGreaterThanOrEqual(0);
        if (!layout.fine) {
          // Each square is a whole number of dots, and wide enough to scan.
          expect(layout.qr / ((code.modules + QR_QUIET_ZONE * 2) * dot), name).toBeCloseTo(layout.dots, 2);
          expect(layout.dots * dot, name).toBeGreaterThanOrEqual(0.33);
        }
        if (layout.arrangement === 'row') expect(layout.qr + layout.gap + layout.text.width, name).toBeCloseTo(inner.width, 1);
        if (layout.arrangement === 'column') expect(layout.qr + layout.gap + layout.text.height, name).toBeCloseTo(inner.height, 1);
        // The lines under the name never start out below the smallest type.
        if (layout.arrangement !== 'code') expect(layout.font * LINE_SCALE, name).toBeGreaterThanOrEqual(TEXT_MIN_MM - 0.01);
      }
    }
  });

  it('leaves the text real room on the small sizes instead of giving the code the whole height', () => {
    const small = labelLayout({ width: 40, height: 30 });
    expect(small).toMatchObject({ arrangement: 'row', dots: 3, fine: false });
    expect(small.text.width).toBeGreaterThan(18);
    expect(small.qr).toBeLessThan(18);
    // A wide label still gets a code nearly as tall as the label: five dots a square.
    expect(labelLayout({ width: 62, height: 29 })).toMatchObject({ arrangement: 'row', dots: 5 });
    expect(labelLayout({ width: 62, height: 29 }).qr).toBeCloseTo(25.65, 1);
  });

  it('sizes the code for the printer: more, finer dots to a square at 300 dpi', () => {
    const at203 = labelLayout({ width: 40, height: 30 }, { modules: 37, dpi: 203 });
    const at300 = labelLayout({ width: 40, height: 30 }, { modules: 37, dpi: 300 });
    expect([at203.dots, at300.dots]).toEqual([3, 4]);
    expect(at300.qr).toBeLessThan(at203.qr);
  });

  it('stacks code over text where side by side would squeeze the text', () => {
    expect(labelLayout({ width: 30, height: 50 }).arrangement).toBe('column');
    expect(labelLayout({ width: 15, height: 150 }, { modules: 29, dpi: 203 }).arrangement).toBe('column');
    expect(labelLayout({ width: 150, height: 15 }, { modules: 29, dpi: 203 }).arrangement).toBe('row');
  });

  it('prints the code alone when no text could be read beside it', () => {
    expect(labelLayout({ width: 15, height: 15 }, { modules: 29, dpi: 203 })).toMatchObject({ arrangement: 'code', dots: 3, fine: false, text: { width: 0, height: 0 } });
    expect(labelLayout({ width: 18, height: 16 }).arrangement).toBe('code');
  });

  it('says when a label is too small for its code to scan reliably', () => {
    // A long address (37 squares) on a 15 mm label: two dots a square is all that fits at 203 dpi.
    expect(labelLayout({ width: 15, height: 15 }, { modules: 37, dpi: 203 })).toMatchObject({ arrangement: 'code', dots: 2, fine: true });
    expect(labelLayout({ width: 20, height: 20 }, { modules: 37, dpi: 203 }).fine).toBe(false);
  });
});

describe('choosing the code for a label', () => {
  const url = 'http://192.168.1.20:4000/s/cmwio79ma00027d3fwcqc5o9q';

  it('uses the sturdier code wherever its squares print wide enough', () => {
    const { shape, layout } = labelCode(url, { width: 40, height: 30 }, 203);
    expect(shape.size).toBe(qrShape(url, 'M').size);
    expect(layout.fine).toBe(false);
  });

  it('falls back to the simpler code on a label too small for the sturdier one', () => {
    // 33 squares at medium correction need 13.9 mm at three dots a square; a 15 mm label has 13.4.
    expect(qrShape(url, 'M').size).toBe(33);
    expect(qrShape(url, 'L').size).toBe(29);
    const { shape, layout } = labelCode(url, { width: 15, height: 15 }, 203);
    expect(shape.size).toBe(29);
    expect(layout).toMatchObject({ arrangement: 'code', dots: 3, fine: false });
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
