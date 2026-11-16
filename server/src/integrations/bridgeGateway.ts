import type { Namespace, Server, Socket } from 'socket.io';
import {
  BRIDGE_NAMESPACE, JOB_IMAGE_ENTRY, MIN_PROTOCOL, bridgeHello, handshakeAuth, jobReadAck, printerReport, printerStatus,
  type BridgeConfig, type BridgeToServerEvents, type ServerToBridgeEvents,
} from '@filament-tracker/protocol';
import { prisma, type Json } from '@/db';
import { env } from '@/env';
import { HttpError } from '@/http';
import { adapterFor, bridgeConnected, bridgeDisconnected, enqueueWrite, ingestReport, setJobFileReader, setLinkStatus } from '@/integrations/registry';
import { tokenBucket } from '@/rateLimit';
import { notifyWorkspaceSoon, onWatchersChanged, workspaceWatchers } from '@/realtime';
import { hashSecret } from '@/services/tokens';

/**
 * Where bridges connect: a socket.io namespace of their own, so a browser session can never act as a bridge
 * or the other way round. A bridge signs in with its token (looked up by SHA-256), and everything it sends is
 * checked against the shared schemas and counted against a per-bridge allowance.
 */

interface BridgeData {
  bridgeId: string;
  workspaceId: string;
  tokenHash: string;
  instanceId: string;
  capabilities: string[];
}
type BridgeSocket = Socket<BridgeToServerEvents, ServerToBridgeEvents, Record<string, never>, BridgeData>;

const sockets = new Map<string, BridgeSocket>();

const refuse = (code: string): Error => Object.assign(new Error(code), { data: { code } });

/** The printers a bridge should hold, plus how to report on them. Access codes are only added by the caller. */
export async function configFor(bridgeId: string, codes: Record<string, string> = {}): Promise<BridgeConfig> {
  const links = await prisma.printerLink.findMany({ where: { bridgeId }, select: { id: true, vendor: true, serial: true, host: true } });
  return {
    printers: links.map((link) => ({ printerId: link.id, vendor: link.vendor, serial: link.serial, host: link.host, ...(codes[link.id] ? { accessCode: codes[link.id] } : {}) })),
    telemetry: adapterFor(links[0]?.vendor ?? 'bambu').telemetry,
  };
}

const rateFor = (workspaceId: string) => ({ mode: workspaceWatchers(workspaceId) > 0 ? ('live' as const) : ('idle' as const) });

export function attachBridgeGateway(io: Server): void {
  // socket.io types a namespace by its server's events; this one has events of its own.
  const namespace = io.of(BRIDGE_NAMESPACE) as unknown as Namespace<BridgeToServerEvents, ServerToBridgeEvents, Record<string, never>, BridgeData>;

  namespace.use(async (socket, next) => {
    try {
      if (!env.PRINTERS_ENABLED) return next(refuse('disabled'));
      const auth = handshakeAuth.safeParse(socket.handshake.auth);
      if (!auth.success) return next(refuse('unauthorized'));
      if (auth.data.protocol < MIN_PROTOCOL) return next(refuse('upgrade_required'));
      const tokenHash = hashSecret(auth.data.token);
      const bridge = await prisma.bridge.findUnique({ where: { tokenHash }, select: { id: true, workspaceId: true } });
      if (!bridge) return next(refuse('unauthorized'));
      // Two installs sharing one token would otherwise take turns knocking each other off for ever.
      const live = sockets.get(bridge.id);
      if (live && live.connected && live.data.instanceId !== auth.data.instanceId) return next(refuse('duplicate'));
      socket.data = { bridgeId: bridge.id, workspaceId: bridge.workspaceId, tokenHash, instanceId: auth.data.instanceId, capabilities: [] };
      void enqueueWrite(() =>
        prisma.bridge.updateMany({ where: { id: bridge.id }, data: { version: auth.data.version, platform: auth.data.platform ?? '', lastSeenAt: new Date() } }),
      );
      next();
    } catch (cause) {
      console.error('Bridge sign-in failed', cause);
      next(refuse('unavailable'));
    }
  });

  namespace.on('connection', (socket) => {
    const { bridgeId, workspaceId } = socket.data;
    sockets.get(bridgeId)?.disconnect(true);
    sockets.set(bridgeId, socket);
    bridgeConnected(bridgeId);
    notifyWorkspaceSoon(workspaceId);

    // Generous for honest use (a few messages a second per printer), tight enough to stop a runaway or hostile bridge.
    const allowance = tokenBucket(200, 40);
    let strikes = 0;
    socket.use((_packet, next) => {
      if (allowance()) return next();
      strikes += 1;
      if (strikes >= 3) socket.disconnect(true);
      next(new Error('rate_limited'));
    });

    socket.on('bridge.hello', async (raw, ack) => {
      const hello = bridgeHello.safeParse(raw);
      if (!hello.success || typeof ack !== 'function') return;
      socket.data.capabilities = hello.data.capabilities;
      void enqueueWrite(() => prisma.bridge.updateMany({ where: { id: bridgeId }, data: { capabilities: hello.data.capabilities as Json } }));
      for (const printer of hello.data.printers) setLinkStatus(bridgeId, printer);
      ack({ ok: true, config: await configFor(bridgeId) });
      socket.emit('bridge.rate', rateFor(workspaceId));
    });

    socket.on('printer.status', (raw) => {
      const status = printerStatus.safeParse(raw);
      if (status.success) setLinkStatus(bridgeId, status.data);
    });

    socket.on('printer.report', (raw, ack) => {
      const report = printerReport.safeParse(raw);
      if (typeof ack !== 'function') return;
      ack(report.success ? ingestReport(bridgeId, report.data) : { ok: true });
    });

    socket.on('disconnect', () => {
      if (sockets.get(bridgeId) !== socket) return;
      sockets.delete(bridgeId);
      bridgeDisconnected(bridgeId);
      void enqueueWrite(() => prisma.bridge.updateMany({ where: { id: bridgeId }, data: { lastSeenAt: new Date() } }));
      notifyWorkspaceSoon(workspaceId);
    });
  });

  // Reading a print's sliced file goes through whichever bridge holds the printer, if that bridge knows how.
  setJobFileReader((bridgeId, printerId) => async (entries) => {
    const socket = sockets.get(bridgeId);
    if (!socket?.connected || !socket.data.capabilities.includes('job.files')) return null;
    try {
      // Pictures are only asked of bridges that send them as bytes; an older one would return them mangled, as text.
      const wanted = socket.data.capabilities.includes('job.images') ? entries : entries.filter((entry) => !JOB_IMAGE_ENTRY.test(entry));
      if (wanted.length === 0) return null;
      const reply = jobReadAck.parse(await socket.timeout(120_000).emitWithAck('job.read', { printerId, entries: wanted }));
      return reply.ok ? { entries: reply.entries, images: reply.images } : null;
    } catch {
      return null;
    }
  });

  // Bridges report less often while nobody has the workspace open.
  onWatchersChanged((workspaceId) => {
    for (const socket of sockets.values()) if (socket.data.workspaceId === workspaceId) socket.emit('bridge.rate', rateFor(workspaceId));
  });

  // A bridge whose record or token has gone (removed, re-paired, workspace deleted) is dropped within a minute,
  // whichever way that happened.
  setInterval(() => {
    const ids = [...sockets.keys()];
    if (ids.length === 0) return;
    prisma.bridge
      .findMany({ where: { id: { in: ids } }, select: { id: true, tokenHash: true } })
      .then((rows) => {
        const valid = new Map(rows.map((row) => [row.id, row.tokenHash]));
        for (const [id, socket] of sockets) if (valid.get(id) !== socket.data.tokenHash) socket.disconnect(true);
      })
      .catch((cause: unknown) => console.error('Bridge check failed', cause));
  }, 60_000).unref();
}

export const bridgeOnline = (bridgeId: string): boolean => sockets.get(bridgeId)?.connected ?? false;

/** Drop a bridge now, for example after it is removed or re-paired. */
export function disconnectBridge(bridgeId: string): void {
  sockets.get(bridgeId)?.disconnect(true);
}

function liveSocket(bridgeId: string): BridgeSocket {
  const socket = sockets.get(bridgeId);
  if (!socket?.connected) throw new HttpError(503, 'The bridge is not connected right now. Check that it is running, then try again.');
  return socket;
}

const TIMED_OUT = 'The bridge did not answer in time. Check that it is running and try again.';

/** Ask the bridge to try a printer with an access code, without keeping anything. */
export async function testPrinter(bridgeId: string, printer: { vendor: string; serial: string; host: string; accessCode: string }) {
  try {
    return await liveSocket(bridgeId).timeout(25_000).emitWithAck('printer.test', printer);
  } catch (cause) {
    if (cause instanceof HttpError) throw cause;
    throw new HttpError(504, TIMED_OUT);
  }
}

export async function discoverPrinters(bridgeId: string) {
  try {
    return await liveSocket(bridgeId).timeout(10_000).emitWithAck('discovery.list', {});
  } catch (cause) {
    if (cause instanceof HttpError) throw cause;
    throw new HttpError(504, TIMED_OUT);
  }
}

/** Send the bridge its list of printers. `codes` carries access codes a member has just typed, by printer id. */
export async function pushConfig(bridgeId: string, codes: Record<string, string> = {}, required = false): Promise<void> {
  const socket = sockets.get(bridgeId);
  if (!socket?.connected) {
    if (required) throw new HttpError(503, 'The bridge is not connected right now. Check that it is running, then try again.');
    return;
  }
  try {
    const reply = await socket.timeout(10_000).emitWithAck('bridge.config', await configFor(bridgeId, codes));
    if (!reply.ok && required) throw new HttpError(502, reply.message ?? 'The bridge could not take the new settings.');
  } catch (cause) {
    if (cause instanceof HttpError) throw cause;
    if (required) throw new HttpError(504, TIMED_OUT);
  }
}
