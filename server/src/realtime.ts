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
        if (joined.startsWith('workspace:')) socket.leave(joined);
      }
      socket.join(room(workspaceId));
    });
  });

  return created;
}

/** For changes that do not come from a signed-in member, such as an outside job request arriving. */
export function notifyWorkspace(workspaceId: string): void {
  io?.to(room(workspaceId)).emit('workspace:changed', { by: null, at: Date.now() });
}

/** Tell everyone looking at a workspace that its data changed, after any successful write. */
export const broadcastChanges: RequestHandler = (req, res, next) => {
  if (req.method !== 'GET') {
    res.on('finish', () => {
      if (res.statusCode < 400) {
        io?.to(room(req.workspaceId)).emit('workspace:changed', { by: req.userId, at: Date.now() });
      }
    });
  }
  next();
};
