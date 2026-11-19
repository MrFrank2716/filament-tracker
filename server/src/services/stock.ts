import type { Db } from '@/db';
import { HttpError } from '@/http';
import { noteMovement } from '@/services/activity';

export const round = (value: number, places = 4): number => {
  const factor = 10 ** places;
  return Math.round(value * factor) / factor;
};

interface MoveInput {
  workspaceId: string;
  itemId: string;
  delta: number;
  reason: 'initial' | 'restock' | 'adjust' | 'job' | 'maintenance' | 'import' | 'undo';
  note?: string;
  jobId?: string | null;
  userId?: string | null;
}

/**
 * The only way stock should change after creation. Never lets a quantity go below zero
 * and always leaves an audit row, so the level on screen can be traced back.
 * Must be called inside a transaction.
 */
export async function moveStock(db: Db, { workspaceId, itemId, delta, reason, note = '', jobId = null, userId = null }: MoveInput): Promise<void> {
  const item = await db.item.findFirst({ where: { id: itemId, workspaceId } });
  if (!item) throw new HttpError(404, 'Item not found');
  const balance = Math.max(0, round(item.quantity + delta));
  const applied = round(balance - item.quantity);
  if (applied === 0) return;
  await db.item.update({ where: { id: itemId }, data: { quantity: balance } });
  const movement = await db.stockMovement.create({
    data: { workspaceId, itemId, delta: applied, balanceAfter: balance, reason, note, jobId, userId },
  });
  noteMovement(movement.id);
}

/** Ensure referenced rows belong to this workspace before linking to them. */
export async function assertInWorkspace(
  db: Db,
  workspaceId: string,
  refs: Partial<Record<'unit' | 'supplier' | 'location' | 'itemType' | 'machineType' | 'machine' | 'item' | 'project', string | null | undefined | string[]>>,
): Promise<void> {
  const checks: Array<[string, string[], Promise<number>]> = [];
  for (const [model, value] of Object.entries(refs)) {
    const ids = [...new Set((Array.isArray(value) ? value : [value]).filter((v): v is string => Boolean(v)))];
    if (!ids.length) continue;
    // Each delegate shares the same count() shape; index access keeps this helper generic.
    const delegate = (db as unknown as Record<string, { count(args: unknown): Promise<number> }>)[model];
    checks.push([model, ids, delegate.count({ where: { id: { in: ids }, workspaceId } })]);
  }
  for (const [model, ids, pending] of checks) {
    if ((await pending) !== ids.length) throw new HttpError(400, `Unknown ${model} for this workspace`);
  }
}
