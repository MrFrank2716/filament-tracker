import type { Doc } from '@filament-tracker/protocol';
import { prisma, type Json } from '@/db';
import { HttpError } from '@/http';
import { plateFor, readSliceInfo, SLICE_INFO } from '@/integrations/threemf';
import type { PrinterAdapter, PrinterReading } from '@/integrations/types';
import { logSystemActivity } from '@/services/activity';
import { endOfQueue, finishJob, startJob } from '@/services/jobs';
import { round } from '@/services/stock';

/**
 * Following prints. When a connected printer is seen printing, the print becomes a job (or joins the job a
 * member already made for it); when the printer says it finished or failed, the job is finished with the real
 * run time and what the sliced file said each spool would give up, and stock is taken.
 *
 * Decisions are made from what the printer is doing NOW compared with the print on record, not from the moment
 * something changed. That is what makes a bridge reconnecting, the server restarting or a report arriving twice
 * harmless: the same comparison simply gives the same answer.
 */

export interface RunTarget {
  linkId: string;
  workspaceId: string;
  machineId: string;
  machineName: string;
  serial: string;
  adapter: PrinterAdapter;
}

/** One filament of a print: what the file says it uses, and the stock item in the tray it feeds from. */
export interface RunFilament {
  id: number;
  material: string | null;
  colour: string | null;
  grams: number;
  feeder: string | null;
  position: number | null;
  itemId: string | null;
  itemName: string | null;
}

/** Reads the sliced file's summary through the bridge; null when it cannot. */
export type JobFileReader = (entries: string[]) => Promise<Record<string, string> | null>;

const busy = (reading: PrinterReading) => reading.phase === 'preparing' || reading.phase === 'printing' || reading.phase === 'paused';

const plain = (name: string) => name.toLowerCase().replace(/\.gcode\.3mf$|\.3mf$|\.gcode$/g, '').replace(/\s+/g, ' ').trim();

const progressOf = (reading: PrinterReading): number => {
  const print = reading.print;
  if (!print) return 0;
  if (print.layer !== null && print.totalLayers) return Math.min(1, print.layer / print.totalLayers);
  return print.progress !== null ? Math.min(1, print.progress / 100) : 0;
};

/**
 * Which tray each of the print's filaments comes from, as the printer announced when the print was sent.
 * Index is the filament's number minus one; a value is feeder x 4 + tray, 254 / 255 the outside holder,
 * anything else "not used".
 */
function trayFor(doc: Doc, filamentId: number, printName: string): { feeder: string; position: number } | null {
  const job = doc.job as { subtask_name?: unknown; use_ams?: unknown; ams_mapping?: unknown } | undefined;
  // An announcement left over from an earlier print says nothing about this one.
  if (!job || (typeof job.subtask_name === 'string' && plain(job.subtask_name) !== plain(printName))) return null;
  if (job.use_ams === false) return { feeder: 'external:0', position: 1 };
  const value = Array.isArray(job.ams_mapping) ? Number(job.ams_mapping[filamentId - 1]) : Number.NaN;
  if (!Number.isInteger(value) || value < 0) return null;
  if (value === 254 || value === 255) return { feeder: 'external:0', position: 1 };
  if (value >= 128) return { feeder: `ams:${value}`, position: 1 };
  return { feeder: `ams:${Math.floor(value / 4)}`, position: (value % 4) + 1 };
}

const plateIndex = (doc: Doc): number | null => {
  const param = (doc.job as { param?: unknown } | undefined)?.param;
  const match = typeof param === 'string' ? /plate_(\d+)\.gcode/.exec(param) : null;
  return match ? Number(match[1]) : null;
};

/** What the print will use, per filament, with the stock item in each tray as it stands now. */
async function readFilaments(target: RunTarget, doc: Doc, printName: string, read: JobFileReader): Promise<RunFilament[] | null> {
  const entries = await read([SLICE_INFO]).catch(() => null);
  const xml = entries?.[SLICE_INFO];
  if (!xml) return null;
  const plate = plateFor(readSliceInfo(xml), plateIndex(doc));
  if (!plate || plate.filaments.length === 0) return null;

  const filaments: RunFilament[] = [];
  for (const filament of plate.filaments) {
    const tray = trayFor(doc, filament.id, printName);
    let item: { id: string; name: string } | null = null;
    if (tray) {
      const slot = await prisma.slot.findFirst({
        where: { position: tray.position, subUnit: { workspaceId: target.workspaceId, externalId: target.adapter.externalId(target.serial, tray.feeder) } },
        select: { item: { select: { id: true, name: true } } },
      });
      item = slot?.item ?? null;
    }
    filaments.push({ ...filament, grams: round(filament.grams, 2), feeder: tray?.feeder ?? null, position: tray?.position ?? null, itemId: item?.id ?? null, itemName: item?.name ?? null });
  }
  return filaments;
}

/** Grams become the item's own unit; an item kept in something else (pieces, metres) cannot be charged. */
async function usageLines(workspaceId: string, filaments: RunFilament[], scale: number): Promise<Array<{ itemId: string; quantity: number }>> {
  const byItem = new Map<string, number>();
  for (const filament of filaments) if (filament.itemId) byItem.set(filament.itemId, (byItem.get(filament.itemId) ?? 0) + filament.grams * scale);
  if (byItem.size === 0) return [];
  const items = await prisma.item.findMany({ where: { workspaceId, id: { in: [...byItem.keys()] } }, select: { id: true, unit: { select: { symbol: true } } } });
  const lines: Array<{ itemId: string; quantity: number }> = [];
  for (const item of items) {
    const symbol = item.unit?.symbol.toLowerCase();
    const grams = byItem.get(item.id)!;
    if (symbol === 'g') lines.push({ itemId: item.id, quantity: round(grams, 1) });
    else if (symbol === 'kg') lines.push({ itemId: item.id, quantity: round(grams / 1000, 4) });
  }
  return lines;
}

/** The job this print belongs to: one a member just started, a planned one with the very same name, or a new one. */
async function jobFor(target: RunTarget, name: string, now: Date): Promise<string> {
  const { workspaceId, machineId } = target;
  const recent = await prisma.job.findFirst({
    where: { workspaceId, machineId, status: 'in_progress', runs: { none: {} }, startedAt: { gte: new Date(now.getTime() - 10 * 60_000) } },
    orderBy: { startedAt: 'desc' },
    select: { id: true },
  });
  if (recent) return recent.id;

  // A name match is only trusted for the workshop's own jobs: starting a job made from an outside request emails
  // the requester, which a coincidence of names must never do.
  const planned = await prisma.job.findMany({ where: { workspaceId, machineId, status: 'planned', request: null }, orderBy: [{ priority: 'desc' }, { queuePosition: 'asc' }], select: { id: true, name: true } });
  const same = planned.find((job) => plain(job.name) === plain(name));
  if (same) {
    try {
      await startJob(workspaceId, same.id, { at: now });
      return same.id;
    } catch (cause) {
      if (!(cause instanceof HttpError)) throw cause;
      // Someone started or changed it in the same moment: fall through to a job of its own.
    }
  }
  const created = await prisma.job.create({
    data: { workspaceId, machineId, name: name.slice(0, 160), status: 'in_progress', startedAt: now, source: 'printer', queuePosition: await endOfQueue(prisma, workspaceId, machineId) },
  });
  await prisma.machine.updateMany({ where: { id: machineId, status: 'ready' }, data: { status: 'in_use' } });
  return created.id;
}

async function closeRun(target: RunTarget, run: { id: string; jobId: string | null; name: string; startedAt: Date; filaments: unknown; progress: number }, outcome: 'completed' | 'failed' | 'cancelled' | 'unseen', reading: PrinterReading | null, now: Date): Promise<void> {
  const claimed = await prisma.printerRun.updateMany({ where: { id: run.id, endedAt: null }, data: { endedAt: now, outcome } });
  if (claimed.count !== 1 || !run.jobId) return;
  const job = await prisma.job.findUnique({ where: { id: run.jobId }, select: { status: true, name: true, source: true, _count: { select: { usages: true } } } });
  if (!job || (job.status !== 'in_progress' && job.status !== 'planned')) return; // a member already finished it

  if (outcome === 'unseen') {
    // It ended while nobody was listening: how it ended and how far it got are unknown, so nothing is deducted.
    await prisma.job.updateMany({ where: { id: run.jobId }, data: { failureReason: 'The print ended while the bridge was not connected. Check it and finish the job by hand.' } });
    return;
  }

  const filaments = (Array.isArray(run.filaments) ? run.filaments : []) as RunFilament[];
  const scale = outcome === 'completed' ? 1 : Math.max(run.progress, reading ? progressOf(reading) : 0);
  const lines = await usageLines(target.workspaceId, filaments, scale);
  // A job the printer made, or one with nothing entered, takes the print's own figures. Materials a member
  // entered on their own job by hand are theirs to keep.
  if (lines.length && (job.source === 'printer' || job._count.usages === 0)) await prisma.job.update({ where: { id: run.jobId }, data: { usages: { deleteMany: {}, create: lines } } });

  const hours = round(Math.max(0, now.getTime() - run.startedAt.getTime()) / 3_600_000, 2);
  const reason = outcome === 'completed' ? undefined : outcome === 'cancelled' ? 'Cancelled at the printer' : (reading?.errors.find((error) => error.severity !== 'info')?.message ?? 'The printer reported that the print failed');
  try {
    await finishJob(target.workspaceId, run.jobId, { outcome: outcome === 'completed' ? 'completed' : 'failed', userId: null, at: now, durationHours: hours, failureReason: reason });
  } catch (cause) {
    if (cause instanceof HttpError && cause.status === 409) return; // finished by a member in the same moment: theirs stands
    throw cause;
  }
  const used = lines.length ? `, using ${filaments.filter((f) => f.itemId).map((f) => `${round(f.grams * scale, 1)} g of ${f.itemName}`).join(' and ')}${scale < 1 ? ' (estimated from how far it got)' : ''}` : '';
  await logSystemActivity({
    workspaceId: target.workspaceId, actor: target.machineName, action: 'printer.job', entityType: 'job', entityId: run.jobId,
    summary: `${outcome === 'completed' ? 'Finished' : outcome === 'cancelled' ? 'Cancelled' : 'Failed'} ${job.name}${used}`,
  });
}

/**
 * Bring the record of this printer's prints in line with what it is doing now. Safe to call as often as reports
 * arrive; returns true when something the screens show changed.
 */
export async function reconcileRun(target: RunTarget, reading: PrinterReading, doc: Doc, read: JobFileReader, now = new Date()): Promise<boolean> {
  const name = reading.print?.name ?? null;
  const run = await prisma.printerRun.findFirst({ where: { printerLinkId: target.linkId, endedAt: null }, orderBy: { startedAt: 'desc' } });

  if (run) {
    const same = name !== null && plain(name) === plain(run.name);
    if (busy(reading) && same) {
      // Still going: remember how far it got, and pick up the file if it was not readable at the start.
      const progress = Math.max(run.progress, progressOf(reading));
      const needsFile = run.usageSource === '' && now.getTime() - run.startedAt.getTime() < 15 * 60_000;
      const filaments = needsFile ? await readFilaments(target, doc, run.name, read) : null;
      if (progress !== run.progress || filaments) {
        await prisma.printerRun.update({ where: { id: run.id }, data: { progress, ...(filaments ? { filaments: filaments as unknown as Json, usageSource: 'file' } : {}) } });
      }
      return Boolean(filaments);
    }
    if (same && reading.phase === 'finished') await closeRun(target, run, 'completed', reading, now);
    else if (same && reading.phase === 'failed') await closeRun(target, run, reading.errors.some((error) => error.code === '0300_400C' || error.code === '0500_400E') ? 'cancelled' : 'failed', reading, now);
    else if (reading.phase === 'unknown') return false; // nothing to go on yet
    else await closeRun(target, run, 'unseen', reading, now);
    if (!busy(reading)) return true;
  }

  // Only a print that is actually under way opens a record: a finished one left on the screen never does.
  if (!busy(reading) || !name) return Boolean(run);
  const jobId = await jobFor(target, name, now);
  const filaments = await readFilaments(target, doc, name, read);
  await prisma.printerRun.create({
    data: {
      workspaceId: target.workspaceId, printerLinkId: target.linkId, jobId, name: name.slice(0, 200), startedAt: now,
      filaments: (filaments ?? []) as unknown as Json, usageSource: filaments ? 'file' : '', progress: progressOf(reading),
    },
  });
  if (filaments) {
    // Show on the job what it is expected to use, while it runs; the same lines are charged when it ends.
    const lines = await usageLines(target.workspaceId, filaments, 1);
    const existing = await prisma.jobUsage.count({ where: { jobId } });
    if (lines.length && existing === 0) await prisma.job.update({ where: { id: jobId }, data: { usages: { create: lines } } });
  }
  return true;
}
