import { useState } from 'react';
import { CalendarCheck, Check, History, Plus, Trash2, Wrench } from 'lucide-react';
import { ItemPicker } from '@/components/items/ItemPicker';
import { Button, IconButton } from '@/components/ui/Button';
import { Badge, EmptyState, ErrorNote, Figure, List, Loading, Meter, Muted, PageHeader, PageSkeleton, Row, RowDetail, SectionTitle, Tabs } from '@/components/ui/Display';
import { Checkbox, FormGrid, NumberField, SelectField, TextAreaField, TextField } from '@/components/ui/Form';
import { Modal, useConfirm } from '@/components/ui/Modal';
import { useAction } from '@/components/ui/Toast';
import { useMachineFocus } from '@/context/FocusContext';
import { useWorkspace, useWsQuery } from '@/context/WorkspaceContext';
import { useCatalog, useItems, type Catalog } from '@/hooks/useCatalog';
import { api } from '@/lib/api';
import { formatDate, formatHours, formatNumber, formatQuantity, parseNumber, toDateInput } from '@/lib/format';
import { describeDue, describeInterval } from '@/lib/status';
import type { Item, MaintenanceData, MaintenanceLog, MaintenanceTask, ScheduleEntry } from '@/lib/types';
import styles from '@/pages/MaintenancePage.module.css';

/** How far through its interval a task is, by the clock that is further along: days or hours of use. */
const leadingClock = (entry: ScheduleEntry): 'days' | 'hours' | null => {
  const byDays = entry.intervalDays && entry.daysRemaining !== null ? 1 - entry.daysRemaining / entry.intervalDays : null;
  const byHours = entry.intervalHours && entry.hoursRemaining !== null ? 1 - entry.hoursRemaining / entry.intervalHours : null;
  if (byHours !== null && (byDays === null || byHours >= byDays)) return 'hours';
  return byDays !== null ? 'days' : null;
};

/** Where the gauge turns "due soon". Mirrors computeDue in server/src/services/maintenance.ts. */
function soonAt(entry: ScheduleEntry): number | undefined {
  const clock = leadingClock(entry);
  if (clock === 'hours') return 0.85;
  if (clock === 'days' && entry.intervalDays) return 1 - Math.min(14, Math.max(1, entry.intervalDays * 0.2)) / entry.intervalDays;
  return undefined;
}

/** Short read-out for the end of a schedule row: "3 d over", "12 h left", "today". */
function dueFigure(entry: ScheduleEntry): string {
  if (leadingClock(entry) === 'hours' && entry.hoursRemaining !== null) {
    return entry.hoursRemaining <= 0 ? `${formatNumber(-entry.hoursRemaining, 1)} h over` : `${formatNumber(entry.hoursRemaining, 1)} h left`;
  }
  const days = entry.daysRemaining;
  if (days === null) return '';
  if (days < 0) return `${Math.ceil(-days)} d over`;
  return days < 1 ? 'today' : `${Math.floor(days)} d left`;
}

type Tab = 'schedule' | 'tasks' | 'history';

export function MaintenancePage() {
  const { canEdit, canOperate } = useWorkspace();
  const catalog = useCatalog();
  const { items } = useItems();
  const { data: all, error } = useWsQuery<MaintenanceData>('/maintenance');
  const { machine } = useMachineFocus();
  const [tab, setTab] = useState<Tab>('schedule');
  const [completing, setCompleting] = useState<ScheduleEntry | null>(null);
  const [taskForm, setTaskForm] = useState<{ task?: MaintenanceTask } | null>(null);

  if (error || catalog.error) return <ErrorNote>{error ?? catalog.error}</ErrorNote>;
  if (!all || catalog.loading) return <PageSkeleton title="Maintenance" subtitle="Recurring service by date or by hours of use. Logging a service resets the clock." filters />;

  // With one machine in focus: its own schedule, plus the tasks set on it or on its type.
  const data: MaintenanceData = machine
    ? {
        schedule: all.schedule.filter((entry) => entry.machineId === machine.id),
        tasks: all.tasks.filter((task) => task.machineId === machine.id || (task.machineTypeId !== null && task.machineTypeId === machine.machineTypeId)),
      }
    : all;

  const attention = data.schedule.filter((e) => e.status !== 'ok').length;

  return (
    <>
      <PageHeader
        title="Maintenance"
        subtitle="Recurring service by date or by hours of use. Logging a service resets the clock."
        actions={
          canEdit && (
            <Button variant="primary" icon={Plus} onClick={() => setTaskForm({})}>
              New task
            </Button>
          )
        }
      />

      <Tabs
        tabs={[
          { id: 'schedule', label: 'Schedule', count: attention },
          { id: 'tasks', label: 'Tasks' },
          { id: 'history', label: 'Service history' },
        ]}
        active={tab}
        onChange={setTab}
      />

      {tab === 'schedule' &&
        (data.schedule.length === 0 ? (
          <EmptyState icon={CalendarCheck} title="Nothing scheduled" action={canEdit && <Button variant="primary" icon={Plus} onClick={() => setTaskForm({})}>Add a maintenance task</Button>}>
            {catalog.machines.length === 0 ? 'Add a machine first, then give it recurring tasks.' : 'Create recurring tasks for a machine, or for a machine type to cover every machine of that type.'}
          </EmptyState>
        ) : (
          // One list in the server's order (overdue, then due soon, then the rest), keyed so a row stays put
          // in the DOM when it is serviced and its needle sweeps back rather than reappearing elsewhere.
          <List>
            {data.schedule.map((entry) => {
              const tone = entry.status === 'overdue' ? 'danger' : entry.status === 'soon' ? 'warn' : undefined;
              return (
                <Row
                  key={`${entry.taskId}:${entry.machineId}`}
                  flagged={tone}
                  title={entry.taskName}
                  subtitle={
                    <RowDetail gauge={<Meter value={entry.progress} max={1} threshold={soonAt(entry)} tone={tone ?? 'accent'} label={`${entry.taskName} on ${entry.machineName}: ${describeDue(entry)}`} />}>
                      {entry.machineName} · {entry.lastDoneAt ? `last done ${formatDate(entry.lastDoneAt)}` : 'never logged'} · {describeInterval(entry)}
                    </RowDetail>
                  }
                  trailing={
                    <>
                      <Figure tone={tone}>{dueFigure(entry)}</Figure>
                      {canOperate && (
                        <Button size="sm" icon={Check} onClick={() => setCompleting(entry)}>
                          Done
                        </Button>
                      )}
                    </>
                  }
                />
              );
            })}
          </List>
        ))}

      {tab === 'tasks' &&
        (data.tasks.length === 0 ? (
          <EmptyState icon={Wrench} title="No tasks defined" />
        ) : (
          <List>
            {data.tasks.map((task) => {
              const target = task.machineId ? catalog.machineById.get(task.machineId)?.name : `All: ${catalog.machineTypeById.get(task.machineTypeId ?? '')?.name ?? 'machine type'}`;
              return (
                <Row
                  key={task.id}
                  onClick={canEdit ? () => setTaskForm({ task }) : undefined}
                  title={task.name}
                  subtitle={`${target} · ${describeInterval(task)}`}
                  trailing={!task.active && <Badge>Paused</Badge>}
                />
              );
            })}
          </List>
        ))}

      {tab === 'history' && <ServiceHistory machineId={machine?.id ?? null} />}

      {completing && <CompleteDialog entry={completing} catalog={catalog} items={items} onClose={() => setCompleting(null)} />}
      {taskForm && <TaskForm catalog={catalog} task={taskForm.task} machineId={machine?.id} onClose={() => setTaskForm(null)} />}
    </>
  );
}

function ServiceHistory({ machineId }: { machineId: string | null }) {
  const { canEdit, wsPath } = useWorkspace();
  const { data: allLogs, error } = useWsQuery<MaintenanceLog[]>('/maintenance/logs');
  const { run } = useAction();
  const confirm = useConfirm();

  if (error) return <ErrorNote>{error}</ErrorNote>;
  if (!allLogs) return <Loading />;
  const logs = machineId ? allLogs.filter((log) => log.machineId === machineId) : allLogs;
  if (logs.length === 0) return <EmptyState icon={History} title="No services logged yet" />;

  const remove = async (log: MaintenanceLog) => {
    const ok = await confirm({ title: 'Remove this entry?', message: 'The task will be due again based on the service before it. Parts used are not put back into stock.', confirmLabel: 'Remove', danger: true });
    if (ok) await run(() => api.delete(wsPath(`/maintenance/logs/${log.id}`)!), 'Entry removed');
  };

  return (
    <List>
      {logs.map((log) => (
        <Row
          key={log.id}
          title={log.task.name}
          subtitle={[log.machine.name, log.notes, log.parts.map((p) => `${p.quantity} × ${p.item.name}`).join(', ')].filter(Boolean).join(' · ')}
          trailing={
            <span className={styles.historyEnd}>
              <span className={styles.historyWhen}>
                <Figure>{formatDate(log.performedAt)}</Figure>
                <Muted>
                  <Figure>{formatHours(log.hoursAtService)}</Figure>
                  {log.user ? ` · ${log.user.name}` : ''}
                </Muted>
              </span>
              {canEdit && <IconButton icon={Trash2} label={`Remove ${log.task.name} on ${formatDate(log.performedAt)}`} size="sm" onClick={() => remove(log)} />}
            </span>
          }
        />
      ))}
    </List>
  );
}

function CompleteDialog({ entry, catalog, items, onClose }: { entry: ScheduleEntry; catalog: Catalog; items: Item[]; onClose: () => void }) {
  const { wsPath } = useWorkspace();
  const { run, busy } = useAction();
  const machine = catalog.machineById.get(entry.machineId);
  const [date, setDate] = useState(toDateInput(new Date()));
  const [hours, setHours] = useState(machine ? String(machine.usageHours) : '');
  const [notes, setNotes] = useState('');
  const [parts, setParts] = useState<Array<{ item: Item; quantity: string }>>([]);
  const [picking, setPicking] = useState(false);

  // Parts that fit this machine come first.
  const pickable = items
    .filter((i) => i.quantity > 0 && !parts.some((p) => p.item.id === i.id))
    .sort((a, b) => Number(b.compatibleMachineIds.includes(entry.machineId)) - Number(a.compatibleMachineIds.includes(entry.machineId)));

  const save = async () => {
    const today = toDateInput(new Date());
    const ok = await run(
      () =>
        api.post(wsPath(`/maintenance/tasks/${entry.taskId}/complete`)!, {
          machineId: entry.machineId,
          // Today keeps the exact time; a back-dated service is logged at midday to stay on the right calendar day.
          performedAt: date && date !== today ? new Date(`${date}T12:00:00`).toISOString() : undefined,
          hoursAtService: parseNumber(hours) ?? undefined,
          notes,
          parts: parts.map((p) => ({ itemId: p.item.id, quantity: parseNumber(p.quantity) ?? 0 })).filter((p) => p.quantity > 0),
        }),
      'Service logged',
    );
    if (ok) onClose();
  };

  return (
    <>
      <Modal
        title="Log service"
        onClose={onClose}
        onSubmit={save}
        footer={
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button type="submit" variant="primary" icon={Check} disabled={busy}>
              Log as done
            </Button>
          </>
        }
      >
        <div>
          <strong>{entry.taskName}</strong>
          <div>
            <Muted>{entry.machineName}</Muted>
          </div>
          {entry.description && <p className={styles.description}>{entry.description}</p>}
        </div>
        <FormGrid>
          <TextField label="Date done" type="date" value={date} onChange={setDate} max={toDateInput(new Date())} />
          <NumberField label="Machine hours at service" value={hours} onChange={setHours} suffix="h" />
          <TextAreaField label="Notes" value={notes} onChange={setNotes} rows={2} placeholder="What was found or changed" />
        </FormGrid>
        <div className={styles.parts}>
          <SectionTitle
            action={
              <Button size="sm" icon={Plus} onClick={() => setPicking(true)}>
                Add part
              </Button>
            }
          >
            Parts used
          </SectionTitle>
          {parts.length === 0 && <Muted>Optional. Anything added here is taken out of stock.</Muted>}
          {parts.map((part) => {
            const unit = part.item.unitId ? catalog.unitById.get(part.item.unitId) : null;
            return (
              <div key={part.item.id} className={styles.part}>
                <NumberField label={`${part.item.name} (${formatQuantity(part.item.quantity, unit)} in stock)`} value={part.quantity} suffix={unit?.symbol} onChange={(quantity) => setParts((current) => current.map((p) => (p.item.id === part.item.id ? { ...p, quantity } : p)))} />
                <IconButton icon={Trash2} label={`Remove ${part.item.name}`} onClick={() => setParts((current) => current.filter((p) => p.item.id !== part.item.id))} />
              </div>
            );
          })}
        </div>
      </Modal>
      {picking && (
        <ItemPicker
          title="Part used"
          items={pickable}
          catalog={catalog}
          note={(item) => (item.compatibleMachineIds.includes(entry.machineId) ? `fits ${entry.machineName}` : '')}
          onPick={(item) => {
            setParts((current) => [...current, { item, quantity: '1' }]);
            setPicking(false);
          }}
          onClose={() => setPicking(false)}
        />
      )}
    </>
  );
}

function TaskForm({ catalog, task, machineId, onClose }: { catalog: Catalog; task?: MaintenanceTask; machineId?: string; onClose: () => void }) {
  const { wsPath } = useWorkspace();
  const { run, busy } = useAction();
  const confirm = useConfirm();
  const [name, setName] = useState(task?.name ?? '');
  const [description, setDescription] = useState(task?.description ?? '');
  // One select covers both kinds of target: "m:<id>" for a machine, "t:<id>" for a machine type.
  // A new task starts on the machine in focus, if there is one.
  const [target, setTarget] = useState(task?.machineId ? `m:${task.machineId}` : task?.machineTypeId ? `t:${task.machineTypeId}` : !task && machineId ? `m:${machineId}` : '');
  const [intervalDays, setIntervalDays] = useState(task?.intervalDays ? String(task.intervalDays) : '');
  const [intervalHours, setIntervalHours] = useState(task?.intervalHours ? String(task.intervalHours) : '');
  const [active, setActive] = useState(task?.active ?? true);
  const [error, setError] = useState('');

  const save = async () => {
    setError('');
    if (!name.trim()) return setError('Give the task a name.');
    if (!target) return setError('Choose the machine or machine type this applies to.');
    const days = parseNumber(intervalDays);
    const hours = parseNumber(intervalHours);
    if (!(days && days > 0) && !(hours && hours > 0)) return setError('Set an interval in days, in hours of use, or both.');
    const body = {
      name: name.trim(),
      description: description.trim(),
      machineId: target.startsWith('m:') ? target.slice(2) : null,
      machineTypeId: target.startsWith('t:') ? target.slice(2) : null,
      intervalDays: days && days > 0 ? days : null,
      intervalHours: hours && hours > 0 ? hours : null,
      active,
    };
    const ok = await run(() => (task ? api.patch(wsPath(`/maintenance/tasks/${task.id}`)!, body) : api.post(wsPath('/maintenance/tasks')!, body)), task ? 'Saved' : 'Task added');
    if (ok) onClose();
  };

  const remove = async () => {
    if (!task) return;
    const ok = await confirm({ title: 'Delete task?', message: `"${task.name}" and its service history will be removed.`, confirmLabel: 'Delete', danger: true });
    if (ok && (await run(() => api.delete(wsPath(`/maintenance/tasks/${task.id}`)!), 'Task deleted'))) onClose();
  };

  return (
    <Modal
      title={task ? 'Edit maintenance task' : 'New maintenance task'}
      size="lg"
      onClose={onClose}
      onSubmit={save}
      footer={
        <>
          {task && (
            <Button variant="danger" icon={Trash2} onClick={remove} disabled={busy}>
              Delete
            </Button>
          )}
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={busy}>
            {task ? 'Save changes' : 'Add task'}
          </Button>
        </>
      }
    >
      <FormGrid>
        <TextField label="Task *" value={name} onChange={setName} wide autoFocus={!task} placeholder="e.g. Clean and lubricate rails" />
        <SelectField label="Applies to *" value={target} onChange={setTarget} wide hint="Pick a machine type to cover every machine of that type, including ones you add later.">
          <option value="">Choose…</option>
          <optgroup label="One machine">
            {catalog.machines.map((m) => (
              <option key={m.id} value={`m:${m.id}`}>
                {m.name}
              </option>
            ))}
          </optgroup>
          <optgroup label="Every machine of a type">
            {catalog.machineTypes.map((t) => (
              <option key={t.id} value={`t:${t.id}`}>
                All: {t.name}
              </option>
            ))}
          </optgroup>
        </SelectField>
        <NumberField label="Every (days)" value={intervalDays} onChange={setIntervalDays} suffix="days" />
        <NumberField label="Every (hours of use)" value={intervalHours} onChange={setIntervalHours} suffix="h" hint="With both set, whichever comes first." />
        <TextAreaField label="Instructions" value={description} onChange={setDescription} placeholder="What to check, what to use" />
      </FormGrid>
      <Checkbox label="Active" hint="Paused tasks stay defined but stop generating reminders." checked={active} onChange={setActive} />
      {!task && <Muted>Log the last service with Done so the clock starts from the right point. Until then, days count from today and hours from zero, so a well-used machine may show as due straight away.</Muted>}
      {error && <ErrorNote>{error}</ErrorNote>}
    </Modal>
  );
}
