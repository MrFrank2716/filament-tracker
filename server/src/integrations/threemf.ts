/**
 * Reading what a sliced file says a print will use.
 *
 * A sliced Bambu / Orca file (.3mf, a zip) carries Metadata/slice_info.config: one <plate> per plate, each
 * listing the filaments it uses with the slicer's estimate in grams. That estimate is the only figure there is
 * for how much a print uses; the printer itself never reports one.
 */

export interface SlicedFilament {
  /** The filament's number in the project, from 1. Numbers can be skipped when a project filament is unused. */
  id: number;
  material: string | null;
  /** "#rrggbb" */
  colour: string | null;
  grams: number;
}

export interface SlicedPlate {
  index: number;
  /** The slicer's estimate of print time, in seconds. */
  seconds: number | null;
  filaments: SlicedFilament[];
}

export const SLICE_INFO = 'Metadata/slice_info.config';

const attribute = (tag: string, name: string): string | null => new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1] ?? null;

/** Every plate in a slice_info.config. Tolerant: anything it cannot read is left out, never thrown. */
export function readSliceInfo(xml: string): SlicedPlate[] {
  const plates: SlicedPlate[] = [];
  for (const [, body] of xml.slice(0, 400_000).matchAll(/<plate>([\s\S]*?)<\/plate>/g)) {
    const meta = new Map<string, string>();
    for (const [tag] of body.matchAll(/<metadata\b[^>]*>/g)) {
      const key = attribute(tag, 'key');
      if (key) meta.set(key, attribute(tag, 'value') ?? '');
    }
    const filaments: SlicedFilament[] = [];
    for (const [tag] of body.matchAll(/<filament\b[^>]*>/g)) {
      const id = Number(attribute(tag, 'id'));
      const grams = Number(attribute(tag, 'used_g'));
      if (!Number.isInteger(id) || id < 1 || !Number.isFinite(grams) || grams < 0) continue;
      const colour = attribute(tag, 'color');
      filaments.push({ id, grams, material: attribute(tag, 'type') || null, colour: colour && /^#[0-9a-f]{6}/i.test(colour) ? colour.slice(0, 7).toLowerCase() : null });
    }
    const index = Number(meta.get('index'));
    const seconds = Number(meta.get('prediction'));
    plates.push({ index: Number.isInteger(index) && index > 0 ? index : plates.length + 1, seconds: Number.isFinite(seconds) && seconds > 0 ? seconds : null, filaments });
  }
  return plates;
}

/** The plate being printed: the one asked for, or the only one. */
export function plateFor(plates: SlicedPlate[], index: number | null): SlicedPlate | null {
  return plates.find((plate) => plate.index === index) ?? (plates.length === 1 ? plates[0] : null);
}
