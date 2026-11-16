import qrcode from 'qrcode-generator';
import type { Catalog } from '@/hooks/useCatalog';
import { locationPath, summarizeFields } from '@/lib/format';
import type { Item, Location } from '@/lib/types';

/**
 * Labels for a roll label printer: one label per page, a QR code beside a few lines of text.
 * The code holds a link (/s/<item id> or /l/<location id>) and nothing else, so any phone camera opens the
 * item or the location, and a stranger who scans it learns nothing and lands on the sign-in page.
 */

export interface LabelSize {
  /** Millimetres. */
  width: number;
  height: number;
}

export const LABEL_PRESETS: Array<LabelSize & { id: string; name: string }> = [
  { id: '62x29', name: '62 × 29 mm (Brother DK-11209)', width: 62, height: 29 },
  { id: '57x32', name: '57 × 32 mm (Dymo 11354)', width: 57, height: 32 },
  { id: '50x30', name: '50 × 30 mm', width: 50, height: 30 },
  { id: '40x30', name: '40 × 30 mm', width: 40, height: 30 },
];

export const LABEL_MIN_MM = 15;
export const LABEL_MAX_MM = 150;

const SIZE_KEY = 'filament-tracker.label-size';

/** A usable size from whatever was typed or stored: whole millimetres within what a label printer takes. */
export function clampLabelSize(size: Partial<LabelSize> | null | undefined): LabelSize {
  const side = (value: unknown, fallback: number) => {
    const number = Math.round(Number(value));
    return Number.isFinite(number) && number > 0 ? Math.min(LABEL_MAX_MM, Math.max(LABEL_MIN_MM, number)) : fallback;
  };
  return { width: side(size?.width, LABEL_PRESETS[0].width), height: side(size?.height, LABEL_PRESETS[0].height) };
}

/** The label size last used on this device. */
export function storedLabelSize(): LabelSize {
  try {
    return clampLabelSize(JSON.parse(localStorage.getItem(SIZE_KEY) ?? 'null') as Partial<LabelSize> | null);
  } catch {
    return clampLabelSize(null);
  }
}

export function rememberLabelSize(size: LabelSize): void {
  try {
    localStorage.setItem(SIZE_KEY, JSON.stringify(clampLabelSize(size)));
  } catch {
    // Private browsing: the size just lasts for this visit.
  }
}

export const itemLink = (origin: string, id: string) => `${origin}/s/${id}`;
export const locationLink = (origin: string, id: string) => `${origin}/l/${id}`;

/** A label printed from an address only this computer can open would not scan anywhere else. */
export const isLocalAddress = (origin: string) => /^https?:\/\/(localhost|127\.|\[::1\])/.test(origin);

export interface Label {
  key: string;
  /** What the QR code holds. */
  url: string;
  title: string;
  /** Smaller lines under the title, most useful first: a small label only has room for one or two. */
  lines: string[];
  /** A short code set in fixed-width type, such as a location's own label code. */
  code?: string;
}

/** The last two steps of where something is: on a small label the drawer matters more than the building. */
function nearPath(locationId: string | null, locations: Location[]): string {
  return locationPath(locationId, locations).split(' › ').slice(-2).join(' › ');
}

export function itemLabel(item: Item, catalog: Catalog, origin: string): Label {
  const type = catalog.typeById.get(item.itemTypeId);
  const summary = type ? summarizeFields(type.fields, item.fields) : '';
  return {
    key: item.id,
    url: itemLink(origin, item.id),
    title: item.name,
    lines: [summary || (type?.name ?? ''), nearPath(item.locationId, catalog.locations)].filter(Boolean),
    ...(item.sku ? { code: item.sku } : {}),
  };
}

export function locationLabel(location: Location, locations: Location[], origin: string): Label {
  return {
    key: location.id,
    url: locationLink(origin, location.id),
    title: location.name,
    lines: [location.kind, nearPath(location.parentId, locations)].filter(Boolean),
    ...(location.code ? { code: location.code } : {}),
  };
}

export interface QrShape {
  /** Modules along one side, quiet zone not included. */
  size: number;
  /** Whether the module at this row and column is dark. */
  dark: (row: number, column: number) => boolean;
  /** One SVG path covering every dark module, in a (size × size) box starting at 0,0. */
  path: string;
}

/**
 * The QR code for a piece of text. Medium error correction: a label that is scuffed or slightly curled round
 * a spool still reads, without the code getting so dense that a small label cannot hold it.
 */
export function qrShape(text: string): QrShape {
  const code = qrcode(0, 'M');
  code.addData(text);
  code.make();
  const size = code.getModuleCount();
  const dark = (row: number, column: number) => code.isDark(row, column);
  let path = '';
  for (let row = 0; row < size; row++) {
    // Runs of dark modules become one stroke each: far fewer path commands than a square per module.
    for (let column = 0; column < size; column++) {
      if (!dark(row, column)) continue;
      let end = column;
      while (end + 1 < size && dark(row, end + 1)) end++;
      path += `M${column} ${row}h${end - column + 1}v1h-${end - column + 1}z`;
      column = end;
    }
  }
  return { size, dark, path };
}

/** Modules of white the code needs around it to be read. Scanners want four; the label's own margin adds to this. */
export const QR_QUIET_ZONE = 2;
