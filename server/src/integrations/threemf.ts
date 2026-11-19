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

/*
 * The file comes from whoever sliced the print, so it is read with plain string searches that each move
 * forward through the text. Regexes such as /<plate>([\s\S]*?)<\/plate>/ rescan the rest of the file
 * from every unclosed start, which a crafted file turns into seconds of a blocked server.
 */

const isWordChar = (char: string | undefined) => char !== undefined && /\w/.test(char);

/** The text between each `open` and the next `close`, in order. */
function* between(text: string, open: string, close: string): Generator<string> {
  let from = 0;
  for (;;) {
    const start = text.indexOf(open, from);
    if (start < 0) return;
    const end = text.indexOf(close, start + open.length);
    // No close after this open means none after any later open either.
    if (end < 0) return;
    yield text.slice(start + open.length, end);
    from = end + close.length;
  }
}

/** Each `<name ...>` tag, whole. `<names>` and other longer names do not count. */
function* tagsNamed(text: string, name: string): Generator<string> {
  const open = `<${name}`;
  let from = 0;
  for (;;) {
    const start = text.indexOf(open, from);
    if (start < 0) return;
    if (isWordChar(text[start + open.length])) {
      from = start + open.length;
      continue;
    }
    const end = text.indexOf('>', start);
    if (end < 0) return;
    yield text.slice(start, end + 1);
    from = end + 1;
  }
}

/** The value of `name="..."` in a tag, where name is not the end of a longer word. */
function attribute(tag: string, name: string): string | null {
  const open = `${name}="`;
  for (let at = tag.indexOf(open); at >= 0; at = tag.indexOf(open, at + 1)) {
    if (isWordChar(tag[at - 1])) continue;
    const end = tag.indexOf('"', at + open.length);
    return end < 0 ? null : tag.slice(at + open.length, end);
  }
  return null;
}

/** Every plate in a slice_info.config. Tolerant: anything it cannot read is left out, never thrown. */
export function readSliceInfo(xml: string): SlicedPlate[] {
  const plates: SlicedPlate[] = [];
  for (const body of between(xml.slice(0, 400_000), '<plate>', '</plate>')) {
    const meta = new Map<string, string>();
    for (const tag of tagsNamed(body, 'metadata')) {
      const key = attribute(tag, 'key');
      if (key) meta.set(key, attribute(tag, 'value') ?? '');
    }
    const filaments: SlicedFilament[] = [];
    for (const tag of tagsNamed(body, 'filament')) {
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
