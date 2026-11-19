import type { Prisma } from '@prisma/client';
import { jobInclude, isOpen, presentJob } from '@/services/jobs';
import { PROJECT_STAGES } from '@/services/snapshot';
import { round } from '@/services/stock';

/**
 * A project gathers the jobs done for one piece of work, adds up what they cost and sets that against the
 * price invoiced for it. Until a price is set, it recommends one from the cost and a target margin.
 */

export { PROJECT_STAGES };
export type ProjectStage = (typeof PROJECT_STAGES)[number];

/** A margin is profit as a share of the price, so 100% can never be reached. */
export const MAX_MARGIN = 95;

export const projectInclude = { jobs: { orderBy: { createdAt: 'asc' }, include: jobInclude } } satisfies Prisma.ProjectInclude;
export type ProjectRow = Prisma.ProjectGetPayload<{ include: typeof projectInclude }>;

/** The price that leaves `marginPercent` of itself as profit once `cost` is paid. */
export function recommendedPrice(cost: number, marginPercent: number): number {
  const margin = Math.min(Math.max(marginPercent, 0), MAX_MARGIN);
  return round(cost / (1 - margin / 100), 2);
}

export interface ProjectTotals {
  /** What the project's jobs cost. Includes the estimate of any job still open. */
  cost: number;
  /** True while a job is still open, so the cost can still move. */
  estimated: boolean;
  /** The target margin in use: the project's own, or the workspace's. */
  marginPercent: number;
  recommendedPrice: number;
  price: number | null;
  /** Price less cost. Null until a price is set. */
  profit: number | null;
  /** Profit as a percentage of the price. Null without a price, or with a price of zero. */
  profitMargin: number | null;
}

export function projectTotals(
  project: { price: number | null; marginPercent: number | null },
  jobs: Array<{ status: string; totalCost: number }>,
  workspaceMargin: number,
): ProjectTotals {
  const cost = round(jobs.reduce((sum, job) => sum + job.totalCost, 0), 2);
  const marginPercent = project.marginPercent ?? workspaceMargin;
  const profit = project.price === null ? null : round(project.price - cost, 2);
  return {
    cost,
    estimated: jobs.some((job) => isOpen(job.status)),
    marginPercent,
    recommendedPrice: recommendedPrice(cost, marginPercent),
    price: project.price,
    profit,
    profitMargin: profit !== null && project.price ? round((profit / project.price) * 100, 1) : null,
  };
}

export function presentProject({ jobs, ...project }: ProjectRow, workspaceMargin: number) {
  const costed = jobs.map(presentJob);
  return {
    ...project,
    jobs: costed.map((job) => ({
      id: job.id,
      name: job.name,
      status: job.status,
      totalCost: job.totalCost,
      completedAt: job.completedAt,
      machine: job.machine ? { id: job.machine.id, name: job.machine.name } : null,
    })),
    totals: projectTotals(project, costed, workspaceMargin),
  };
}
