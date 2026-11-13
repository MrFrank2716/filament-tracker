import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { prisma } from '@/db';
import { env } from '@/env';
import { errorHandler, HttpError } from '@/http';
import { attachRealtime } from '@/realtime';
import { authRouter } from '@/routes/auth';
import { registerCatalogRoutes } from '@/routes/catalog';
import { registerItemRoutes } from '@/routes/items';
import { registerJobRoutes } from '@/routes/jobs';
import { registerMachineRoutes } from '@/routes/machines';
import { registerMaintenanceRoutes } from '@/routes/maintenance';
import { registerReportRoutes } from '@/routes/reports';
import { publicRequestsRouter, registerRequestRoutes } from '@/routes/requests';
import { registerTransferRoutes } from '@/routes/transfer';
import { workspaceScope, workspacesRouter } from '@/routes/workspaces';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', env.TRUST_PROXY);
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        // The host's proxy redirects to HTTPS; leaving this on would break plain-HTTP runs on a local network.
        upgradeInsecureRequests: null,
      },
    },
  }),
);
app.use(cors({ origin: env.CLIENT_ORIGIN }));
app.use(express.json({ limit: '5mb' }));

app.get('/api/health', (_req, res) => {
  res.json({ ok: true });
});

// Everything under /api/workspaces/:wid is membership- and role-checked by workspaceGuard.
registerCatalogRoutes(workspaceScope);
registerItemRoutes(workspaceScope);
registerMachineRoutes(workspaceScope);
registerMaintenanceRoutes(workspaceScope);
registerJobRoutes(workspaceScope);
registerReportRoutes(workspaceScope);
registerTransferRoutes(workspaceScope);
registerRequestRoutes(workspaceScope);

app.use('/api/auth', authRouter);
// The only routes that need no account: sending a job request and following its progress.
app.use('/api/public', publicRequestsRouter);
app.use('/api', workspacesRouter);
app.use('/api', () => {
  throw new HttpError(404, 'Not found');
});

// In production the API also serves the built client (npm run build), so one process is enough.
const clientDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../client/dist');
if (existsSync(clientDist)) {
  app.use(express.static(clientDist));
  app.get(/^(?!\/api\/).*/, (_req, res) => {
    // Relative to a root, so a dot-folder somewhere above the app (which sendFile refuses) cannot break deep links.
    res.sendFile('index.html', { root: clientDist });
  });
}

app.use(errorHandler);

const server = createServer(app);
const io = attachRealtime(server);
server.listen(env.PORT, () => {
  console.log(`Wrkbench API listening on http://localhost:${env.PORT}`);
});

// A redeploy sends SIGTERM: stop taking requests, let open ones finish, then release the database.
let stopping = false;
function shutdown(signal: string): void {
  if (stopping) return;
  stopping = true;
  console.log(`${signal} received, shutting down`);
  // If a connection refuses to close, do not hang the deploy.
  setTimeout(() => process.exit(1), 10_000).unref();
  // Closing socket.io also closes the HTTP server it is attached to.
  io.close(() => {
    prisma.$disconnect().finally(() => process.exit(0));
  });
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
