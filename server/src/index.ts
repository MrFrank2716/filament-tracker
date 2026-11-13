import { createServer } from 'node:http';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import express from 'express';
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
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

app.use(errorHandler);

const server = createServer(app);
attachRealtime(server);
server.listen(env.PORT, () => {
  console.log(`Filament Tracker API listening on http://localhost:${env.PORT}`);
});
