import type { Server as HttpServer } from 'node:http';
import type { RequestHandler } from 'express';
import { Server } from 'socket.io';
import { env } from '@/env';
import { getRole, userForSession } from '@/auth';

let io: Server | null = null;

const room = (workspaceId: string) => `workspace:${workspaceId}`;

export function attachRealtime(server: HttpServer): Server {
  const created = new Server(server, { cors: { origin: env.CLIENT_ORIGIN } });
  io = created;

  io.use((socket, next) => {
    userForSession(String(socket.handshake.auth?.token ?? ''))
      .then((user) => {
        if (!user) return next(new Error('unauthorized'));
        socket.data.userId = user.id;
        next();
      })
      .catch(() => next(new Error('unauthorized')));
  });

  io.on('connection', (socket) => {
    socket.on('workspace:join', async (workspaceId: unknown) => {
      if (typeof workspaceId !== 'string') return;
      const role = await getRole(socket.data.userId, workspaceId);
      if (!role) return;
      for (const joined of socket.rooms) {
        if (joined.startsWith('workspace:')) {
          socket.leave(joined);
          watchersChanged(joined.slice('workspace:'.length));
        }
      }
      socket.join(room(workspaceId));
      watchersChanged(workspaceId);
    });
    socket.on('disconnecting', () => {
      const left = [...socket.rooms].filter((joined) => joined.startsWith('workspace:'));
      // The rooms are only left once this handler returns.
      setImmediate(() => left.forEach((joined) => watchersChanged(joined.slice('workspace:'.length))));
    });
  });

  return created;
}

/** For changes that do not come from a signed-in member, such as an outside job request arriving. */
export function notifyWorkspace(workspaceId: string): void {
  io?.to(room(workspaceId)).emit('workspace:changed', { by: null, at: Date.now() });
}

const pending = new Map<string, ReturnType<typeof setTimeout>>();

/** The same, for changes that come in bursts (a printer reporting): several close together become one refresh. */
export function notifyWorkspaceSoon(workspaceId: string): void {
  if (pending.has(workspaceId)) return;
  pending.set(
    workspaceId,
    setTimeout(() => {
      pending.delete(workspaceId);
      notifyWorkspace(workspaceId);
    }, 250),
  );
}

/** Send one named event to everyone looking at a workspace, without making them reload anything. */
export function emitToWorkspace(workspaceId: string, event: string, payload: unknown): void {
  io?.to(room(workspaceId)).emit(event, payload);
}

/** How many browsers have this workspace open right now. */
export function workspaceWatchers(workspaceId: string): number {
  return io?.of('/').adapter.rooms.get(room(workspaceId))?.size ?? 0;
}

const watcherListeners = new Set<(workspaceId: string) => void>();
const watchersChanged = (workspaceId: string) => watcherListeners.forEach((listener) => listener(workspaceId));

/** Called whenever someone opens or leaves a workspace. */
export function onWatchersChanged(listener: (workspaceId: string) => void): void {
  watcherListeners.add(listener);
}

/** Tell everyone looking at a workspace that its data changed, after any successful write. */
export const broadcastChanges: RequestHandler = (req, res, next) => {
  // A question to the assistant is a POST but changes nothing, so nobody needs to reload.
  if (req.method !== 'GET' && !req.path.startsWith('/ai/')) {
    res.on('finish', () => {
      if (res.statusCode < 400) {
        io?.to(room(req.workspaceId)).emit('workspace:changed', { by: req.userId, at: Date.now() });
      }
    });
  }
  next();
};
