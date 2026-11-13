import type { Router } from 'express';
import { z } from 'zod';
import { prisma } from '@/db';
import { param, parse } from '@/http';
import { UNDOABLE, undoActivity } from '@/services/activity';

const listQuery = z.object({
  /** Only entries about this record, e.g. one item's history. */
  entityId: z.string().max(64).optional(),
  userId: z.string().max(64).optional(),
  /** Entries older than this id's entry: the next page. */
  before: z.string().max(64).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
});

export function registerActivityRoutes(router: Router): void {
  router.get('/activity', async (req, res) => {
    const { entityId, userId, before, limit } = parse(listQuery, req.query);
    const cursor = before ? await prisma.activityLog.findFirst({ where: { id: before, workspaceId: req.workspaceId }, select: { createdAt: true } }) : null;
    const entries = await prisma.activityLog.findMany({
      where: {
        workspaceId: req.workspaceId,
        ...(entityId ? { entityId } : {}),
        ...(userId ? { userId } : {}),
        ...(cursor ? { createdAt: { lt: cursor.createdAt } } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    const canUndo = req.role === 'admin' || req.role === 'owner';
    res.json(
      entries.map(({ movementIds, ...entry }) => ({
        ...entry,
        undoable: canUndo && !entry.undoneAt && UNDOABLE.has(entry.action) && Array.isArray(movementIds) && movementIds.length > 0,
      })),
    );
  });

  /** Admins and owners only (the workspace guard does not list it for operators). */
  router.post('/activity/:id/undo', async (req, res) => {
    const id = param(req, 'id');
    const entry = await prisma.$transaction((tx) => undoActivity(tx, req.workspaceId, id, req.userId), { timeout: 30_000 });
    const user = await prisma.user.findUnique({ where: { id: req.userId }, select: { name: true } });
    await prisma.activityLog.create({
      data: {
        workspaceId: req.workspaceId,
        userId: req.userId,
        userName: user?.name ?? '',
        action: 'activity.undo',
        entityType: entry.entityType,
        entityId: entry.entityId,
        summary: `Undid: ${entry.summary}`.slice(0, 500),
        movementIds: [],
      },
    });
    res.status(204).end();
  });
}
