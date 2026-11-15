import type { Catalog } from '@/hooks/useCatalog';
import type { Detected, Item } from '@/lib/types';

/**
 * Ranking stock items against what a printer reports in a tray, so the likely spool is at the top of the
 * picker. The same rules as server/src/integrations/spoolMatch.ts.
 */

const plain = (value: string) => value.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Roughly 0 (same) to 765 (black against white); the "redmean" formula tracks what the eye sees. */
export function colourDistance(a: string, b: string): number {
  const parse = (hex: string) => [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16));
  const [r1, g1, b1] = parse(a);
  const [r2, g2, b2] = parse(b);
  if ([r1, g1, b1, r2, g2, b2].some((value) => Number.isNaN(value))) return 765;
  const mean = (r1 + r2) / 2;
  return Math.sqrt((2 + mean / 256) * (r1 - r2) ** 2 + 4 * (g1 - g2) ** 2 + (2 + (255 - mean) / 256) * (b1 - b2) ** 2);
}

const COLOUR_CLOSE = 90;

/** Hue in degrees and saturation 0 to 1; hue is meaningless for greys (low saturation). */
function hueOf(hex: string): { hue: number; saturation: number } {
  const [r, g, b] = [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16) / 255);
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const spread = max - min;
  if (!(spread > 0)) return { hue: 0, saturation: 0 };
  const light = (max + min) / 2;
  const hue = (max === r ? ((g - b) / spread + 6) % 6 : max === g ? (b - r) / spread + 2 : (r - g) / spread + 4) * 60;
  return { hue, saturation: spread / (1 - Math.abs(2 * light - 1)) };
}

/**
 * How far apart two colours are when choosing "which of these is it?": the plain distance, plus a penalty for
 * being a different kind of colour. A light blue is nearer to a dark blue than to a grey of the same brightness,
 * which plain distance gets wrong.
 */
export function colourChoiceDistance(a: string, b: string): number {
  const first = hueOf(a);
  const second = hueOf(b);
  const vivid = (colour: { saturation: number }) => colour.saturation >= 0.2;
  let penalty = 0;
  if (vivid(first) !== vivid(second)) penalty = 160;
  else if (vivid(first)) {
    const apart = Math.abs(first.hue - second.hue);
    penalty = Math.min(apart, 360 - apart) * 2;
  }
  return colourDistance(a, b) + penalty;
}

/** The material and colour of a stock item, from its category's own fields. */
export function spoolFacts(item: Item, catalog: Catalog): { material: string | null; colour: string | null } {
  const fields = catalog.typeById.get(item.itemTypeId)?.fields ?? [];
  const materialField = fields.find((field) => field.key === 'material') ?? fields.find((field) => /material/i.test(field.label));
  const colourField = fields.find((field) => field.fieldType === 'color');
  const material = materialField ? item.fields[materialField.key] : null;
  const colour = colourField ? item.fields[colourField.key] : null;
  return {
    material: typeof material === 'string' && material ? material : null,
    colour: typeof colour === 'string' && /^#[0-9a-f]{6}$/i.test(colour) ? colour : null,
  };
}

/**
 * How well an item fits a tray: 3 the very spool (same tag), 2 same material and a close colour,
 * 1 same material, 0 no reason to think so.
 */
export function matchScore(item: Item, detected: Detected, catalog: Catalog): number {
  if (detected.tagId && item.tagId === detected.tagId) return 3;
  // An item tagged as some other spool is not this one.
  if (item.tagId && detected.tagId) return 0;
  const facts = spoolFacts(item, catalog);
  if (!facts.material || !detected.material || plain(facts.material) !== plain(detected.material)) return 0;
  if (facts.colour && detected.colour) return colourDistance(facts.colour, detected.colour) <= COLOUR_CLOSE ? 2 : 0;
  return 1;
}

/** Items in the order they should be offered for a tray: best fit first, spools not loaded elsewhere before loaded ones. */
export function rankForTray(items: Item[], detected: Detected | null, catalog: Catalog): Array<{ item: Item; score: number }> {
  const scored = items.map((item) => ({ item, score: detected?.state === 'loaded' ? matchScore(item, detected, catalog) : 0 }));
  return scored.sort((a, b) => b.score - a.score || Number(Boolean(a.item.slot)) - Number(Boolean(b.item.slot)) || a.item.name.localeCompare(b.item.name));
}

/** What the printer knows about a tray, as one line: "PLA Basic · Bambu Lab · 82 % left". */
export function describeDetected(detected: Detected): string {
  if (detected.state === 'empty') return 'Empty';
  return [
    detected.subType ?? detected.material,
    detected.brand,
    detected.remainingPercent !== null ? `${Math.round(detected.remainingPercent)} % left` : null,
  ].filter(Boolean).join(' · ');
}

/** Grams the printer believes are left on a tagged spool, when it says. */
export function detectedGrams(detected: Detected | null): number | null {
  if (!detected || detected.remainingPercent === null || detected.spoolWeightGrams === null) return null;
  return Math.round((detected.spoolWeightGrams * detected.remainingPercent) / 100);
}

/** A plain word for a colour, good enough to tell spools apart by name: "Black", "Light blue", "Dark green". */
export function colourWord(hex: string): string {
  const [r, g, b] = [1, 3, 5].map((start) => Number.parseInt(hex.slice(start, start + 2), 16) / 255);
  if ([r, g, b].some((value) => Number.isNaN(value))) return '';
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const light = (max + min) / 2;
  const spread = max - min;
  const saturation = spread === 0 ? 0 : spread / (1 - Math.abs(2 * light - 1));
  if (saturation < 0.12) return light < 0.15 ? 'Black' : light > 0.9 ? 'White' : light < 0.45 ? 'Dark grey' : 'Grey';
  const hue = (max === r ? ((g - b) / spread + 6) % 6 : max === g ? (b - r) / spread + 2 : (r - g) / spread + 4) * 60;
  const name =
    hue < 15 || hue >= 345 ? 'Red' : hue < 42 ? (light < 0.4 ? 'Brown' : 'Orange') : hue < 70 ? 'Yellow' : hue < 165 ? 'Green'
      : hue < 195 ? 'Teal' : hue < 255 ? 'Blue' : hue < 290 ? 'Purple' : 'Pink';
  if (name === 'Brown') return name;
  return light < 0.32 ? `Dark ${name.toLowerCase()}` : light > 0.75 ? `Light ${name.toLowerCase()}` : name;
}

/** A full spool is assumed to be this size when the printer cannot say (spools without a tag). */
const USUAL_SPOOL_GRAMS = 1000;

/**
 * The option of a choice field that best fits the printer's word for a material. Exact first ("PETG"), then the
 * longest option the word starts with ("PETG HF" is PETG, "PAHT-CF" is PA-CF by its ending), then "Other".
 */
function materialOption(options: string[], material: string): string | undefined {
  const word = plain(material);
  const exact = options.find((option) => plain(option) === word);
  if (exact) return exact;
  const prefix = options.filter((option) => word.startsWith(plain(option))).sort((a, b) => b.length - a.length)[0];
  const reinforced = /cf$|gf$/.exec(word)?.[0];
  if (reinforced && prefix) {
    const withFibre = options.find((option) => plain(option) === `${plain(prefix)}${reinforced}`);
    if (withFibre) return withFibre;
  }
  return prefix ?? options.find((option) => plain(option) === 'other');
}

/**
 * A new stock item filled in from what the printer read: category, name, material, colour and its name, brand,
 * diameter, nozzle temperature, size, how much is left, and the printer it was found in. Whoever adds it only
 * has to check it over and add a price.
 */
export function newSpoolFrom(detected: Detected, catalog: Catalog, machineId?: string | null): Partial<Item> {
  const type =
    catalog.types.find((candidate) => candidate.fields.some((field) => field.key === 'material') && candidate.fields.some((field) => field.fieldType === 'color')) ??
    catalog.types.find((candidate) => candidate.fields.some((field) => field.fieldType === 'color'));
  const fields: Item['fields'] = {};
  const colour = detected.colour ? colourWord(detected.colour) : '';
  for (const field of type?.fields ?? []) {
    if (field.fieldType === 'color' && detected.colour) fields[field.key] = detected.colour;
    else if (field.key === 'material' && detected.material) {
      // A choice field only takes its own options.
      const option = field.fieldType === 'select' ? materialOption(field.options, detected.subType ?? detected.material) ?? materialOption(field.options, detected.material) : detected.material;
      if (option) fields[field.key] = option;
    } else if (field.key === 'brand' && detected.brand) fields[field.key] = detected.brand;
    else if ((field.key === 'colour_name' || field.key === 'color_name') && colour) fields[field.key] = colour;
    else if (field.key === 'diameter' && detected.diameter) fields[field.key] = detected.diameter;
    else if (field.key === 'nozzle_temp' && detected.nozzleTemp) fields[field.key] = field.fieldType === 'number' ? detected.nozzleTemp[1] : `${detected.nozzleTemp[0]}-${detected.nozzleTemp[1]}`;
  }
  const unit = type?.defaultUnitId ? catalog.unitById.get(type.defaultUnitId) : undefined;
  // The printer speaks in grams; only carry weights over when this category is kept in grams too.
  const inGrams = unit?.symbol === 'g';
  // A tagged spool says its size and what is left. For any other, assume a usual full spool: right more often
  // than an empty box, and one number to correct if not.
  const capacity = detected.spoolWeightGrams ?? USUAL_SPOOL_GRAMS;
  const quantity = detectedGrams(detected) ?? capacity;
  return {
    ...(type ? { itemTypeId: type.id, unitId: type.defaultUnitId } : {}),
    name: [detected.brand && detected.brand !== 'Bambu Lab' ? detected.brand : '', detected.subType ?? detected.material, colour].filter(Boolean).join(' '),
    fields,
    ...(inGrams ? { capacity, quantity } : {}),
    ...(machineId ? { compatibleMachineIds: [machineId] } : {}),
    tagId: detected.tagId,
  };
}
