import type { Item, Location } from '@/lib/types';

/**
 * Working out what was scanned. A Wrkbench label holds a link (/s/<item id> or /l/<location id>); an OpenSpool
 * tag holds a small JSON record; anything else is a plain code, such as a product barcode or a location's own
 * label code, looked up among the workspace's items and locations.
 */

export type Scan =
  | { kind: 'item'; id: string }
  | { kind: 'location'; id: string }
  /** `tagId` is set when the record was read from an NFC sticker with a serial ("NFC…"), not pasted or from a QR code. */
  | { kind: 'openspool'; record: Record<string, unknown>; tagId?: string | null }
  | { kind: 'text'; text: string };

const LINK = /^\/(s|l)\/([A-Za-z0-9_-]{1,64})\/?$/;

export function parseScan(raw: string): Scan {
  const text = raw.trim();
  // The host is not checked: one server is reached at several addresses (its name, its IP, localhost), and
  // a label printed at one must still open at another. The id is looked up in the member's own workspaces.
  let path = text;
  if (/^https?:\/\//i.test(text)) {
    try {
      path = new URL(text).pathname;
    } catch {
      return { kind: 'text', text };
    }
  }
  const link = LINK.exec(path);
  if (link) return { kind: link[1] === 's' ? 'item' : 'location', id: link[2] };
  if (text.startsWith('{')) {
    try {
      const record = JSON.parse(text) as unknown;
      if (record && typeof record === 'object' && String((record as { protocol?: unknown }).protocol).toLowerCase() === 'openspool') {
        return { kind: 'openspool', record: record as Record<string, unknown> };
      }
    } catch {
      // Not JSON after all: treat it as a code.
    }
  }
  return { kind: 'text', text };
}

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** What a plain code belongs to: an item by its SKU or barcode, or a location by its label code. */
export function findByCode(text: string, items: Item[], locations: Location[]): Extract<Scan, { kind: 'item' | 'location' }> | null {
  if (!text.trim()) return null;
  const item = items.find((candidate) => candidate.sku && same(candidate.sku, text));
  if (item) return { kind: 'item', id: item.id };
  const location = locations.find((candidate) => candidate.code && same(candidate.code, text));
  return location ? { kind: 'location', id: location.id } : null;
}
