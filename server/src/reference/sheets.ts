import type { ReferenceSheet, SheetSize } from '@/reference/types';

/**
 * Sheet materials for laser cutters and CNC routers, with the thicknesses usually stocked.
 * Notes flag materials that are unsafe or unsuitable for a laser. They are general guidance:
 * the machine maker's own material list always wins.
 */

const LASER_UNSAFE = 'Do not laser cut';

export const sheets: ReferenceSheet[] = [
  { id: 'sh-birch-ply-laser', name: 'Birch plywood, laser grade', material: 'Plywood', finish: 'Birch', thicknesses: [1.5, 2, 3, 4, 6] },
  { id: 'sh-birch-ply', name: 'Birch plywood', material: 'Plywood', finish: 'Birch', thicknesses: [6, 9, 12, 15, 18] },
  { id: 'sh-poplar-ply', name: 'Poplar plywood', material: 'Plywood', finish: 'Poplar', thicknesses: [3, 4, 6] },
  { id: 'sh-mdf', name: 'MDF', material: 'MDF', thicknesses: [2, 3, 4, 6, 9, 12, 18] },
  { id: 'sh-mdf-mr', name: 'MDF, moisture resistant', material: 'MDF', finish: 'Moisture resistant', thicknesses: [6, 9, 12, 18] },
  { id: 'sh-hdf', name: 'HDF hardboard', material: 'HDF', thicknesses: [3, 6] },
  { id: 'sh-hardwood', name: 'Hardwood board', material: 'Hardwood', finish: 'Oak, walnut, cherry…', thicknesses: [3, 6, 10, 20] },
  { id: 'sh-veneer', name: 'Wood veneer', material: 'Veneer', thicknesses: [0.6] },
  { id: 'sh-bamboo', name: 'Bamboo plywood', material: 'Bamboo', thicknesses: [3, 6] },
  { id: 'sh-cork', name: 'Cork sheet', material: 'Cork', thicknesses: [2, 3, 5] },
  { id: 'sh-acrylic-cast-clear', name: 'Cast acrylic, clear', material: 'Acrylic', finish: 'Clear', thicknesses: [2, 3, 4, 5, 6, 8, 10], note: 'Cast acrylic engraves frosted white; best for engraving and cutting.' },
  { id: 'sh-acrylic-cast-colour', name: 'Cast acrylic, colour', material: 'Acrylic', finish: 'Colour', thicknesses: [3, 5] },
  { id: 'sh-acrylic-extruded', name: 'Extruded acrylic', material: 'Acrylic', finish: 'Clear', thicknesses: [2, 3, 5], note: 'Cuts with a polished edge but engraves poorly.' },
  { id: 'sh-acrylic-mirror', name: 'Mirror acrylic', material: 'Acrylic', finish: 'Mirror', thicknesses: [3], note: 'Cut with the protective film on. Engrave from the back.' },
  { id: 'sh-laminate', name: 'Two-colour engraving laminate', material: 'Engraving laminate', thicknesses: [0.8, 1.6] },
  { id: 'sh-petg', name: 'PETG sheet', material: 'PETG', thicknesses: [0.5, 1, 2], note: 'Melts on a laser. Cut with a knife or on the CNC.' },
  { id: 'sh-pp', name: 'Polypropylene sheet', material: 'Polypropylene', thicknesses: [0.5, 0.8] },
  { id: 'sh-hdpe', name: 'HDPE sheet', material: 'HDPE', thicknesses: [3, 6, 10, 12], note: 'Melts on a laser. Machines well on the CNC.' },
  { id: 'sh-acetal', name: 'Acetal (POM) sheet', material: 'Acetal', thicknesses: [3, 6, 10], note: 'Gives off formaldehyde when laser cut. Only with strong extraction.' },
  { id: 'sh-polycarbonate', name: 'Polycarbonate sheet', material: 'Polycarbonate', thicknesses: [2, 3], note: `${LASER_UNSAFE}: it discolours, burns and gives off fumes. Cut on the CNC.` },
  { id: 'sh-pvc-foam', name: 'PVC foam board', material: 'PVC foam', thicknesses: [3, 5, 10], note: `${LASER_UNSAFE}: PVC releases chlorine gas that harms people and the machine. Knife or CNC only.` },
  { id: 'sh-card', name: 'Card and mountboard', material: 'Card', thicknesses: [0.5, 1, 1.4] },
  { id: 'sh-greyboard', name: 'Greyboard', material: 'Greyboard', thicknesses: [1, 2, 3] },
  { id: 'sh-paper', name: 'Paper', material: 'Paper', thicknesses: [0.2] },
  { id: 'sh-leather', name: 'Vegetable-tanned leather', material: 'Leather', thicknesses: [1.5, 2, 3], note: 'Use vegetable-tanned leather on a laser; chrome-tanned leather gives off harmful fumes.' },
  { id: 'sh-felt', name: 'Wool felt', material: 'Felt', thicknesses: [1, 3, 5] },
  { id: 'sh-fabric', name: 'Cotton fabric', material: 'Fabric', thicknesses: [0.5] },
  { id: 'sh-rubber', name: 'Laser-safe rubber', material: 'Rubber', thicknesses: [2.3], note: 'Only rubber sold as laser-safe. Ordinary rubber may contain chlorine.' },
  { id: 'sh-eva', name: 'EVA foam', material: 'Foam', thicknesses: [2, 5, 10], note: 'Can flare up on a laser. Never leave it unattended.' },
  { id: 'sh-slate', name: 'Slate', material: 'Slate', thicknesses: [5], note: 'For laser engraving, not cutting.' },
  { id: 'sh-glass', name: 'Glass', material: 'Glass', thicknesses: [3], note: 'For laser engraving, not cutting.' },
  { id: 'sh-aluminium', name: 'Aluminium sheet', material: 'Aluminium', thicknesses: [1, 1.5, 2, 3, 5, 6], note: 'CNC or fibre laser. CO2 and diode lasers can only mark coated aluminium.' },
  { id: 'sh-brass', name: 'Brass sheet', material: 'Brass', thicknesses: [0.5, 1, 2], note: 'CNC or fibre laser.' },
  { id: 'sh-stainless', name: 'Stainless steel sheet', material: 'Stainless steel', thicknesses: [0.5, 1], note: 'Fibre laser, or marking spray on a CO2 laser.' },
];

export const sheetSizes: SheetSize[] = [
  { label: '300 × 200', width: 300, length: 200 },
  { label: '300 × 300', width: 300, length: 300 },
  { label: '400 × 300', width: 400, length: 300 },
  { label: '600 × 300', width: 600, length: 300 },
  { label: '600 × 400', width: 600, length: 400 },
  { label: '1220 × 610', width: 1220, length: 610 },
  { label: '2440 × 1220', width: 2440, length: 1220 },
  { label: 'A4 (297 × 210)', width: 297, length: 210 },
  { label: 'A3 (420 × 297)', width: 420, length: 297 },
  { label: 'A2 (594 × 420)', width: 594, length: 420 },
  { label: '12 × 12 in (305 × 305)', width: 305, length: 305 },
  { label: '12 × 20 in (305 × 508)', width: 305, length: 508 },
  { label: '12 × 24 in (305 × 610)', width: 305, length: 610 },
];
