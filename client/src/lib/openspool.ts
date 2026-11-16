import type { Catalog } from '@/hooks/useCatalog';
import { spoolFacts } from '@/lib/spoolMatch';
import type { Detected, Item } from '@/lib/types';

/**
 * OpenSpool: an open format for NFC stickers on filament spools. The sticker holds one small JSON record
 * saying what the filament is, so any OpenSpool reader or app can tell. Wrkbench writes that record plus a
 * link to the spool in stock, and reads either. Readers skip records and keys they do not know.
 */

export interface OpenSpoolRecord {
  protocol: 'openspool';
  version: '1.0';
  /** Material: "PLA", "PETG" … */
  type: string;
  /** Six hexadecimal digits, no "#". */
  color_hex: string;
  brand: string;
  /** Nozzle temperatures in °C, as text, as the format has them. */
  min_temp: string;
  max_temp: string;
}

/**
 * Usual nozzle ranges, used only when a spool in stock does not say its own. A reader acts on these numbers,
 * so a tag is never written without them.
 */
const USUAL_TEMPS: Array<[material: RegExp, min: number, max: number]> = [
  [/^pla/i, 190, 220],
  [/^petg/i, 220, 250],
  [/^(abs|asa)/i, 240, 270],
  [/^tpu/i, 210, 240],
  [/^(pa|nylon)/i, 260, 290],
  [/^pc/i, 260, 290],
];

function temperatures(item: Item, material: string): [number, number] | null {
  const raw = item.fields.nozzle_temp;
  const numbers = typeof raw === 'number' ? [raw] : typeof raw === 'string' ? (raw.match(/\d+/g) ?? []).map(Number) : [];
  const sensible = numbers.filter((value) => value >= 100 && value <= 500);
  if (sensible.length >= 2) return [Math.min(...sensible), Math.max(...sensible)];
  if (sensible.length === 1) return [sensible[0], sensible[0]];
  const usual = USUAL_TEMPS.find(([pattern]) => pattern.test(material));
  return usual ? [usual[1], usual[2]] : null;
}

/** Why a tag cannot be written for an item, in words for whoever is holding the sticker; null when it can. */
export function cannotTag(item: Item, catalog: Catalog): string | null {
  const facts = spoolFacts(item, catalog);
  if (!facts.material) return 'Only filament spools can be written to a spool tag: this item has no material.';
  if (!temperatures(item, facts.material)) return `Add a nozzle temperature to this spool first: there is no usual one for ${facts.material}, and readers need it.`;
  return null;
}

/** The record to write for a spool in stock, or null when the item is not a spool or lacks what a reader needs. */
export function toOpenSpool(item: Item, catalog: Catalog): OpenSpoolRecord | null {
  const facts = spoolFacts(item, catalog);
  if (!facts.material) return null;
  const temps = temperatures(item, facts.material);
  if (!temps) return null;
  const brand = item.fields.brand;
  return {
    protocol: 'openspool',
    version: '1.0',
    type: facts.material,
    // A spool with no colour recorded is written as white rather than left out: readers expect the key.
    color_hex: (facts.colour ?? '#ffffff').slice(1).toUpperCase(),
    brand: typeof brand === 'string' && brand.trim() ? brand.trim() : 'Generic',
    min_temp: String(temps[0]),
    max_temp: String(temps[1]),
  };
}

const text = (value: unknown): string | null => (typeof value === 'string' || typeof value === 'number' ? String(value).trim() || null : null);

/**
 * What a tag says, in the same shape a connected printer reports a tray in, so everything that already works
 * from a printer's reading (filling in a new spool, ranking stock against it) works from a tag too.
 * Lenient about how the values are written; null when the record does not even name a material.
 */
export function fromOpenSpool(record: Record<string, unknown>): Detected | null {
  const material = text(record.type);
  if (!material) return null;
  const hex = text(record.color_hex)?.replace(/^#/, '') ?? '';
  const colour = /^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(hex) ? `#${hex.slice(0, 6).toLowerCase()}` : null;
  const brand = text(record.brand);
  const min = Number(text(record.min_temp));
  const max = Number(text(record.max_temp));
  const temps = Number.isFinite(min) && Number.isFinite(max) && min > 0 && max > 0 ? ([Math.min(min, max), Math.max(min, max)] as [number, number]) : null;
  return {
    state: 'loaded',
    material,
    subType: null,
    colour,
    colours: [],
    // "Generic" is the format's word for no brand at all.
    brand: brand && brand.toLowerCase() !== 'generic' ? brand : null,
    tagId: null,
    remainingPercent: null,
    spoolWeightGrams: null,
    nozzleTemp: temps,
  };
}

/**
 * How a sticker's serial is kept on an item: "NFC" and the serial's hexadecimal digits. Phones report it as
 * "04:a1:b2:…". The prefix keeps it apart from the tags printers read, which are hexadecimal throughout.
 */
export function stickerTag(serial: string | null | undefined): string | null {
  const digits = (serial ?? '').replace(/[^0-9a-f]/gi, '').toUpperCase();
  return digits.length >= 4 && digits.length <= 32 ? `NFC${digits}` : null;
}
