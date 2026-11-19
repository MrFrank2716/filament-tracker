import type { AddressInfo } from 'node:net';
import { createApp } from '@/app';
import { signToken } from '@/auth';
import { prisma } from '@/db';

/**
 * The real HTTP app on a spare port, for tests of what the guards decide: who may call a route, and what
 * someone outside a workspace is told. Most tests call services directly and do not need this.
 */
export async function startApp() {
  const server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
  /** The whole response, for tests that look at more than the status and body. `headers` adds to the usual ones. */
  const raw = (method: string, path: string, token: string, body?: unknown, headers: Record<string, string> = {}) =>
    fetch(`${base}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  const call = async (method: string, path: string, token: string, body?: unknown) => {
    const response = await raw(method, path, token, body);
    const text = await response.text();
    return { status: response.status, body: (text ? JSON.parse(text) : null) as Record<string, unknown> | null };
  };
  return { call, raw, close: () => new Promise<void>((resolve) => server.close(() => resolve())) };
}

/** A user who is a member of the workspace with this role (or of none), and a sign-in token for them. */
export async function member(email: string, workspaceId: string | null, role = 'viewer') {
  const user = await prisma.user.create({
    data: { email, name: email.split('@')[0], passwordHash: 'x', ...(workspaceId ? { memberships: { create: { workspaceId, role } } } : {}) },
  });
  return signToken(user);
}
