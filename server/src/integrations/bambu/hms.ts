import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { PrinterError } from '@/integrations/types';

/**
 * Bambu Lab error codes: how they are written, what they mean, and where the maker explains them.
 *
 * A printer reports two kinds. Its health list ("HMS") holds standing problems as pairs of 32-bit numbers,
 * shown on its screen as four groups of four hex digits. `print_error` is a single number about the current
 * print, shown as two groups; several of its values are not faults at all ("cancelled", "paused by the user").
 *
 * Meanings and links come from data/hms/bambu.json (see scripts/import-hms.ts). A link is never built from a
 * code: the pages are organised by printer family, and several codes share one page.
 */

/** One value for every model, or one per model with "" as the default. Model keys are upper-case: "P1S", "A1MINI". */
const variants = z.union([z.string(), z.record(z.string(), z.string())]);
export type Variants = z.output<typeof variants>;

export const hmsFileSchema = z.object({
  source: z.object({ name: z.string(), url: z.string(), licence: z.string(), commit: z.string() }),
  hms: z.record(z.string(), variants),
  errors: z.record(z.string(), variants),
  links: z.record(z.string(), variants),
});
export type HmsFile = z.output<typeof hmsFileSchema>;

export const HMS_FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../data/hms/bambu.json');

const WIKI = 'https://wiki.bambulab.com';
const WIKI_HOME = `${WIKI}/en/hms/home`;

let cached: HmsFile | null | undefined;
/** Loaded on first use. Without the file, codes are still shown; they just have no words. */
function data(): HmsFile | null {
  if (cached === undefined) {
    try {
      cached = existsSync(HMS_FILE) ? hmsFileSchema.parse(JSON.parse(readFileSync(HMS_FILE, 'utf8'))) : null;
    } catch (cause) {
      console.error('Could not read the printer error texts', cause);
      cached = null;
    }
  }
  return cached;
}

/** "A1 mini" and "H2D Pro" as the data spells them: "A1MINI", "H2DPRO". */
const modelKey = (modelName: string | null) => (modelName ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');

function pick(value: Variants | undefined, model: string): string | null {
  if (value === undefined) return null;
  if (typeof value === 'string') return value;
  return value[model] ?? value[''] ?? null;
}

const group = (value: number) => (value & 0xffff).toString(16).toUpperCase().padStart(4, '0');

/** attr and code as the printer's screen shows them: "0700_2300_0002_0012". */
export function formatHmsCode(attr: number, code: number): string {
  return `${group(attr >>> 16)}_${group(attr)}_${group(code >>> 16)}_${group(code)}`;
}

/** The severity sits in the high half of `code`: 1 fatal, 2 serious, 3 common, 4 information. */
function hmsSeverity(code: number): PrinterError['severity'] {
  switch (code >>> 16) {
    case 1: return 'fatal';
    case 2: return 'error';
    case 3: return 'warning';
    default: return 'info';
  }
}

export function readHms(attr: number, code: number, modelName: string | null): PrinterError {
  const display = formatHmsCode(attr, code);
  const key = display.replace(/_/g, '');
  const model = modelKey(modelName);
  const link = pick(data()?.links[key], model);
  return {
    kind: 'hms',
    code: display,
    severity: hmsSeverity(code),
    message: pick(data()?.hms[key], model),
    url: link ? `${WIKI}${link}` : WIKI_HOME,
  };
}

/** Values of `print_error` that only say what someone did. Shown as a note, never as a fault. */
const NOTES = new Set(['0300400C', '0500400E', '03008001']);

/**
 * The current print's error, or null when there is nothing worth showing. Printers also raise numbers here
 * that mean nothing to a person and have no text; with the texts loaded, those are left out.
 */
export function readPrintError(value: number, modelName: string | null): PrinterError | null {
  if (!value) return null;
  const key = (value >>> 0).toString(16).toUpperCase().padStart(8, '0');
  const texts = data();
  const message = pick(texts?.errors[key], modelKey(modelName));
  if (texts && !message) return null;
  return { kind: 'print_error', code: `${key.slice(0, 4)}_${key.slice(4)}`, severity: NOTES.has(key) ? 'info' : 'error', message, url: null };
}
