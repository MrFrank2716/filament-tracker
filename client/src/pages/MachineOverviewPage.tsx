import { Link } from 'react-router-dom';
import { ClipboardList, Wrench } from 'lucide-react';
import { StockMeter } from '@/components/items/StockMeter';
import { ReadingBadges, SubUnitPanel } from '@/components/machines/SubUnitPanel';
import { Badge, EmptyState, ErrorNote, Figure, Grid, HeaderStat, Ledger, List, Loading, Meter, PageHeader, Readout, Row, RowDetail, SectionTitle, Stack, TypeIcon } from '@/components/ui/Display';
import { useMachineFocus } from '@/context/FocusContext';
import { useWorkspace, useWsQuery } from '@/context/WorkspaceContext';
import { useCatalog, useItems } from '@/hooks/useCatalog';
import { formatDate, formatHours, formatNumber, formatQuantity, isLow, isWorn } from '@/lib/format';
import { describeDue, DUE_STATUS, JOB_STATUS, MACHINE_STATUS } from '@/lib/status';
import { DashboardPage } from '@/pages/DashboardPage';
import type { DueStatus, Job, JobRequest, Machine, MaintenanceData, SubUnit } from '@/lib/types';
import styles from '@/components/machines/Machines.module.css';

/** The Overview screen: the whole workshop, or one machine when the focus bar has one picked. */
export function OverviewPage() {
  const { machine } = useMachineFocus();
  return machine ? <MachineOverview key={machine.id} machine={machine} /> : <DashboardPage />;
}

const DUE_ORDER: Record<DueStatus, number> = { overdue: 0, soon: 1, ok: 2 };
const isOpen = (job: Job) => job.status === 'planned' || job.status === 'in_progress';
const noop = () => undefined;

/** Everything about one machine in one place: what is in it, what it needs, and what it has been doing. */
function MachineOverview({ machine }: { machine: Machine }) {
  const { money } = useWorkspace();
  const catalog = useCatalog();
  const { items } = useItems();
  const { relates } = useMachineFocus();
  const subUnits = useWsQuery<SubUnit[]>('/sub-units');
  const maintenance = useWsQuery<MaintenanceData>('/maintenance');
  const jobs = useWsQuery<Job[]>('/jobs');
  const requests = useWsQuery<JobRequest[]>('/job-requests');

  const error = catalog.error ?? subUnits.error ?? maintenance.error ?? jobs.error;
  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (catalog.loading || !subUnits.data || !maintenance.data || !jobs.data) return <Loading />;

  const machineType = machine.machineTypeId ? catalog.machineTypeById.get(machine.machineTypeId) : undefined;
  const makeModel = [machine.manufacturer, machine.model].filter(Boolean).join(' ');
  const status = MACHINE_STATUS[machine.status];

  const itemById = new Map(items.map((item) => [item.id, item]));
  const related = items.filter(relates);
  const loaded = related.filter((item) => item.slot?.subUnit.machineId === machine.id);
  const attention = related.filter((item) => isLow(item) || isWorn(item));
  const categories = catalog.types.map((type) => ({ type, items: related.filter((item) => item.itemTypeId === type.id) })).filter((group) => group.items.length > 0);
  const attached = subUnits.data.filter((subUnit) => subUnit.machineId === machine.id);

  const schedule = maintenance.data.schedule.filter((entry) => entry.machineId === machine.id).sort((a, b) => DUE_ORDER[a.status] - DUE_ORDER[b.status]);
  const overdue = schedule.filter((entry) => entry.status === 'overdue').length;
  const soon = schedule.filter((entry) => entry.status === 'soon').length;

  const machineJobs = jobs.data.filter((job) => job.machineId === machine.id);
  const open = machineJobs.filter(isOpen);
  const finished = machineJobs.filter((job) => job.status === 'completed' || job.status === 'failed');
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);
  const thisMonth = finished.filter((job) => job.completedAt && new Date(job.completedAt) >= monthStart);
  const total = (list: Job[], pick: (job: Job) => number) => list.reduce((sum, job) => sum + pick(job), 0);
  const waiting = (requests.data ?? []).filter((request) => request.status === 'pending' && request.machine?.id === machine.id).length;

  return (
    <>
      <PageHeader
        title={machine.name}
        subtitle={[machineType?.name, makeModel !== machine.name ? makeModel : '', machine.locationId ? catalog.locationById.get(machine.locationId)?.name : ''].filter(Boolean).join(' · ') || undefined}
        actions={
          <div className={styles.headerStats}>
            <HeaderStat to="/machines" label="Status" value={status.label} tone={status.tone} />
            <HeaderStat to="/machines" label="Hours" value={formatHours(machine.usageHours)} hint={machine.hourlyCost > 0 ? `${money(machine.hourlyCost)} / h` : undefined} />
          </div>
        }
      />

      <Ledger
        label={`${machine.name} at a glance`}
        entries={[
          { label: 'Loaded', to: '/inventory', value: formatNumber(loaded.length), active: loaded.length > 0 },
          { label: 'Low or worn', to: '/reorder', value: formatNumber(attention.length), tone: 'danger', active: attention.length > 0 },
          { label: 'Overdue', to: '/maintenance', value: formatNumber(overdue), tone: 'danger', active: overdue > 0 },
          { label: 'Due soon', to: '/maintenance', value: formatNumber(soon), tone: 'warn', active: soon > 0 },
          { label: 'Open jobs', to: '/jobs', value: formatNumber(open.length), active: open.length > 0 },
          ...(waiting > 0 ? [{ label: 'Requests', to: '/jobs', value: formatNumber(waiting), tone: 'warn' as const }] : []),
        ]}
      />

      <ReadingBadges readings={machine.specs} />

      {machine.notes && <p className={styles.notes}>{machine.notes}</p>}

      {/* Full width: what is in the machine right now is the first thing to check. */}
      {attached.length > 0 && (
        <Stack gap="sm">
          <SectionTitle count={attached.length} action={<Link to="/machines">Load or change</Link>}>
            Attached hardware
          </SectionTitle>
          <Grid min="lg">
            {attached.map((subUnit) => (
              <SubUnitPanel key={subUnit.id} subUnit={subUnit} catalog={catalog} itemById={itemById} canEdit={false} onEdit={noop} onSlot={noop} />
            ))}
          </Grid>
        </Stack>
      )}

      <Grid min="lg">
        {attention.length > 0 && (
          <Stack gap="sm">
            <SectionTitle count={attention.length}>Low or worn</SectionTitle>
            <List>
              {attention.map((item) => {
                const unit = item.unitId ? catalog.unitById.get(item.unitId) : null;
                const worn = isWorn(item);
                const byLife = worn && item.lifeHours !== null;
                return (
                  <Row
                    key={item.id}
                    to={`/inventory?item=${item.id}`}
                    flagged
                    title={item.name}
                    subtitle={
                      byLife ? (
                        <RowDetail gauge={<Meter value={item.usageHours} max={item.lifeHours ?? 1} tone="danger" label={`${item.name} life used`} />}>
                          Tool life · {formatHours(item.lifeHours ?? 0)} expected
                        </RowDetail>
                      ) : worn ? (
                        'Flagged as worn'
                      ) : (
                        <RowDetail gauge={<StockMeter item={item} />}>Reorder · minimum {formatQuantity(item.minQuantity, unit)}</RowDetail>
                      )
                    }
                    trailing={
                      <>
                        <Figure>{byLife ? formatHours(item.usageHours) : formatQuantity(item.quantity, unit)}</Figure>
                        {worn && !byLife && <Badge tone="danger">Replace</Badge>}
                      </>
                    }
                  />
                );
              })}
            </List>
          </Stack>
        )}

        <Stack gap="sm">
          <SectionTitle count={schedule.length}>Maintenance</SectionTitle>
          {schedule.length === 0 ? (
            <EmptyState icon={Wrench} title="No maintenance scheduled">
              Add a recurring task for this machine under Maintenance.
            </EmptyState>
          ) : (
            <List>
              {schedule.map((entry) => (
                <Row
                  key={entry.taskId}
                  to="/maintenance"
                  flagged={entry.status === 'overdue' ? 'danger' : entry.status === 'soon' ? 'warn' : false}
                  title={entry.taskName}
                  subtitle={
                    <RowDetail gauge={<Meter value={entry.progress} max={1} tone={DUE_STATUS[entry.status].tone} label={`${entry.taskName} interval used`} />}>
                      {describeDue(entry)}
                    </RowDetail>
                  }                />
              ))}
            </List>
          )}
        </Stack>

        <Stack gap="sm">
          <SectionTitle
            count={open.length || undefined}
            action={
              finished.length > 0 && (
                <Readout>
                  This month · {formatNumber(thisMonth.length)} done · {formatHours(total(thisMonth, (job) => job.durationHours))} · {money(total(thisMonth, (job) => job.totalCost))}
                </Readout>
              )
            }
          >
            Jobs
          </SectionTitle>
          {machineJobs.length === 0 ? (
            <EmptyState icon={ClipboardList} title="No jobs on this machine yet">
              Plan or log a job under Jobs and pick this machine.
            </EmptyState>
          ) : (
            <List>
              {[...open, ...machineJobs.filter((job) => !isOpen(job)).slice(0, 5)].map((job) => (
                <Row
                  key={job.id}
                  to="/jobs"
                  title={job.name}
                  subtitle={[formatHours(job.durationHours), formatDate(job.completedAt ?? job.createdAt), job.request ? `for ${job.request.requesterName}` : ''].filter(Boolean).join(' · ')}
                  trailing={
                    <>
                      <Figure>{money(job.totalCost)}</Figure>
                      <Badge tone={JOB_STATUS[job.status].tone}>{JOB_STATUS[job.status].label}</Badge>
                    </>
                  }
                />
              ))}
            </List>
          )}
        </Stack>

        {categories.length > 0 && (
          <Stack gap="sm">
            <SectionTitle count={related.length}>Materials, tooling and parts</SectionTitle>
            <List>
              {categories.map(({ type, items: group }) => {
                const flagged = group.filter((item) => isLow(item) || isWorn(item)).length;
                return (
                  <Row
                    key={type.id}
                    to="/inventory"
                    leading={<TypeIcon icon={type.icon} tone={type.color} />}
                    title={type.name}
                    subtitle={group.map((item) => item.name).join(', ')}
                    trailing={
                      <>
                        <Figure>{group.length}</Figure>
                        {flagged > 0 && <Badge tone="danger">{flagged} low or worn</Badge>}
                      </>
                    }
                  />
                );
              })}
            </List>
          </Stack>
        )}
      </Grid>
    </>
  );
}
