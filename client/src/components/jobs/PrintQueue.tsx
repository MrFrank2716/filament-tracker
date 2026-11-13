import type { ReactNode } from 'react';
import { ArrowDown, ArrowUp, Pause } from 'lucide-react';
import { IconButton } from '@/components/ui/Button';
import { Badge, Figure, List, Loading, Muted, Row, SectionTitle } from '@/components/ui/Display';
import { useAction } from '@/components/ui/Toast';
import { useWorkspace } from '@/context/WorkspaceContext';
import { api } from '@/lib/api';
import { formatDateTime, formatHours } from '@/lib/format';
import { JOB_STATUS, MACHINE_STATUS, PRIORITY } from '@/lib/status';
import type { Job, MachineQueue, QueuedJob } from '@/lib/types';
import styles from '@/components/jobs/Jobs.module.css';

interface Props {
  queues: MachineQueue[] | undefined;
  jobs: Job[];
  /** Only this machine's queue, when one is in focus. */
  machineId?: string;
  onOpen: (jobId: string) => void;
  empty: ReactNode;
}

/** When a time is today, the hour is enough. */
function when(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  const today = new Date();
  return date.toDateString() === today.toDateString()
    ? date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
    : formatDateTime(iso);
}

/** Open jobs as each machine will run them: running first, then by priority, then the order set here. */
export function PrintQueue({ queues, jobs, machineId, onOpen, empty }: Props) {
  if (!queues) return <Loading />;
  const shown = queues.filter((queue) => queue.jobs.length > 0 && (!machineId || queue.machine?.id === machineId));
  if (shown.length === 0) return <>{empty}</>;
  const jobById = new Map(jobs.map((job) => [job.id, job]));
  return (
    <div className={styles.queues}>
      {shown.map((queue) => (
        <MachineQueueList key={queue.machine?.id ?? 'none'} queue={queue} jobById={jobById} onOpen={onOpen} />
      ))}
    </div>
  );
}

function MachineQueueList({ queue, jobById, onOpen }: { queue: MachineQueue; jobById: Map<string, Job>; onOpen: (jobId: string) => void }) {
  const { wsPath, canOperate } = useWorkspace();
  const { run, busy } = useAction();

  const move = (index: number, by: -1 | 1) => {
    const order = queue.jobs.map((job) => job.id);
    [order[index], order[index + by]] = [order[index + by], order[index]];
    return run(() => api.put(wsPath(`/queue/${queue.machine?.id ?? 'none'}`)!, { jobIds: order }));
  };
  // Only waiting jobs of the same priority can swap: the running job stays first, and priority wins over order.
  const canSwap = (a: QueuedJob | undefined, b: QueuedJob | undefined) =>
    Boolean(a && b && a.status === 'planned' && b.status === 'planned' && a.priority === b.priority);

  const summary = queue.machine
    ? queue.paused
      ? `${MACHINE_STATUS[queue.machine.status].label}: queue paused`
      : `${formatHours(queue.totalHours)} queued${queue.clearsAt ? ` · clear around ${when(queue.clearsAt)}` : ''}${queue.unestimated ? ` · ${queue.unestimated} without a run time` : ''}`
    : 'Pick a machine for these to schedule them';

  return (
    <section>
      <SectionTitle count={queue.jobs.length}>{queue.machine?.name ?? 'No machine yet'}</SectionTitle>
      <Muted>
        {queue.paused && queue.machine ? <Pause size={14} aria-hidden /> : null} {summary}
      </Muted>
      <List>
        {queue.jobs.map((entry, index) => {
          const job = jobById.get(entry.id);
          const short = job ? job.usages.filter((usage) => usage.quantity > usage.item.quantity) : [];
          const timing =
            entry.status === 'in_progress'
              ? entry.estimatedFinish
                ? `running · done around ${when(entry.estimatedFinish)}`
                : 'running'
              : entry.estimatedFinish
                ? `starts ~${when(entry.estimatedStart)} · done ~${when(entry.estimatedFinish)}`
                : entry.durationHours > 0
                  ? formatHours(entry.durationHours)
                  : 'no run time set';
          return (
            <div key={entry.id} className={styles.queueItem}>
            <Row
              onClick={() => onOpen(entry.id)}
              flagged={short.length > 0 ? 'warn' : false}
              leading={<span className={styles.queueNumber}>{index + 1}</span>}
              title={entry.name}
              subtitle={[short.length > 0 ? `Short: ${short.map((usage) => usage.item.name).join(', ')}` : '', timing, entry.requesterName ? `for ${entry.requesterName}` : ''].filter(Boolean).join(' · ')}
              trailing={
                <>
                  {entry.priority !== 0 && <Badge tone={PRIORITY[entry.priority].tone}>{PRIORITY[entry.priority].label}</Badge>}
                  {entry.status === 'in_progress' && <Badge tone={JOB_STATUS.in_progress.tone}>{JOB_STATUS.in_progress.label}</Badge>}
                  {entry.remainingHours > 0 && entry.status === 'in_progress' && <Figure>{formatHours(entry.remainingHours)} left</Figure>}
                </>
              }
            />
            {/* Beside the row, not in it: the row is itself a button. */}
            {canOperate && queue.jobs.length > 1 && (
              <span className={styles.queueMove}>
                <IconButton icon={ArrowUp} size="sm" label={`Move ${entry.name} up`} disabled={busy || !canSwap(queue.jobs[index - 1], entry)} onClick={() => move(index, -1)} />
                <IconButton icon={ArrowDown} size="sm" label={`Move ${entry.name} down`} disabled={busy || !canSwap(entry, queue.jobs[index + 1])} onClick={() => move(index, 1)} />
              </span>
            )}
            </div>
          );
        })}
      </List>
    </section>
  );
}
