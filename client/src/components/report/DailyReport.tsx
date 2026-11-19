import { useCallback, useEffect, useState, type MouseEvent } from 'react';
import { Link } from 'react-router-dom';
import { CircleCheck } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { EmptyState, ErrorNote, Figure, Ledger, SectionTitle, Stack } from '@/components/ui/Display';
import { Modal } from '@/components/ui/Modal';
import { useAuth } from '@/context/AuthContext';
import { useWorkspace, useWsQuery } from '@/context/WorkspaceContext';
import { daysSince, formatHours, formatNumber, relativeDays, toDateInput } from '@/lib/format';
import { describeDue } from '@/lib/status';
import { refresh } from '@/lib/store';
import type { DailyReport as Report, ReportAction } from '@/lib/types';
import styles from '@/components/report/DailyReport.module.css';

// ---- Once a day ------------------------------------------------------------

/** Where localStorage is unavailable the report still shows only once per visit. */
const shownThisVisit = new Map<string, string>();
const today = () => toDateInput(new Date());

function lastShown(key: string): string | null {
  try {
    return localStorage.getItem(key) ?? shownThisVisit.get(key) ?? null;
  } catch {
    return shownThisVisit.get(key) ?? null;
  }
}

function markShown(key: string): void {
  shownThisVisit.set(key, today());
  try {
    localStorage.setItem(key, today());
  } catch {
    /* remembered for this visit only */
  }
}

/** One report per person, per workspace, per day, remembered on this device. */
function useReportKey(): string | null {
  const { user } = useAuth();
  const { workspace } = useWorkspace();
  return user && workspace ? `filament-tracker.daily-report.${user.id}.${workspace.id}` : null;
}

type Mode = 'closed' | 'auto' | 'asked';

/**
 * Opens the report by itself on the first visit of the day: signing in, opening the app with a session that is
 * still valid, or coming back to a tab that was left open overnight. `show` opens it again at any time.
 */
export function useDailyReport() {
  const { user } = useAuth();
  const { workspace } = useWorkspace();
  const key = useReportKey();
  // A personal choice (Settings, Your account). The button still opens the report.
  const wanted = user?.dailyReportAuto !== false;
  // An empty workspace has nothing to report; it starts the day after something is added.
  const hasContent = Boolean(workspace?.counts && (workspace.counts.items > 0 || workspace.counts.machines > 0));
  const [mode, setMode] = useState<Mode>('closed');

  useEffect(() => {
    if (!key || !hasContent || !wanted) return;
    const check = () => {
      if (document.visibilityState === 'visible' && lastShown(key) !== today()) setMode((current) => (current === 'closed' ? 'auto' : current));
    };
    check();
    document.addEventListener('visibilitychange', check);
    return () => document.removeEventListener('visibilitychange', check);
  }, [key, hasContent, wanted]);

  const show = useCallback(() => setMode('asked'), []);
  const close = useCallback(() => setMode('closed'), []);
  return { mode, show, close };
}

// ---- Wording ---------------------------------------------------------------

const plural = (count: number, one: string, many = `${one}s`) => `${formatNumber(count)} ${count === 1 ? one : many}`;
const amount = (value: number, { unit, decimals }: { unit: string; decimals: number }) => `${formatNumber(value, decimals)}${unit ? ` ${unit}` : ''}`;
const percent = (fraction: number) => `${formatNumber(Math.min(fraction, 9.99) * 100)} %`;
const aboutDays = (days: number) => (days < 1 ? 'under a day' : `about ${plural(Math.round(days), 'day')}`);
/** "A, B, C and 2 more" */
const listNames = (names: string[], show = 3) => (names.length > show ? `${names.slice(0, show).join(', ')} and ${formatNumber(names.length - show)} more` : names.join(', '));

interface Step {
  to: string;
  title: string;
  detail: string;
  figure?: string;
}

function describeAction(action: ReportAction, money: (value: number) => string): Step {
  switch (action.kind) {
    case 'service': {
      const [first] = action.entries;
      if (action.entries.length === 1) {
        return { to: '/maintenance', title: `${first.taskName} on ${action.machineName}`, detail: describeDue(first), figure: percent(first.progress) };
      }
      return {
        to: '/maintenance',
        title: `Service ${action.machineName}: ${formatNumber(action.entries.length)} tasks ${action.urgency === 'today' ? 'overdue' : 'due soon'}`,
        detail: listNames(action.entries.map((entry) => entry.taskName)),
        // The schedule lists the most pressing first.
        figure: percent(first.progress),
      };
    }
    case 'machine':
      return { to: '/machines', title: `Check ${action.machineName}`, detail: 'Marked as needing service. Set it back to Ready once it is sorted.' };
    case 'shortfall':
      return {
        to: `/inventory?item=${action.itemId}`,
        title: `Not enough ${action.itemName} for ${action.jobs.length === 1 ? action.jobs[0] : `${formatNumber(action.jobs.length)} open jobs`}`,
        detail: `${amount(action.needed, action)} needed, ${amount(action.available, action)} in stock. Restock, or change the job.`,
        figure: `${amount(action.needed - action.available, action)} short`,
      };
    case 'requests': {
      const sent = relativeDays(-daysSince(action.oldestAt));
      return {
        to: '/jobs?tab=requests',
        title: `Check ${plural(action.count, 'job request')}`,
        detail: action.count === 1 ? `Sent ${sent}. The requester is waiting for an answer.` : `The oldest was sent ${sent}. The requesters are waiting for an answer.`,
      };
    }
    case 'order': {
      const count = plural(action.items.length, 'item');
      const { suppliers, unassigned } = action;
      // One source: name what to buy. Several: name where from, the reorder list has the rest.
      const single = suppliers.length + (unassigned > 0 ? 1 : 0) === 1;
      return {
        to: '/reorder',
        title: suppliers.length === 0 ? `Restock ${count}` : single ? `Order ${count} from ${suppliers[0]}` : `Order ${count} from ${plural(suppliers.length, 'supplier')}`,
        detail: single
          ? `${listNames(action.items)}${suppliers.length === 0 ? '. No supplier set.' : ''}`
          : `${listNames(suppliers)}${unassigned > 0 ? `, plus ${plural(unassigned, 'item')} with no supplier set` : ''}`,
        figure: action.estimatedCost > 0 ? money(action.estimatedCost) : undefined,
      };
    }
    case 'runout':
      return {
        to: `/inventory?item=${action.itemId}`,
        title: `Reorder ${action.itemName} before it runs low`,
        detail:
          action.minQuantity > 0
            ? `At the rate it has been used, it drops below its minimum of ${amount(action.minQuantity, action)} in ${aboutDays(action.daysLeft)}.`
            : `At the rate it has been used, it runs out in ${aboutDays(action.daysLeft)}.`,
        figure: amount(action.quantity, action),
      };
    case 'wearing':
      return {
        to: `/inventory?item=${action.itemId}`,
        title: `Have a spare ${action.itemName} ready`,
        detail: `${formatHours(action.usageHours)} of its expected ${formatHours(action.lifeHours)} used.`,
        figure: percent(action.usageHours / action.lifeHours),
      };
  }
}

function summarize(todayCount: number, soonCount: number): string {
  if (todayCount > 0) return `${plural(todayCount, 'thing')} to do today${soonCount > 0 ? `, ${formatNumber(soonCount)} coming up` : ''}`;
  return soonCount > 0 ? `Nothing urgent today, ${formatNumber(soonCount)} coming up` : 'Nothing needs doing today';
}

/** The week in sentences. Each one appears only when it has something to say. */
function weekNotes(report: Report): string[] {
  const { week, previousWeek, day } = report.activity;
  const notes: string[] = [];

  if (week.jobs === 0 && previousWeek.jobs === 0) notes.push('No jobs were finished in the last two weeks.');
  else {
    const change = week.jobs - previousWeek.jobs;
    const trend = change === 0 ? 'As many jobs finished as the week before' : `${plural(Math.abs(change), `${change > 0 ? 'more' : 'fewer'} job`)} finished than the week before`;
    notes.push(day.jobs > 0 ? `${trend}, ${formatNumber(day.jobs)} of them in the last 24 hours.` : `${trend}.`);
  }

  if (report.busiestMachine) notes.push(`${report.busiestMachine.name} did the most work: ${formatHours(report.busiestMachine.hours)} of run time.`);

  const { failed, total, machine } = report.failures;
  if (failed > 0) notes.push(`${formatNumber(failed)} of ${plural(total, 'job')} failed in the last 30 days${machine ? `, ${machine.failed === failed ? 'all' : `${formatNumber(machine.failed)} of them`} on ${machine.name}` : ''}.`);

  const { planned, inProgress } = report.openJobs;
  const open = [inProgress > 0 ? `${formatNumber(inProgress)} in progress` : '', planned > 0 ? `${formatNumber(planned)} planned` : ''].filter(Boolean);
  if (open.length) notes.push(`Open jobs: ${open.join(', ')}.`);

  return notes;
}

// ---- The dialog ------------------------------------------------------------

function greeting(name: string | undefined): string {
  const hour = new Date().getHours();
  const part = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const first = name?.trim().split(/\s+/)[0];
  return first ? `${part}, ${first}` : part;
}

interface DailyReportProps {
  /** Opened by itself rather than asked for: stays out of the way when there is nothing to show. */
  auto: boolean;
  onClose: () => void;
}

export function DailyReport({ auto, onClose }: DailyReportProps) {
  const { user } = useAuth();
  const { money, wsPath } = useWorkspace();
  const key = useReportKey();
  const path = wsPath('/daily-report');
  const { data, error } = useWsQuery<Report>('/daily-report');

  // The shared cache may hold an earlier copy: always ask again on opening.
  useEffect(() => {
    if (path) refresh(path);
  }, [path]);

  const ready = Boolean(data);
  useEffect(() => {
    if (ready && key) markShown(key);
    // A report nobody asked for should not open just to say the server is unreachable. It tries again next visit.
    else if (auto && error) onClose();
  }, [ready, key, auto, error, onClose]);

  if (!data && !error) return null;
  if (!data) {
    if (auto) return null;
    return (
      <Modal title="Daily report" onClose={onClose}>
        <ErrorNote>{error}</ErrorNote>
      </Modal>
    );
  }

  const steps = data.actions.map((action, index) => ({ index, urgency: action.urgency, ...describeAction(action, money) }));
  const doToday = steps.filter((step) => step.urgency === 'today');
  const comingUp = steps.filter((step) => step.urgency === 'soon');
  const notes = weekNotes(data);
  const { week } = data.activity;

  // Every line leads somewhere; following one puts the report away.
  const followLink = (event: MouseEvent) => {
    if ((event.target as Element).closest('a')) onClose();
  };

  const plan = (list: typeof steps) => (
    <ol className={styles.plan}>
      {list.map((step) => (
        <li key={step.index} className={styles.step}>
          <Link to={step.to} className={`${styles.stepLink} ${styles[step.urgency]}`}>
            <span className={styles.stepNumber} aria-hidden>
              {String(step.index + 1).padStart(2, '0')}
            </span>
            <span className={styles.stepText}>
              <span className={styles.stepTitle}>{step.title}</span>
              <span className={styles.stepDetail}>{step.detail}</span>
            </span>
            {step.figure && (
              <span className={styles.stepFigure}>
                <Figure>{step.figure}</Figure>
              </span>
            )}
          </Link>
        </li>
      ))}
    </ol>
  );

  return (
    <Modal
      title="Daily report"
      size="lg"
      onClose={onClose}
      footer={
        <Button variant="primary" onClick={onClose} autoFocus>
          Got it
        </Button>
      }
    >
      <div className={styles.intro}>
        <span className={styles.date}>
          {new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date())} · {greeting(user?.name)}
        </span>
        <h3 className={styles.summary}>{summarize(doToday.length, comingUp.length)}</h3>
      </div>

      {/* Clicks bubble up from the links inside. */}
      <div onClick={followLink}>
        <Stack gap="lg">
          {doToday.length > 0 && (
            <Stack gap="sm">
              <SectionTitle count={doToday.length}>Do today</SectionTitle>
              {plan(doToday)}
            </Stack>
          )}

          {comingUp.length > 0 && (
            <Stack gap="sm">
              <SectionTitle count={comingUp.length}>Coming up</SectionTitle>
              {plan(comingUp)}
            </Stack>
          )}

          {steps.length === 0 && (
            <EmptyState icon={CircleCheck} title="All clear">
              Stock is above minimum, tooling is within life, service is on schedule and no requests are waiting.
            </EmptyState>
          )}

          <Stack gap="sm">
            <SectionTitle>Last 7 days</SectionTitle>
            <Ledger
              label="Finished jobs in the last 7 days"
              entries={[
                { label: 'Jobs done', to: '/jobs?tab=history', value: formatNumber(week.jobs), active: week.jobs > 0 },
                { label: 'Run time', value: formatHours(week.hours), active: week.hours > 0 },
                { label: 'Cost', value: money(week.cost), active: week.cost > 0 },
                { label: 'Failed', value: formatNumber(week.failed), tone: 'danger', active: week.failed > 0 },
              ]}
            />
            <ul className={styles.notes}>
              {notes.map((note) => (
                <li key={note}>{note}</li>
              ))}
            </ul>
          </Stack>

          {data.mostUsed.length > 0 && (
            <Stack gap="sm">
              <SectionTitle>Most used, last 30 days</SectionTitle>
              <ul className={styles.plan}>
                {data.mostUsed.map((item) => (
                  <li key={item.itemId} className={styles.step}>
                    <Link to={`/inventory?item=${item.itemId}`} className={styles.stepLink}>
                      <span className={styles.stepText}>
                        <span className={styles.stepTitle}>{item.name}</span>
                        <span className={styles.stepDetail}>
                          {amount(item.used, item)} used{item.cost > 0 ? ` · ${money(item.cost)}` : ''}
                        </span>
                      </span>
                      <span className={styles.stepFigure}>
                        <Figure>{item.daysLeft === null ? 'None left' : `${aboutDays(item.daysLeft)} left`}</Figure>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </Stack>
          )}
        </Stack>
      </div>
    </Modal>
  );
}
