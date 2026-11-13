import type { Router } from 'express';
import { z } from 'zod';
import { prisma } from '@/db';
import { HttpError, param, parse } from '@/http';
import { describeActivity } from '@/services/activity';
import { buildQueues } from '@/services/queue';

const orderInput = z.object({ jobIds: z.array(z.string().min(1)).min(1).max(500) });

export function registerQueueRoutes(router: Router): void {
  router.get('/queue', async (req, res) => {
    res.json(await buildQueues(prisma, req.workspaceId));
  });

  /**
   * Set the run order on one machine (`none` for jobs without a machine). Positions only break ties
   * within a priority, so dragging a normal job above an urgent one has no effect until priorities change.
   */
  router.put('/queue/:machineId', async (req, res) => {
    const { jobIds } = parse(orderInput, req.body);
    const machineParam = param(req, 'machineId');
    const machineId = machineParam === 'none' ? null : machineParam;
    const jobs = await prisma.job.findMany({
      where: { id: { in: jobIds }, workspaceId: req.workspaceId, machineId, status: { in: ['planned', 'in_progress'] } },
      select: { id: true },
    });
    if (jobs.length !== new Set(jobIds).size) throw new HttpError(409, 'The queue changed while you were ordering it. Reload and try again.');
    await prisma.$transaction(jobIds.map((id, index) => prisma.job.update({ where: { id }, data: { queuePosition: index } })));
    const machine = machineId ? await prisma.machine.findUnique({ where: { id: machineId }, select: { name: true } }) : null;
    describeActivity(`Reordered the queue for ${machine?.name ?? 'jobs without a machine'}`, { type: 'machine', id: machineId });
    res.json(await buildQueues(prisma, req.workspaceId));
  });
}
