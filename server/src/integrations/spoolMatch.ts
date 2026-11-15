import type { Tray } from '@/integrations/types';

/**
 * Deciding whether a spool in stock could be the one a printer reports in a tray.
 * Pure functions, so they are easy to test; client/src/lib/spoolMatch.ts ranks candidates the same way.
 */

/** What a slot remembers about the tray the printer last reported there. */
export interface Detected {
  state: 'empty' | 'loaded';
  material: string | null;
  subType: string | null;
  colour: string | null;
  colours: string[];
  brand: string | null;
  tagId: string | null;
  remainingPercent: number | null;
  spoolWeightGrams: number | null;
  /** Changes only when the tray physically holds something else. */
  signature: string;
  /** The signature when the current item was put here; a different one means the binding is stale. */
  boundSignature: string | null;
}

/** Identifies what is physically in a tray. Remaining amount is left out: it changes as the spool is used. */
export function traySignature(tray: Pick<Tray, 'state' | 'material' | 'subType' | 'colour' | 'tagId'>): string {
  if (tray.state === 'empty') return 'empty';
  return [tray.tagId ?? '', tray.material ?? '', tray.subType ?? '', tray.colour ?? ''].join('|').toLowerCase();
}

export function detectedFrom(tray: Tray, boundSignature: string | null): Detected {
  return {
    state: tray.state, material: tray.material, subType: tray.subType, colour: tray.colour, colours: tray.colours,
    brand: tray.brand, tagId: tray.tagId, remainingPercent: tray.remainingPercent, spoolWeightGrams: tray.spoolWeightGrams,
    signature: traySignature(tray), boundSignature,
  };
}

const plain = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');

/** "PLA" matches "PLA", "pla" and "PLA+"; it does not match "PLA-CF" or "PETG". */
export function materialMatches(itemMaterial: string, trayMaterial: string): boolean {
  const a = plain(itemMaterial);
  const b = plain(trayMaterial);
  return a !== '' && a === b;
}

/**
 * How different two "#rrggbb" colours look, roughly 0 (same) to 765 (black against white).
 * The "redmean" formula: cheap, and far closer to what the eye sees than plain RGB distance.
 */
export function colourDistance(a: string, b: string): number {
  const parse = (hex: string) => [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16));
  const [r1, g1, b1] = parse(a);
  const [r2, g2, b2] = parse(b);
  if ([r1, g1, b1, r2, g2, b2].some((value) => Number.isNaN(value))) return 765;
  const mean = (r1 + r2) / 2;
  const dr = r1 - r2;
  const dg = g1 - g2;
  const db = b1 - b2;
  return Math.sqrt((2 + mean / 256) * dr * dr + 4 * dg * dg + (2 + (255 - mean) / 256) * db * db);
}

/** Close enough to be the same spool described twice (a slicer preset against a hand-picked swatch). */
export const COLOUR_CLOSE = 90;

export interface SpoolFacts {
  material: string | null;
  colour: string | null;
  tagId: string | null;
}

/**
 * Could this stock item be what the tray holds?
 * A tag settles it either way. Without one the material must match, and the colour too when both are known.
 */
export function compatible(item: SpoolFacts, tray: Pick<Tray, 'material' | 'colour' | 'tagId'>): boolean {
  if (item.tagId && tray.tagId) return item.tagId === tray.tagId;
  // A tagged item is not what an untagged tray holds, and the other way round is only a guess.
  if (item.tagId && !tray.tagId) return false;
  if (!item.material || !tray.material || !materialMatches(item.material, tray.material)) return false;
  if (item.colour && tray.colour) return colourDistance(item.colour, tray.colour) <= COLOUR_CLOSE;
  return true;
}
