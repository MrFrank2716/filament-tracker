import { Router, type RequestHandler } from 'express';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { ownerOnly } from '@/auth';
import { prisma } from '@/db';
import { HttpError, notFound, param, parse } from '@/http';
import { rateLimit } from '@/rateLimit';
import { notifyWorkspace } from '@/realtime';
import { endOfQueue } from '@/services/jobs';
import { describeActivity } from '@/services/activity';
import { estimateJob } from '@/services/queue';
import { canMoveTo, emailComment, emailStatus } from '@/services/requestStatus';
import { assertInWorkspace } from '@/services/stock';
import { assertWorkspaceRoom, cleanFileName, newToken, receiveFiles, removeStored, requireDiskRoom, storedPath, uploadedFiles, uploadLimits } from '@/services/uploads';

/**
 * Outside job requests.
 *
 * Someone without an account opens the workspace's request link, describes the job and attaches files.
 * The request waits in a queue until an admin has checked the files and approves it (creating a planned job),
 * asks for changes (the requester can send new files), or rejects it. Once approved it follows its job:
 * in progress when the job starts, done when it completes. Both sides can comment. The requester follows
 * everything on a progress link and is emailed when the status changes or a member comments.
 */

const OPEN = ['pending', 'changes_requested'];
/** A full queue stops accepting, so a leaked link cannot fill the disk. */
const MAX_OPEN_REQUESTS = 200;
/** Across the original submission and any resubmissions. */
const MAX_FILES_PER_REQUEST = uploadLimits.maxFiles * 3;

const text = (max: number) => z.string().trim().max(max);

const submissionInput = z.object({
  requesterName: text(80).min(1, 'Tell us your name'),
  requesterEmail: z.email('Enter a valid email address').max(200),
  title: text(160).min(1, 'Give the job a short title'),
  details: text(5000).optional(),
  machineId: z.string().max(64).optional(),
});

const resubmitInput = z.object({ message: text(2000).optional() });

const commentInput = z.object({ body: text(2000).min(1, 'Write a message first') });

const statusInput = z.object({ status: z.enum(['in_progress', 'done']) });

const commentSelect = { id: true, authorName: true, fromRequester: true, body: true, createdAt: true } as const;

/** A leaked progress link cannot fill the database with messages. */
const MAX_COMMENTS_PER_REQUEST = 200;

const reviewInput = z.object({
  decision: z.enum(['approve', 'changes', 'reject']),
  note: text(2000).optional(),
  machineId: z.string().nullable().optional(),
  durationHours: z.number().min(0).max(10_000).optional(),
});

// ---- Public: no account needed -------------------------------------------------

const submitLimit = rateLimit(20, 60 * 60 * 1000);

/** Resolves the public link to its workspace before any bytes are accepted. */
const viaRequestLink: RequestHandler = async (req, _res, next) => {
  const workspace = await prisma.workspace.findUnique({ where: { requestToken: param(req, 'token') }, select: { id: true } });
  if (!workspace) throw new HttpError(404, 'This request link is not active. Ask the workshop for a current one.');
  req.workspaceId = workspace.id;
  next();
};

/** Resolves a progress link to its request, and only lets files in while changes are being asked for. */
const viaTrackLink: RequestHandler = async (req, _res, next) => {
  const request = await prisma.jobRequest.findUnique({ where: { trackToken: param(req, 'token') }, select: { workspaceId: true, status: true } });
  if (!request) throw notFound('Request');
  if (request.status !== 'changes_requested') throw new HttpError(409, 'This request is not waiting for changes');
  req.workspaceId = request.workspaceId;
  next();
};

const fileRows = (req: Parameters<RequestHandler>[0]) =>
  uploadedFiles(req).map((file) => ({ name: cleanFileName(file.originalname), storedName: file.filename, size: file.size }));

const incomingBytes = (files: Array<{ size: number }>) => files.reduce((sum, file) => sum + file.size, 0);

/** If anything fails after the files were written, do not leave them behind. */
async function discardOnFailure<T>(req: Parameters<RequestHandler>[0], work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    await removeStored(req.workspaceId, uploadedFiles(req).map((file) => file.filename));
    throw error;
  }
}

export const publicRequestsRouter = Router();

publicRequestsRouter.get('/requests/:token', viaRequestLink, async (req, res) => {
  const workspace = await prisma.workspace.findUniqueOrThrow({
    where: { id: req.workspaceId },
    select: {
      name: true,
      machines: { where: { status: { not: 'offline' } }, orderBy: { createdAt: 'asc' }, select: { id: true, name: true, machineType: { select: { name: true } } } },
    },
  });
  res.json({
    workspaceName: workspace.name,
    machines: workspace.machines.map((machine) => ({ id: machine.id, name: machine.name, type: machine.machineType?.name ?? '' })),
    limits: uploadLimits,
  });
});

publicRequestsRouter.post('/requests/:token', submitLimit, viaRequestLink, requireDiskRoom, receiveFiles, async (req, res) => {
  const trackToken = await discardOnFailure(req, async () => {
    const data = parse(submissionInput, req.body ?? {});
    const files = fileRows(req);
    if (files.length === 0) throw new HttpError(400, 'Attach at least one file to be checked');

    const waiting = await prisma.jobRequest.count({ where: { workspaceId: req.workspaceId, status: { in: OPEN } } });
    if (waiting >= MAX_OPEN_REQUESTS) throw new HttpError(503, 'The queue is full at the moment. Please try again later.');
    await assertWorkspaceRoom(req.workspaceId, incomingBytes(files));

    const machineId = data.machineId || null;
    if (machineId && !(await prisma.machine.findFirst({ where: { id: machineId, workspaceId: req.workspaceId }, select: { id: true } }))) {
      throw new HttpError(400, 'That machine is no longer available. Reload the page and choose again.');
    }

    const request = await prisma.jobRequest.create({
      data: {
        workspaceId: req.workspaceId,
        machineId,
        title: data.title,
        details: data.details ?? '',
        requesterName: data.requesterName,
        requesterEmail: data.requesterEmail.toLowerCase(),
        trackToken: newToken(),
        files: { create: files },
      },
    });
    return request.trackToken;
  });
  notifyWorkspace(req.workspaceId);
  res.status(201).json({ trackToken });
});

publicRequestsRouter.get('/track/:token', async (req, res) => {
  const request = await prisma.jobRequest.findUnique({
    where: { trackToken: param(req, 'token') },
    include: {
      files: { orderBy: { createdAt: 'asc' }, select: { name: true, size: true } },
      machine: { select: { name: true } },
      workspace: { select: { name: true } },
      job: { select: { id: true, status: true } },
      comments: { orderBy: { createdAt: 'asc' }, select: commentSelect },
    },
  });
  if (!request) throw notFound('Request');
  const jobOpen = request.job && (request.job.status === 'planned' || request.job.status === 'in_progress');
  const estimate = jobOpen ? await estimateJob(prisma, request.workspaceId, request.job!.id) : null;
  const ahead =
    request.status === 'pending'
      ? await prisma.jobRequest.count({ where: { workspaceId: request.workspaceId, status: 'pending', createdAt: { lt: request.createdAt } } })
      : 0;
  res.json({
    workspaceName: request.workspace.name,
    title: request.title,
    details: request.details,
    requesterName: request.requesterName,
    status: request.status,
    reviewNote: request.reviewNote,
    createdAt: request.createdAt,
    reviewedAt: request.reviewedAt,
    machineName: request.machine?.name ?? null,
    jobStatus: request.job?.status ?? null,
    ahead,
    estimate,
    comments: request.comments,
    files: request.files,
    limits: uploadLimits,
  });
});

/** The requester writes back, whatever the status. */
publicRequestsRouter.post('/track/:token/comments', submitLimit, async (req, res) => {
  const { body } = parse(commentInput, req.body ?? {});
  const request = await prisma.jobRequest.findUnique({ where: { trackToken: param(req, 'token') }, include: { _count: { select: { comments: true } } } });
  if (!request) throw notFound('Request');
  if (request._count.comments >= MAX_COMMENTS_PER_REQUEST) throw new HttpError(409, 'This request has too many messages. Contact the workshop directly.');
  const comment = await prisma.jobRequestComment.create({
    data: { requestId: request.id, authorName: request.requesterName, fromRequester: true, body },
    select: commentSelect,
  });
  notifyWorkspace(request.workspaceId);
  res.status(201).json(comment);
});

/** Answering "changes requested": new files and an optional message put the request back in the queue. */
publicRequestsRouter.post('/track/:token/resubmit', submitLimit, viaTrackLink, requireDiskRoom, receiveFiles, async (req, res) => {
  const trackToken = param(req, 'token');
  await discardOnFailure(req, async () => {
    const { message } = parse(resubmitInput, req.body ?? {});
    const files = fileRows(req);
    if (files.length === 0 && !message) throw new HttpError(400, 'Attach the corrected files, or write a reply');

    const request = await prisma.jobRequest.findUniqueOrThrow({ where: { trackToken }, include: { _count: { select: { files: true } } } });
    if (request._count.files + files.length > MAX_FILES_PER_REQUEST) {
      throw new HttpError(400, `A request can hold ${MAX_FILES_PER_REQUEST} files in total. Send a new request instead.`);
    }
    await assertWorkspaceRoom(req.workspaceId, incomingBytes(files));
    // Claimed conditionally so a double submit cannot add the files twice.
    const claimed = await prisma.jobRequest.updateMany({
      where: { id: request.id, status: 'changes_requested' },
      data: { status: 'pending' },
    });
    if (claimed.count !== 1) throw new HttpError(409, 'This request is not waiting for changes');
    if (message) {
      await prisma.jobRequestComment.create({ data: { requestId: request.id, authorName: request.requesterName, fromRequester: true, body: message } });
    }
    if (files.length) await prisma.jobRequestFile.createMany({ data: files.map((file) => ({ ...file, requestId: request.id })) });
  });
  notifyWorkspace(req.workspaceId);
  res.status(204).end();
});

// ---- Members: the review queue -------------------------------------------------

const requestInclude = {
  files: { orderBy: { createdAt: 'asc' }, select: { id: true, name: true, size: true } },
  machine: { select: { id: true, name: true } },
  job: { select: { id: true, name: true, status: true } },
  reviewedBy: { select: { name: true } },
  comments: { orderBy: { createdAt: 'asc' }, select: commentSelect },
} satisfies Prisma.JobRequestInclude;

type RequestRow = Prisma.JobRequestGetPayload<{ include: typeof requestInclude }>;

/** The progress link is a secret between the requester and whoever handles the queue. */
const present = ({ trackToken, ...request }: RequestRow, canEdit: boolean) => (canEdit ? { ...request, trackToken } : request);

const memberName = async (userId: string) => (await prisma.user.findUnique({ where: { id: userId }, select: { name: true } }))?.name ?? 'The workshop';

export function registerRequestRoutes(router: Router): void {
  router.get('/job-requests', async (req, res) => {
    const requests = await prisma.jobRequest.findMany({
      where: { workspaceId: req.workspaceId },
      orderBy: { createdAt: 'asc' },
      take: 500,
      include: requestInclude,
    });
    res.json(requests.map((request) => present(request, req.role !== 'viewer')));
  });

  router.get('/job-requests/:id/files/:fileId', async (req, res) => {
    const file = await prisma.jobRequestFile.findFirst({
      where: { id: param(req, 'fileId'), requestId: param(req, 'id'), request: { workspaceId: req.workspaceId } },
    });
    if (!file) throw notFound('File');
    // Always a download, never rendered: these files come from outside.
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.type('application/octet-stream');
    res.download(storedPath(req.workspaceId, file.storedName), file.name, (error) => {
      if (error && !res.headersSent) res.status(404).json({ error: 'That file is no longer stored' });
    });
  });

  router.post('/job-requests/:id/review', async (req, res) => {
    const { decision, note = '', machineId, durationHours = 0 } = parse(reviewInput, req.body);
    const id = param(req, 'id');
    const workspaceId = req.workspaceId;
    if (decision === 'changes' && !note) throw new HttpError(400, 'Say what needs changing, so the requester knows what to send');

    const request = await prisma.jobRequest.findFirst({ where: { id, workspaceId }, include: { workspace: { select: { name: true } } } });
    if (!request) throw notFound('Request');
    const reviewer = await memberName(req.userId);
    const jobMachineId = machineId === undefined ? request.machineId : machineId;
    if (decision === 'approve') await assertInWorkspace(prisma, workspaceId, { machine: jobMachineId });

    await prisma.$transaction(async (tx) => {
      // Flip the status first, conditionally, so two reviewers cannot both act on the same request.
      const claimed = await tx.jobRequest.updateMany({
        where: { id, status: decision === 'changes' ? 'pending' : { in: OPEN } },
        data: {
          status: decision === 'approve' ? 'approved' : decision === 'reject' ? 'rejected' : 'changes_requested',
          reviewNote: note,
          reviewedById: req.userId,
          reviewedAt: new Date(),
        },
      });
      if (claimed.count !== 1) throw new HttpError(409, 'This request has already been dealt with');

      if (decision === 'approve') {
        const job = await tx.job.create({
          data: {
            workspaceId,
            machineId: jobMachineId,
            name: request.title,
            durationHours,
            queuePosition: await endOfQueue(tx, workspaceId, jobMachineId),
            notes: [`Requested by ${request.requesterName} (${request.requesterEmail}).`, request.details].filter(Boolean).join('\n\n').slice(0, 5000),
            createdById: req.userId,
          },
        });
        await tx.jobRequest.update({ where: { id }, data: { jobId: job.id, machineId: jobMachineId } });
      }
      // The note joins the conversation, so the requester reads one thread.
      if (note) await tx.jobRequestComment.create({ data: { requestId: id, userId: req.userId, authorName: reviewer, body: note } });
    });

    emailStatus(request, decision === 'approve' ? 'approved' : decision === 'reject' ? 'rejected' : 'changes_requested', note);
    const verb = decision === 'approve' ? 'Approved' : decision === 'reject' ? 'Rejected' : 'Asked for changes to';
    describeActivity(`${verb} request ${request.title}`, { type: 'jobRequest', id });

    const updated = await prisma.jobRequest.findUniqueOrThrow({ where: { id }, include: requestInclude });
    res.json(present(updated, true));
  });

  /** Move an approved request along by hand, for work not run as a job here. */
  router.post('/job-requests/:id/status', async (req, res) => {
    const { status } = parse(statusInput, req.body);
    const id = param(req, 'id');
    const request = await prisma.jobRequest.findFirst({ where: { id, workspaceId: req.workspaceId }, include: { workspace: { select: { name: true } } } });
    if (!request) throw notFound('Request');
    if (!canMoveTo(request.status, status)) {
      throw new HttpError(409, status === 'in_progress' ? 'Only an approved request can be started' : 'Only an approved or started request can be marked done');
    }
    const moved = await prisma.jobRequest.updateMany({ where: { id, status: request.status }, data: { status } });
    if (moved.count !== 1) throw new HttpError(409, 'This request changed meanwhile. Reload and try again.');
    emailStatus(request, status);
    describeActivity(`Marked request ${request.title} ${status === 'done' ? 'done' : 'in progress'}`, { type: 'jobRequest', id });
    res.json(present(await prisma.jobRequest.findUniqueOrThrow({ where: { id }, include: requestInclude }), req.role !== 'viewer'));
  });

  router.post('/job-requests/:id/comments', async (req, res) => {
    const { body } = parse(commentInput, req.body);
    const id = param(req, 'id');
    const request = await prisma.jobRequest.findFirst({ where: { id, workspaceId: req.workspaceId }, include: { workspace: { select: { name: true } } } });
    if (!request) throw notFound('Request');
    const authorName = await memberName(req.userId);
    const comment = await prisma.jobRequestComment.create({ data: { requestId: id, userId: req.userId, authorName, body }, select: commentSelect });
    emailComment(request, authorName, body);
    describeActivity(`Commented on request ${request.title}`, { type: 'jobRequest', id });
    res.status(201).json(comment);
  });

  /** Removes the request and its files. A job already created from it stays. */
  router.delete('/job-requests/:id', async (req, res) => {
    const request = await prisma.jobRequest.findFirst({
      where: { id: param(req, 'id'), workspaceId: req.workspaceId },
      include: { files: { select: { storedName: true } } },
    });
    if (!request) throw notFound('Request');
    await prisma.jobRequest.delete({ where: { id: request.id } });
    await removeStored(req.workspaceId, request.files.map((file) => file.storedName));
    res.status(204).end();
  });

  // ---- The public link itself ----

  const link = async (workspaceId: string, canEdit: boolean) => {
    const { requestToken } = await prisma.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { requestToken: true } });
    return { enabled: requestToken !== null, token: canEdit ? requestToken : null, limits: uploadLimits };
  };

  router.get('/request-link', async (req, res) => {
    res.json(await link(req.workspaceId, req.role !== 'viewer'));
  });

  /** Switch outside requests on or off. `renew` replaces the link, which stops the old one working. */
  router.put('/request-link', ownerOnly, async (req, res) => {
    const { enabled, renew } = parse(z.object({ enabled: z.boolean(), renew: z.boolean().optional() }), req.body);
    const current = await prisma.workspace.findUniqueOrThrow({ where: { id: req.workspaceId }, select: { requestToken: true } });
    const requestToken = !enabled ? null : renew || !current.requestToken ? newToken() : current.requestToken;
    await prisma.workspace.update({ where: { id: req.workspaceId }, data: { requestToken } });
    describeActivity(!enabled ? 'Turned the request link off' : renew ? 'Replaced the request link' : 'Turned the request link on', { type: 'requestLink', id: null });
    res.json(await link(req.workspaceId, true));
  });
}
