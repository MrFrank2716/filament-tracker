import type { FastenerSize, ReferenceFastener } from '@/reference/types';

/**
 * Common fastener families, generated from ISO and DIN size tables. Lengths are the standard
 * preferred lengths across the range usually stocked, not every length a standard permits.
 */

/** Coarse thread pitches, ISO 261. */
const PITCH: Record<string, number> = {
  M2: 0.4, 'M2.5': 0.45, M3: 0.5, M4: 0.7, M5: 0.8, M6: 1, M8: 1.25, M10: 1.5, M12: 1.75,
};

const PREFERRED = [3, 4, 5, 6, 8, 10, 12, 16, 20, 25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 80, 90, 100];

/** Metric sizes with preferred lengths between min and max (inclusive). */
function metric(ranges: Record<string, [number, number] | null>): FastenerSize[] {
  return Object.entries(ranges).map(([size, range]) => ({
    size,
    pitch: PITCH[size],
    lengths: range ? PREFERRED.filter((l) => l >= range[0] && l <= range[1]) : [],
  }));
}

const plain = (sizes: string[], lengths: Record<string, number[]> = {}): FastenerSize[] =>
  sizes.map((size) => ({ size, pitch: PITCH[size], lengths: lengths[size] ?? [] }));

const INCH = 25.4;
const inches = (values: number[]) => values.map((v) => Number((v * INCH).toFixed(2)));

const A2 = { material: 'Stainless', grade: 'A2-70' } as const;
const A4 = { material: 'Stainless', grade: 'A4-70' } as const;
const BLACK_129 = { material: 'Black oxide steel', grade: '12.9' } as const;
const ZINC_88 = { material: 'Zinc-plated steel', grade: '8.8' } as const;
const ZINC = { material: 'Zinc-plated steel' } as const;
const BRASS = { material: 'Brass' } as const;
const NYLON = { material: 'Nylon' } as const;

const NUT_SIZES = ['M2', 'M2.5', 'M3', 'M4', 'M5', 'M6', 'M8', 'M10', 'M12'];

export const fasteners: ReferenceFastener[] = [
  {
    id: 'fx-iso4762', name: 'Socket cap screw', kind: 'Screw', standard: 'ISO 4762', head: 'Socket cap', drive: 'Hex socket',
    materials: [A2, BLACK_129, A4],
    sizes: metric({ M2: [4, 20], 'M2.5': [4, 25], M3: [4, 40], M4: [5, 50], M5: [6, 60], M6: [8, 80], M8: [10, 100], M10: [16, 100], M12: [20, 100] }),
  },
  {
    id: 'fx-iso7380', name: 'Button head screw', kind: 'Screw', standard: 'ISO 7380', head: 'Button', drive: 'Hex socket',
    materials: [A2, BLACK_129],
    sizes: metric({ 'M2.5': [4, 16], M3: [4, 30], M4: [6, 40], M5: [8, 40], M6: [10, 50], M8: [12, 50], M10: [16, 50] }),
  },
  {
    id: 'fx-iso10642', name: 'Countersunk socket screw', kind: 'Screw', standard: 'ISO 10642', head: 'Countersunk', drive: 'Hex socket',
    materials: [A2, BLACK_129],
    sizes: metric({ M3: [6, 30], M4: [6, 40], M5: [8, 50], M6: [10, 60], M8: [12, 60], M10: [16, 60] }),
  },
  {
    id: 'fx-iso7045', name: 'Pan head screw', kind: 'Screw', standard: 'ISO 7045', head: 'Pan', drive: 'Pozidriv',
    materials: [A2, ZINC],
    sizes: metric({ M2: [4, 16], 'M2.5': [4, 20], M3: [4, 30], M4: [6, 40], M5: [8, 50], M6: [10, 50] }),
  },
  {
    id: 'fx-iso4026', name: 'Grub screw, flat point', kind: 'Grub screw', standard: 'ISO 4026', drive: 'Hex socket',
    materials: [BLACK_129, A2],
    sizes: metric({ M3: [3, 12], M4: [4, 16], M5: [5, 20], M6: [6, 25], M8: [8, 30] }),
  },
  {
    id: 'fx-iso4017', name: 'Hex head set screw', kind: 'Bolt', standard: 'ISO 4017', head: 'Hex', drive: 'Hex head',
    materials: [ZINC_88, A2],
    sizes: metric({ M5: [10, 60], M6: [10, 80], M8: [16, 100], M10: [20, 100], M12: [25, 100] }),
  },
  {
    id: 'fx-iso4032', name: 'Hex nut', kind: 'Nut', standard: 'ISO 4032',
    materials: [A2, ZINC_88],
    sizes: plain(NUT_SIZES),
  },
  {
    id: 'fx-din985', name: 'Nylon insert lock nut', kind: 'Nut', standard: 'DIN 985',
    materials: [A2, ZINC],
    sizes: plain(NUT_SIZES.slice(2)),
  },
  {
    id: 'fx-din562', name: 'Square nut, thin', kind: 'Nut', standard: 'DIN 562',
    materials: [ZINC, A2],
    sizes: plain(['M3', 'M4', 'M5', 'M6']),
  },
  {
    id: 'fx-iso7089', name: 'Flat washer', kind: 'Washer', standard: 'ISO 7089',
    materials: [A2, ZINC],
    sizes: plain(NUT_SIZES),
  },
  {
    id: 'fx-din9021', name: 'Large flat (penny) washer', kind: 'Washer', standard: 'DIN 9021',
    materials: [A2, ZINC],
    sizes: plain(NUT_SIZES.slice(2)),
  },
  {
    id: 'fx-din127', name: 'Spring washer', kind: 'Washer', standard: 'DIN 127',
    materials: [A2, ZINC],
    sizes: plain(NUT_SIZES.slice(2)),
  },
  {
    id: 'fx-heatset', name: 'Heat-set threaded insert', kind: 'Heat-set insert',
    materials: [BRASS],
    sizes: plain(['M2', 'M2.5', 'M3', 'M4', 'M5'], { M2: [3, 4], 'M2.5': [3, 4, 5], M3: [3, 4, 5, 6], M4: [4, 6, 8], M5: [6, 8, 10] }),
  },
  {
    id: 'fx-tnut-20', name: 'Drop-in T-nut, 20 mm profile (6 mm slot)', kind: 'T-nut',
    materials: [ZINC],
    sizes: plain(['M3', 'M4', 'M5']),
  },
  {
    id: 'fx-tnut-30', name: 'Drop-in T-nut, 30 mm profile (8 mm slot)', kind: 'T-nut',
    materials: [ZINC],
    sizes: plain(['M4', 'M5', 'M6']),
  },
  {
    id: 'fx-din1624', name: 'Hammer-in T-nut for wood', kind: 'T-nut', standard: 'DIN 1624',
    materials: [ZINC],
    sizes: plain(['M4', 'M5', 'M6', 'M8', 'M10']),
  },
  {
    id: 'fx-standoff-brass', name: 'Hex standoff, female-female', kind: 'Standoff',
    materials: [BRASS],
    sizes: plain(['M2.5', 'M3'], { 'M2.5': [5, 6, 8, 10, 12, 15, 20], M3: [5, 6, 8, 10, 12, 15, 20, 25, 30] }),
  },
  {
    id: 'fx-standoff-nylon', name: 'Hex standoff, female-female', kind: 'Standoff',
    materials: [NYLON],
    sizes: plain(['M2.5', 'M3'], { 'M2.5': [5, 6, 8, 10, 12], M3: [5, 6, 8, 10, 12, 15, 20] }),
  },
  {
    id: 'fx-din975', name: 'Threaded rod, 1 m', kind: 'Threaded rod', standard: 'DIN 975',
    materials: [ZINC, A2],
    sizes: plain(['M3', 'M4', 'M5', 'M6', 'M8', 'M10', 'M12'], Object.fromEntries(['M3', 'M4', 'M5', 'M6', 'M8', 'M10', 'M12'].map((s) => [s, [1000]]))),
  },
  {
    id: 'fx-iso8734', name: 'Dowel pin, hardened', kind: 'Dowel pin', standard: 'ISO 8734',
    materials: [{ material: 'Steel' }, A2],
    sizes: [
      { size: '2 mm', lengths: [6, 8, 10, 12] },
      { size: '3 mm', lengths: [8, 10, 12, 16, 20] },
      { size: '4 mm', lengths: [10, 12, 16, 20, 25] },
      { size: '5 mm', lengths: [12, 16, 20, 25, 30] },
      { size: '6 mm', lengths: [12, 16, 20, 25, 30, 40] },
    ],
  },
  {
    id: 'fx-woodscrew', name: 'Wood screw, countersunk', kind: 'Wood screw', head: 'Countersunk', drive: 'Pozidriv',
    materials: [ZINC, A2],
    sizes: [
      { size: '3.0 mm', lengths: [12, 16, 20, 25, 30, 35, 40] },
      { size: '3.5 mm', lengths: [16, 20, 25, 30, 35, 40, 45, 50] },
      { size: '4.0 mm', lengths: [20, 25, 30, 35, 40, 45, 50, 60] },
      { size: '4.5 mm', lengths: [25, 30, 35, 40, 45, 50, 60, 70] },
      { size: '5.0 mm', lengths: [30, 40, 50, 60, 70, 80] },
    ],
  },
  {
    id: 'fx-iso7049', name: 'Self-tapping screw, pan head', kind: 'Self-tapping screw', standard: 'ISO 7049', head: 'Pan', drive: 'Phillips',
    materials: [A2, ZINC],
    sizes: [
      { size: 'ST2.2', lengths: [6.5, 9.5, 13] },
      { size: 'ST2.9', lengths: [6.5, 9.5, 13, 16] },
      { size: 'ST3.5', lengths: [9.5, 13, 16, 19] },
      { size: 'ST4.2', lengths: [9.5, 13, 16, 19, 25] },
    ],
  },
  {
    id: 'fx-rivet', name: 'Blind rivet, domed', kind: 'Rivet',
    materials: [{ material: 'Aluminium' }, A2],
    sizes: [
      { size: '3.2 mm', lengths: [6, 8, 10, 12] },
      { size: '4.0 mm', lengths: [6, 8, 10, 12, 16] },
      { size: '4.8 mm', lengths: [8, 10, 12, 16, 20] },
    ],
  },
  // Imperial (UNC)
  {
    id: 'fx-unc-shcs', name: 'Socket cap screw, UNC', kind: 'Screw', standard: 'ASME B18.3', head: 'Socket cap', drive: 'Hex socket', imperial: true,
    materials: [{ material: 'Stainless', grade: '18-8' }, { material: 'Black oxide steel', grade: 'Alloy steel' }],
    sizes: [
      { size: '#4-40', lengths: inches([1 / 4, 3 / 8, 1 / 2, 5 / 8, 3 / 4]) },
      { size: '#6-32', lengths: inches([1 / 4, 3 / 8, 1 / 2, 5 / 8, 3 / 4, 1]) },
      { size: '#8-32', lengths: inches([3 / 8, 1 / 2, 5 / 8, 3 / 4, 1]) },
      { size: '#10-24', lengths: inches([3 / 8, 1 / 2, 3 / 4, 1, 1.25]) },
      { size: '1/4-20', lengths: inches([1 / 2, 3 / 4, 1, 1.25, 1.5, 2]) },
      { size: '5/16-18', lengths: inches([3 / 4, 1, 1.25, 1.5, 2]) },
      { size: '3/8-16', lengths: inches([3 / 4, 1, 1.5, 2, 2.5]) },
    ],
  },
  {
    id: 'fx-unc-nut', name: 'Hex nut, UNC', kind: 'Nut', imperial: true,
    materials: [{ material: 'Stainless', grade: '18-8' }, { material: 'Zinc-plated steel', grade: 'Grade 5' }],
    sizes: plain(['#4-40', '#6-32', '#8-32', '#10-24', '1/4-20', '5/16-18', '3/8-16']),
  },
  {
    id: 'fx-sae-washer', name: 'Flat washer, SAE', kind: 'Washer', imperial: true,
    materials: [{ material: 'Stainless', grade: '18-8' }, ZINC],
    sizes: plain(['#4', '#6', '#8', '#10', '1/4', '5/16', '3/8']),
  },
];
