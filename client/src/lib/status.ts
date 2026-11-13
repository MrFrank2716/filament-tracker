import type { StatusTone } from '@/components/ui/Display';
import { formatNumber, relativeDays } from '@/lib/format';
import type { DueStatus, JobStatus, MachineStatus, RequestStatus, ScheduleEntry } from '@/lib/types';

export const MACHINE_STATUS: Record<MachineStatus, { label: string; tone: StatusTone }> = {
  ready: { label: 'Ready', tone: 'ok' },
  in_use: { label: 'In use', tone: 'info' },
  needs_service: { label: 'Needs service', tone: 'warn' },
  offline: { label: 'Offline', tone: 'neutral' },
};

export const JOB_STATUS: Record<JobStatus, { label: string; tone: StatusTone }> = {
  planned: { label: 'Planned', tone: 'neutral' },
  in_progress: { label: 'In progress', tone: 'info' },
  completed: { label: 'Completed', tone: 'ok' },
  failed: { label: 'Failed', tone: 'danger' },
  cancelled: { label: 'Cancelled', tone: 'neutral' },
};

export const REQUEST_STATUS: Record<RequestStatus, { label: string; tone: StatusTone }> = {
  pending: { label: 'Waiting to be checked', tone: 'warn' },
  changes_requested: { label: 'Changes needed', tone: 'info' },
  approved: { label: 'Approved', tone: 'ok' },
  rejected: { label: 'Not accepted', tone: 'danger' },
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
