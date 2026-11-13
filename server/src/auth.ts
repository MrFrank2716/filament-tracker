import type { RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '@/env';
import { prisma } from '@/db';
import { HttpError, param } from '@/http';

export const ROLES = ['owner', 'editor', 'viewer'] as const;
export type Role = (typeof ROLES)[number];

const rank: Record<Role, number> = { viewer: 1, editor: 2, owner: 3 };

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
 * and anything that is not a read requires editor or owner.
 */
export const workspaceGuard: RequestHandler = async (req, _res, next) => {
  const workspaceId = param(req, 'wid');
  const role = await getRole(req.userId, workspaceId);
  if (!role) throw new HttpError(404, 'Workspace not found');
  if (req.method !== 'GET' && rank[role] < rank.editor) {
    throw new HttpError(403, 'Viewers can look but not change things. Ask an owner for editor access.');
  }
  req.workspaceId = workspaceId;
  req.role = role;
  next();
};

export const ownerOnly: RequestHandler = (req, _res, next) => {
  if (req.role !== 'owner') throw new HttpError(403, 'Only a workspace owner can do that');
  next();
};
