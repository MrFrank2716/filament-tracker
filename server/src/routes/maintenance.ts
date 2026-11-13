import type { Router } from 'express';
import { z } from 'zod';
import { prisma } from '@/db';
import { HttpError, notFound, param, parse } from '@/http';
import { buildSchedule } from '@/services/maintenance';
import { assertInWorkspace, moveStock } from '@/services/stock';

const taskShape = z.object({
  name: z.string().trim().min(1, 'Give the task a name').max(160),
  description: z.string().trim().max(2000).optional(),
  machineId: z.string().nullable().optional(),
  machineTypeId: z.string().nullable().optional(),
  intervalDays: z.number().positive().nullable().optional(),
  intervalHours: z.number().positive().nullable().optional(),
  active: z.boolean().optional(),
});

const completeInput = z.object({
  machineId: z.string().min(1),
  performedAt: z.coerce.date().optional(),
  hoursAtService: z.number().min(0).optional(),
  notes: z.string().trim().max(2000).optional(),
  parts: z.array(z.object({ itemId: z.string().min(1), quantity: z.number().positive() })).max(30).optional(),
});

function assertTarget(task: { machineId?: string | null; machineTypeId?: string | null; intervalDays?: number | null; intervalHours?: number | null }) {
  if (Boolean(task.machineId) === Boolean(task.machineTypeId)) {
    throw new HttpError(400, 'Attach the task to one machine or to one machine type');
  }
  if (!task.intervalDays && !task.intervalHours) {
    throw new HttpError(400, 'Set an interval in days, in usage hours, or both');
  }
}

export function registerMaintenanceRoutes(router: Router): void {
  /** Task definitions plus the computed per-machine schedule (overdue first). */
  router.get('/maintenance', async (req, res) => {
    const [tasks, schedule] = await Promise.all([
      prisma.maintenanceTask.findMany({ where: { workspaceId: req.workspaceId }, orderBy: { name: 'asc' } }),
      buildSchedule(prisma, req.workspaceId),
    ]);
    res.json({ tasks, schedule });
  });

  router.get('/maintenance/logs', async (req, res) => {
    const machineId = typeof req.query.machineId === 'string' ? req.query.machineId : undefined;
    const taskId = typeof req.query.taskId === 'string' ? req.query.taskId : undefined;
    const logs = await prisma.maintenanceLog.findMany({
      where: { task: { workspaceId: req.workspaceId }, machineId, taskId },
      orderBy: { performedAt: 'desc' },
      take: 200,
      include: {
        task: { select: { name: true } },
        machine: { select: { name: true } },
        user: { select: { name: true } },
        parts: { include: { item: { select: { name: true } } } },
      },
    });
    res.json(logs);
  });

  router.post('/maintenance/tasks', async (req, res) => {
    const data = parse(taskShape, req.body);
    assertTarget(data);
    await assertInWorkspace(prisma, req.workspaceId, { machine: data.machineId, machineType: data.machineTypeId });
    res.status(201).json(await prisma.maintenanceTask.create({ data: { ...data, workspaceId: req.workspaceId } }));
  });

  router.patch('/maintenance/tasks/:id', async (req, res) => {
    const data = parse(taskShape.partial(), req.body);
    const id = param(req, 'id');
    const existing = await prisma.maintenanceTask.findFirst({ where: { id, workspaceId: req.workspaceId } });
    if (!existing) throw notFound('Task');
    assertTarget({ ...existing, ...data });
    await assertInWorkspace(prisma, req.workspaceId, { machine: data.machineId, machineType: data.machineTypeId });
    res.json(await prisma.maintenanceTask.update({ where: { id }, data }));
  });

  router.delete('/maintenance/tasks/:id', async (req, res) => {
    const id = param(req, 'id');
    const existing = await prisma.maintenanceTask.findFirst({ where: { id, workspaceId: req.workspaceId } });
    if (!existing) throw notFound('Task');
    await prisma.maintenanceTask.delete({ where: { id } });
    res.status(204).end();
  });

  /** Log a service. Resets both clocks for that machine and takes any parts used out of stock. */
  router.post('/maintenance/tasks/:id/complete', async (req, res) => {
    const { machineId, performedAt, hoursAtService, notes, parts = [] } = parse(completeInput, req.body);
    const id = param(req, 'id');
    const workspaceId = req.workspaceId;
    const task = await prisma.maintenanceTask.findFirst({ where: { id, workspaceId } });
    if (!task) throw notFound('Task');
    const machine = await prisma.machine.findFirst({ where: { id: machineId, workspaceId } });
    if (!machine) throw notFound('Machine');
    const covered = task.machineId ? task.machineId === machine.id : task.machineTypeId === machine.machineTypeId;
    if (!covered) throw new HttpError(400, 'That task does not apply to this machine');
    if (performedAt && performedAt.getTime() > Date.now() + 60_000) throw new HttpError(400, 'Service date cannot be in the future');

    const log = await prisma.$transaction(async (tx) => {
      const created = await tx.maintenanceLog.create({
        data: {
          taskId: id,
          machineId,
          performedAt: performedAt ?? new Date(),
          hoursAtService: hoursAtService ?? machine.usageHours,
          notes: notes ?? '',
          userId: req.userId,
        },
      });
      for (const part of parts) {
        await moveStock(tx, {
          workspaceId, itemId: part.itemId, delta: -part.quantity, reason: 'maintenance',
          note: `${task.name} on ${machine.name}`, userId: req.userId,
        });
        await tx.maintenancePart.create({ data: { logId: created.id, itemId: part.itemId, quantity: part.quantity } });
      }
      if (machine.status === 'needs_service') {
        const remaining = (await buildSchedule(tx, workspaceId)).some((e) => e.machineId === machineId && e.status === 'overdue');
        if (!remaining) await tx.machine.update({ where: { id: machineId }, data: { status: 'ready' } });
      }
      return created;
    });
    res.status(201).json(log);
  });

  router.delete('/maintenance/logs/:id', async (req, res) => {
    const id = param(req, 'id');
    const log = await prisma.maintenanceLog.findFirst({ where: { id, task: { workspaceId: req.workspaceId } } });
    if (!log) throw notFound('Log entry');
    await prisma.maintenanceLog.delete({ where: { id } });
    res.status(204).end();
  });
}
