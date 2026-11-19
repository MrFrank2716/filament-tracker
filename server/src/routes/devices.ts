import { Router, type Request, type RequestHandler, type Response } from 'express';
import type { Prisma } from '@prisma/client';
import { z } from 'zod';
import { bearerToken } from '@/auth';
import { prisma, type Json } from '@/db';
import { env } from '@/env';
import { HttpError, notFound, param, parse } from '@/http';
import { armPendingSpool, statesForWorkspace } from '@/integrations/registry';
import { decodeBambuTag } from '@/integrations/bambu/tag';
import { isStickerTag } from '@/integrations/spoolMatch';
import { rateLimit } from '@/rateLimit';
import { notifyWorkspaceSoon } from '@/realtime';
import { describeActivity, logSystemActivity } from '@/services/activity';
import { buildOverview, displayPrinter, displayRow, forDisplay, itemSelect, locationTree, MAX_ROWS, POLL_SECONDS } from '@/services/deviceOverview';
import { itemForKey, readTagKey, readUid, spoolKey, tagIdFor } from '@/services/deviceTags';
import { appUrl } from '@/services/mail';
import { assertInWorkspace, moveItems } from '@/services/stock';
import { assignTag } from '@/services/tags';
import { hashSecret, newDeviceToken, newPairingCode, normalizePairingCode } from '@/services/tokens';

/**
 * Location displays: small screens of Wrkbench's own (a CYD board today) fixed to a shelf, rack or dry box.
 *
 * Set-up works like a bridge's: an admin makes a one-time code in Settings, the display swaps it for a long
 * random token, and only the token's hash is kept. After that the display polls GET /api/device/overview.
 * Every write under /workspaces/:wid/devices is for admins and owners (none is on the operator allow-list).
 */

const PAIRING_MINUTES = 10;
/** A display polls every 30 s and its last-seen time is written at most once a minute, so 2.5 minutes is safe. */
const ONLINE_MS = 150_000;
const TOUCH_MS = 60_000;

function requireEnabled(): void {
  if (!env.DEVICES_ENABLED) throw new HttpError(404, 'Location displays are switched off on this server');
}

const createInput = z.object({
  name: z.string().trim().min(1, 'Give the display a name').max(80),
  locationId: z.string().min(1).nullable().optional(),
});

const updateInput = z.object({
  name: z.string().trim().min(1, 'Give the display a name').max(80).optional(),
  locationId: z.string().min(1).nullable().optional(),
  machineId: z.string().min(1).nullable().optional(),
  canWrite: z.boolean().optional(),
});

async function issuePairing(deviceId: string) {
  const code = newPairingCode();
  const expiresAt = new Date(Date.now() + PAIRING_MINUTES * 60_000);
  await prisma.device.update({ where: { id: deviceId }, data: { pairingHash: hashSecret(normalizePairingCode(code)), pairingExpiresAt: expiresAt } });
  return { code, expiresAt, server: appUrl('') };
}

const deviceSelect = {
  id: true, name: true, kind: true, locationId: true, machineId: true, canWrite: true, model: true, version: true, hasReader: true,
  lastSeenAt: true, createdAt: true, tokenHash: true, pairingExpiresAt: true,
  location: { select: { name: true } },
  machine: { select: { name: true } },
} as const;

type DeviceRow = Prisma.DeviceGetPayload<{ select: typeof deviceSelect }>;

const isOnline = (lastSeenAt: Date | null) => lastSeenAt !== null && Date.now() - lastSeenAt.getTime() < ONLINE_MS;

const presentDevice = ({ tokenHash, pairingExpiresAt, location, machine, ...device }: DeviceRow) => ({
  ...device,
  locationName: location?.name ?? null,
  machineName: machine?.name ?? null,
  online: tokenHash !== null && isOnline(device.lastSeenAt),
  /** paired: has swapped its code for a token. Otherwise it is still waiting for set-up. */
  paired: tokenHash !== null,
  pairingExpiresAt: pairingExpiresAt && pairingExpiresAt > new Date() ? pairingExpiresAt : null,
});

const loadDevice = async (id: string) => presentDevice(await prisma.device.findUniqueOrThrow({ where: { id }, select: deviceSelect }));

export function registerDeviceRoutes(router: Router): void {
  router.get('/devices', async (req, res) => {
    requireEnabled();
    const devices = await prisma.device.findMany({ where: { workspaceId: req.workspaceId }, orderBy: { createdAt: 'asc' }, select: deviceSelect });
    res.json(devices.map(presentDevice));
  });

  router.post('/devices', async (req, res) => {
    requireEnabled();
    const { name, locationId } = parse(createInput, req.body);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.userId }, select: { isGuest: true } });
    // A guest's workspace is deleted after a week; a display left pointing at it would only cause confusion.
    if (user.isGuest) throw new HttpError(403, 'Create an account to set up a display. Guest sessions are temporary.');
    const count = await prisma.device.count({ where: { workspaceId: req.workspaceId } });
    if (count >= env.DEVICE_MAX_PER_WORKSPACE) throw new HttpError(409, `A workspace can have up to ${env.DEVICE_MAX_PER_WORKSPACE} displays. Remove one first.`);
    await assertInWorkspace(prisma, req.workspaceId, { location: locationId });
    const created = await prisma.device.create({ data: { workspaceId: req.workspaceId, name, locationId: locationId ?? null } });
    const pairing = await issuePairing(created.id);
    res.status(201).json({ ...(await loadDevice(created.id)), pairing });
  });

  /** A fresh code for the same display: to finish setting it up, or after it was reset. Its old token stops working once the code is used. */
  router.post('/devices/:id/pairing', async (req, res) => {
    requireEnabled();
    const id = param(req, 'id');
    const existing = await prisma.device.findFirst({ where: { id, workspaceId: req.workspaceId }, select: { name: true } });
    if (!existing) throw notFound('Display');
    describeActivity(`Made a new set-up code for display ${existing.name}`, { type: 'device', id });
    const pairing = await issuePairing(id);
    res.json({ ...(await loadDevice(id)), pairing });
  });

  router.patch('/devices/:id', async (req, res) => {
    requireEnabled();
    const input = parse(updateInput, req.body);
    const id = param(req, 'id');
    await assertInWorkspace(prisma, req.workspaceId, { location: input.locationId, machine: input.machineId });
    const updated = await prisma.device.updateMany({ where: { id, workspaceId: req.workspaceId }, data: input });
    if (updated.count !== 1) throw notFound('Display');
    res.json(await loadDevice(id));
  });

  /** Removes the display. Its token stops working at once, so the screen goes back to asking for a set-up code. */
  router.delete('/devices/:id', async (req, res) => {
    requireEnabled();
    const deleted = await prisma.device.deleteMany({ where: { id: param(req, 'id'), workspaceId: req.workspaceId } });
    if (deleted.count !== 1) throw notFound('Display');
    res.status(204).end();
  });

  // ---- Bambu Lab spools tapped on a display that nothing in stock is tied to yet -------------
  router.get('/unknown-tags', async (req, res) => {
    const tags = await prisma.unknownTag.findMany({
      where: { workspaceId: req.workspaceId },
      orderBy: { createdAt: 'asc' },
      select: { id: true, tagId: true, detected: true, createdAt: true, device: { select: { name: true, locationId: true } } },
    });
    res.json(tags);
  });

  /** "Not a spool of ours": forget the read. Tying the tag to an item (or adding one with it) forgets it too. */
  router.delete('/unknown-tags/:id', async (req, res) => {
    const removed = await prisma.unknownTag.deleteMany({ where: { id: param(req, 'id'), workspaceId: req.workspaceId } });
    if (removed.count !== 1) throw notFound('Tag');
    describeActivity('Dismissed a spool read at a display');
    res.status(204).end();
  });
}

// ---- What the display itself calls -------------------------------------------------------

const pairInput = z.object({
  code: z.string().trim().min(1).max(40),
  model: z.string().trim().max(60).default(''),
  version: z.string().trim().max(40).default(''),
});

const authedSelect = {
  id: true, workspaceId: true, name: true, locationId: true, machineId: true, canWrite: true, hasReader: true, lastSeenAt: true,
  workspace: { select: { name: true } },
  machine: { select: { name: true } },
} as const;

type AuthedDevice = Prisma.DeviceGetPayload<{ select: typeof authedSelect }>;

const deviceOf = (res: Response): AuthedDevice => res.locals.device as AuthedDevice;

/** Signs a display in by its token. User sign-ins and bridge tokens are refused here, and a display token works nowhere else. */
const deviceAuth: RequestHandler = async (req, res, next) => {
  requireEnabled();
  const token = bearerToken(req.headers.authorization);
  if (!token.startsWith('wbd_')) throw new HttpError(401, 'This display is not set up');
  const device = await prisma.device.findUnique({ where: { tokenHash: hashSecret(token) }, select: authedSelect });
  if (!device) throw new HttpError(401, 'This display is not set up');
  res.locals.device = device;
  next();
};

/** Note that the display is alive, at most once a minute. Settings is told when it comes back, so its card turns green. */
async function touch(device: AuthedDevice, hasReader: boolean | null): Promise<void> {
  const stale = !device.lastSeenAt || Date.now() - device.lastSeenAt.getTime() > TOUCH_MS;
  const readerChanged = hasReader !== null && hasReader !== device.hasReader;
  if (!stale && !readerChanged) return;
  const wasOnline = isOnline(device.lastSeenAt);
  await prisma.device.update({ where: { id: device.id }, data: { lastSeenAt: new Date(), ...(hasReader === null ? {} : { hasReader }) } });
  if (!wasOnline || readerChanged) notifyWorkspaceSoon(device.workspaceId);
}

function requireWrite(device: AuthedDevice): void {
  if (!device.canWrite) throw new HttpError(403, 'Changes from this display are switched off in Settings');
}

/** After a change made from a display: written down under the display's name, and open browsers refresh. */
async function logChange(device: AuthedDevice, action: string, summary: string, entityId: string | null) {
  await logSystemActivity({ workspaceId: device.workspaceId, actor: device.name, action, entityType: 'item', entityId, summary });
  notifyWorkspaceSoon(device.workspaceId);
}

export const deviceRouter = Router();

/** The one call a display makes before it has a token. */
deviceRouter.post('/pair', rateLimit(10, 10 * 60_000), async (req, res) => {
  requireEnabled();
  const input = parse(pairInput, req.body);
  const pairingHash = hashSecret(normalizePairingCode(input.code));
  const token = newDeviceToken();
  // One conditional write, so a code is only ever used once. Any earlier token stops working here.
  const claimed = await prisma.device.updateMany({
    where: { pairingHash, pairingExpiresAt: { gt: new Date() } },
    data: { pairingHash: null, pairingExpiresAt: null, tokenHash: hashSecret(token), model: input.model, version: input.version, lastSeenAt: new Date() },
  });
  if (claimed.count !== 1) throw new HttpError(400, 'That set-up code is not valid or has run out. Make a new one in Settings, Displays.');
  const device = await prisma.device.findUniqueOrThrow({ where: { tokenHash: hashSecret(token) }, select: authedSelect });
  await logSystemActivity({ workspaceId: device.workspaceId, actor: device.name, action: 'device.pair', entityType: 'device', entityId: device.id, summary: `Display ${device.name} was set up` });
  notifyWorkspaceSoon(device.workspaceId);
  res.json({ token, deviceId: device.id, workspaceName: device.workspace.name, deviceName: device.name, poll: POLL_SECONDS });
});

deviceRouter.use(rateLimit(120, 60_000), deviceAuth);

/**
 * What to draw. `location` browses another location of the same workspace; `since` is the `v` of what the
 * display already has (304 when nothing changed); `nfc=1|0` says whether its tag reader is working.
 */
deviceRouter.get('/overview', async (req, res) => {
  const device = deviceOf(res);
  const nfc = req.query.nfc === '1' ? true : req.query.nfc === '0' ? false : null;
  await touch(device, nfc);
  const asked = typeof req.query.location === 'string' && req.query.location ? req.query.location : null;
  if (asked && !(await prisma.location.count({ where: { id: asked, workspaceId: device.workspaceId } }))) throw notFound('Location');
  const overview = await buildOverview(prisma, device, asked ?? device.locationId, printerBeside(device));
  if (typeof req.query.since === 'string' && req.query.since === overview.v) {
    res.status(304).end();
    return;
  }
  res.json(overview);
});

/** The status of the printer chosen as "beside" this display, from the live readings the bridge sends. */
function printerBeside(device: AuthedDevice) {
  if (!env.PRINTERS_ENABLED || !device.machineId || !device.machine) return null;
  const state = statesForWorkspace(device.workspaceId).find((s) => s.machineId === device.machineId) ?? null;
  return displayPrinter(device.machine.name, state);
}

type TaggedItem = NonNullable<Awaited<ReturnType<typeof itemForKey>>>;
type Tree = Awaited<ReturnType<typeof locationTree>>;

/** What the display shows for a tag nothing is tied to. */
const unknownTag = (device: AuthedDevice, key: string) => ({ known: false, uid: key, canLink: device.canWrite && device.locationId !== null });

/** What the display shows for a tagged item: what it is, where it is kept, and what this display may do with it. */
function knownTag(device: AuthedDevice, key: string, item: TaggedItem, tree: Tree) {
  const here = item.locationId !== null && item.locationId === device.locationId;
  return {
    known: true,
    uid: key,
    item: { ...displayRow(item, null, () => ''), location: item.locationId ? forDisplay(tree.path(item.locationId), 64) : null, here },
    canPutAway: device.canWrite && device.locationId !== null && !here,
    insertInto: device.canWrite && device.machineId && device.machine ? { machineId: device.machineId, name: device.machine.name } : null,
  };
}

/** A tag looked up without changing anything. */
deviceRouter.get('/tag/:uid', async (req, res) => {
  const device = deviceOf(res);
  const key = readTagKey(param(req, 'uid'));
  const item = await itemForKey(prisma, device.workspaceId, key);
  res.json(item ? knownTag(device, key, item, await locationTree(prisma, device.workspaceId)) : unknownTag(device, key));
});

const tapInput = z.object({
  /** A Bambu Lab spool's data blocks, as the reader unlocked them: block number to its 16 bytes in hex. */
  blocks: z.record(z.string().regex(/^\d{1,2}$/), z.string().regex(/^[0-9a-fA-F]{32}$/)).refine((blocks) => Object.keys(blocks).length <= 64).optional(),
});

/**
 * A tag was held to the reader. The spool is tagged in or out by itself: one kept here (or in a location inside
 * this one) is taken out and is "on the move" until it is put away or a printer reports it loaded; any other is
 * put away here. Answers like the lookup above, with `message` saying what was done.
 *
 * `:uid` is the chip's UID. With a Bambu Lab spool the display also sends the tag's data, and the spool is known
 * by the id read from it; every later call for that tag uses the key in the answer's `uid`.
 */
deviceRouter.post('/tag/:uid/tap', async (req, res) => {
  const device = deviceOf(res);
  const chip = readUid(param(req, 'uid'));
  const { blocks } = parse(tapInput, req.body ?? {});
  const facts = blocks ? decodeBambuTag(blocks) : null;
  const key = facts?.tagId ? spoolKey(facts.tagId) : chip;
  const { workspaceId } = device;
  const item = await itemForKey(prisma, workspaceId, key);

  if (!item) {
    if (!facts?.tagId) {
      res.json(unknownTag(device, key));
      return;
    }
    const what = [facts.brand, facts.subType ?? facts.material].filter(Boolean).join(' ');
    // With changes switched off the display only says what it read: nothing is kept for the app.
    if (!device.canWrite) {
      res.json({ ...unknownTag(device, key), message: forDisplay(`Not in stock yet: ${what}.`, 90) });
      return;
    }
    // A spool Wrkbench has not met: kept for a member to say what it is, in the app.
    const waiting = await prisma.unknownTag.findUnique({ where: { workspaceId_tagId: { workspaceId, tagId: facts.tagId } }, select: { id: true } });
    await prisma.unknownTag.upsert({
      where: { workspaceId_tagId: { workspaceId, tagId: facts.tagId } },
      create: { workspaceId, deviceId: device.id, tagId: facts.tagId, detected: facts as unknown as Json },
      update: { deviceId: device.id, detected: facts as unknown as Json },
    });
    if (!waiting) await logChange(device, 'device.unknown', `Read a spool that is not in stock yet: ${what}`, null);
    res.json({ ...unknownTag(device, key), message: forDisplay(`Not in stock yet: ${what}. Add it in Wrkbench.`, 90) });
    return;
  }

  let tree = await locationTree(prisma, workspaceId);
  let message = '';
  if (device.canWrite && device.locationId) {
    const place = tree.byId.get(device.locationId)?.name ?? 'this location';
    const keptHere = item.locationId !== null && tree.subtree(device.locationId).includes(item.locationId);
    if (keptHere && !item.outSince) {
      await prisma.item.update({ where: { id: item.id }, data: { locationId: null, outSince: new Date() } });
      await logChange(device, 'item.move', `Took ${item.name} out of ${place}: it is on the move`, item.id);
      message = 'Taken out: on the move';
    } else {
      await prisma.item.update({ where: { id: item.id }, data: { locationId: device.locationId, outSince: null } });
      await logChange(device, 'item.move', `Put ${item.name} away in ${place}`, item.id);
      message = `Put away in ${forDisplay(place, 40)}`;
    }
  }
  const now = message ? await itemForKey(prisma, workspaceId, key) : item;
  if (message) tree = await locationTree(prisma, workspaceId);
  res.json({ ...knownTag(device, key, now ?? item, tree), ...(message ? { message } : {}) });
});

/** Items in this display's location (and below) without a tag, to link a new sticker to. Printer-tagged spools are left out. */
deviceRouter.get('/untagged', async (_req, res) => {
  const device = deviceOf(res);
  if (!device.locationId) {
    res.json({ items: [] });
    return;
  }
  const tree = await locationTree(prisma, device.workspaceId);
  const items = await prisma.item.findMany({
    where: { workspaceId: device.workspaceId, archived: false, tagId: null, locationId: { in: tree.subtree(device.locationId) } },
    select: itemSelect,
    orderBy: { name: 'asc' },
    take: MAX_ROWS,
  });
  res.json({ items: items.map((item) => displayRow(item, device.locationId, (id) => tree.byId.get(id)?.name ?? '')) });
});

async function taggedItem(req: Request, device: AuthedDevice) {
  const item = await itemForKey(prisma, device.workspaceId, readTagKey(param(req, 'uid')));
  if (!item) throw notFound('Item with that tag');
  return item;
}

/** "This spool lives here now." */
deviceRouter.post('/tag/:uid/put-away', async (req, res) => {
  const device = deviceOf(res);
  requireWrite(device);
  if (!device.locationId) throw new HttpError(409, 'This display has no location yet. Choose one in Settings, Displays.');
  const item = await taggedItem(req, device);
  const { moved, summary } = await moveItems(prisma, device.workspaceId, [item.id], device.locationId);
  if (moved.length) await logChange(device, 'item.move', summary, item.id);
  res.json({ moved: moved.length, message: moved.length ? forDisplay(summary, 60) : 'Already here' });
});

/** "This spool is going into the printer next": the same as scanning it on the Load spools screen. */
deviceRouter.post('/tag/:uid/insert', async (req, res) => {
  const device = deviceOf(res);
  requireWrite(device);
  if (!device.machineId || !device.machine) throw new HttpError(409, 'This display has no printer chosen. Choose one in Settings, Displays.');
  const item = await taggedItem(req, device);
  const expiresAt = armPendingSpool(device.workspaceId, device.machineId, item);
  if (expiresAt === null) throw new HttpError(409, `${device.machine.name} is not reporting right now, so Wrkbench cannot see a spool go in. Choose the slot in the app instead.`);
  await logChange(device, 'printer.pending', `Tapped ${item.name} to go into ${device.machine.name} next`, item.id);
  res.json({ expiresAt, message: `Put ${forDisplay(item.name)} into ${forDisplay(device.machine.name)} in the next 2 minutes` });
});

/** Tie a new sticker to an item kept at this display's location (or inside it). An item that carries a printer's own spool tag keeps it: replacing it would stop the printer recognising the spool. */
deviceRouter.post('/tag/:uid/link', async (req, res) => {
  const device = deviceOf(res);
  requireWrite(device);
  const key = readTagKey(param(req, 'uid'));
  const { itemId } = parse(z.object({ itemId: z.string().min(1) }), req.body);
  if (!device.locationId) throw new HttpError(409, 'This display has no location yet. Choose one in Settings, Displays.');
  const item = await prisma.item.findFirst({ where: { id: itemId, workspaceId: device.workspaceId, archived: false }, select: { id: true, name: true, tagId: true, locationId: true } });
  if (!item) throw notFound('Item');
  // A display links tags to what is kept where it is (what its own list offers), not to anything in the workspace.
  const tree = await locationTree(prisma, device.workspaceId);
  if (!item.locationId || !tree.subtree(device.locationId).includes(item.locationId)) throw new HttpError(403, `${item.name} is not kept at this display's location`);
  if (item.tagId && !isStickerTag(item.tagId)) throw new HttpError(409, `${item.name} already has its spool's own tag, which the printer uses to recognise it`);
  await prisma.$transaction((tx) => assignTag(tx, device.workspaceId, item.id, tagIdFor(key)));
  await logChange(device, 'item.tag', `Tagged ${item.name}`, item.id);
  res.json({ ok: true, message: `Linked to ${forDisplay(item.name)}` });
});

