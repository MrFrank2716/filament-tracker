import jsQR from 'jsqr';
import { describe, expect, it } from 'vitest';
import { qrShape } from '@/lib/labels';
import { findAllByCode, findByCode, parseScan } from '@/lib/scan';
import type { Item, Location } from '@/lib/types';

describe('working out what was scanned', () => {
  it('reads a label\'s link whatever address it was printed at', () => {
    expect(parseScan('https://shop.example/s/cmwio79ma00027d3fwcqc5o9q')).toEqual({ kind: 'item', id: 'cmwio79ma00027d3fwcqc5o9q' });
    expect(parseScan('http://192.168.1.20:4000/l/abc123/')).toEqual({ kind: 'location', id: 'abc123' });
    expect(parseScan('  /s/abc123 ')).toEqual({ kind: 'item', id: 'abc123' });
  });

  it('does not take other links or look-alikes for a label', () => {
    expect(parseScan('https://shop.example/settings')).toEqual({ kind: 'text', text: 'https://shop.example/settings' });
    expect(parseScan('https://shop.example/s/abc/extra').kind).toBe('text');
    expect(parseScan('/s/../../etc').kind).toBe('text');
    expect(parseScan('http://').kind).toBe('text');
  });

  it('recognises an OpenSpool record', () => {
    const scan = parseScan('{"protocol":"openspool","version":"1.0","type":"PLA","color_hex":"FFAABB","brand":"Generic","min_temp":"220","max_temp":"240"}');
    expect(scan).toMatchObject({ kind: 'openspool', record: { type: 'PLA', color_hex: 'FFAABB' } });
    expect(parseScan('{"protocol":"something-else"}').kind).toBe('text');
    expect(parseScan('{not json').kind).toBe('text');
  });

  it('treats anything else as a code', () => {
    expect(parseScan(' 5901234123457 ')).toEqual({ kind: 'text', text: '5901234123457' });
  });

  it('finds what a code belongs to: an item by its SKU or barcode, a location by its label code', () => {
    const items = [{ id: 'i1', sku: '5901234123457' }, { id: 'i2', sku: '' }] as Item[];
    const locations = [{ id: 'l1', code: 'LOC-014' }, { id: 'l2', code: '' }] as Location[];
    expect(findByCode('5901234123457', items, locations)).toEqual({ kind: 'item', id: 'i1' });
    expect(findByCode('loc-014', items, locations)).toEqual({ kind: 'location', id: 'l1' });
    expect(findByCode('unknown', items, locations)).toBeNull();
    expect(findByCode('', items, locations)).toBeNull();
  });

  it('finds every item sharing a maker\'s barcode', () => {
    const items = [{ id: 'i1', sku: '5901234123457' }, { id: 'i2', sku: 'other' }, { id: 'i3', sku: '5901234123457' }] as Item[];
    const locations = [{ id: 'l1', code: '5901234123457' }] as Location[];
    expect(findAllByCode('5901234123457', items, locations)).toEqual([{ kind: 'item', id: 'i1' }, { kind: 'item', id: 'i3' }]);
    expect(findAllByCode('5901234123457', [], locations)).toEqual([{ kind: 'location', id: 'l1' }]);
    expect(findAllByCode('unknown', items, locations)).toEqual([]);
  });
});

describe('a printed label', () => {
  it('reads back as the link it was made from', () => {
    const url = 'https://shop.example/s/cmwio79ma00027d3fwcqc5o9q';
    const shape = qrShape(url);
    // Draw the code the way the label does (dark modules on white, a two-module margin) at 4 pixels a module.
    const scale = 4;
    const margin = 2;
    const side = (shape.size + margin * 2) * scale;
    const pixels = new Uint8ClampedArray(side * side * 4).fill(255);
    for (let y = 0; y < side; y++) {
      for (let x = 0; x < side; x++) {
        const row = Math.floor(y / scale) - margin;
        const column = Math.floor(x / scale) - margin;
        if (row >= 0 && column >= 0 && row < shape.size && column < shape.size && shape.dark(row, column)) pixels.fill(0, (y * side + x) * 4, (y * side + x) * 4 + 3);
      }
    }
    expect(jsQR(pixels, side, side)?.data).toBe(url);
    expect(parseScan(jsQR(pixels, side, side)!.data)).toEqual({ kind: 'item', id: 'cmwio79ma00027d3fwcqc5o9q' });
  });
});
