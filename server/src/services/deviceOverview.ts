import { createHash } from 'node:crypto';
import type { Prisma } from '@prisma/client';
import type { Db } from '@/db';
import { isLow } from '@/services/reorder';
import { round } from '@/services/stock';

/**
 * What a location display draws: the items stored in one location (and the locations inside it), already
 * worded and formatted so the firmware only has to lay them out. Kept small (a few KB) because the display
 * has no spare memory, and versioned so an unchanged poll costs one short 304.
 */

/** Seconds between a display's polls. Sent with every overview so it can be changed here without new firmware. */
export const POLL_SECONDS = 30;
/** More than this many rows would not fit the display's memory; `total` still gives the real count. */
export const MAX_ROWS = 40;
const MAX_LOCATIONS = 60;

/**
 * The display's built-in fonts hold plain ASCII only. Accents are dropped ("Café" → "Cafe") and anything else
 * becomes a space, so names read sensibly instead of showing boxes.
 */
export function forDisplay(value: string, max = 40): string {
  const plain = value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\x20-\x7e]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return plain.length > max ? `${plain.slice(0, max - 1).trimEnd()}~` : plain;
}

interface LocationRow {
  id: string;
  name: string;
  parentId: string | null;
}

/** Every location in the workspace, with a way to read one's path and the locations below it. */
export async function locationTree(db: Db, workspaceId: string) {
  const rows: LocationRow[] = await db.location.findMany({ where: { workspaceId }, select: { id: true, name: true, parentId: true } });
  const byId = new Map(rows.map((row) => [row.id, row]));
  const children = new Map<string, string[]>();
  for (const row of rows) if (row.parentId) children.set(row.parentId, [...(children.get(row.parentId) ?? []), row.id]);

  const path = (id: string): string => {
    const names: string[] = [];
    const seen = new Set<string>();
    for (let at = byId.get(id); at && !seen.has(at.id); at = at.parentId ? byId.get(at.parentId) : undefined) {
      seen.add(at.id);
      names.unshift(at.name);
    }
    return names.join(' / ');
  };
  /** The location and everything inside it, at any depth. */
  const subtree = (id: string): string[] => {
    const out: string[] = [];
    const queue = [id];
    while (queue.length) {
      const next = queue.shift()!;
      if (out.includes(next)) continue;
      out.push(next);
      queue.push(...(children.get(next) ?? []));
    }
    return out;
  };
  return { byId, path, subtree };
}

export const itemSelect = {
  id: true, name: true, quantity: true, capacity: true, minQuantity: true, fields: true, tagId: true, locationId: true,
  unit: { select: { symbol: true, decimals: true } },
  supplier: { select: { name: true } },
  itemType: { select: { name: true, fields: { select: { key: true, label: true, fieldType: true } } } },
} as const;

type ItemRow = Prisma.ItemGetPayload<{ select: typeof itemSelect }>;

export interface DisplayRow {
  id: string;
  name: string;
  /** "PLA - Bambu Lab", or the item's type when it has neither. */
  sub: string;
  color: string | null;
  qty: string;
  fill: number | null;
  low: boolean;
  /** The sub-location it sits in, when that is not the location being shown. */
  at: string | null;
  tagged: boolean;
}

/** One item as a display row. `shownLocationId` is the location on screen, so items deeper down get an "at". */
export function displayRow(item: ItemRow, shownLocationId: string | null, locationName: (id: string) => string): DisplayRow {
  const values = (item.fields ?? {}) as Record<string, unknown>;
  const fields = item.itemType.fields;
  const text = (key: string | undefined) => {
    const value = key ? values[key] : undefined;
    return typeof value === 'string' ? value.trim() : '';
  };
  const material = text((fields.find((f) => f.key === 'material') ?? fields.find((f) => /material/i.test(f.label)))?.key);
  const brand = text(fields.find((f) => f.key === 'brand')?.key) || item.supplier?.name || '';
  const colour = text(fields.find((f) => f.fieldType === 'color')?.key);
  const decimals = item.unit?.decimals ?? 0;
  const amount = round(item.quantity, decimals).toFixed(decimals);
  return {
    id: item.id,
    name: forDisplay(item.name),
    sub: forDisplay([material, brand].filter(Boolean).join(' - ') || item.itemType.name),
    color: /^#[0-9a-f]{6}$/i.test(colour) ? colour.toLowerCase() : null,
    qty: forDisplay(item.unit?.symbol ? `${amount} ${item.unit.symbol}` : amount, 16),
    fill: item.capacity && item.capacity > 0 ? round(Math.min(1, Math.max(0, item.quantity / item.capacity)), 2) : null,
    low: isLow(item),
    at: item.locationId && item.locationId !== shownLocationId ? forDisplay(locationName(item.locationId), 24) : null,
    tagged: Boolean(item.tagId),
  };
}

/** Low stock first, then by name: what needs attention is at the top of a small screen. */
const byAttention = (a: DisplayRow, b: DisplayRow) => Number(b.low) - Number(a.low) || a.name.localeCompare(b.name);

export interface Overview {
  v: string;
  poll: number;
  workspace: string;
  device: string;
  canWrite: boolean;
  location: { id: string; name: string; path: string } | null;
  total: number;
  lowCount: number;
  items: DisplayRow[];
  locations: Array<{ id: string; name: string }>;
}

/** The overview for a display, of `locationId` (its own location, or one it is browsing). */
export async function buildOverview(
  db: Db,
  device: { workspaceId: string; name: string; canWrite: boolean; workspace: { name: string } },
  locationId: string | null,
): Promise<Overview> {
  const tree = await locationTree(db, device.workspaceId);
  const shown = locationId ? tree.byId.get(locationId) : undefined;
  let rows: DisplayRow[] = [];
  if (shown) {
    const items = await db.item.findMany({
      where: { workspaceId: device.workspaceId, archived: false, locationId: { in: tree.subtree(shown.id) } },
      select: itemSelect,
    });
    rows = items.map((item) => displayRow(item, shown.id, (id) => tree.byId.get(id)?.name ?? '')).sort(byAttention);
  }
  const locations = [...tree.byId.keys()]
    .map((id) => ({ id, name: forDisplay(tree.path(id), 48) }))
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, MAX_LOCATIONS);
  const body = {
    poll: POLL_SECONDS,
    workspace: forDisplay(device.workspace.name),
    device: forDisplay(device.name),
    canWrite: device.canWrite,
    location: shown ? { id: shown.id, name: forDisplay(shown.name), path: forDisplay(tree.path(shown.id), 64) } : null,
    total: rows.length,
    lowCount: rows.filter((row) => row.low).length,
    items: rows.slice(0, MAX_ROWS),
    locations,
  };
  const v = createHash('sha256').update(JSON.stringify(body)).digest('base64url').slice(0, 12);
  return { v, ...body };
}
