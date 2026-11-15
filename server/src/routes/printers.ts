import { Router } from 'express';
import { z } from 'zod';
import { accessCode, host, pairRequest, serial } from '@filament-tracker/protocol';
import { atLeast } from '@/auth';
import { prisma } from '@/db';
import { env } from '@/env';
import { HttpError, notFound, param, parse } from '@/http';
import { releaseFeeders } from '@/integrations/amsSync';
import { bambuModelName } from '@/integrations/bambu/models';
import { bridgeOnline, disconnectBridge, discoverPrinters, pushConfig, testPrinter } from '@/integrations/bridgeGateway';
import { forgetPrinter, statesForWorkspace, trackPrinterById } from '@/integrations/registry';
import { rateLimit } from '@/rateLimit';
import { notifyWorkspaceSoon } from '@/realtime';
import { describeActivity } from '@/services/activity';
import { appUrl } from '@/services/mail';
import { assertInWorkspace } from '@/services/stock';
import { hashSecret, newBridgeToken, newPairingCode, normalizePairingCode } from '@/services/tokens';

/**
 * Connected printers: the bridges a workspace runs on its own network, and the printers reached through them.
 *
 * Every write here is for admins and owners (none is on the operator allow-list in auth.ts).
 * A printer's access code passes through on its way to the bridge and is never stored, logged or sent back.
 */

const PAIRING_MINUTES = 10;

const bridgeInput = z.object({ name: z.string().trim().min(1, 'Give the bridge a name').max(80) });

const linkInput = z.object({
  bridgeId: z.string().min(1),
  serial: serial.transform((value) => value.toUpperCase()),
  host,
  accessCode,
  /** Tie it to a machine that already exists, or leave out to add one named `machineName`. */
  machineId: z.string().min(1).optional(),
  machineName: z.string().trim().min(1).max(120).optional(),
  /** What the printer called itself when it was found on the network. */
  modelCode: z.string().trim().max(40).optional(),
});

const codeInput = z.object({ accessCode, host: host.optional() });

const privateHost = (value: string): boolean => {
  const [a, b] = value.split('.').map(Number);
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
};

function requireEnabled(): void {
  if (!env.PRINTERS_ENABLED) throw new HttpError(404, 'Connected printers are switched off on this server');
}

/** The one-time code and the commands that use it. Shown once: only the code's hash is kept. */
async function issuePairing(bridgeId: string) {
  const code = newPairingCode();
  const expiresAt = new Date(Date.now() + PAIRING_MINUTES * 60_000);
  await prisma.bridge.update({ where: { id: bridgeId }, data: { pairingHash: hashSecret(normalizePairingCode(code)), pairingExpiresAt: expiresAt } });
  const server = appUrl('');
  return {
    code,
    expiresAt,
    docker: `docker run -d --name wrkbench-bridge --restart unless-stopped --network host -v wrkbench-bridge:/data ${env.BRIDGE_IMAGE} --server ${server} --pair ${code}`,
    source: `npm run bridge -- --server ${server} --pair ${code}`,
  };
}

const bridgeSelect = {
  id: true, name: true, version: true, platform: true, lastSeenAt: true, createdAt: true, tokenHash: true, pairingExpiresAt: true,
  _count: { select: { printers: true } },
} as const;

type BridgeRow = Awaited<ReturnType<typeof prisma.bridge.findFirstOrThrow<{ select: typeof bridgeSelect }>>>;

const presentBridge = ({ tokenHash, pairingExpiresAt, _count, ...bridge }: BridgeRow) => ({
  ...bridge,
  online: bridgeOnline(bridge.id),
  /** paired: has signed in at least once. Otherwise it is still waiting for its code to be used. */
  paired: tokenHash !== null,
  pairingExpiresAt: pairingExpiresAt && pairingExpiresAt > new Date() ? pairingExpiresAt : null,
  printerCount: _count.printers,
});

const linkSelect = {
  id: true, machineId: true, bridgeId: true, vendor: true, serial: true, host: true, modelName: true, firmware: true, codeState: true, createdAt: true,
  machine: { select: { name: true } },
  bridge: { select: { name: true } },
} as const;

export function registerPrinterRoutes(router: Router): void {
  // ---- Bridges ---------------------------------------------------------------------
  router.get('/bridges', async (req, res) => {
    requireEnabled();
    const bridges = await prisma.bridge.findMany({ where: { workspaceId: req.workspaceId }, orderBy: { createdAt: 'asc' }, select: bridgeSelect });
    res.json(bridges.map(presentBridge));
  });

  router.post('/bridges', async (req, res) => {
    requireEnabled();
    const { name } = parse(bridgeInput, req.body);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.userId }, select: { isGuest: true } });
    // A guest's workspace is deleted after a week; a bridge left pointing at it would only cause confusion.
    if (user.isGuest) throw new HttpError(403, 'Create an account to connect printers. Guest sessions are temporary.');
    const count = await prisma.bridge.count({ where: { workspaceId: req.workspaceId } });
    if (count >= env.BRIDGE_MAX_PER_WORKSPACE) throw new HttpError(409, `A workspace can have up to ${env.BRIDGE_MAX_PER_WORKSPACE} bridges. Remove one first.`);
    const created = await prisma.bridge.create({ data: { workspaceId: req.workspaceId, name, capabilities: [] } });
    const pairing = await issuePairing(created.id);
    const bridge = await prisma.bridge.findUniqueOrThrow({ where: { id: created.id }, select: bridgeSelect });
    res.status(201).json({ ...presentBridge(bridge), pairing });
  });

  /** A fresh code for the same bridge: to finish setting it up, or to move it to another computer. Its printers stay. */
  router.post('/bridges/:id/pairing', async (req, res) => {
    requireEnabled();
    const id = param(req, 'id');
    const existing = await prisma.bridge.findFirst({ where: { id, workspaceId: req.workspaceId }, select: { name: true } });
    if (!existing) throw notFound('Bridge');
    describeActivity(`Made a new set-up code for bridge ${existing.name}`, { type: 'bridge', id });
    const pairing = await issuePairing(id);
    const bridge = await prisma.bridge.findUniqueOrThrow({ where: { id }, select: bridgeSelect });
    res.json({ ...presentBridge(bridge), pairing });
  });

  router.patch('/bridges/:id', async (req, res) => {
    requireEnabled();
    const { name } = parse(bridgeInput, req.body);
    const id = param(req, 'id');
    const updated = await prisma.bridge.updateMany({ where: { id, workspaceId: req.workspaceId }, data: { name } });
    if (updated.count !== 1) throw notFound('Bridge');
    res.json(presentBridge(await prisma.bridge.findUniqueOrThrow({ where: { id }, select: bridgeSelect })));
  });

  /** Removes the bridge and unlinks its printers. The machines, their hardware and what is loaded all stay. */
  router.delete('/bridges/:id', async (req, res) => {
    requireEnabled();
    const id = param(req, 'id');
    const existing = await prisma.bridge.findFirst({ where: { id, workspaceId: req.workspaceId }, include: { printers: { select: { id: true, vendor: true, serial: true } } } });
    if (!existing) throw notFound('Bridge');
    await prisma.$transaction(async (tx) => {
      for (const printer of existing.printers) await releaseFeeders(tx, req.workspaceId, printer.vendor, printer.serial);
      await tx.bridge.delete({ where: { id } });
    });
    existing.printers.forEach((printer) => forgetPrinter(printer.id));
    disconnectBridge(id);
    res.status(204).end();
  });

  /** Printers the bridge can see on its network right now. A read, but it reaches into the workshop, so admins only. */
  router.get('/bridges/:id/discovered', async (req, res) => {
    requireEnabled();
    if (!atLeast(req.role, 'admin')) throw new HttpError(403, 'Only an admin can look for printers');
    const id = param(req, 'id');
    const bridge = await prisma.bridge.findFirst({ where: { id, workspaceId: req.workspaceId }, select: { id: true } });
    if (!bridge) throw notFound('Bridge');
    const reply = await discoverPrinters(id);
    if (!reply.ok) throw new HttpError(502, reply.message ?? 'The bridge could not look for printers');
    const linked = await prisma.printerLink.findMany({ where: { workspaceId: req.workspaceId }, select: { serial: true } });
    const taken = new Set(linked.map((link) => link.serial));
    res.json(
      reply.printers.map((printer) => ({
        serial: printer.serial.toUpperCase(),
        host: printer.host,
        name: printer.name,
        modelName: bambuModelName(printer.modelCode, printer.serial),
        linked: taken.has(printer.serial.toUpperCase()),
      })),
    );
  });

  // ---- Printers --------------------------------------------------------------------
  router.get('/printers', async (req, res) => {
    requireEnabled();
    res.json(await prisma.printerLink.findMany({ where: { workspaceId: req.workspaceId }, orderBy: { createdAt: 'asc' }, select: linkSelect }));
  });

  /** The latest reading of every connected printer. After this, changes arrive over the socket as "printer:state". */
  router.get('/printers/state', (req, res) => {
    res.json(env.PRINTERS_ENABLED ? statesForWorkspace(req.workspaceId) : []);
  });

  /**
   * Connect a printer. The bridge tries the access code first, so a wrong code or address is caught here and
   * nothing is saved. The code then goes to the bridge and is kept only there.
   */
  router.post('/printers', async (req, res) => {
    requireEnabled();
    const input = parse(linkInput, req.body);
    const workspaceId = req.workspaceId;
    if (!privateHost(input.host)) throw new HttpError(400, 'Use the printer\'s address on your own network, such as 192.168.1.50');
    const bridge = await prisma.bridge.findFirst({ where: { id: input.bridgeId, workspaceId }, select: { id: true, _count: { select: { printers: true } } } });
    if (!bridge) throw notFound('Bridge');
    if (bridge._count.printers >= env.PRINTER_MAX_PER_BRIDGE) throw new HttpError(409, `A bridge can serve up to ${env.PRINTER_MAX_PER_BRIDGE} printers`);
    if (await prisma.printerLink.findFirst({ where: { workspaceId, serial: input.serial }, select: { id: true } })) {
      throw new HttpError(409, 'That printer is already connected to this workspace');
    }
    if (input.machineId) {
      await assertInWorkspace(prisma, workspaceId, { machine: input.machineId });
      if (await prisma.printerLink.findUnique({ where: { machineId: input.machineId }, select: { id: true } })) {
        throw new HttpError(409, 'That machine is already connected to a printer');
      }
    } else if (!input.machineName) throw new HttpError(400, 'Choose a machine, or give the new one a name');

    const tested = await testPrinter(bridge.id, { vendor: 'bambu', serial: input.serial, host: input.host, accessCode: input.accessCode });
    if (!tested.ok) throw new HttpError(400, testFailure(tested.code, tested.message));
    const modelName = tested.modelName || bambuModelName(input.modelCode, input.serial);

    const link = await prisma.$transaction(async (tx) => {
      const machineId =
        input.machineId ??
        (await tx.machine.create({ data: { workspaceId, name: input.machineName!, manufacturer: 'Bambu Lab', model: modelName, serial: input.serial } })).id;
      if (input.machineId) {
        // Fill in what the printer told us, without overwriting anything typed by hand.
        const machine = await tx.machine.findUniqueOrThrow({ where: { id: machineId } });
        await tx.machine.update({
          where: { id: machineId },
          data: { manufacturer: machine.manufacturer || 'Bambu Lab', model: machine.model || modelName, serial: machine.serial || input.serial },
        });
      }
      return tx.printerLink.create({
        data: { workspaceId, machineId, bridgeId: bridge.id, vendor: 'bambu', serial: input.serial, host: input.host, modelName, firmware: tested.firmware ?? '' },
        select: linkSelect,
      });
    });
    await trackPrinterById(link.id);
    try {
      await pushConfig(bridge.id, { [link.id]: input.accessCode }, true);
    } catch (cause) {
      // The bridge never got the code, so the link would sit there broken: take it back.
      forgetPrinter(link.id);
      await prisma.printerLink.delete({ where: { id: link.id } });
      throw cause;
    }
    describeActivity(`Connected printer ${link.machine.name}`, { type: 'machine', id: link.machineId });
    res.status(201).json(link);
  });

  /** A new access code (the printer shows a new one after a network reset), and optionally a new address. */
  router.put('/printers/:id/access-code', async (req, res) => {
    requireEnabled();
    const input = parse(codeInput, req.body);
    const id = param(req, 'id');
    const link = await prisma.printerLink.findFirst({ where: { id, workspaceId: req.workspaceId }, select: linkSelect });
    if (!link) throw notFound('Printer');
    const hostNow = input.host ?? link.host;
    if (!privateHost(hostNow)) throw new HttpError(400, 'Use the printer\'s address on your own network, such as 192.168.1.50');
    const tested = await testPrinter(link.bridgeId, { vendor: link.vendor, serial: link.serial, host: hostNow, accessCode: input.accessCode });
    if (!tested.ok) throw new HttpError(400, testFailure(tested.code, tested.message));
    const updated = await prisma.printerLink.update({ where: { id }, data: { host: hostNow, codeState: 'ok' }, select: linkSelect });
    await trackPrinterById(id);
    await pushConfig(link.bridgeId, { [id]: input.accessCode }, true);
    describeActivity(`Updated the access code for printer ${link.machine.name}`, { type: 'machine', id: link.machineId });
    res.json(updated);
  });

  /** Unlink a printer. The machine stays, and so does its hardware with whatever is loaded; it just stops updating. */
  router.delete('/printers/:id', async (req, res) => {
    requireEnabled();
    const id = param(req, 'id');
    const link = await prisma.printerLink.findFirst({ where: { id, workspaceId: req.workspaceId } });
    if (!link) throw notFound('Printer');
    await prisma.$transaction(async (tx) => {
      await releaseFeeders(tx, req.workspaceId, link.vendor, link.serial);
      await tx.printerLink.delete({ where: { id } });
    });
    forgetPrinter(id);
    // The bridge drops the printer, and its access code with it.
    await pushConfig(link.bridgeId);
    res.status(204).end();
  });
}

function testFailure(code: string, message?: string): string {
  switch (code) {
    case 'auth_failed': return 'The printer refused that access code. Check it on the printer\'s screen (Settings, then Network or LAN Only) and try again.';
    case 'unreachable': return 'The bridge could not reach a printer at that address. Check the address and that the printer is on the same network as the bridge.';
    case 'wrong_printer': return 'A printer answered at that address, but with a different serial number.';
    case 'not_allowed': return 'The bridge only talks to addresses on its own network.';
    default: return message ?? 'The bridge could not connect to the printer.';
  }
}

// ---- Pairing: the one route a bridge calls before it has a token ---------------------------

export const bridgeRouter = Router();

bridgeRouter.post('/pair', rateLimit(10, 10 * 60_000), async (req, res) => {
  requireEnabled();
  const input = parse(pairRequest, req.body);
  const pairingHash = hashSecret(normalizePairingCode(input.code));
  const token = newBridgeToken();
  // Claimed in one conditional write, so a code can only ever be used once. Any earlier token stops working here:
  // re-pairing replaces the old install rather than adding a second one.
  const claimed = await prisma.bridge.updateMany({
    where: { pairingHash, pairingExpiresAt: { gt: new Date() } },
    data: { pairingHash: null, pairingExpiresAt: null, tokenHash: hashSecret(token), version: input.version, platform: input.platform },
  });
  if (claimed.count !== 1) throw new HttpError(400, 'That set-up code is not valid or has run out. Make a new one in Settings, Printers.');
  const bridge = await prisma.bridge.findUniqueOrThrow({ where: { tokenHash: hashSecret(token) }, select: { id: true, workspaceId: true, workspace: { select: { name: true } } } });
  disconnectBridge(bridge.id);
  notifyWorkspaceSoon(bridge.workspaceId);
  res.json({ token, bridgeId: bridge.id, workspaceName: bridge.workspace.name });
});
