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
  /** The name: the one piece of text a label keeps however small it is. */
  title: string;
  /** A short code set in fixed-width type: an item's SKU or barcode, a location's own label code. */
  code?: string;
  /** What it is: an item's material and size, a location's kind. */
  details?: string;
  /** Where it lives. The first thing left off when a label is too small for everything. */
  place?: string;
}

/** The last two steps of where something is: on a small label the drawer matters more than the building. */
function nearPath(locationId: string | null, locations: Location[]): string {
  return locationPath(locationId, locations).split(' › ').slice(-2).join(' › ');
}

/** Only the parts that have something in them, so an empty line never takes room on a label. */
const filled = (label: Label): Label => Object.fromEntries(Object.entries(label).filter(([, value]) => value)) as unknown as Label;

export function itemLabel(item: Item, catalog: Catalog, origin: string): Label {
  const type = catalog.typeById.get(item.itemTypeId);
  const summary = type ? summarizeFields(type.fields, item.fields) : '';
  return filled({
    key: item.id,
    url: itemLink(origin, item.id),
    title: item.name,
    code: item.sku,
    details: summary || (type?.name ?? ''),
    place: nearPath(item.locationId, catalog.locations),
  });
}

export function locationLabel(location: Location, locations: Location[], origin: string): Label {
  return filled({
    key: location.id,
    url: locationLink(origin, location.id),
    title: location.name,
    code: location.code,
    details: location.kind,
    place: nearPath(location.parentId, locations),
  });
}

// ---- Fitting a label to its size ---------------------------------------------------------------

/**
 * A label printer lays down whole dots, black or not, so a QR code prints cleanly only when each of its
 * squares is a whole number of dots wide; in between, some squares come out a dot wider than others and a
 * small code stops scanning. Thermal label printers come in these two resolutions.
 */
export const PRINTER_DPI = [203, 300] as const;
export type PrinterDpi = (typeof PRINTER_DPI)[number];
/** A square narrower than this (mm) is too fine to scan reliably off a label, whatever the printer. */
const QR_SQUARE_MIN_MM = 0.33;

const DPI_KEY = 'filament-tracker.label-dpi';

/** The printer resolution last chosen on this device; 203 dpi, the commonest, until one is. */
export function storedPrinterDpi(): PrinterDpi {
  try {
    const stored = Number(localStorage.getItem(DPI_KEY));
    return PRINTER_DPI.find((dpi) => dpi === stored) ?? 203;
  } catch {
    return 203;
  }
}

export function rememberPrinterDpi(dpi: PrinterDpi): void {
  try {
    localStorage.setItem(DPI_KEY, String(dpi));
  } catch {
    // Private browsing: the choice just lasts for this visit.
  }
}

/** What a label's QR code is made of: how many squares a side (see qrShape) and the printer it is for. */
export interface CodeSpec {
  modules: number;
  dpi: PrinterDpi;
}

/** The smallest type printed: about 4 pt. Anything smaller is not worth the room it takes. */
export const TEXT_MIN_MM = 1.5;
/** Secondary lines are set at this share of the name's size. */
export const LINE_SCALE = 0.75;
/** A text box narrower or shorter than this holds nothing readable: the label is then the code alone. */
const TEXT_BOX_MIN = { width: 12, height: 5 };

export interface LabelLayout {
  /** Code beside the text, code above the text, or the code alone when there is no room for text. */
  arrangement: 'row' | 'column' | 'code';
  /** All in mm. */
  padding: number;
  gap: number;
  /** Side of the QR code, its own margin included. A whole number of printer dots per square. */
  qr: number;
  /** Printer dots across one square of the code. */
  dots: number;
  /** The code's squares are finer than scans reliably: the label is too small for this link on this printer. */
  fine: boolean;
  /** The box the text has to fit in. Zero when the label is the code alone. */
  text: LabelSize;
  /** The size the name starts at; it is stepped down from here until everything fits. */
  font: number;
}

const clamp = (value: number, low: number, high: number) => Math.min(high, Math.max(low, value));
const round = (value: number) => Math.round(value * 1000) / 1000;

/**
 * How a label of this size is divided between its QR code and its text. The code gets what it needs to scan
 * and no more than its share, sized to whole printer dots; the arrangement is whichever leaves the text the
 * most room.
 */
export function labelLayout(size: LabelSize, code: CodeSpec = { modules: 37, dpi: 203 }): LabelLayout {
  return divide(size, code);
}

/**
 * The code and layout for one label: the sturdier code where its squares come out wide enough to scan, and
 * the simpler one (fewer squares, so each is larger) where the label is too small for that.
 */
export function labelCode(url: string, size: LabelSize, dpi: PrinterDpi): { shape: QrShape; layout: LabelLayout } {
  const sturdy = qrShape(url, 'M');
  const layout = divide(size, { modules: sturdy.size, dpi });
  if (!layout.fine) return { shape: sturdy, layout };
  const simple = qrShape(url, 'L');
  const simpler = divide(size, { modules: simple.size, dpi });
  return simpler.dots > layout.dots ? { shape: simple, layout: simpler } : { shape: sturdy, layout };
}

function divide(size: LabelSize, code: CodeSpec): LabelLayout {
  const padding = clamp(Math.min(size.width, size.height) * 0.05, 0.8, 1.5);
  const gap = padding;
  const width = size.width - padding * 2;
  const height = size.height - padding * 2;
  const largest = Math.min(width, height);

  // One dot per square makes a code this wide; the code is some whole number of these.
  const unit = ((code.modules + QR_QUIET_ZONE * 2) * 25.4) / code.dpi;
  const fewest = Math.ceil(QR_SQUARE_MIN_MM / (25.4 / code.dpi) - 1e-9);
  /** The largest whole-dot code within `room`, with at least one dot a square. */
  const snapped = (room: number) => Math.max(1, Math.floor(room / unit + 1e-9));
  const needed = Math.min(fewest * unit, largest);

  const option = (arrangement: 'row' | 'column') => {
    const along = arrangement === 'row' ? width : height;
    const across = arrangement === 'row' ? height : width;
    // Up to the full depth of the label, but not much more than its share of the length.
    const dots = snapped(clamp(Math.min(across, along * (arrangement === 'row' ? 0.45 : 0.5)), needed, largest));
    const qr = dots * unit;
    const text = arrangement === 'row' ? { width: width - qr - gap, height } : { width, height: height - qr - gap };
    return { arrangement, dots, qr, text, usable: dots >= fewest && text.width >= TEXT_BOX_MIN.width && text.height >= TEXT_BOX_MIN.height };
  };
  // A line of text wants width far more than a column of text wants height, so width counts double.
  const worth = (text: LabelSize) => text.width * Math.min(text.height, text.width * 2);
  const best = [option('row'), option('column')].filter((candidate) => candidate.usable).sort((a, b) => worth(b.text) - worth(a.text))[0];

  if (!best) {
    // No room for text beside a code that scans: the whole label goes to the code.
    const dots = snapped(largest);
    return { arrangement: 'code', padding: round(padding), gap: 0, qr: round(Math.min(dots * unit, largest)), dots, fine: dots < fewest || dots * unit > largest + 1e-9, text: { width: 0, height: 0 }, font: 0 };
  }
  return {
    arrangement: best.arrangement,
    padding: round(padding),
    gap: round(gap),
    qr: round(best.qr),
    dots: best.dots,
    fine: false,
    text: { width: round(best.text.width), height: round(best.text.height) },
    // About four lines deep or nine letters across, whichever is tighter; never so small that the lines under
    // the name would start below the smallest type.
    font: round(clamp(Math.min(best.text.height / 4, best.text.width / 9), TEXT_MIN_MM / LINE_SCALE, 12)),
  };
}

/**
 * How much damage a code survives: M reads with about 15% of it scuffed or missing, L with about 7%.
 * L needs fewer squares for the same link, which is what a very small label is short of.
 */
export type QrLevel = 'M' | 'L';

export interface QrShape {
  /** Modules along one side, quiet zone not included. */
  size: number;
  /** Whether the module at this row and column is dark. */
  dark: (row: number, column: number) => boolean;
  /** One SVG path covering every dark module, in a (size × size) box starting at 0,0. */
  path: string;
}

/**
 * The QR code for a piece of text. Medium error correction unless asked otherwise: a label that is scuffed or
 * slightly curled round a spool still reads, without the code getting so dense that a small label cannot hold it.
 */
export function qrShape(text: string, level: QrLevel = 'M'): QrShape {
  const key = `${level}:${text}`;
  const known = shapes.get(key);
  if (known) return known;
  const shape = drawQr(text, level);
  // Working a code out is the slow part of drawing a label, and the same labels are drawn again at every
  // size tried. Kept for the visit; a few hundred links is nothing to hold.
  if (shapes.size >= 1000) shapes.clear();
  shapes.set(key, shape);
  return shape;
}

const shapes = new Map<string, QrShape>();

function drawQr(text: string, level: QrLevel): QrShape {
  const code = qrcode(0, level);
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
