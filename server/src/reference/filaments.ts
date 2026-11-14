import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import { FILAMENT_MATERIALS } from '@/templates/library';
import type { FilamentLine } from '@/reference/types';

/**
 * Filament product lines, generated from an open dataset by scripts/import-filaments.ts.
 * The file is committed and read once, on first use, so a deploy ships whatever was last imported.
 */

const range = z.tuple([z.number(), z.number()]);

export const filamentLineSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/),
  brand: z.string().min(1),
  name: z.string().min(1),
  material: z.enum(FILAMENT_MATERIALS),
  materialCode: z.string().min(1),
  density: z.number().positive(),
  diameters: z.array(z.number().positive()).min(1),
  weights: z.array(z.object({ g: z.number().positive(), spool: z.number().min(0).optional() })).min(1),
  nozzle: range.optional(),
  bed: range.optional(),
  finish: z.string().optional(),
  colours: z.array(z.tuple([z.string().min(1), z.string().regex(/^#[0-9a-f]{6}$/)])).min(1),
}) satisfies z.ZodType<FilamentLine>;

export const filamentFileSchema = z.object({
  source: z.object({
    name: z.string(),
    url: z.string().url(),
    licence: z.literal('MIT'),
    copyright: z.string(),
    commit: z.string(),
  }),
  lines: z.array(filamentLineSchema),
});

export type FilamentFile = z.infer<typeof filamentFileSchema>;

export const FILAMENT_FILE = fileURLToPath(new URL('../../data/reference/filaments.json', import.meta.url));

let cached: FilamentFile | null = null;

export function loadFilaments(): FilamentFile {
  cached ??= filamentFileSchema.parse(JSON.parse(readFileSync(FILAMENT_FILE, 'utf8')));
  return cached;
}
