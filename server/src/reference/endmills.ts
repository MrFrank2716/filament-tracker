import type { ReferenceEndmill } from '@/reference/types';

/**
 * Generic cutter geometries for desktop and hobby CNC. These are shapes, not branded products:
 * the user adds the maker, coating and price on the item once it is in their workspace.
 */

const INCH = 25.4;
const mm = (value: number) => Number(value.toFixed(3));
const fmt = (value: number) => (Number.isInteger(value) ? String(value) : String(Number(value.toFixed(3))));
const slug = (value: number) => fmt(value).replace('.', '_');

type Entry = Omit<ReferenceEndmill, 'id' | 'name' | 'toolMaterial'> & { toolMaterial?: ReferenceEndmill['toolMaterial']; label?: string };

const NAMES: Record<ReferenceEndmill['cutType'], string> = {
  Flat: 'flat', 'Ball nose': 'ball nose', 'Bull nose': 'bull nose', 'Tapered ball nose': 'tapered ball nose',
  'V-bit': 'V-bit', 'O-flute': 'O-flute', Downcut: 'downcut', Compression: 'compression', Chamfer: 'chamfer',
  Engraving: 'engraving bit', Surfacing: 'surfacing bit', Roundover: 'roundover', Dovetail: 'dovetail', Drill: 'PCB drill',
};

function make(entry: Entry): ReferenceEndmill {
  const { label, toolMaterial = 'Carbide', ...rest } = entry;
  const size = entry.imperial ? `${label ?? fmt(entry.diameter)}"` : `${fmt(entry.diameter)} mm`;
  const flutes = entry.cutType === 'Drill' || entry.angle ? '' : `${entry.flutes}-flute `;
  const angle = entry.angle ? `${entry.angle}° ` : '';
  const shank = Math.abs(entry.shank - 6.35) < 0.01 ? '1/4" shank' : Math.abs(entry.shank - 3.175) < 0.01 ? '1/8" shank' : `${fmt(entry.shank)} mm shank`;
  return {
    ...rest,
    toolMaterial,
    id: `em-${entry.cutType.toLowerCase().replace(/[^a-z]+/g, '-')}-${entry.angle ? `${entry.angle}deg-` : ''}${slug(entry.diameter)}-${entry.flutes}f-${slug(entry.shank)}`,
    name: `${size} ${angle}${flutes}${NAMES[entry.cutType]}, ${shank}`,
  };
}

const metricShank = (diameter: number) => (diameter <= 4 ? diameter : diameter <= 6 ? 6 : diameter);

const WOOD_PLASTIC = 'Wood, plastics, aluminium';

export const endmills: ReferenceEndmill[] = [
  // Hobby router sizes on a 1/8" (3.175 mm) shank
  ...[0.8, 1, 1.5, 2, 2.5, 3.175].map((d) => make({ cutType: 'Flat', diameter: d, shank: 3.175, flutes: 2, ratedFor: WOOD_PLASTIC })),
  // Metric flat endmills
  ...[3, 4, 5, 6, 8, 10, 12].map((d) => make({ cutType: 'Flat', diameter: d, shank: metricShank(d), flutes: 2, ratedFor: WOOD_PLASTIC })),
  ...[3, 4, 6, 8, 10].map((d) => make({ cutType: 'Flat', diameter: d, shank: metricShank(d), flutes: 3, ratedFor: 'Aluminium' })),
  ...[4, 6, 8, 10, 12].map((d) => make({ cutType: 'Flat', diameter: d, shank: metricShank(d), flutes: 4, ratedFor: 'Steel, aluminium', coating: 'TiAlN' })),
  // Imperial flats
  make({ cutType: 'Flat', diameter: mm(INCH / 16), label: '1/16', shank: 3.175, flutes: 2, ratedFor: WOOD_PLASTIC, imperial: true }),
  make({ cutType: 'Flat', diameter: mm(INCH / 8), label: '1/8', shank: 6.35, flutes: 2, ratedFor: WOOD_PLASTIC, imperial: true }),
  make({ cutType: 'Flat', diameter: mm(INCH / 4), label: '1/4', shank: 6.35, flutes: 2, ratedFor: WOOD_PLASTIC, imperial: true }),
  make({ cutType: 'Flat', diameter: mm(INCH / 4), label: '1/4', shank: 6.35, flutes: 3, ratedFor: 'Aluminium', imperial: true }),
  // Single flute for plastics and aluminium
  ...[3.175, 4, 6].map((d) => make({ cutType: 'O-flute', diameter: d, shank: d === 4 ? 4 : d, flutes: 1, ratedFor: 'Plastics, aluminium' })),
  // Clean edges in sheet goods
  ...[3.175, 6, 6.35].map((d) => make({ cutType: 'Downcut', diameter: d, shank: d, flutes: 2, ratedFor: 'Plywood, laminates (clean top face)' })),
  ...[3.175, 6, 6.35].map((d) => make({ cutType: 'Compression', diameter: d, shank: d, flutes: 2, ratedFor: 'Plywood, laminates (clean both faces)' })),
  // 3D work
  ...[1, 2, 3, 3.175, 6].map((d) => make({ cutType: 'Ball nose', diameter: d, shank: d < 3 ? 3.175 : d, flutes: 2, ratedFor: '3D finishing passes' })),
  ...[3, 6].map((d) => make({ cutType: 'Bull nose', diameter: d, shank: d, flutes: 2, ratedFor: '3D roughing and flat floors' })),
  ...[0.25, 0.5, 1].map((d) => make({ cutType: 'Tapered ball nose', diameter: d, shank: 6.35, flutes: 2, ratedFor: 'Fine 3D relief carving' })),
  // Engraving and V-carving (diameter is the cutter's widest point)
  ...[30, 60, 90].map((angle) => make({ cutType: 'V-bit', angle, diameter: 12.7, shank: 6.35, flutes: 2, ratedFor: 'V-carving, signs, chamfers' })),
  ...[20, 30].map((angle) => make({ cutType: 'Engraving', angle, diameter: 3.175, shank: 3.175, flutes: 1, ratedFor: 'Engraving, PCB isolation' })),
  make({ cutType: 'Chamfer', angle: 90, diameter: 12.7, shank: 6.35, flutes: 2, ratedFor: 'Edge chamfers, deburring' }),
  make({ cutType: 'Roundover', diameter: 19.05, shank: 6.35, flutes: 2, ratedFor: 'Edge roundovers' }),
  make({ cutType: 'Dovetail', angle: 14, diameter: 12.7, shank: 6.35, flutes: 2, ratedFor: 'Dovetail joints, T-slots' }),
  // Flattening spoilboards and stock
  make({ cutType: 'Surfacing', diameter: 25.4, shank: 6.35, flutes: 2, ratedFor: 'Spoilboard and stock flattening' }),
  make({ cutType: 'Surfacing', diameter: 50.8, shank: 12.7, flutes: 3, ratedFor: 'Spoilboard and stock flattening' }),
  // PCB drilling
  ...[0.6, 0.8, 1, 1.2].map((d) => make({ cutType: 'Drill', diameter: d, shank: 3.175, flutes: 2, ratedFor: 'PCB drilling' })),
];
