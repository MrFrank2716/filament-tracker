import { createServer } from 'node:http';
import { createApp } from '@/app';
import { prisma } from '@/db';
import { env } from '@/env';
import { attachBridgeGateway } from '@/integrations/bridgeGateway';
import { flushRegistry, hydrateRegistry } from '@/integrations/registry';
import { attachRealtime } from '@/realtime';
import { scheduleGuestCleanup } from '@/services/guests';

const app = createApp();
const server = createServer(app);
const io = attachRealtime(server);
attachBridgeGateway(io);
server.listen(env.PORT, () => {
  console.log(`Wrkbench API listening on http://localhost:${env.PORT}`);
  scheduleGuestCleanup();
  hydrateRegistry().catch((cause: unknown) => console.error('Could not load connected printers', cause));
});

// A redeploy sends SIGTERM: stop taking requests, let open ones finish, then release the database.
let stopping = false;
function shutdown(signal: string): void {
  if (stopping) return;
  stopping = true;
  console.log(`${signal} received, shutting down`);
  // If a connection refuses to close, do not hang the deploy.
  setTimeout(() => process.exit(1), 10_000).unref();
  // Closing socket.io also closes the HTTP server it is attached to. Bridges reconnect by themselves afterwards.
  io.close(() => {
    // Keep the last reading of each printer, so there is something to show until its bridge is back.
    flushRegistry()
      .catch(() => undefined)
      .finally(() => prisma.$disconnect().finally(() => process.exit(0)));
  });
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
