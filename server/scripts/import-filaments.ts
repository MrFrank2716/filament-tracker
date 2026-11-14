/**
 * Regenerate data/reference/filaments.json from a local checkout of SpoolmanDB (MIT licence).
 *
 *   git clone --depth 1 https://github.com/Donkie/SpoolmanDB /tmp/spoolmandb
 *   npm run reference:filaments -w server -- --dir /tmp/spoolmandb
 *
 * The output is sorted and stable, so running it twice gives no diff. If anything fails
 * validation the script exits non-zero and leaves the existing file untouched.
 * To switch to another source, write another adapter returning FilamentLine[] and call it below.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { FILAMENT_FILE, filamentFileSchema, type FilamentFile } from '@/reference/filaments';
import type { FilamentLine } from '@/reference/types';
import type { FILAMENT_MATERIALS } from '@/templates/library';

type Material = (typeof FILAMENT_MATERIALS)[number];

const SOURCE = { name: 'SpoolmanDB', url: 'https://github.com/Donkie/SpoolmanDB', licence: 'MIT' as const };

// ---- SpoolmanDB adapter ----------------------------------------------------------------------

interface SpoolmanColour {
  name: string;
  hex?: string;
  hexes?: string[];
}
interface SpoolmanFilament {
  name: string;
  material: string;
  density: number;
  diameters: number[];
  weights: { weight: number; spool_weight?: number }[];
  colors: SpoolmanColour[];
  extruder_temp?: number;
  extruder_temp_range?: [number, number];
  bed_temp?: number;
  bed_temp_range?: [number, number];
  finish?: 'matte' | 'glossy' | null;
  pattern?: 'marble' | 'sparkle' | null;
  fill?: 'glass fiber' | 'carbon fiber' | 'wood' | null;
  translucent?: boolean;
  glow?: boolean;
  multi_color_direction?: 'coaxial' | 'longitudinal' | null;
}
interface SpoolmanFile {
  manufacturer: string;
  filaments: SpoolmanFilament[];
}

/**
 * Map a maker's material code (e.g. "PA6-CF", "TPU-95A", "HTPLA+") onto the app's material list.
 * Order matters: more specific rules come first. Anything unmatched becomes "Other".
 */
const MATERIAL_RULES: [RegExp, Material][] = [
  [/^PLA\+WOOD$/, 'PLA'],
  [/^(HT)?PLA\+/, 'PLA+'],
  [/^PLA-CF/, 'PLA-CF'],
  [/^(PLA|PLAX|WOOD)$/, 'PLA'],
  [/^PETG-CF/, 'PETG-CF'],
  [/^PETG/, 'PETG'],
  [/^PCTG/, 'PCTG'],
  [/^(HT)?PET\b|^PET[-+]|^CPE$/, 'PET'],
  [/^PC\+ABS/, 'PC+ABS'],
  [/^(EASY)?ABS/, 'ABS'],
  [/^(EASY)?ASA/, 'ASA'],
  [/^HIPS$/, 'HIPS'],
  [/^TPU/, 'TPU'],
  [/^(TPE|TPC|PEBA)$/, 'TPE'],
  [/^P?PA[0-9A-Z]*-CF/, 'PA-CF'],
  [/^P?PA[0-9A-Z]*-GF/, 'PA-GF'],
  [/^(PA|PPA)[0-9]*$/, 'PA'],
  [/^PC(PBT)?-CF/, 'PC-CF'],
  [/^PC(PBT)?$/, 'PC'],
  [/^PP(-[CG]F\d*)?$/, 'PP'],
  [/^PVA$/, 'PVA'],
  [/^BVOH$/, 'BVOH'],
  [/^PVB$/, 'PVB'],
  [/^(PEEK|PEKK|PEI|PPS|PPSU|PPE|PVDF|TPI)\b/, 'High-temp'],
];

export function mapMaterial(code: string): Material {
  return MATERIAL_RULES.find(([pattern]) => pattern.test(code))?.[1] ?? 'Other';
}

const slug = (value: string) => value.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const tidy = (value: string) => value.replace(/\{color_name\}/g, '').replace(/\s+/g, ' ').trim();

function hexOf(colour: SpoolmanColour): string | null {
  const raw = colour.hex ?? colour.hexes?.[0];
  if (!raw || !/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(raw)) return null;
  return `#${raw.slice(0, 6).toLowerCase()}`;
}

function rangeOf(span: [number, number] | undefined, single: number | undefined): [number, number] | undefined {
  if (span && span.length === 2) return [Math.min(...span), Math.max(...span)];
  return single ? [single, single] : undefined;
}

function finishOf(line: SpoolmanFilament): string | undefined {
  const parts = [
    line.finish === 'matte' ? 'Matte' : line.finish === 'glossy' ? 'Glossy' : '',
    line.fill === 'carbon fiber' ? 'Carbon fibre filled' : line.fill === 'glass fiber' ? 'Glass fibre filled' : line.fill === 'wood' ? 'Wood filled' : '',
    line.pattern === 'marble' ? 'Marble' : line.pattern === 'sparkle' ? 'Sparkle' : '',
    line.translucent ? 'Translucent' : '',
    line.glow ? 'Glow in the dark' : '',
    line.multi_color_direction ? 'Multi-colour' : '',
  ].filter(Boolean);
  return parts.length ? parts.join(', ') : undefined;
}

function fromSpoolmanDb(dir: string): { lines: FilamentLine[]; unmapped: Map<string, number>; skipped: number } {
  const folder = join(dir, 'filaments');
  if (!existsSync(folder)) throw new Error(`No filaments folder in ${dir}. Point --dir at a SpoolmanDB checkout.`);
  const unmapped = new Map<string, number>();
  const lines: FilamentLine[] = [];
  let skipped = 0;

  for (const file of readdirSync(folder).filter((f) => f.endsWith('.json')).sort()) {
    const data = JSON.parse(readFileSync(join(folder, file), 'utf8')) as SpoolmanFile;
    const brand = data.manufacturer.trim();
    const usedIds = new Set<string>();
    for (const line of data.filaments) {
      const colours = line.colors
        .map((c) => [c.name.trim(), hexOf(c)] as const)
        .filter((c): c is readonly [string, string] => Boolean(c[0] && c[1]))
        .map(([name, hex]) => [name, hex] as [string, string]);
      if (!colours.length || !line.weights?.length || !line.diameters?.length) {
        skipped++;
        continue;
      }
      const material = mapMaterial(line.material);
      if (material === 'Other') unmapped.set(line.material, (unmapped.get(line.material) ?? 0) + 1);

      const name = tidy(line.name) || line.material;
      let id = slug(`${brand} ${name}`);
      for (let n = 2; usedIds.has(id); n++) id = slug(`${brand} ${name} ${line.material} ${n}`);
      usedIds.add(id);

      lines.push({
        id,
        brand,
        name,
        material,
        materialCode: line.material,
        density: line.density,
        diameters: [...new Set(line.diameters)].sort((a, b) => a - b),
        weights: line.weights
          .filter((w) => w.weight > 0)
          .map((w) => ({ g: w.weight, ...(w.spool_weight !== undefined ? { spool: w.spool_weight } : {}) })),
        ...(rangeOf(line.extruder_temp_range, line.extruder_temp) ? { nozzle: rangeOf(line.extruder_temp_range, line.extruder_temp) } : {}),
        ...(rangeOf(line.bed_temp_range, line.bed_temp) ? { bed: rangeOf(line.bed_temp_range, line.bed_temp) } : {}),
        ...(finishOf(line) ? { finish: finishOf(line) } : {}),
        colours,
      });
    }
  }
  return { lines: lines.filter((l) => l.weights.length > 0), unmapped, skipped };
}

// ---- Output ----------------------------------------------------------------------------------

/** One line per product line keeps the file reviewable in diffs without bloating it. */
function serialise(file: FilamentFile): string {
  const lines = file.lines.map((line) => `    ${JSON.stringify(line)}`).join(',\n');
  return `{\n  "source": ${JSON.stringify(file.source)},\n  "lines": [\n${lines}\n  ]\n}\n`;
}

function main() {
  const index = process.argv.indexOf('--dir');
  const dir = index > -1 ? process.argv[index + 1] : undefined;
  if (!dir) {
    console.error('Usage: npm run reference:filaments -w server -- --dir <path to SpoolmanDB checkout>');
    process.exit(1);
  }

  const { lines, unmapped, skipped } = fromSpoolmanDb(dir);
  let commit = 'unknown';
  try {
    commit = execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    // Not a git checkout: keep "unknown".
  }
  const licence = readFileSync(join(dir, 'LICENSE'), 'utf8');
  const copyright = licence.split('\n').find((l) => l.startsWith('Copyright'))?.trim() ?? '';
  if (!/^MIT License/.test(licence.trim())) throw new Error('The source LICENSE is no longer MIT. Review it before importing.');

  lines.sort((a, b) => a.brand.localeCompare(b.brand, 'en') || a.name.localeCompare(b.name, 'en') || a.id.localeCompare(b.id));
  const file = filamentFileSchema.parse({ source: { ...SOURCE, copyright, commit }, lines });

  writeFileSync(FILAMENT_FILE, serialise(file));
  const colours = file.lines.reduce((sum, line) => sum + line.colours.length, 0);
  console.log(`Wrote ${file.lines.length} product lines (${colours} colours) from ${new Set(file.lines.map((l) => l.brand)).size} brands to ${FILAMENT_FILE}`);
  if (skipped) console.log(`Skipped ${skipped} lines with no usable colour, weight or diameter.`);
  if (unmapped.size) {
    console.log('Material codes mapped to "Other" (add a rule in MATERIAL_RULES if one deserves its own entry):');
    for (const [code, count] of [...unmapped].sort()) console.log(`  ${code} (${count})`);
  }
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split('/').pop()!)) main();
