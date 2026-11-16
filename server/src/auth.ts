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
  ['POST', /^\/items\/move$/], // putting things away
  ['PUT', /^\/items\/[^/]+\/tag$/], // writing or scanning a spool's sticker
  ['POST', /^\/jobs$/],
  ['PATCH', /^\/jobs\/[^/]+$/],
  ['POST', /^\/jobs\/[^/]+\/(start|finish|cancel)$/],
  ['PUT', /^\/queue\/[^/]+$/],
  ['POST', /^\/maintenance\/tasks\/[^/]+\/complete$/],
  ['PUT', /^\/sub-units\/[^/]+\/slots\/\d+$/],
  ['PUT', /^\/printers\/by-machine\/[^/]+\/pending-spool$/], // "this spool goes in next"
  ['DELETE', /^\/printers\/by-machine\/[^/]+\/pending-spool$/],
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

interface TokenUser {
  id: string;
  tokenVersion: number;
}

/** The token carries the user's tokenVersion, so raising that number revokes every token issued before. */
export function signToken(user: TokenUser, expiresIn: `${number}d` = '30d'): string {
  return jwt.sign({ sub: user.id, v: user.tokenVersion }, env.JWT_SECRET, { expiresIn });
}

/** A one-hour, single-purpose token for the emailed "set a new password" link. Never accepted as a sign-in. */
export function signResetToken(user: TokenUser): string {
  return jwt.sign({ sub: user.id, v: user.tokenVersion, purpose: 'reset' }, env.JWT_SECRET, { expiresIn: '1h' });
}

function readToken(token: string, purpose: 'session' | 'reset'): { userId: string; version: number } | null {
  try {
    const payload = jwt.verify(token, env.JWT_SECRET);
    if (typeof payload !== 'object' || typeof payload.sub !== 'string') return null;
    if ((payload.purpose ?? 'session') !== purpose) return null;
    // Tokens from before versions existed carry none: they count as version 0.
    return { userId: payload.sub, version: typeof payload.v === 'number' ? payload.v : 0 };
  } catch {
    return null;
  }
}

/** The user a token belongs to, or null when it is invalid, expired, revoked or the account is gone. */
async function userFor(token: string, purpose: 'session' | 'reset') {
  const claims = token ? readToken(token, purpose) : null;
  if (!claims) return null;
  const user = await prisma.user.findUnique({ where: { id: claims.userId } });
  return user && user.tokenVersion === claims.version ? user : null;
}

export const userForSession = (token: string) => userFor(token, 'session');
export const userForReset = (token: string) => userFor(token, 'reset');

export const bearerToken = (header: string | undefined): string => (header?.startsWith('Bearer ') ? header.slice(7) : '');

export const requireAuth: RequestHandler = async (req, _res, next) => {
  const user = await userForSession(bearerToken(req.headers.authorization));
  if (!user) throw new HttpError(401, 'Please sign in');
  req.userId = user.id;
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
