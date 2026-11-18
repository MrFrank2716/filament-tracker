import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { prisma } from '@/db';
import { finishJob } from '@/services/jobs';
import { projectTotals, recommendedPrice } from '@/services/projects';
import { exportSnapshot, importSnapshot } from '@/services/snapshot';
import { member, startApp } from './http';

let app: Awaited<ReturnType<typeof startApp>>;
let viewer: string;
let operator: string;
let admin: string;
let workspaceId: string;
let otherWorkspaceId: string;
let finishedId: string;
let openId: string;
const ws = (path: string) => `/workspaces/${workspaceId}${path}`;

type Body = Record<string, any>;
const create = async (name: string) => ((await app.call('POST', ws('/projects'), operator, { name })).body as Body).id as string;
const read = async (id: string) => ((await app.call('GET', ws('/projects'), viewer)).body as unknown as Body[]).find((p) => p.id === id) as Body;

beforeAll(async () => {
  app = await startApp();
  workspaceId = (await prisma.workspace.create({ data: { name: 'Shop' } })).id;
  otherWorkspaceId = (await prisma.workspace.create({ data: { name: 'Next door' } })).id;
  viewer = await member('viewer@example.test', workspaceId, 'viewer');
  operator = await member('operator@example.test', workspaceId, 'operator');
  admin = await member('admin@example.test', workspaceId, 'admin');
  const typeId = (await prisma.itemType.create({ data: { workspaceId, name: 'Filament' } })).id;
  const itemId = (await prisma.item.create({ data: { workspaceId, itemTypeId: typeId, name: 'PLA Black', quantity: 1000, unitCost: 0.02, fields: {} } })).id;
  const machineId = (await prisma.machine.create({ data: { workspaceId, name: 'Printer', hourlyCost: 0.5 } })).id;
  // Finished: 200 g at 0.02 + 4 h at 0.50 + 4 extra = 10.00
  finishedId = (await prisma.job.create({ data: { workspaceId, machineId, name: 'Panels', durationHours: 4, extraCost: 4, usages: { create: { itemId, quantity: 200 } } } })).id;
  await finishJob(workspaceId, finishedId, { userId: null });
  // Still planned: 100 g + 2 h = 3.00, estimated
  openId = (await prisma.job.create({ data: { workspaceId, machineId, name: 'Lid', durationHours: 2, usages: { create: { itemId, quantity: 100 } } } })).id;
});
afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe('working out a project', () => {
  it('recommends the price that leaves the target margin', () => {
    expect(recommendedPrice(60, 40)).toBe(100);
    expect(recommendedPrice(60, 0)).toBe(60);
    expect(recommendedPrice(0, 40)).toBe(0);
    expect(recommendedPrice(10, 500)).toBe(200); // held at 95%
  });

  it('shows a recommended price until a price is set, then the profit', () => {
    const jobs = [{ status: 'completed', totalCost: 40 }, { status: 'failed', totalCost: 20 }];
    expect(projectTotals({ price: null, marginPercent: null }, jobs, 40)).toEqual({
      cost: 60, estimated: false, marginPercent: 40, recommendedPrice: 100, price: null, profit: null, profitMargin: null,
    });
    expect(projectTotals({ price: 80, marginPercent: 25 }, jobs, 40)).toMatchObject({ marginPercent: 25, recommendedPrice: 80, price: 80, profit: 20, profitMargin: 25 });
  });

  it('shows a loss, and copes with a price of nothing', () => {
    const jobs = [{ status: 'planned', totalCost: 50 }];
    expect(projectTotals({ price: 30, marginPercent: null }, jobs, 40)).toMatchObject({ estimated: true, profit: -20, profitMargin: -66.7 });
    expect(projectTotals({ price: 0, marginPercent: null }, jobs, 40)).toMatchObject({ profit: -50, profitMargin: null });
  });
});

describe('projects over the API', () => {
  let projectId: string;

  it('lets an operator make and rename a project, but not a viewer', async () => {
    expect((await app.call('POST', ws('/projects'), viewer, { name: 'Enclosure' })).status).toBe(403);
    const made = await app.call('POST', ws('/projects'), operator, { name: 'Enclosure', customer: 'Riverside Makers' });
    expect(made.status).toBe(201);
    expect(made.body).toMatchObject({ name: 'Enclosure', customer: 'Riverside Makers', stage: 'open', price: null, jobs: [] });
    projectId = (made.body as Body).id;
    expect((await app.call('PATCH', ws(`/projects/${projectId}`), operator, { name: 'Printer enclosure' })).body).toMatchObject({ name: 'Printer enclosure', customer: 'Riverside Makers' });
    expect((await app.call('POST', ws('/projects'), operator, { name: ' ' })).status).toBe(400);
  });

  it('adds up finished and open jobs, including a finished job that is otherwise locked', async () => {
    expect((await app.call('PUT', ws(`/jobs/${finishedId}/project`), viewer, { projectId })).status).toBe(403);
    const assigned = await app.call('PUT', ws(`/jobs/${finishedId}/project`), operator, { projectId });
    expect(assigned).toMatchObject({ status: 200, body: { status: 'completed', project: { id: projectId, name: 'Printer enclosure' } } });
    expect((await read(projectId)).totals).toMatchObject({ cost: 10, estimated: false, marginPercent: 40, recommendedPrice: 16.67, price: null, profit: null });

    // An open job can also be put in a project by editing it.
    expect((await app.call('PATCH', ws(`/jobs/${openId}`), operator, { projectId })).status).toBe(200);
    const project = await read(projectId);
    expect(project.jobs.map((job: Body) => [job.name, job.totalCost])).toEqual([['Panels', 10], ['Lid', 3]]);
    expect(project.totals).toMatchObject({ cost: 13, estimated: true, recommendedPrice: 21.67 });
  });

  it('keeps price, margin and stage for admins', async () => {
    const pricing = ws(`/projects/${projectId}/pricing`);
    expect((await app.call('PUT', pricing, operator, { price: 30 })).status).toBe(403);
    // PATCH is open to operators, so it must not take the money fields.
    expect((await app.call('PATCH', ws(`/projects/${projectId}`), operator, { price: 30, stage: 'paid' })).body).toMatchObject({ price: null, stage: 'open' });

    expect((await app.call('PUT', pricing, admin, { marginPercent: 50 })).body).toMatchObject({ totals: { marginPercent: 50, recommendedPrice: 26 } });
    expect((await app.call('PUT', pricing, admin, { marginPercent: 96 })).status).toBe(400);
    expect((await app.call('PUT', pricing, admin, { stage: 'invoiced' })).status).toBe(400);
    expect((await app.call('PUT', pricing, admin, { price: 30, stage: 'invoiced' })).body).toMatchObject({
      stage: 'invoiced', price: 30, totals: { cost: 13, price: 30, profit: 17, profitMargin: 56.7 },
    });
    expect((await app.call('PUT', pricing, admin, { price: null })).status).toBe(400);
    expect((await app.call('PUT', pricing, admin, { price: null, stage: 'open' })).body).toMatchObject({ stage: 'open', price: null });
  });

  it('uses the workspace target margin when the project has none', async () => {
    await prisma.workspace.update({ where: { id: workspaceId }, data: { targetMargin: 20 } });
    const id = await create('Spare parts');
    await app.call('PUT', ws(`/jobs/${finishedId}/project`), operator, { projectId: id });
    expect((await read(id)).totals).toMatchObject({ cost: 10, marginPercent: 20, recommendedPrice: 12.5 });
    expect((await read(projectId)).totals).toMatchObject({ cost: 3, marginPercent: 50 });
    await app.call('PUT', ws(`/jobs/${finishedId}/project`), operator, { projectId });
  });

  it('refuses a project from another workspace', async () => {
    const foreign = await prisma.project.create({ data: { workspaceId: otherWorkspaceId, name: 'Theirs' } });
    expect((await app.call('PUT', ws(`/jobs/${finishedId}/project`), operator, { projectId: foreign.id })).status).toBe(400);
    expect((await app.call('POST', ws('/jobs'), operator, { name: 'Sneaky', projectId: foreign.id })).status).toBe(400);
    expect((await app.call('PATCH', ws(`/projects/${foreign.id}`), admin, { name: 'Mine now' })).status).toBe(404);
    expect((await app.call('DELETE', ws(`/projects/${foreign.id}`), admin)).status).toBe(404);
  });

  it('keeps projects through an export and import', async () => {
    await app.call('PUT', ws(`/projects/${projectId}/pricing`), admin, { price: 30, stage: 'paid' });
    const snapshot = await exportSnapshot(prisma, workspaceId);
    const summary = await importSnapshot(prisma, otherWorkspaceId, snapshot, null);
    expect(summary.projects).toBe(2);
    const copy = await prisma.project.findFirstOrThrow({ where: { workspaceId: otherWorkspaceId, name: 'Printer enclosure' }, include: { jobs: true } });
    expect(copy).toMatchObject({ customer: 'Riverside Makers', stage: 'paid', price: 30, marginPercent: 50 });
    expect(copy.jobs.map((job) => job.name).sort()).toEqual(['Lid', 'Panels']);
  });

  it('takes a job out, and deleting a project leaves its jobs', async () => {
    expect((await app.call('PUT', ws(`/jobs/${openId}/project`), operator, { projectId: null })).body).toMatchObject({ project: null });
    expect((await app.call('DELETE', ws(`/projects/${projectId}`), operator)).status).toBe(403);
    expect((await app.call('DELETE', ws(`/projects/${projectId}`), admin)).status).toBe(204);
    expect(await prisma.job.findUniqueOrThrow({ where: { id: finishedId } })).toMatchObject({ projectId: null, status: 'completed', totalCost: 10 });
  });
});
