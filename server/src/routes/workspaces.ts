import { Router } from 'express';
import { z } from 'zod';
import { prisma } from '@/db';
import { ownerOnly, requireAuth, ROLES, workspaceGuard } from '@/auth';
import { HttpError, notFound, param, parse } from '@/http';
import { broadcastChanges } from '@/realtime';
import { registerReferenceRoutes } from '@/routes/reference';
import { recordActivity } from '@/services/activity';
import { addFromReference, pickSchema } from '@/services/reference';
import { importSnapshot, snapshotSchema } from '@/services/snapshot';
import { removeWorkspaceUploads } from '@/services/uploads';
import { getTemplate, listTemplates } from '@/templates';

export const workspacesRouter = Router();
workspacesRouter.use(requireAuth);

const workspaceInput = z.object({
  name: z.string().trim().min(1, 'Give the workspace a name').max(80),
  description: z.string().trim().max(500).optional(),
  currency: z.string().trim().toUpperCase().regex(/^[A-Z]{3}$/, 'Use a 3-letter currency code such as GBP').optional(),
});

// ---- Templates -------------------------------------------------------------

workspacesRouter.get('/templates', (_req, res) => {
  res.json(listTemplates());
});

workspacesRouter.get('/templates/:id', (req, res) => {
  const template = getTemplate(param(req, 'id'));
  if (!template) throw notFound('Template');
  res.json(template);
});

// ---- Reference catalogue (read-only, no workspace needed) ------------------

registerReferenceRoutes(workspacesRouter);

// ---- Links on labels -------------------------------------------------------

/**
 * A QR label or NFC sticker carries only an item's or a location's id, so it stays short and says nothing to
 * a stranger. This tells a signed-in member which of their workspaces the id belongs to. Unknown ids and ids
 * in someone else's workspace look the same: not found.
 */
workspacesRouter.get('/resolve/:kind/:id', async (req, res) => {
  const kind = param(req, 'kind');
  const id = param(req, 'id');
  const mine = { members: { some: { userId: req.userId } } };
  if (kind === 'item') {
    const item = await prisma.item.findFirst({ where: { id, workspace: mine }, select: { workspaceId: true, archived: true, name: true } });
    if (!item) throw notFound('Item');
    res.json(item);
  } else if (kind === 'location') {
    const location = await prisma.location.findFirst({ where: { id, workspace: mine }, select: { workspaceId: true, name: true } });
    if (!location) throw notFound('Location');
    res.json({ ...location, archived: false });
  } else throw notFound();
});

// ---- Workspaces ------------------------------------------------------------

workspacesRouter.get('/workspaces', async (req, res) => {
  const memberships = await prisma.membership.findMany({
    where: { userId: req.userId },
    orderBy: { createdAt: 'asc' },
    include: { workspace: { include: { _count: { select: { items: true, machines: true, members: true } } } } },
  });
  res.json(
    memberships.map(({ role, workspace }) => ({
      id: workspace.id,
      name: workspace.name,
      description: workspace.description,
      currency: workspace.currency,
      role,
      counts: workspace._count,
    })),
  );
});

const setupInput = workspaceInput.extend({
  snapshot: z.unknown().optional(),
  /** Machines (or other catalogue entries) chosen during set-up, added after the template. */
  picks: z.array(pickSchema).max(50).optional(),
});

/** Create a workspace, optionally pre-filled from a (possibly edited) template snapshot and catalogue picks. */
workspacesRouter.post('/workspaces', async (req, res) => {
  const { snapshot: rawSnapshot, picks = [], ...rest } = parse(setupInput, req.body);
  const snapshot = rawSnapshot ? parse(snapshotSchema, rawSnapshot) : null;

  const workspace = await prisma.$transaction(
    async (tx) => {
      const created = await tx.workspace.create({
        data: { ...rest, members: { create: { userId: req.userId, role: 'owner' } } },
      });
      if (snapshot) await importSnapshot(tx, created.id, snapshot, req.userId);
      // After the template, so a machine joins the machine type the template just created.
      if (picks.length) await addFromReference(tx, created.id, { picks }, req.userId);
      return created;
    },
    { timeout: 60_000, maxWait: 10_000 },
  );
  res.status(201).json({ ...workspace, role: 'owner' });
});

/** Any member, including a viewer, may leave. Registered before the guard, which limits viewer and operator writes. */
workspacesRouter.post('/workspaces/:wid/leave', async (req, res) => {
  const workspaceId = param(req, 'wid');
  const membership = await prisma.membership.findUnique({
    where: { userId_workspaceId: { userId: req.userId, workspaceId } },
  });
  if (!membership) throw notFound('Workspace');
  if (membership.role === 'owner') {
    const owners = await prisma.membership.count({ where: { workspaceId, role: 'owner' } });
    if (owners <= 1) throw new HttpError(409, 'You are the only owner. Make someone else an owner first, or delete the workspace.');
  }
  await prisma.membership.delete({ where: { id: membership.id } });
  res.status(204).end();
});

const scoped = Router({ mergeParams: true });
workspacesRouter.use('/workspaces/:wid', workspaceGuard, broadcastChanges, recordActivity, scoped);
export const workspaceScope = scoped;

// The request-link secret has its own route (/request-link); it is left out of the plain workspace record.
const workspaceFields = { id: true, name: true, description: true, currency: true, createdAt: true } as const;

scoped.get('/', async (req, res) => {
  const workspace = await prisma.workspace.findUniqueOrThrow({ where: { id: req.workspaceId }, select: workspaceFields });
  res.json({ ...workspace, role: req.role });
});

scoped.patch('/', ownerOnly, async (req, res) => {
  const data = parse(workspaceInput.partial(), req.body);
  res.json(await prisma.workspace.update({ where: { id: req.workspaceId }, data, select: workspaceFields }));
});

scoped.delete('/', ownerOnly, async (req, res) => {
  await prisma.workspace.delete({ where: { id: req.workspaceId } });
  // Files sent with job requests live on disk, outside the database.
  await removeWorkspaceUploads(req.workspaceId);
  res.status(204).end();
});

// ---- Members ---------------------------------------------------------------

scoped.get('/members', async (req, res) => {
  const members = await prisma.membership.findMany({
    where: { workspaceId: req.workspaceId },
    orderBy: { createdAt: 'asc' },
    include: { user: { select: { id: true, name: true, email: true } } },
  });
  res.json(members.map((m) => ({ id: m.id, role: m.role, userId: m.userId, name: m.user.name, email: m.user.email })));
});

const roleSchema = z.enum(ROLES);

scoped.post('/members', ownerOnly, async (req, res) => {
  const { email, role } = parse(z.object({ email: z.string().trim().toLowerCase(), role: roleSchema }), req.body);
  const user = await prisma.user.findUnique({ where: { email } });
  if (!user) throw new HttpError(404, 'No account uses that email yet. Ask them to register first, then add them here.');
  const existing = await prisma.membership.findUnique({
    where: { userId_workspaceId: { userId: user.id, workspaceId: req.workspaceId } },
  });
  if (existing) throw new HttpError(409, 'They are already a member of this workspace');
  const member = await prisma.membership.create({ data: { userId: user.id, workspaceId: req.workspaceId, role } });
  res.status(201).json({ id: member.id, role, userId: user.id, name: user.name, email: user.email });
});

async function assertNotLastOwner(workspaceId: string, membershipId: string) {
  const target = await prisma.membership.findFirst({ where: { id: membershipId, workspaceId } });
  if (!target) throw notFound('Member');
  if (target.role === 'owner') {
    const owners = await prisma.membership.count({ where: { workspaceId, role: 'owner' } });
    if (owners <= 1) throw new HttpError(409, 'A workspace needs at least one owner');
  }
  return target;
}

scoped.patch('/members/:id', ownerOnly, async (req, res) => {
  const { role } = parse(z.object({ role: roleSchema }), req.body);
  const id = param(req, 'id');
  if (role !== 'owner') await assertNotLastOwner(req.workspaceId, id);
  else if (!(await prisma.membership.findFirst({ where: { id, workspaceId: req.workspaceId } }))) throw notFound('Member');
  const member = await prisma.membership.update({ where: { id }, data: { role } });
  res.json({ id: member.id, role: member.role });
});

scoped.delete('/members/:id', ownerOnly, async (req, res) => {
  const id = param(req, 'id');
  await assertNotLastOwner(req.workspaceId, id);
  await prisma.membership.delete({ where: { id } });
  res.status(204).end();
});
