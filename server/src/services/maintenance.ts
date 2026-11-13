import type { Db } from '@/db';

const DAY_MS = 86_400_000;

export type DueStatus = 'ok' | 'soon' | 'overdue';

export interface ScheduleEntry {
  taskId: string;
  taskName: string;
  description: string;
  machineId: string;
  machineName: string;
  /** True when the task comes from the machine's type rather than the machine itself. */
  inherited: boolean;
  intervalDays: number | null;
  intervalHours: number | null;
  status: DueStatus;
  lastDoneAt: string | null;
  lastDoneHours: number | null;
  dueDate: string | null;
  daysRemaining: number | null;
  hoursRemaining: number | null;
  /** 0..1+ : how far through the interval we are (the larger of the date and usage clocks). */
  progress: number;
}

interface DueInput {
  intervalDays: number | null;
  intervalHours: number | null;
  createdAt: Date;
  machineHours: number;
  lastLog: { performedAt: Date; hoursAtService: number } | null;
  now: Date;
}

/**
 * A task is due when either clock runs out. With no service history the date clock
 * starts when the task was created and the usage clock counts all machine hours,
 * so an unknown history errs towards reminding rather than staying silent.
 */
export function computeDue({ intervalDays, intervalHours, createdAt, machineHours, lastLog, now }: DueInput) {
  let status: DueStatus = 'ok';
  let dueDate: Date | null = null;
  let daysRemaining: number | null = null;
  let hoursRemaining: number | null = null;
  let progress = 0;
  const escalate = (next: DueStatus) => {
    if (next === 'overdue' || (next === 'soon' && status === 'ok')) status = next;
  };

  if (intervalDays) {
    const base = lastLog?.performedAt ?? createdAt;
    dueDate = new Date(base.getTime() + intervalDays * DAY_MS);
    daysRemaining = (dueDate.getTime() - now.getTime()) / DAY_MS;
    progress = Math.max(progress, 1 - daysRemaining / intervalDays);
    const warnDays = Math.min(14, Math.max(1, intervalDays * 0.2));
    if (daysRemaining < 0) escalate('overdue');
    else if (daysRemaining <= warnDays) escalate('soon');
  }

  if (intervalHours) {
    const base = lastLog?.hoursAtService ?? 0;
    hoursRemaining = base + intervalHours - machineHours;
    progress = Math.max(progress, 1 - hoursRemaining / intervalHours);
    if (hoursRemaining <= 0) escalate('overdue');
    else if (hoursRemaining <= intervalHours * 0.15) escalate('soon');
  }

  return { status, dueDate, daysRemaining, hoursRemaining, progress: Math.max(0, progress) };
}

const order: Record<DueStatus, number> = { overdue: 0, soon: 1, ok: 2 };

/** Expand every active task into one schedule entry per machine it covers. */
export async function buildSchedule(db: Db, workspaceId: string, now = new Date()): Promise<ScheduleEntry[]> {
  const [tasks, machines] = await Promise.all([
    db.maintenanceTask.findMany({ where: { workspaceId, active: true } }),
    db.machine.findMany({ where: { workspaceId } }),
  ]);
  if (!tasks.length) return [];

  const logs = await db.maintenanceLog.findMany({
    where: { taskId: { in: tasks.map((t) => t.id) } },
    orderBy: { performedAt: 'desc' },
    select: { taskId: true, machineId: true, performedAt: true, hoursAtService: true },
  });
  const latest = new Map<string, (typeof logs)[number]>();
  for (const log of logs) {
    const key = `${log.taskId}:${log.machineId}`;
    if (!latest.has(key)) latest.set(key, log);
  }

  const entries: ScheduleEntry[] = [];
  for (const task of tasks) {
    const covered = task.machineId
      ? machines.filter((m) => m.id === task.machineId)
      : machines.filter((m) => m.machineTypeId && m.machineTypeId === task.machineTypeId);
    for (const machine of covered) {
      const lastLog = latest.get(`${task.id}:${machine.id}`) ?? null;
      const due = computeDue({
        intervalDays: task.intervalDays,
        intervalHours: task.intervalHours,
        createdAt: task.createdAt,
        machineHours: machine.usageHours,
        lastLog,
        now,
      });
      entries.push({
        taskId: task.id,
        taskName: task.name,
        description: task.description,
        machineId: machine.id,
        machineName: machine.name,
        inherited: !task.machineId,
        intervalDays: task.intervalDays,
        intervalHours: task.intervalHours,
        status: due.status,
        lastDoneAt: lastLog?.performedAt.toISOString() ?? null,
        lastDoneHours: lastLog?.hoursAtService ?? null,
        dueDate: due.dueDate?.toISOString() ?? null,
        daysRemaining: due.daysRemaining,
        hoursRemaining: due.hoursRemaining,
        progress: due.progress,
      });
    }
  }

  return entries.sort((a, b) => order[a.status] - order[b.status] || b.progress - a.progress);
}
