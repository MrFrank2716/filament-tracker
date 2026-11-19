import type { ReactNode } from 'react';
import { CircleCheck, Wrench } from 'lucide-react';
import { Badge, EmptyState, ErrorNote, Figure, Grid, HeaderStat, Ledger, List, Meter, PageHeader, PageSkeleton, Readout, Row, RowDetail, SectionTitle, Stack, type StatusTone } from '@/components/ui/Display';
import { useWorkspace, useWsQuery } from '@/context/WorkspaceContext';
import { useCatalog } from '@/hooks/useCatalog';
import { formatDate, formatHours, formatNumber, formatQuantity } from '@/lib/format';
import { describeDue, DUE_STATUS, JOB_STATUS, MACHINE_STATUS } from '@/lib/status';
import type { Dashboard } from '@/lib/types';

/** One line in "Before the next job": stock, service and tooling share a single queue. */
interface QueueEntry {
  key: string;
  severity: 'danger' | 'warn';
  to: string;
  title: string;
  context: string;
  gauge: ReactNode;
  figure: string;
  badge: string;
}

export function DashboardPage() {
  const { workspace, money } = useWorkspace();
  const { data, error } = useWsQuery<Dashboard>('/dashboard');
  const { unitById } = useCatalog();

  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!data || !workspace) return <PageSkeleton title={workspace?.name ?? 'Overview'} subtitle={workspace?.description || undefined} />;
  const { counts } = data;

  const queue: QueueEntry[] = [
    ...data.maintenance.map((entry): QueueEntry => {
      const tone = DUE_STATUS[entry.status].tone as 'danger' | 'warn';
      return {
        key: `m:${entry.taskId}:${entry.machineId}`,
        severity: entry.status === 'overdue' ? 'danger' : 'warn',
        to: '/maintenance',
        title: entry.taskName,
        context: `${entry.machineName} · ${describeDue(entry)}`,
        gauge: <Meter value={entry.progress} max={1} tone={tone} label={`${entry.taskName} interval used`} />,
        figure: `${formatNumber(Math.min(entry.progress, 9.99) * 100)} %`,
        badge: DUE_STATUS[entry.status].label,
      };
    }),
    ...data.lowStock.map((item): QueueEntry => {
      const unit = item.unitId ? unitById.get(item.unitId) : null;
      return {
        key: `s:${item.id}`,
        severity: 'danger',
        to: `/inventory?item=${item.id}`,
        title: item.name,
        context: `Reorder · minimum ${formatQuantity(item.minQuantity, unit)}`,
        gauge: <Meter value={item.quantity} max={item.minQuantity * 2} threshold={item.minQuantity} tone="danger" label={`${item.name} against minimum`} />,
        figure: formatQuantity(item.quantity, unit),
        badge: 'Low',
      };
    }),
    ...data.wornTools.map((tool): QueueEntry => {
      const worn = tool.wearFlag || (tool.lifeHours !== null && tool.usageHours >= tool.lifeHours);
      return {
        key: `t:${tool.id}`,
        severity: worn ? 'danger' : 'warn',
        to: `/inventory?item=${tool.id}`,
        title: tool.name,
        context: tool.lifeHours ? `Tool life · ${formatHours(tool.lifeHours)} expected` : 'Flagged as worn',
        gauge: tool.lifeHours ? <Meter value={tool.usageHours} max={tool.lifeHours} tone={worn ? 'danger' : 'warn'} label={`${tool.name} life used`} /> : null,
        figure: formatHours(tool.usageHours),
        badge: worn ? 'Replace' : 'Wearing',
      };
    }),
  ].sort((a, b) => (a.severity === b.severity ? 0 : a.severity === 'danger' ? -1 : 1));

  const tally = (value: number, tone: StatusTone) => ({ value: formatNumber(value), tone, active: value > 0 });

  return (
    <>
      <PageHeader
        title={workspace.name}
        subtitle={workspace.description || undefined}
        actions={<HeaderStat to="/inventory" label="Stock value" value={money(data.stockValue)} hint={`${formatNumber(counts.items)} items`} />}
      />

      <Ledger
        label="Workshop at a glance"
        entries={[
          { label: 'Low stock', to: '/reorder', ...tally(counts.lowStock, 'danger') },
          { label: 'Overdue', to: '/maintenance', ...tally(counts.overdue, 'danger') },
          { label: 'Due soon', to: '/maintenance', ...tally(counts.dueSoon, 'warn') },
          { label: 'Worn tools', to: '/reorder', ...tally(counts.wornTools, 'warn') },
          { label: 'Open jobs', to: '/jobs', value: formatNumber(counts.openJobs), active: counts.openJobs > 0 },
        ]}
      />

      <Stack gap="sm">
        <SectionTitle count={queue.length || undefined}>Before the next job</SectionTitle>
        {queue.length ? (
          <List>
            {queue.map((entry) => (
              <Row
                key={entry.key}
                to={entry.to}
                flagged={entry.severity}
                title={entry.title}
                subtitle={<RowDetail gauge={entry.gauge}>{entry.context}</RowDetail>}
                trailing={
                  <>
                    <Figure>{entry.figure}</Figure>
                    {/* The bar and gauge already carry the state; a badge only where there is no gauge. */}
                    {!entry.gauge && <Badge tone={entry.severity}>{entry.badge}</Badge>}
                  </>
                }
              />
            ))}
          </List>
        ) : (
          <EmptyState icon={CircleCheck} title="Nothing to do before the next job">
            Stock is above minimum, tooling is within life and service is on schedule.
          </EmptyState>
        )}
      </Stack>

      <Grid>
        <Stack gap="sm">
          <SectionTitle count={data.machines.length || undefined}>Machines</SectionTitle>
          {data.machines.length ? (
            <List>
              {data.machines.map((machine) => (
                <Row
                  key={machine.id}
                  to="/machines"
                  title={machine.name}
                  subtitle={<Figure>{formatHours(machine.usageHours)} logged</Figure>}
                  trailing={<Badge tone={MACHINE_STATUS[machine.status].tone}>{MACHINE_STATUS[machine.status].label}</Badge>}
                />
              ))}
            </List>
          ) : (
            <EmptyState icon={Wrench} title="No machines yet">
              Add equipment under Machines to track hours and service.
            </EmptyState>
          )}
        </Stack>

        {data.recentJobs.length > 0 && (
          <Stack gap="sm">
            <SectionTitle
              action={
                <Readout>
                  This month · {formatNumber(data.month.jobs)} done · {formatHours(data.month.hours)} · {money(data.month.cost)}
                </Readout>
              }
            >
              Recent jobs
            </SectionTitle>
            <List>
              {data.recentJobs.map((job) => (
                <Row
                  key={job.id}
                  to="/jobs"
                  title={job.name}
                  subtitle={[job.machine?.name, formatDate(job.completedAt ?? job.createdAt)].filter(Boolean).join(' · ')}
                  trailing={
                    <>
                      <Figure>{job.totalCost ? money(job.totalCost) : formatHours(job.durationHours)}</Figure>
                      <Badge tone={JOB_STATUS[job.status].tone}>{JOB_STATUS[job.status].label}</Badge>
                    </>
                  }
                />
              ))}
            </List>
          </Stack>
        )}
      </Grid>
    </>
  );
}
