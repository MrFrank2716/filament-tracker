import { AsyncLocalStorage } from 'node:async_hooks';
import type { Request, RequestHandler } from 'express';
import { prisma, type Db } from '@/db';
import { HttpError, notFound } from '@/http';
import { moveStock, round } from '@/services/stock';

/**
 * Activity / audit log.
 *
 * Every successful change a member makes under /workspaces/:wid is written down with who, what and when.
 * Stock movements made while handling the request are collected (through AsyncLocalStorage, so moveStock
 * does not need to know about requests) and kept on the entry, which is what lets a stock edit be undone.
 */

interface Context {
  movementIds: string[];
  /** Set by a handler that knows better than the generic wording. */
  summary?: string;
  entity?: { type: string; id: string | null };
}

const store = new AsyncLocalStorage<Context>();

/** Called by moveStock for every movement it writes. */
export function noteMovement(id: string): void {
  store.getStore()?.movementIds.push(id);
}

/** Let a handler word its own log entry. */
export function describeActivity(summary: string, entity?: { type: string; id: string | null }): void {
  const context = store.getStore();
  if (!context) return;
  context.summary = summary;
  if (entity) context.entity = entity;
}

/**
 * An entry for something no member did: a connected printer loading a spool, for example.
 * `actor` is shown where a member's name would be.
 */
export async function logSystemActivity(entry: {
  workspaceId: string;
  actor: string;
  action: string;
  entityType?: string;
  entityId?: string | null;
  summary: string;
}): Promise<void> {
  await prisma.activityLog.create({
    data: {
      workspaceId: entry.workspaceId,
      userId: null,
      userName: entry.actor.slice(0, 120),
      action: entry.action,
      entityType: entry.entityType ?? '',
      entityId: entry.entityId ?? null,
      summary: entry.summary.slice(0, 500),
      movementIds: [],
    },
  });
}

/** Only these can be undone: changes whose whole effect is the stock they moved. */
export const UNDOABLE = new Set(['item.adjust', 'item.update']);

/** Response header naming the activity entry a stock change became, sent only to members who may undo it. */
export const UNDO_HEADER = 'X-Undo-Activity';

// ---- Wording -----------------------------------------------------------------

const NOUNS: Record<string, string> = {
  items: 'item',
  units: 'unit',
  suppliers: 'supplier',
  locations: 'location',
  'item-types': 'item type',
  'machine-types': 'machine type',
  machines: 'machine',
  'sub-units': 'attachment',
  jobs: 'job',
  projects: 'project',
  'job-requests': 'request',
  members: 'member',
  queue: 'queue',
  'request-link': 'request link',
  bridges: 'bridge',
  printers: 'printer connection',
  devices: 'display',
  reference: 'catalogue',
};

/** For deletes the record is gone afterwards, so its name is read first. */
async function nameBeforeDelete(workspaceId: string, collection: string, id: string): Promise<string> {
  const where = { id, workspaceId };
  const pick = (row: { name?: string; title?: string } | null) => row?.name ?? row?.title ?? '';
  switch (collection) {
    case 'items': return pick(await prisma.item.findFirst({ where, select: { name: true } }));
    case 'units': return pick(await prisma.unit.findFirst({ where, select: { name: true } }));
    case 'suppliers': return pick(await prisma.supplier.findFirst({ where, select: { name: true } }));
    case 'locations': return pick(await prisma.location.findFirst({ where, select: { name: true } }));
    case 'item-types': return pick(await prisma.itemType.findFirst({ where, select: { name: true } }));
    case 'machine-types': return pick(await prisma.machineType.findFirst({ where, select: { name: true } }));
    case 'machines': return pick(await prisma.machine.findFirst({ where, select: { name: true } }));
    case 'sub-units': return pick(await prisma.subUnit.findFirst({ where, select: { name: true } }));
    case 'jobs': return pick(await prisma.job.findFirst({ where, select: { name: true } }));
    case 'projects': return pick(await prisma.project.findFirst({ where, select: { name: true } }));
    case 'bridges': return pick(await prisma.bridge.findFirst({ where, select: { name: true } }));
    case 'devices': return pick(await prisma.device.findFirst({ where, select: { name: true } }));
    case 'printers': {
      const link = await prisma.printerLink.findFirst({ where, select: { machine: { select: { name: true } } } });
      return link?.machine.name ?? '';
    }
    case 'job-requests': return pick(await prisma.jobRequest.findFirst({ where, select: { title: true } }));
    case 'members': {
      const member = await prisma.membership.findFirst({ where, select: { user: { select: { name: true } } } });
      return member?.user.name ?? '';
    }
    default: return '';
  }
}

const ACTIONS: Record<string, string> = {
  adjust: 'Adjusted stock of',
  start: 'Started',
  finish: 'Finished',
  cancel: 'Cancelled',
  review: 'Reviewed',
  comments: 'Commented on',
  status: 'Changed status of',
};

function describe(method: string, segments: string[], name: string, body: Record<string, unknown> | undefined) {
  const [collection = '', id, sub] = segments;
  // /maintenance/tasks/:id/complete and /maintenance/logs/:id
  if (collection === 'maintenance') {
    const [, kind, , verb] = segments;
    const what = kind === 'logs' ? 'maintenance record' : 'maintenance task';
    if (verb === 'complete') return { action: 'maintenance.complete', type: 'maintenance', text: `Did maintenance${name ? `: ${name}` : ''}` };
    return { action: `maintenance.${method.toLowerCase()}`, type: 'maintenance', text: `${verbFor(method, !segments[2])} ${what}${name ? ` ${name}` : ''}` };
  }
  if (collection === '') return { action: `workspace.${method.toLowerCase()}`, type: 'workspace', text: method === 'DELETE' ? 'Deleted the workspace' : 'Changed workspace settings' };
  const noun = NOUNS[collection] ?? collection;
  const key = collection.replace(/s$/, '').replace(/-([a-z])/g, (_m, c: string) => c.toUpperCase());
  if (sub === 'slots') return { action: 'subUnit.slot', type: 'subUnit', text: `Changed a slot on ${name || 'an attachment'}` };
  if (sub && ACTIONS[sub]) {
    const extra = sub === 'review' && typeof body?.status === 'string' ? ` (${String(body.status).replace('_', ' ')})` : '';
    return { action: `${key}.${sub}`, type: key, text: `${ACTIONS[sub]} ${noun} ${name}${extra}`.trim() };
  }
  if (collection === 'import') return { action: 'import', type: '', text: segments[1] === 'items.csv' ? 'Imported items from CSV' : 'Imported data' };
  return {
    action: `${key}.${{ POST: 'create', PATCH: 'update', PUT: 'set', DELETE: 'delete' }[method] ?? method.toLowerCase()}`,
    type: key,
    text: `${verbFor(method, !id)} ${noun}${name ? ` ${name}` : ''}`,
  };
}

function verbFor(method: string, onCollection: boolean): string {
  if (method === 'DELETE') return 'Deleted';
  if (method === 'POST' && onCollection) return 'Added';
  if (method === 'PUT') return 'Set';
  return 'Edited';
}

/** "PLA Black: -120 g (now 880 g)" for each movement, so the log says what actually happened to stock. */
async function describeMovements(ids: string[]): Promise<string> {
  if (ids.length === 0) return '';
  const movements = await prisma.stockMovement.findMany({
    where: { id: { in: ids } },
    include: { item: { select: { name: true, unit: { select: { symbol: true } } } } },
  });
  const parts = movements.slice(0, 4).map((m) => {
    const unit = m.item.unit?.symbol ? ` ${m.item.unit.symbol}` : '';
    return `${m.item.name} ${m.delta > 0 ? '+' : ''}${round(m.delta, 3)}${unit} (now ${round(m.balanceAfter, 3)}${unit})`;
  });
  if (movements.length > 4) parts.push(`and ${movements.length - 4} more`);
  return parts.join(', ');
}

// ---- Middleware ------------------------------------------------------------------

/** Mounted on /workspaces/:wid after the guard. Reads are not logged. */
export const recordActivity: RequestHandler = async (req, res, next) => {
  if (req.method === 'GET' || req.method === 'HEAD') return next();

  const segments = req.path.split('/').filter(Boolean);
  let nameBefore = '';
  if (req.method === 'DELETE' && segments.length === 2) nameBefore = await nameBeforeDelete(req.workspaceId, segments[0], segments[1]);

  const context: Context = { movementIds: [] };
  let responseBody: Record<string, unknown> | undefined;
  const json = res.json.bind(res);
  res.json = (body: unknown) => {
    if (body && typeof body === 'object' && !Array.isArray(body)) responseBody = body as Record<string, unknown>;
    return json(body);
  };

  // Written before the response is finished, so whoever refreshes on seeing it (the caller, or others
  // told over the socket) already finds the entry. A failed write is logged, never turned into an error.
  const end = res.end.bind(res) as (...args: unknown[]) => typeof res;
  let ended = false;
  res.end = ((...args: unknown[]) => {
    if (ended || res.statusCode >= 400) return end(...args);
    ended = true;
    write(req, segments, nameBefore, responseBody, context)
      // Whoever may undo this change is told which entry it became, so the screen can offer Undo straight away.
      .then((undoId) => {
        if (undoId && !res.headersSent) res.setHeader(UNDO_HEADER, undoId);
      })
      .catch((error: unknown) => console.error('Could not write activity log', error))
      .finally(() => end(...args));
    return res;
  }) as typeof res.end;
  store.run(context, () => next());
};

/** Writes the entry. Resolves to its id when it is a stock change this member may undo, otherwise to null. */
async function write(req: Request, segments: string[], nameBefore: string, body: Record<string, unknown> | undefined, context: Context): Promise<string | null> {
  // The workspace itself is gone: there is nowhere to write.
  if (req.method === 'DELETE' && segments.length === 0) return null;
  // Undo writes its own entry.
  if (segments[0] === 'activity') return null;
  // A question to the assistant changes nothing in the workshop, so it is not part of its history.
  if (segments[0] === 'ai') return null;
  const name = nameBefore || String(body?.name ?? body?.title ?? '');
  const generic = describe(req.method, segments, name, body);
  const moved = await describeMovements(context.movementIds);
  // A stock adjustment is fully described by its movements, which already name the item.
  const summary = context.summary ?? (generic.action === 'item.adjust' && moved ? `Changed stock: ${moved}` : moved ? `${generic.text}: ${moved}` : generic.text);
  const user = await prisma.user.findUnique({ where: { id: req.userId }, select: { name: true } });
  const entry = await prisma.activityLog.create({
    data: {
      workspaceId: req.workspaceId,
      userId: req.userId,
      userName: user?.name ?? '',
      action: generic.action,
      entityType: context.entity?.type ?? generic.type,
      entityId: context.entity?.id ?? (typeof body?.id === 'string' ? body.id : (segments[1] ?? null)),
      summary: summary.slice(0, 500),
      movementIds: context.movementIds,
    },
  });
  // The same rule the activity list uses for its Undo button.
  const mayUndo = req.role === 'admin' || req.role === 'owner';
  return mayUndo && UNDOABLE.has(generic.action) && context.movementIds.length > 0 ? entry.id : null;
}

// ---- Undo ------------------------------------------------------------------------

/**
 * Put back the stock an entry moved, as new "undo" movements (history is never rewritten).
 * Quantities are relative, so later changes to the same item are kept.
 */
export async function undoActivity(db: Db, workspaceId: string, activityId: string, userId: string) {
  const entry = await db.activityLog.findFirst({ where: { id: activityId, workspaceId } });
  if (!entry) throw notFound('Activity');
  if (!UNDOABLE.has(entry.action)) throw new HttpError(400, 'Only stock changes can be undone');
  const ids = Array.isArray(entry.movementIds) ? (entry.movementIds as string[]) : [];
  if (ids.length === 0) throw new HttpError(400, 'This change did not move any stock, so there is nothing to undo');

  // Claimed first, so two people pressing undo cannot both reverse it.
  const claimed = await db.activityLog.updateMany({ where: { id: entry.id, undoneAt: null }, data: { undoneAt: new Date(), undoneById: userId } });
  if (claimed.count !== 1) throw new HttpError(409, 'This change has already been undone');

  const movements = await db.stockMovement.findMany({ where: { id: { in: ids }, workspaceId } });
  if (movements.length === 0) throw new HttpError(409, 'The item this changed has been deleted');
  for (const movement of movements) {
    await moveStock(db, {
      workspaceId, itemId: movement.itemId, delta: -movement.delta, reason: 'undo',
      note: `Undo: ${entry.summary}`.slice(0, 300), userId,
    });
  }
  return entry;
}
