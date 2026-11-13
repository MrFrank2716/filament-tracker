import type { Router } from 'express';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma, type Db } from '@/db';
import { HttpError, notFound, param, parse } from '@/http';
import { followJob } from '@/services/requestStatus';
import { assertInWorkspace, moveStock, round } from '@/services/stock';

/** New jobs, and jobs moved to another machine, join the end of that machine's queue. */
export async function endOfQueue(db: Db, workspaceId: string, machineId: string | null | undefined): Promise<number> {
  const last = await db.job.aggregate({ where: { workspaceId, machineId: machineId ?? null, status: { in: ['planned', 'in_progress'] } }, _max: { queuePosition: true } });
  return (last._max.queuePosition ?? -1) + 1;
}

const usageInput = z.object({
  itemId: z.string().min(1),
  quantity: z.number().min(0).optional(),
  hours: z.number().min(0).optional(),
});

const jobInput = z.object({
  name: z.string().trim().min(1, 'Give the job a name').max(160),
  machineId: z.string().nullable().optional(),
  durationHours: z.number().min(0).max(10_000).optional(),
  notes: z.string().max(5000).optional(),
  extraCost: z.number().min(0).optional(),
  /** -1 low, 0 normal, 1 high, 2 urgent. */
  priority: z.number().int().min(-1).max(2).optional(),
  usages: z.array(usageInput).max(60).optional(),
});

const finishInput = z.object({ outcome: z.enum(['completed', 'failed']).optional() });

const jobInclude = {
  machine: { select: { id: true, name: true, hourlyCost: true } },
  createdBy: { select: { name: true } },
  // Jobs approved from an outside request carry the requester and their files.
  request: { select: { id: true, requesterName: true, requesterEmail: true, files: { orderBy: { createdAt: 'asc' }, select: { id: true, name: true, size: true } } } },
  usages: { include: { item: { select: { id: true, name: true, unitCost: true, lifeHours: true, quantity: true, unitId: true, itemTypeId: true } } } },
} satisfies Prisma.JobInclude;
type JobRow = Prisma.JobGetPayload<{ include: typeof jobInclude }>;

interface CostLine {
  quantity: number;
  hours: number;
  item: { unitCost: number; lifeHours: number | null };
}

/** Material is charged by quantity; tooling is amortised over its expected life. */
function lineCost({ quantity, hours, item }: CostLine) {
  const material = quantity * item.unitCost;
  const tooling = item.lifeHours && hours > 0 ? (hours / item.lifeHours) * item.unitCost : 0;
  return { material, tooling };
}

function costJob(job: { durationHours: number; extraCost: number; machine: { hourlyCost: number } | null; usages: CostLine[] }) {
  let materialCost = 0;
  let toolingCost = 0;
  for (const usage of job.usages) {
    const { material, tooling } = lineCost(usage);
    materialCost += material;
    toolingCost += tooling;
  }
  const machineCost = job.durationHours * (job.machine?.hourlyCost ?? 0);
  return {
    materialCost: round(materialCost, 2),
    toolingCost: round(toolingCost, 2),
    machineCost: round(machineCost, 2),
    totalCost: round(materialCost + toolingCost + machineCost + job.extraCost, 2),
  };
}

const isOpen = (status: string) => status === 'planned' || status === 'in_progress';

/** Finished jobs keep the costs snapshotted at completion; open jobs show a live estimate. */
const present = (job: JobRow) => (isOpen(job.status) ? { ...job, ...costJob(job) } : job);

const mergeUsages = (usages: z.output<typeof usageInput>[]) => {
  const merged = new Map<string, { itemId: string; quantity: number; hours: number }>();
  for (const usage of usages) {
    const line = merged.get(usage.itemId) ?? { itemId: usage.itemId, quantity: 0, hours: 0 };
    line.quantity += usage.quantity ?? 0;
    line.hours += usage.hours ?? 0;
    merged.set(usage.itemId, line);
  }
  return [...merged.values()];
};

export function registerJobRoutes(router: Router): void {
  router.get('/jobs', async (req, res) => {
    const jobs = await prisma.job.findMany({
      where: { workspaceId: req.workspaceId },
      orderBy: { createdAt: 'desc' },
      take: 300,
      include: jobInclude,
    });
    res.json(jobs.map(present));
  });

  router.post('/jobs', async (req, res) => {
    const { usages = [], ...data } = parse(jobInput, req.body);
    const lines = mergeUsages(usages);
    await assertInWorkspace(prisma, req.workspaceId, { machine: data.machineId, item: lines.map((l) => l.itemId) });
    const job = await prisma.job.create({
      data: {
        ...data,
        workspaceId: req.workspaceId,
        createdById: req.userId,
        queuePosition: await endOfQueue(prisma, req.workspaceId, data.machineId),
        usages: { create: lines },
      },
      include: jobInclude,
    });
    res.status(201).json(present(job));
  });

  router.patch('/jobs/:id', async (req, res) => {
    const { usages, ...data } = parse(jobInput.partial(), req.body);
    const id = param(req, 'id');
    const existing = await prisma.job.findFirst({ where: { id, workspaceId: req.workspaceId } });
    if (!existing) throw notFound('Job');
    if (!isOpen(existing.status)) {
      throw new HttpError(409, 'Finished jobs are locked because stock and tool life were already updated from them');
    }
    const lines = usages ? mergeUsages(usages) : undefined;
    await assertInWorkspace(prisma, req.workspaceId, { machine: data.machineId, item: lines?.map((l) => l.itemId) });
    const job = await prisma.job.update({
      where: { id },
      data: {
        ...data,
        ...(data.machineId !== undefined && data.machineId !== existing.machineId ? { queuePosition: await endOfQueue(prisma, req.workspaceId, data.machineId) } : {}),
        ...(lines ? { usages: { deleteMany: {}, create: lines } } : {}),
      },
      include: jobInclude,
    });
    res.json(present(job));
  });

  router.post('/jobs/:id/start', async (req, res) => {
    const id = param(req, 'id');
    const existing = await prisma.job.findFirst({ where: { id, workspaceId: req.workspaceId } });
    if (!existing) throw notFound('Job');
    if (existing.status !== 'planned') throw new HttpError(409, 'Only planned jobs can be started');
    const [job] = await prisma.$transaction([
      prisma.job.update({ where: { id }, data: { status: 'in_progress', startedAt: new Date() }, include: jobInclude }),
      ...(existing.machineId
        ? [prisma.machine.updateMany({ where: { id: existing.machineId, status: 'ready' }, data: { status: 'in_use' } })]
        : []),
    ]);
    await followJob(id, 'in_progress');
    res.json(present(job));
  });

  /**
   * Finish a job. Whether it succeeded or failed, the material is gone and the tooling is worn,
   * so both outcomes take stock, add tool hours and machine hours, and snapshot the cost.
   */
  router.post('/jobs/:id/finish', async (req, res) => {
    const { outcome = 'completed' } = parse(finishInput, req.body ?? {});
    const id = param(req, 'id');
    const workspaceId = req.workspaceId;

    const job = await prisma.$transaction(
      async (tx) => {
        const current = await tx.job.findFirst({ where: { id, workspaceId }, include: jobInclude });
        if (!current) throw notFound('Job');
        if (!isOpen(current.status)) throw new HttpError(409, 'This job is already finished');

        // Flip the status first, conditionally, so two people finishing at once cannot both take stock.
        const claimed = await tx.job.updateMany({
          where: { id, status: current.status },
          data: { status: outcome, completedAt: new Date(), ...costJob(current) },
        });
        if (claimed.count !== 1) throw new HttpError(409, 'This job is already finished');

        for (const usage of current.usages) {
          const { material, tooling } = lineCost(usage);
          await tx.jobUsage.update({ where: { id: usage.id }, data: { cost: round(material + tooling, 2) } });
          if (usage.quantity > 0) {
            await moveStock(tx, {
              workspaceId, itemId: usage.itemId, delta: -usage.quantity, reason: 'job',
              note: current.name, jobId: id, userId: req.userId,
            });
          }
          if (usage.hours > 0) {
            const item = await tx.item.update({ where: { id: usage.itemId }, data: { usageHours: { increment: usage.hours } } });
            if (item.lifeHours && item.usageHours >= item.lifeHours && !item.wearFlag) {
              await tx.item.update({ where: { id: item.id }, data: { wearFlag: true } });
            }
          }
        }

        if (current.machineId) {
          await tx.machine.update({ where: { id: current.machineId }, data: { usageHours: { increment: current.durationHours } } });
          await tx.machine.updateMany({ where: { id: current.machineId, status: 'in_use' }, data: { status: 'ready' } });
        }
        return tx.job.findUniqueOrThrow({ where: { id }, include: jobInclude });
      },
      { timeout: 30_000 },
    );
    // A failed run is not the requester's job done: it stays where it is until someone reruns it or sets it by hand.
    if (outcome === 'completed') await followJob(id, 'done');
    res.json(present(job));
  });

  router.post('/jobs/:id/cancel', async (req, res) => {
    const id = param(req, 'id');
    const existing = await prisma.job.findFirst({ where: { id, workspaceId: req.workspaceId } });
    if (!existing) throw notFound('Job');
    if (!isOpen(existing.status)) throw new HttpError(409, 'This job is already finished');
    const [job] = await prisma.$transaction([
      prisma.job.update({ where: { id }, data: { status: 'cancelled', completedAt: new Date() }, include: jobInclude }),
      ...(existing.machineId && existing.status === 'in_progress'
        ? [prisma.machine.updateMany({ where: { id: existing.machineId, status: 'in_use' }, data: { status: 'ready' } })]
        : []),
    ]);
    res.json(present(job));
  });

  /** Removes the record only. Stock already taken by a finished job stays taken (the movements remain in each item's history). */
  router.delete('/jobs/:id', async (req, res) => {
    const id = param(req, 'id');
    const existing = await prisma.job.findFirst({ where: { id, workspaceId: req.workspaceId } });
    if (!existing) throw notFound('Job');
    await prisma.job.delete({ where: { id } });
    res.status(204).end();
  });
}
