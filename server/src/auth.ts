import type { RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '@/env';
import { prisma } from '@/db';
import { HttpError, param } from '@/http';

export const ROLES = ['owner', 'admin', 'operator', 'viewer'] as const;
export type Role = (typeof ROLES)[number];

const rank: Record<Role, number> = { viewer: 1, operator: 2, admin: 3, owner: 4 };

export const atLeast = (role: Role, needed: Role): boolean => rank[role] >= rank[needed];

/**
 * The writes an operator may make: running jobs, logging what was used, servicing machines,
 * loading spools and talking to requesters. Everything else that changes data needs an admin.
 * Paths are relative to /workspaces/:wid. New routes are admin-only until listed here.
 */
const OPERATOR_WRITES: Array<[method: string, path: RegExp]> = [
  ['POST', /^\/items\/[^/]+\/adjust$/], // the handler only lets operators take stock away
  ['POST', /^\/jobs$/],
  ['PATCH', /^\/jobs\/[^/]+$/],
  ['POST', /^\/jobs\/[^/]+\/(start|finish|cancel)$/],
  ['PUT', /^\/queue\/[^/]+$/],
  ['POST', /^\/maintenance\/tasks\/[^/]+\/complete$/],
  ['PUT', /^\/sub-units\/[^/]+\/slots\/\d+$/],
  ['POST', /^\/job-requests\/[^/]+\/comments$/],
  ['POST', /^\/job-requests\/[^/]+\/status$/],
];

const operatorMay = (method: string, path: string) => OPERATOR_WRITES.some(([m, pattern]) => m === method && pattern.test(path));

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId: string;
      workspaceId: string;
      role: Role;
    }
  }
}

export function signToken(userId: string, expiresIn: `${number}d` = '30d'): string {
  return jwt.sign({ sub: userId }, env.JWT_SECRET, { expiresIn });
}

export function verifyToken(token: string): string | null {
  try {
    const payload = jwt.verify(token, env.JWT_SECRET);
    return typeof payload === 'object' && typeof payload.sub === 'string' ? payload.sub : null;
  } catch {
    return null;
  }
}

export const requireAuth: RequestHandler = (req, _res, next) => {
  const header = req.headers.authorization ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';
  const userId = token ? verifyToken(token) : null;
  if (!userId) throw new HttpError(401, 'Please sign in');
  req.userId = userId;
  next();
};

export async function getRole(userId: string, workspaceId: string): Promise<Role | null> {
  const membership = await prisma.membership.findUnique({
    where: { userId_workspaceId: { userId, workspaceId } },
  });
  return (membership?.role as Role | undefined) ?? null;
}

/**
 * Guards every /workspaces/:wid route: the caller must be a member,
 * viewers only read, operators may make the writes listed in OPERATOR_WRITES, and admins and owners the rest.
 */
export const workspaceGuard: RequestHandler = async (req, _res, next) => {
  const workspaceId = param(req, 'wid');
  const role = await getRole(req.userId, workspaceId);
  if (!role) throw new HttpError(404, 'Workspace not found');
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    if (role === 'viewer') throw new HttpError(403, 'Viewers can look but not change things. Ask an owner for more access.');
    if (role === 'operator' && !operatorMay(req.method, req.path)) {
      throw new HttpError(403, 'Operators can run jobs and log what they use, but not change the inventory or set-up. Ask an admin.');
    }
  }
  req.workspaceId = workspaceId;
  req.role = role;
  next();
};

export const ownerOnly: RequestHandler = (req, _res, next) => {
  if (req.role !== 'owner') throw new HttpError(403, 'Only a workspace owner can do that');
  next();
};
