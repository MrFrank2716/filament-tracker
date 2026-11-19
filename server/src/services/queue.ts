import type { Db } from '@/db';
import { round } from '@/services/stock';

/**
 * Print queue: the open jobs on each machine in the order they will run, with estimated times.
 *
 * Order: the running job first, then higher priority, then the hand-set position, then the oldest.
 * Times assume each machine works through its queue back to back from now, using each job's
 * estimated duration (a running job counts only what is left of it). A machine that is offline or
 * needs service is "paused": its jobs keep their order but get no finish time.
 */

export interface QueuedJob {
  id: string;
  name: string;
  status: string;
  priority: number;
  queuePosition: number;
  durationHours: number;
  startedAt: Date | null;
  createdAt: Date;
  /** Hours left on this job (all of it unless running). */
  remainingHours: number;
  estimatedStart: Date | null;
  estimatedFinish: Date | null;
  requesterName: string | null;
}

export interface MachineQueue {
  machine: { id: string; name: string; status: string } | null;
  paused: boolean;
  /** Jobs whose duration is not set yet, so the times after them are a lower bound. */
  unestimated: number;
  totalHours: number;
  clearsAt: Date | null;
  jobs: QueuedJob[];
}

const HOUR = 3_600_000;

type Row = {
  id: string; name: string; status: string; priority: number; queuePosition: number;
  durationHours: number; startedAt: Date | null; createdAt: Date; machineId: string | null;
  request: { requesterName: string } | null;
};

export function sortQueue<T extends { status: string; priority: number; queuePosition: number; createdAt: Date }>(jobs: T[]): T[] {
  return [...jobs].sort(
    (a, b) =>
      Number(b.status === 'in_progress') - Number(a.status === 'in_progress') ||
      b.priority - a.priority ||
      a.queuePosition - b.queuePosition ||
      a.createdAt.getTime() - b.createdAt.getTime(),
  );
}

function schedule(jobs: Row[], paused: boolean, now: Date) {
  let clock = now.getTime();
  let unestimated = 0;
  let totalHours = 0;
  const queued: QueuedJob[] = sortQueue(jobs).map((job) => {
    const elapsed = job.status === 'in_progress' && job.startedAt ? (now.getTime() - job.startedAt.getTime()) / HOUR : 0;
    const remainingHours = round(Math.max(0, job.durationHours - elapsed), 2);
    if (job.durationHours <= 0) unestimated += 1;
    totalHours += remainingHours;
    const start = paused ? null : new Date(clock);
    if (!paused) clock += remainingHours * HOUR;
    return {
      id: job.id, name: job.name, status: job.status, priority: job.priority, queuePosition: job.queuePosition,
      durationHours: job.durationHours, startedAt: job.startedAt, createdAt: job.createdAt,
      remainingHours,
      estimatedStart: start,
      estimatedFinish: paused ? null : new Date(clock),
      requesterName: job.request?.requesterName ?? null,
    };
  });
  return { jobs: queued, unestimated, totalHours: round(totalHours, 2), clearsAt: paused || queued.length === 0 ? null : new Date(clock) };
}

/** Every machine's queue, plus one for open jobs with no machine yet. */
export async function buildQueues(db: Db, workspaceId: string, now = new Date()): Promise<MachineQueue[]> {
  const [machines, jobs] = await Promise.all([
    db.machine.findMany({ where: { workspaceId }, orderBy: { createdAt: 'asc' }, select: { id: true, name: true, status: true } }),
    db.job.findMany({
      where: { workspaceId, status: { in: ['planned', 'in_progress'] } },
      select: {
        id: true, name: true, status: true, priority: true, queuePosition: true, durationHours: true,
        startedAt: true, createdAt: true, machineId: true, request: { select: { requesterName: true } },
      },
    }),
  ]);
  const queues: MachineQueue[] = machines.map((machine) => {
    const paused = machine.status === 'offline' || machine.status === 'needs_service';
    return { machine, paused, ...schedule(jobs.filter((job) => job.machineId === machine.id), paused, now) };
  });
  const unassigned = jobs.filter((job) => !job.machineId);
  if (unassigned.length) queues.push({ machine: null, paused: true, ...schedule(unassigned, true, now) });
  return queues;
}

/** Where one job stands: for the requester's progress page. */
export async function estimateJob(db: Db, workspaceId: string, jobId: string) {
  const queues = await buildQueues(db, workspaceId);
  for (const queue of queues) {
    const index = queue.jobs.findIndex((job) => job.id === jobId);
    if (index === -1) continue;
    const job = queue.jobs[index];
    return { ahead: index, estimatedStart: job.estimatedStart, estimatedFinish: job.estimatedFinish, paused: queue.paused };
  }
  return null;
}
