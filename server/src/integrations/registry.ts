import { applyMergePatch, deepEqual, type CodeState, type Doc, type LinkStatus, type PrinterReport, type PrinterStatus, type ReportAck } from '@filament-tracker/protocol';
import { prisma, type Json } from '@/db';
import { syncFeeders } from '@/integrations/amsSync';
import { reconcileRun, type JobFileReader } from '@/integrations/runs';
import { bambuAdapter } from '@/integrations/bambu/normalize';
import { traySignature } from '@/integrations/spoolMatch';
import { emptyReading, type PrinterAdapter, type PrinterConnection, type PrinterReading, type PrinterState } from '@/integrations/types';
import { emitToWorkspace, notifyWorkspaceSoon } from '@/realtime';

/**
 * Every connected printer's latest status, held in memory.
 *
 * Printers report every second or two, so none of that is written to the database as it arrives. Browsers get
 * it over the socket ("printer:state"). The database only changes when something real does: a spool swapped,
 * a feeder added, the printer's firmware or model becoming known. The last reading is also saved now and then
 * (at most once a minute, and when a bridge goes away) so there is something to show while a bridge is offline
 * or after a restart.
 */

const ADAPTERS: Record<string, PrinterAdapter> = { bambu: bambuAdapter };
export const adapterFor = (vendor: string): PrinterAdapter => ADAPTERS[vendor] ?? bambuAdapter;

interface Entry {
  linkId: string;
  workspaceId: string;
  machineId: string;
  machineName: string;
  bridgeId: string;
  serial: string;
  adapter: PrinterAdapter;
  /** The printer's own document as the bridge last described it; null until a full report arrives. */
  doc: Doc | null;
  /** Sequence number of the last report taken from the current connection; -1 when a full one is needed. */
  seq: number;
  reading: PrinterReading | null;
  asOf: number | null;
  endsAt: number | null;
  link: LinkStatus | null;
  codeState: CodeState;
  modelName: string;
  firmware: string;
  /** Changed since it was last saved. */
  dirty: boolean;
  emitTimer: ReturnType<typeof setTimeout> | null;
  lastEmitAt: number;
  /** What the feeders held when they were last synced to the database. */
  syncedSignature: string | null;
  lastSyncAt: number;
  syncTimer: ReturnType<typeof setTimeout> | null;
  emptySince: Map<string, number>;
  /** The printer's state and print name when its prints were last brought up to date. */
  runSignature: string | null;
  runPending: boolean;
}

const entries = new Map<string, Entry>();
const onlineBridges = new Set<string>();

const EMIT_GAP_MS = 1000;
const SAVE_EVERY_MS = 60_000;
const RESYNC_EVERY_MS = 10 * 60_000;
const SYNC_DEBOUNCE_MS = 1500;

// ---- One writer at a time ----------------------------------------------------------
// SQLite takes one writer; request handlers may hold it for a while. Everything a printer causes to be written
// goes through this queue, so a burst of reports can never pile up competing transactions.

let writes: Promise<unknown> = Promise.resolve();

export function enqueueWrite<T>(work: () => Promise<T>): Promise<T | undefined> {
  const next = writes.then(work).catch((cause: unknown) => {
    console.error('Printer update could not be saved', cause);
    return undefined;
  });
  writes = next;
  return next;
}

/** Resolves once every queued write has finished. For shutdown and tests. */
export const writesSettled = (): Promise<unknown> => writes;

// ---- Reading state out -------------------------------------------------------------

function connectionOf(entry: Entry): PrinterConnection {
  if (!onlineBridges.has(entry.bridgeId)) return entry.reading ? 'bridge_offline' : 'never_seen';
  if (entry.codeState !== 'ok') return 'needs_code';
  if (entry.link === 'online') return 'live';
  return entry.reading ? 'printer_unreachable' : entry.link === 'connecting' || entry.link === null ? 'never_seen' : 'printer_unreachable';
}

function stateOf(entry: Entry): PrinterState {
  return {
    ...(entry.reading ?? emptyReading()),
    v: 1,
    machineId: entry.machineId,
    printerLinkId: entry.linkId,
    connection: connectionOf(entry),
    asOf: entry.asOf,
    endsAt: entry.endsAt,
  };
}

export const statesForWorkspace = (workspaceId: string): PrinterState[] =>
  [...entries.values()].filter((entry) => entry.workspaceId === workspaceId).map(stateOf);

export const stateForLink = (linkId: string): PrinterState | null => {
  const entry = entries.get(linkId);
  return entry ? stateOf(entry) : null;
};

export const bridgeIsOnline = (bridgeId: string): boolean => onlineBridges.has(bridgeId);

/** Tell browsers, at most once a second per printer; the last change in a burst always goes out. */
function emitSoon(entry: Entry): void {
  if (entry.emitTimer) return;
  const wait = Math.max(0, EMIT_GAP_MS - (Date.now() - entry.lastEmitAt));
  entry.emitTimer = setTimeout(() => {
    entry.emitTimer = null;
    entry.lastEmitAt = Date.now();
    if (entries.get(entry.linkId) === entry) emitToWorkspace(entry.workspaceId, 'printer:state', stateOf(entry));
  }, wait);
  entry.emitTimer.unref();
}

// ---- Keeping track of printers -------------------------------------------------------

interface LinkRow {
  id: string;
  workspaceId: string;
  machineId: string;
  bridgeId: string;
  vendor: string;
  serial: string;
  codeState: string;
  modelName: string;
  firmware: string;
  lastState: unknown;
  machine: { name: string };
}

const linkSelect = {
  id: true, workspaceId: true, machineId: true, bridgeId: true, vendor: true, serial: true, codeState: true,
  modelName: true, firmware: true, lastState: true, machine: { select: { name: true } },
} as const;

interface Saved {
  reading: PrinterReading;
  asOf: number | null;
  endsAt: number | null;
}

export function trackPrinter(link: LinkRow): void {
  const previous = entries.get(link.id);
  const saved = link.lastState as Saved | null;
  entries.set(link.id, {
    linkId: link.id, workspaceId: link.workspaceId, machineId: link.machineId, machineName: link.machine.name,
    bridgeId: link.bridgeId, serial: link.serial, adapter: adapterFor(link.vendor),
    doc: previous?.doc ?? null, seq: previous?.seq ?? -1,
    reading: previous?.reading ?? saved?.reading ?? null,
    asOf: previous?.asOf ?? saved?.asOf ?? null,
    endsAt: previous?.endsAt ?? saved?.endsAt ?? null,
    link: previous?.link ?? null,
    codeState: (link.codeState as CodeState) ?? 'ok',
    modelName: link.modelName, firmware: link.firmware,
    dirty: false, emitTimer: null, lastEmitAt: 0,
    syncedSignature: previous?.syncedSignature ?? null, lastSyncAt: previous?.lastSyncAt ?? 0, syncTimer: null,
    emptySince: previous?.emptySince ?? new Map(),
    runSignature: previous?.runSignature ?? null, runPending: false,
  });
}

export async function trackPrinterById(linkId: string): Promise<void> {
  const link = await prisma.printerLink.findUnique({ where: { id: linkId }, select: linkSelect });
  if (link) trackPrinter(link);
}

export function forgetPrinter(linkId: string): void {
  const entry = entries.get(linkId);
  if (!entry) return;
  if (entry.emitTimer) clearTimeout(entry.emitTimer);
  if (entry.syncTimer) clearTimeout(entry.syncTimer);
  entries.delete(linkId);
}

let saveTimer: ReturnType<typeof setInterval> | null = null;

/** At start-up: every linked printer, with its last saved reading. Nothing is written and no status changes. */
export async function hydrateRegistry(): Promise<void> {
  const links = await prisma.printerLink.findMany({ select: linkSelect });
  links.forEach(trackPrinter);
  saveTimer ??= setInterval(() => {
    const now = Date.now();
    for (const entry of entries.values()) {
      if (entry.dirty) void save(entry);
      // Readings (humidity, drying) drift without any tray changing; catch them up now and then.
      if (entry.reading && connectionOf(entry) === 'live' && now - entry.lastSyncAt > RESYNC_EVERY_MS) scheduleSync(entry, 0);
      if (entry.reading && connectionOf(entry) === 'live' && entry.reading.phase !== 'idle') followPrint(entry);
    }
  }, SAVE_EVERY_MS);
  saveTimer.unref();
}

function save(entry: Entry): Promise<unknown> {
  entry.dirty = false;
  if (!entry.reading) return Promise.resolve();
  const saved: Saved = { reading: entry.reading, asOf: entry.asOf, endsAt: entry.endsAt };
  return enqueueWrite(() =>
    prisma.printerLink.updateMany({
      where: { id: entry.linkId },
      data: { lastState: saved as unknown as Json, lastStateAt: new Date(), modelName: entry.modelName, firmware: entry.firmware, codeState: entry.codeState },
    }),
  );
}

/** Save everything that changed. Called when the server is asked to stop. */
export async function flushRegistry(): Promise<void> {
  for (const entry of entries.values()) if (entry.dirty) void save(entry);
  await writesSettled();
}

// ---- Feeders and spools ------------------------------------------------------------

const feederSignature = (reading: PrinterReading): string =>
  reading.feeders.map((feeder) => `${feeder.key}=${feeder.trays.map((tray) => `${tray.position}:${traySignature(tray)}`).join(',')}`).join(';');

function scheduleSync(entry: Entry, delay = SYNC_DEBOUNCE_MS): void {
  if (entry.syncTimer) return;
  entry.syncTimer = setTimeout(() => {
    entry.syncTimer = null;
    const reading = entry.reading;
    if (!reading || entries.get(entry.linkId) !== entry) return;
    const signature = feederSignature(reading);
    void enqueueWrite(async () => {
      const result = await syncFeeders(entry, reading, entry.emptySince);
      entry.lastSyncAt = Date.now();
      // Until a tray that went empty has settled, the sync is not finished: keep the old signature so it runs again.
      if (result.retryInMs === null) entry.syncedSignature = signature;
      else scheduleSync(entry, result.retryInMs + 250);
      if (result.changed) notifyWorkspaceSoon(entry.workspaceId);
    });
  }, delay);
  entry.syncTimer.unref();
}

// ---- Prints ------------------------------------------------------------------------

type FileReaderFor = (bridgeId: string, printerId: string) => JobFileReader;
let fileReaderFor: FileReaderFor = () => async () => null;

/** How to read a print's sliced file through a bridge. Set by the gateway, which owns the connections. */
export function setJobFileReader(reader: FileReaderFor): void {
  fileReaderFor = reader;
}

/** Bring the record of this printer's prints (and their jobs) in line with what it is doing. One at a time per printer. */
function followPrint(entry: Entry): void {
  if (entry.runPending || !entry.reading || !entry.doc) return;
  entry.runPending = true;
  const reading = entry.reading;
  const doc = entry.doc;
  // Not through the write queue: reading the sliced file can take a minute, and nothing else should wait on it.
  // Its own writes are small, and only one of these runs per printer at a time.
  reconcileRun(entry, reading, doc, fileReaderFor(entry.bridgeId, entry.linkId))
    .then((changed) => {
      if (changed) notifyWorkspaceSoon(entry.workspaceId);
    })
    .catch((cause: unknown) => console.error('Could not follow a print', cause))
    .finally(() => {
      entry.runPending = false;
      // Whatever happened while this one ran is looked at now.
      const latest = entry.reading ? `${entry.reading.phase}|${entry.reading.print?.name ?? ''}` : null;
      if (latest !== null && latest !== `${reading.phase}|${reading.print?.name ?? ''}`) followPrint(entry);
    });
}

// ---- What bridges tell us ------------------------------------------------------------

function accept(entry: Entry, doc: Doc): void {
  entry.doc = doc;
  const reading = entry.adapter.read(doc);
  const now = Date.now();
  const before = entry.reading;
  entry.reading = reading;
  entry.asOf = now;
  entry.endsAt = reading.print?.remainingMinutes != null && (reading.phase === 'printing' || reading.phase === 'paused') ? now + reading.print.remainingMinutes * 60_000 : null;
  if (reading.modelName && reading.modelName !== entry.modelName) entry.modelName = reading.modelName;
  if (reading.firmware && reading.firmware !== entry.firmware) entry.firmware = reading.firmware;
  if (!deepEqual(before, reading)) {
    entry.dirty = true;
    emitSoon(entry);
  }
  if (feederSignature(reading) !== entry.syncedSignature) scheduleSync(entry);
  // A print starting, ending or changing is acted on at once; progress in between is caught up once a minute.
  const runSignature = `${reading.phase}|${reading.print?.name ?? ''}`;
  if (runSignature !== entry.runSignature) {
    entry.runSignature = runSignature;
    followPrint(entry);
  }
}

/** One step of a printer's document from its bridge. The answer tells the bridge whether to carry on or start over. */
export function ingestReport(bridgeId: string, report: PrinterReport): ReportAck {
  const entry = entries.get(report.printerId);
  // Not this bridge's printer (or one that was just removed): nothing to resend.
  if (!entry || entry.bridgeId !== bridgeId) return { ok: true };
  if (report.kind === 'full') {
    entry.seq = report.seq;
    accept(entry, report.data);
    return { ok: true };
  }
  if (report.seq <= entry.seq && entry.seq !== -1) return { ok: true };
  if (entry.doc === null || entry.seq === -1 || report.seq !== entry.seq + 1) {
    entry.seq = -1;
    return { ok: false, resync: true };
  }
  entry.seq = report.seq;
  accept(entry, applyMergePatch(entry.doc, report.data) as Doc);
  return { ok: true };
}

export function setLinkStatus(bridgeId: string, status: PrinterStatus): void {
  const entry = entries.get(status.printerId);
  if (!entry || entry.bridgeId !== bridgeId) return;
  if (entry.link === status.link && entry.codeState === status.codeState) return;
  const codeChanged = entry.codeState !== status.codeState;
  entry.link = status.link;
  entry.codeState = status.codeState;
  emitSoon(entry);
  if (codeChanged) {
    void enqueueWrite(() => prisma.printerLink.updateMany({ where: { id: entry.linkId }, data: { codeState: entry.codeState } }));
    notifyWorkspaceSoon(entry.workspaceId);
  }
}

export function bridgeConnected(bridgeId: string): void {
  onlineBridges.add(bridgeId);
  for (const entry of entries.values()) {
    if (entry.bridgeId !== bridgeId) continue;
    // A new connection starts its numbering again and always opens with a full report.
    entry.seq = -1;
    entry.link = null;
    emitSoon(entry);
  }
}

export function bridgeDisconnected(bridgeId: string): void {
  onlineBridges.delete(bridgeId);
  for (const entry of entries.values()) {
    if (entry.bridgeId !== bridgeId) continue;
    entry.link = null;
    emitSoon(entry);
    if (entry.dirty) void save(entry);
  }
}

/** For tests: forget everything. */
export function resetRegistry(): void {
  for (const linkId of [...entries.keys()]) forgetPrinter(linkId);
  onlineBridges.clear();
  if (saveTimer) clearInterval(saveTimer);
  saveTimer = null;
}
