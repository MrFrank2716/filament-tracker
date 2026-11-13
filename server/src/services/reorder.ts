import type { Db } from '@/db';
import { round } from '@/services/stock';

export interface ReorderLine {
  itemId: string;
  name: string;
  typeName: string;
  reason: 'low' | 'worn';
  quantity: number;
  minQuantity: number;
  unit: string;
  decimals: number;
  suggested: number;
  estimatedCost: number;
}

export interface ReorderGroup {
  supplier: { id: string; name: string; website: string; email: string } | null;
  lines: ReorderLine[];
  total: number;
}

/** Holding exactly the minimum is fine; dropping below it is low. */
export const isLow = (item: { quantity: number; minQuantity: number }) => item.quantity < item.minQuantity;
export const isWorn = (item: { wearFlag: boolean; usageHours: number; lifeHours: number | null }) =>
  item.wearFlag || (item.lifeHours !== null && item.usageHours >= item.lifeHours);

/**
 * Everything that needs buying, grouped by supplier: items below their minimum,
 * and tooling that has reached the end of its life.
 */
export async function buildReorder(db: Db, workspaceId: string): Promise<{ groups: ReorderGroup[]; total: number }> {
  const items = await db.item.findMany({
    where: { workspaceId, archived: false, isRemnant: false },
    include: { supplier: true, unit: true, itemType: { select: { name: true } } },
    orderBy: { name: 'asc' },
  });

  const groups = new Map<string, ReorderGroup>();
  for (const item of items) {
    const low = isLow(item);
    const worn = isWorn(item);
    if (!low && !worn) continue;

    // With a known pack size, order whole packs (enough to clear the minimum). Otherwise top up to twice the minimum.
    const shortfall = item.minQuantity - item.quantity;
    const suggested =
      worn && !low
        ? 1
        : item.capacity
          ? item.capacity * Math.max(1, Math.ceil(shortfall / item.capacity))
          : round(Math.max(item.minQuantity * 2 - item.quantity, 1), item.unit?.decimals ?? 0);
    const estimatedCost = round(suggested * item.unitCost, 2);

    const key = item.supplierId ?? 'none';
    const group = groups.get(key) ?? {
      supplier: item.supplier
        ? { id: item.supplier.id, name: item.supplier.name, website: item.supplier.website, email: item.supplier.email }
        : null,
      lines: [],
      total: 0,
    };
    group.lines.push({
      itemId: item.id,
      name: item.name,
      typeName: item.itemType.name,
      reason: low ? 'low' : 'worn',
      quantity: item.quantity,
      minQuantity: item.minQuantity,
      unit: item.unit?.symbol ?? '',
      decimals: item.unit?.decimals ?? 0,
      suggested,
      estimatedCost,
    });
    group.total = round(group.total + estimatedCost, 2);
    groups.set(key, group);
  }

  const list = [...groups.values()].sort((a, b) => {
    if (!a.supplier) return 1;
    if (!b.supplier) return -1;
    return a.supplier.name.localeCompare(b.supplier.name);
  });
  return { groups: list, total: round(list.reduce((sum, g) => sum + g.total, 0), 2) };
}
