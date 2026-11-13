import type { Db } from '@/db';
import { buildSchedule, type ScheduleEntry } from '@/services/maintenance';
import { buildReorder, isLow, isWorn } from '@/services/reorder';
import { round } from '@/services/stock';

const DAY_MS = 86_400_000;
/** Use is averaged over this many days to forecast when stock runs out. */
const RATE_DAYS = 30;
/** "Coming up" looks this far ahead: long enough to order most things and have them arrive. */
const HORIZON_DAYS = 14;
/** Tooling is worth a spare once this much of its expected life is used. */
const WEARING_AT = 0.8;

interface Amount {
  unit: string;
  decimals: number;
}

/**
 * One line of the action plan. The server states the facts; the client words them,
 * so numbers and dates follow the reader's locale like everywhere else.
 */
export type ReportAction =
  | { kind: 'service'; urgency: 'today' | 'soon'; machineId: string; machineName: string; entries: ScheduleEntry[] }
  | { kind: 'machine'; urgency: 'today'; machineId: string; machineName: string }
  | ({ kind: 'shortfall'; urgency: 'today'; itemId: string; itemName: string; needed: number; available: number; jobs: string[] } & Amount)
  | { kind: 'requests'; urgency: 'today'; count: number; oldestAt: string }
  | { kind: 'order'; urgency: 'today'; suppliers: string[]; items: string[]; unassigned: number; estimatedCost: number }
  | ({ kind: 'runout'; urgency: 'soon'; itemId: string; itemName: string; quantity: number; minQuantity: number; daysLeft: number } & Amount)
  | { kind: 'wearing'; urgency: 'soon'; itemId: string; itemName: string; usageHours: number; lifeHours: number };

interface Totals {
  jobs: number;
  failed: number;
  hours: number;
  cost: number;
}

export interface DailyReport {
  generatedAt: string;
  /** In the order they should be tackled: today's first, then what is coming up. */
  actions: ReportAction[];
  /** Finished jobs over rolling windows, so the figures do not depend on anyone's time zone. */
  activity: { day: Totals; week: Totals; previousWeek: Totals };
  openJobs: { planned: number; inProgress: number };
  /** Last 30 days. `machine` is where most of the failures happened, when one stands out. */
  failures: { failed: number; total: number; machine: { name: string; failed: number } | null };
  /** The machine with the most run time in the last 7 days. */
  busiestMachine: { name: string; hours: number } | null;
  /** What the last 30 days of work went through, biggest spend first. `daysLeft` is null with nothing left to forecast from. */
  mostUsed: Array<{ itemId: string; name: string; used: number; cost: number; daysLeft: number | null } & Amount>;
}

const emptyTotals = (): Totals => ({ jobs: 0, failed: 0, hours: 0, cost: 0 });
const tidy = (totals: Totals): Totals => ({ ...totals, hours: round(totals.hours, 1), cost: round(totals.cost, 2) });

export async function buildDailyReport(db: Db, workspaceId: string, now = new Date()): Promise<DailyReport> {
  const since = (days: number) => new Date(now.getTime() - days * DAY_MS);

  const [items, machines, schedule, reorder, openJobs, finished, parts, waiting] = await Promise.all([
    db.item.findMany({
      where: { workspaceId, archived: false },
      select: {
        id: true, name: true, quantity: true, minQuantity: true, unitCost: true, isRemnant: true,
        wearFlag: true, usageHours: true, lifeHours: true, unit: { select: { symbol: true, decimals: true } },
      },
    }),
    db.machine.findMany({ where: { workspaceId }, select: { id: true, name: true, status: true } }),
    buildSchedule(db, workspaceId, now),
    buildReorder(db, workspaceId),
    db.job.findMany({
      where: { workspaceId, status: { in: ['planned', 'in_progress'] } },
      orderBy: { createdAt: 'asc' },
      select: { name: true, status: true, usages: { select: { itemId: true, quantity: true } } },
    }),
    db.job.findMany({
      where: { workspaceId, status: { in: ['completed', 'failed'] }, completedAt: { gte: since(RATE_DAYS) } },
      select: {
        status: true, durationHours: true, totalCost: true, completedAt: true, machineId: true,
        usages: { select: { itemId: true, quantity: true } },
      },
    }),
    db.maintenancePart.findMany({
      where: { log: { performedAt: { gte: since(RATE_DAYS) }, task: { workspaceId } } },
      select: { itemId: true, quantity: true },
    }),
    db.jobRequest.findMany({
      where: { workspaceId, status: 'pending' },
      orderBy: { createdAt: 'asc' },
      select: { createdAt: true },
    }),
  ]);

  const itemById = new Map(items.map((item) => [item.id, item]));
  const machineName = new Map(machines.map((machine) => [machine.id, machine.name]));
  const amount = (item: (typeof items)[number]): Amount => ({ unit: item.unit?.symbol ?? '', decimals: item.unit?.decimals ?? 0 });

  // ---- What the last 30 days used: finished jobs (failed runs use material too) and parts fitted during services.
  const used = new Map<string, number>();
  const use = (itemId: string, quantity: number) => {
    if (quantity > 0) used.set(itemId, (used.get(itemId) ?? 0) + quantity);
  };
  for (const job of finished) for (const usage of job.usages) use(usage.itemId, usage.quantity);
  for (const part of parts) use(part.itemId, part.quantity);
  const perDay = (itemId: string) => (used.get(itemId) ?? 0) / RATE_DAYS;

  // ---- Action plan: today ------------------------------------------------
  const today: ReportAction[] = [];
  const soon: ReportAction[] = [];

  // Machines first: nothing should run on one that is overdue or flagged.
  // One step per machine, because that is one trip to it. The schedule arrives most pressing first, and the groups keep that order.
  const services = (status: 'overdue' | 'soon', urgency: 'today' | 'soon') => {
    const byMachine = new Map<string, Extract<ReportAction, { kind: 'service' }>>();
    for (const entry of schedule) {
      if (entry.status !== status) continue;
      const step = byMachine.get(entry.machineId) ?? { kind: 'service', urgency, machineId: entry.machineId, machineName: entry.machineName, entries: [] };
      step.entries.push(entry);
      byMachine.set(entry.machineId, step);
    }
    return [...byMachine.values()];
  };
  today.push(...services('overdue', 'today'));
  soon.push(...services('soon', 'soon'));
  for (const machine of machines) {
    if (machine.status === 'needs_service') today.push({ kind: 'machine', urgency: 'today', machineId: machine.id, machineName: machine.name });
  }

  // Open jobs that ask for more than is on the shelf, added up across every job that wants the same item.
  const wanted = new Map<string, { needed: number; jobs: string[] }>();
  for (const job of openJobs) {
    for (const usage of job.usages) {
      if (usage.quantity <= 0) continue;
      const line = wanted.get(usage.itemId) ?? { needed: 0, jobs: [] };
      line.needed += usage.quantity;
      line.jobs.push(job.name);
      wanted.set(usage.itemId, line);
    }
  }
  for (const [itemId, { needed, jobs }] of wanted) {
    const item = itemById.get(itemId);
    if (!item || round(needed) <= item.quantity) continue;
    today.push({
      kind: 'shortfall', urgency: 'today', itemId, itemName: item.name,
      needed: round(needed), available: item.quantity, jobs, ...amount(item),
    });
  }

  // People are waiting on these.
  if (waiting.length) today.push({ kind: 'requests', urgency: 'today', count: waiting.length, oldestAt: waiting[0].createdAt.toISOString() });

  // One step for all the buying: the reorder list it links to is already split by supplier.
  if (reorder.groups.length) {
    today.push({
      kind: 'order', urgency: 'today',
      suppliers: reorder.groups.flatMap((group) => (group.supplier ? [group.supplier.name] : [])),
      items: reorder.groups.flatMap((group) => group.lines.map((line) => line.name)),
      unassigned: reorder.groups.find((group) => !group.supplier)?.lines.length ?? 0,
      estimatedCost: reorder.total,
    });
  }

  // ---- Action plan: coming up --------------------------------------------
  // Stock that is fine today but, at the rate it has been going, will cross its minimum (or run out) inside the horizon.
  const runouts: Extract<ReportAction, { kind: 'runout' }>[] = [];
  for (const item of items) {
    const rate = perDay(item.id);
    if (item.isRemnant || rate <= 0 || isLow(item) || item.quantity <= 0) continue;
    const daysLeft = (item.quantity - item.minQuantity) / rate;
    if (daysLeft > HORIZON_DAYS) continue;
    runouts.push({
      kind: 'runout', urgency: 'soon', itemId: item.id, itemName: item.name,
      quantity: item.quantity, minQuantity: item.minQuantity, daysLeft: round(daysLeft, 1), ...amount(item),
    });
  }
  soon.push(...runouts.sort((a, b) => a.daysLeft - b.daysLeft));

  for (const item of items) {
    if (item.lifeHours === null || isWorn(item) || item.usageHours < item.lifeHours * WEARING_AT) continue;
    soon.push({ kind: 'wearing', urgency: 'soon', itemId: item.id, itemName: item.name, usageHours: item.usageHours, lifeHours: item.lifeHours });
  }

  // ---- Insights ----------------------------------------------------------
  const activity = { day: emptyTotals(), week: emptyTotals(), previousWeek: emptyTotals() };
  const failures = { failed: 0, total: finished.length };
  const failedOn = new Map<string, number>();
  const hoursOn = new Map<string, number>();
  for (const job of finished) {
    const age = job.completedAt ? (now.getTime() - job.completedAt.getTime()) / DAY_MS : Infinity;
    const windows = [age <= 1 && activity.day, age <= 7 && activity.week, age > 7 && age <= 14 && activity.previousWeek];
    for (const totals of windows) {
      if (!totals) continue;
      totals.jobs++;
      totals.hours += job.durationHours;
      totals.cost += job.totalCost;
      if (job.status === 'failed') totals.failed++;
    }
    if (job.status === 'failed') {
      failures.failed++;
      if (job.machineId) failedOn.set(job.machineId, (failedOn.get(job.machineId) ?? 0) + 1);
    }
    if (age <= 7 && job.machineId) hoursOn.set(job.machineId, (hoursOn.get(job.machineId) ?? 0) + job.durationHours);
  }

  const top = (counts: Map<string, number>) => [...counts].sort((a, b) => b[1] - a[1])[0];
  const worst = top(failedOn);
  const busiest = top(hoursOn);
  // Only name a machine when it accounts for more than one failure and most of them.
  const failureMachine = worst && worst[1] > 1 && worst[1] * 2 > failures.failed ? { name: machineName.get(worst[0]) ?? '', failed: worst[1] } : null;

  const mostUsed = [...used]
    .flatMap(([itemId, quantity]) => {
      const item = itemById.get(itemId);
      if (!item) return [];
      const rate = quantity / RATE_DAYS;
      return [{
        itemId, name: item.name, used: round(quantity), cost: round(quantity * item.unitCost, 2),
        daysLeft: item.quantity > 0 ? round(item.quantity / rate, 1) : null, ...amount(item),
      }];
    })
    .sort((a, b) => b.cost - a.cost || (a.daysLeft ?? 0) - (b.daysLeft ?? 0))
    .slice(0, 3);

  return {
    generatedAt: now.toISOString(),
    actions: [...today, ...soon],
    activity: { day: tidy(activity.day), week: tidy(activity.week), previousWeek: tidy(activity.previousWeek) },
    openJobs: {
      planned: openJobs.filter((job) => job.status === 'planned').length,
      inProgress: openJobs.filter((job) => job.status === 'in_progress').length,
    },
    failures: { ...failures, machine: failureMachine },
    busiestMachine: busiest && busiest[1] > 0 ? { name: machineName.get(busiest[0]) ?? '', hours: round(busiest[1], 1) } : null,
    mostUsed,
  };
}
