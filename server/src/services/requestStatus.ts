import { prisma } from '@/db';
import { appUrl, sendMail } from '@/services/mail';

/**
 * The life of an outside job request:
 *   pending -> changes_requested -> pending ... -> approved -> in_progress -> done
 *   pending / changes_requested -> rejected
 * in_progress and done follow the job made from the request, and can also be set by hand.
 */
export const REQUEST_STATUSES = ['pending', 'changes_requested', 'approved', 'in_progress', 'done', 'rejected'] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

/** Which statuses each later status may be reached from. */
const FROM: Partial<Record<RequestStatus, RequestStatus[]>> = {
  in_progress: ['approved'],
  done: ['approved', 'in_progress'],
};

export const canMoveTo = (from: string, to: RequestStatus) => (FROM[to] ?? []).includes(from as RequestStatus);

const WORDING: Record<Exclude<RequestStatus, 'pending'>, { subject: string; line: string }> = {
  changes_requested: { subject: 'needs changes', line: 'Your request needs some changes before it can go ahead.' },
  approved: { subject: 'approved', line: 'Good news: your request has been approved and is in the queue.' },
  in_progress: { subject: 'in progress', line: 'Your job has started.' },
  done: { subject: 'done', line: 'Your job is done.' },
  rejected: { subject: 'not accepted', line: 'Sorry, your request could not be accepted.' },
};

interface Requested {
  title: string;
  requesterName: string;
  requesterEmail: string;
  trackToken: string;
  workspace: { name: string };
}

/** Tell the requester where their request stands. */
export function emailStatus(request: Requested, status: Exclude<RequestStatus, 'pending'>, note = ''): void {
  const words = WORDING[status];
  sendMail({
    to: request.requesterEmail,
    subject: `${request.workspace.name}: "${request.title}" ${words.subject}`,
    text: [
      `Hi ${request.requesterName},`,
      '',
      words.line,
      ...(note ? ['', `Message from ${request.workspace.name}:`, note] : []),
      '',
      `Follow your request and reply here: ${appUrl(`/request/${request.trackToken}`)}`,
      '',
      `${request.workspace.name}`,
    ].join('\n'),
  });
}

/** Someone in the workspace commented: let the requester know there is something to read. */
export function emailComment(request: Requested, author: string, body: string): void {
  sendMail({
    to: request.requesterEmail,
    subject: `${request.workspace.name}: new message about "${request.title}"`,
    text: [
      `Hi ${request.requesterName},`,
      '',
      `${author} wrote:`,
      body,
      '',
      `Reply here: ${appUrl(`/request/${request.trackToken}`)}`,
    ].join('\n'),
  });
}

/**
 * Move the request behind a job along when the job moves. Conditional, so a request someone
 * already set by hand (or one already done) is left alone. Emails the requester when it changes.
 */
export async function followJob(jobId: string, status: 'in_progress' | 'done'): Promise<void> {
  const request = await prisma.jobRequest.findUnique({ where: { jobId }, include: { workspace: { select: { name: true } } } });
  if (!request || !canMoveTo(request.status, status)) return;
  const moved = await prisma.jobRequest.updateMany({ where: { id: request.id, status: request.status }, data: { status } });
  if (moved.count === 1) emailStatus(request, status);
}
