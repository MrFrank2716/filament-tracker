import type { StatusTone } from '@/components/ui/Display';
import { formatNumber, relativeDays } from '@/lib/format';
import type { DueStatus, JobStatus, MachineStatus, PrinterConnection, PrinterError, PrinterPhase, ProjectStage, RequestStatus, ScheduleEntry } from '@/lib/types';

export const MACHINE_STATUS: Record<MachineStatus, { label: string; tone: StatusTone }> = {
  ready: { label: 'Ready', tone: 'ok' },
  in_use: { label: 'In use', tone: 'info' },
  needs_service: { label: 'Needs service', tone: 'warn' },
  offline: { label: 'Offline', tone: 'neutral' },
};

/** What a connected printer is doing, in its own terms. */
export const PRINTER_PHASE: Record<PrinterPhase, { label: string; tone: StatusTone }> = {
  idle: { label: 'Idle', tone: 'ok' },
  preparing: { label: 'Preparing', tone: 'info' },
  printing: { label: 'Printing', tone: 'info' },
  paused: { label: 'Paused', tone: 'warn' },
  finished: { label: 'Finished', tone: 'ok' },
  failed: { label: 'Stopped', tone: 'danger' },
  unknown: { label: 'Unknown', tone: 'neutral' },
};

/** Why a connected printer's figures may be old. `live` needs no explaining. */
export const PRINTER_CONNECTION: Record<PrinterConnection, { label: string; tone: StatusTone; hint: string }> = {
  live: { label: 'Live', tone: 'ok', hint: '' },
  printer_unreachable: { label: 'Printer not reachable', tone: 'warn', hint: 'The bridge is running but cannot reach the printer. Check that it is switched on and on the network.' },
  bridge_offline: { label: 'Bridge offline', tone: 'neutral', hint: 'The bridge is not connected, so these are the last figures it sent.' },
  needs_code: { label: 'Needs access code', tone: 'warn', hint: 'The bridge has no working access code for this printer. Enter it again under Settings, Printers.' },
  never_seen: { label: 'Waiting for the printer', tone: 'neutral', hint: 'Nothing has been heard from this printer yet.' },
};

export const PRINTER_ERROR_TONE: Record<PrinterError['severity'], StatusTone> = { info: 'neutral', warning: 'warn', error: 'danger', fatal: 'danger' };

export const JOB_STATUS: Record<JobStatus, { label: string; tone: StatusTone }> = {
  planned: { label: 'Planned', tone: 'neutral' },
  in_progress: { label: 'In progress', tone: 'info' },
  completed: { label: 'Completed', tone: 'ok' },
  failed: { label: 'Failed', tone: 'danger' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
};

export const PROJECT_STAGE: Record<ProjectStage, { label: string; tone: StatusTone }> = {
  open: { label: 'Open', tone: 'neutral' },
  invoiced: { label: 'Invoiced', tone: 'info' },
  paid: { label: 'Paid', tone: 'ok' },
};
export const PROJECT_STAGES = Object.keys(PROJECT_STAGE) as ProjectStage[];

export const REQUEST_STATUS: Record<RequestStatus, { label: string; tone: StatusTone }> = {
  pending: { label: 'Waiting to be checked', tone: 'warn' },
  changes_requested: { label: 'Changes needed', tone: 'info' },
  approved: { label: 'Approved', tone: 'ok' },
  in_progress: { label: 'In progress', tone: 'info' },
  done: { label: 'Done', tone: 'ok' },
  rejected: { label: 'Not accepted', tone: 'danger' },
};

export const PRIORITY: Record<number, { label: string; tone: StatusTone }> = {
  [-1]: { label: 'Low', tone: 'neutral' },
  0: { label: 'Normal', tone: 'neutral' },
  1: { label: 'High', tone: 'warn' },
  2: { label: 'Urgent', tone: 'danger' },
};

export const DUE_STATUS: Record<DueStatus, { label: string; tone: StatusTone }> = {
  overdue: { label: 'Overdue', tone: 'danger' },
  soon: { label: 'Due soon', tone: 'warn' },
  // Nothing to do is not a state worth colouring.
  ok: { label: 'On track', tone: 'neutral' },
};

export const MOVEMENT_REASON: Record<string, string> = {
  initial: 'Added',
  restock: 'Restocked',
  adjust: 'Adjusted',
  job: 'Used in job',
  maintenance: 'Used in service',
  import: 'Imported',
  undo: 'Undone',
};

/** "3 days overdue · 12 h left" - whichever clocks the task runs on. */
export function describeDue(entry: ScheduleEntry): string {
  const parts: string[] = [];
  if (entry.daysRemaining !== null) {
    parts.push(entry.daysRemaining < 0 ? `was due ${relativeDays(entry.daysRemaining)}` : `due ${relativeDays(entry.daysRemaining)}`);
  }
  if (entry.hoursRemaining !== null) {
    parts.push(entry.hoursRemaining <= 0 ? `${formatNumber(-entry.hoursRemaining, 1)} h over` : `${formatNumber(entry.hoursRemaining, 1)} h of use left`);
  }
  return parts.join(' · ');
}

export function describeInterval(task: { intervalDays: number | null; intervalHours: number | null }): string {
  return [
    task.intervalDays ? `every ${formatNumber(task.intervalDays, 1)} days` : '',
    task.intervalHours ? `every ${formatNumber(task.intervalHours, 1)} h of use` : '',
  ]
    .filter(Boolean)
    .join(' or ');
}
