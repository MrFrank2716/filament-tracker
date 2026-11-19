import type { Router } from 'express';
import { z } from 'zod';
import { prisma } from '@/db';
import { HttpError, notFound, param, parse } from '@/http';
import { describeActivity } from '@/services/activity';
import { jobInclude, presentJob } from '@/services/jobs';
import { MAX_MARGIN, PROJECT_STAGES, presentProject, projectInclude } from '@/services/projects';
import { assertInWorkspace } from '@/services/stock';

const projectInput = z.object({
  name: z.string().trim().min(1, 'Give the project a name').max(160),
  customer: z.string().trim().max(160).optional(),
  notes: z.string().max(5000).optional(),
});

/** The money side of a project. Kept on its own route so that it stays with admins. */
const pricingInput = z.object({
  price: z.number().min(0).max(1_000_000_000).nullable().optional(),
  marginPercent: z.number().min(0).max(MAX_MARGIN, `A margin can be at most ${MAX_MARGIN}%`).nullable().optional(),
  stage: z.enum(PROJECT_STAGES).optional(),
});

const assignInput = z.object({ projectId: z.string().min(1).nullable() });

const targetMargin = async (workspaceId: string) =>
  (await prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { targetMargin: true } })).targetMargin;

export function registerProjectRoutes(router: Router): void {
  const present = async (workspaceId: string, id: string) =>
    presentProject(await prisma.project.findUniqueOrThrow({ where: { id }, include: projectInclude }), await targetMargin(workspaceId));

  const find = async (workspaceId: string, id: string) => {
    const project = await prisma.project.findFirst({ where: { id, workspaceId } });
    if (!project) throw notFound('Project');
    return project;
  };

  router.get('/projects', async (req, res) => {
    const [projects, margin] = await Promise.all([
      prisma.project.findMany({ where: { workspaceId: req.workspaceId }, orderBy: { createdAt: 'desc' }, take: 300, include: projectInclude }),
      targetMargin(req.workspaceId),
    ]);
    res.json(projects.map((project) => presentProject(project, margin)));
  });

  router.post('/projects', async (req, res) => {
    const data = parse(projectInput, req.body);
    const project = await prisma.project.create({ data: { ...data, workspaceId: req.workspaceId } });
    res.status(201).json(await present(req.workspaceId, project.id));
  });

  router.patch('/projects/:id', async (req, res) => {
    const data = parse(projectInput.partial(), req.body);
    const { id } = await find(req.workspaceId, param(req, 'id'));
    await prisma.project.update({ where: { id }, data });
    res.json(await present(req.workspaceId, id));
  });

  /** Price, target margin and stage. Not in OPERATOR_WRITES, so only admins and owners reach it. */
  router.put('/projects/:id/pricing', async (req, res) => {
    const data = parse(pricingInput, req.body);
    const existing = await find(req.workspaceId, param(req, 'id'));
    const price = data.price === undefined ? existing.price : data.price;
    const stage = data.stage ?? existing.stage;
    if (stage !== 'open' && price === null) throw new HttpError(400, 'Set the invoiced price before marking a project invoiced or paid');
    await prisma.project.update({ where: { id: existing.id }, data });
    describeActivity(
      data.stage && data.stage !== existing.stage ? `Marked project ${existing.name} ${data.stage}` : `Changed the pricing of project ${existing.name}`,
      { type: 'project', id: existing.id },
    );
    res.json(await present(req.workspaceId, existing.id));
  });

  /** The jobs stay, with no project. */
  router.delete('/projects/:id', async (req, res) => {
    const { id } = await find(req.workspaceId, param(req, 'id'));
    await prisma.project.delete({ where: { id } });
    res.status(204).end();
  });

  /**
   * Put a job in a project, or take it out with null. Its own route because a finished job is otherwise
   * locked (PATCH /jobs/:id), and which project it belongs to changes nothing about stock.
   */
  router.put('/jobs/:id/project', async (req, res) => {
    const { projectId } = parse(assignInput, req.body);
    const id = param(req, 'id');
    const existing = await prisma.job.findFirst({ where: { id, workspaceId: req.workspaceId }, include: { project: { select: { name: true } } } });
    if (!existing) throw notFound('Job');
    await assertInWorkspace(prisma, req.workspaceId, { project: projectId });
    const job = await prisma.job.update({ where: { id }, data: { projectId }, include: jobInclude });
    describeActivity(
      job.project ? `Added job ${job.name} to project ${job.project.name}` : `Took job ${job.name} out of project ${existing.project?.name ?? ''}`.trim(),
      { type: 'job', id },
    );
    res.json(presentJob(job));
  });
}
