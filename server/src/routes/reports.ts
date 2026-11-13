import type { Router } from 'express';
import { prisma } from '@/db';
import { buildDailyReport } from '@/services/dailyReport';
import { buildSchedule } from '@/services/maintenance';
import { buildReorder, isLow, isWorn } from '@/services/reorder';
import { round } from '@/services/stock';

export function registerReportRoutes(router: Router): void {
  router.get('/dashboard', async (req, res) => {
    const workspaceId = req.workspaceId;
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    const [items, machines, schedule, openJobs, recentJobs, monthJobs] = await Promise.all([
      prisma.item.findMany({
        where: { workspaceId, archived: false },
        select: {
          id: true, name: true, quantity: true, minQuantity: true, unitCost: true, wearFlag: true,
          usageHours: true, lifeHours: true, itemTypeId: true, unitId: true,
        },
      }),
      prisma.machine.findMany({ where: { workspaceId }, select: { id: true, name: true, status: true, usageHours: true } }),
      buildSchedule(prisma, workspaceId),
      prisma.job.count({ where: { workspaceId, status: { in: ['planned', 'in_progress'] } } }),
      prisma.job.findMany({
        where: { workspaceId },
        orderBy: { createdAt: 'desc' },
        take: 6,
        select: { id: true, name: true, status: true, totalCost: true, durationHours: true, createdAt: true, completedAt: true, machine: { select: { name: true } } },
      }),
      prisma.job.aggregate({
        where: { workspaceId, status: { in: ['completed', 'failed'] }, completedAt: { gte: monthStart } },
        _sum: { totalCost: true, durationHours: true },
        _count: true,
      }),
    ]);

    const lowStock = items.filter(isLow).sort((a, b) => a.quantity / a.minQuantity - b.quantity / b.minQuantity);    const worn = items.filter(isWorn);
    const wearingSoon = items.filter((i) => !isWorn(i) && i.lifeHours !== null && i.usageHours >= i.lifeHours * 0.8);

    res.json({
      counts: {
        items: items.length,
        machines: machines.length,
        openJobs,
        lowStock: lowStock.length,
        wornTools: worn.length,
        overdue: schedule.filter((e) => e.status === 'overdue').length,
        dueSoon: schedule.filter((e) => e.status === 'soon').length,
      },
      stockValue: round(items.reduce((sum, i) => sum + i.quantity * i.unitCost, 0), 2),
      month: {
        jobs: monthJobs._count,
        cost: round(monthJobs._sum.totalCost ?? 0, 2),
        hours: round(monthJobs._sum.durationHours ?? 0, 1),
      },
      lowStock: lowStock.slice(0, 8),
      wornTools: [...worn, ...wearingSoon].slice(0, 8),
      maintenance: schedule.filter((e) => e.status !== 'ok').slice(0, 8),
      machines,
      recentJobs,
    });
  });

  /** Everything that needs buying, grouped by supplier. */
  router.get('/reorder', async (req, res) => {
    res.json(await buildReorder(prisma, req.workspaceId));
  });

  /** The action plan and trends shown on the first visit of each day. */
  router.get('/daily-report', async (req, res) => {
    res.json(await buildDailyReport(prisma, req.workspaceId));
  });
}
