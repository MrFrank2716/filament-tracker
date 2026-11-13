import { useState } from 'react';
import { Plus, Trash2, TriangleAlert } from 'lucide-react';
import { ItemPicker } from '@/components/items/ItemPicker';
import { Button, IconButton } from '@/components/ui/Button';
import { ErrorNote, Figure, Muted, SectionTitle, TypeIcon } from '@/components/ui/Display';
import { FormGrid, NumberField, SelectField, TextAreaField, TextField } from '@/components/ui/Form';
import { Modal } from '@/components/ui/Modal';
import { useAction } from '@/components/ui/Toast';
import { useWorkspace } from '@/context/WorkspaceContext';
import type { Catalog } from '@/hooks/useCatalog';
import { api } from '@/lib/api';
import { formatQuantity, parseNumber } from '@/lib/format';
import { PRIORITY } from '@/lib/status';
import type { Item, Job } from '@/lib/types';
import styles from '@/components/jobs/Jobs.module.css';

interface Line {
  itemId: string;
  quantity: string;
  hours: string;
}

interface Props {
  catalog: Catalog;
  items: Item[];
  job?: Job;
  /** Machine a new job starts on, e.g. the one in focus. */
  defaultMachineId?: string;
  onClose: () => void;
}

export function JobForm({ catalog, items, job, defaultMachineId, onClose }: Props) {
  const { wsPath, money, workspace } = useWorkspace();
  const { run, busy } = useAction();
  const [name, setName] = useState(job?.name ?? '');
  const [machineId, setMachineId] = useState(job?.machineId ?? defaultMachineId ?? '');
  const [duration, setDuration] = useState(job?.durationHours ? String(job.durationHours) : '');
  const [extraCost, setExtraCost] = useState(job?.extraCost ? String(job.extraCost) : '');
  const [notes, setNotes] = useState(job?.notes ?? '');
  const [priority, setPriority] = useState(String(job?.priority ?? 0));
  const [lines, setLines] = useState<Line[]>(
    job?.usages.map((u) => ({ itemId: u.itemId, quantity: u.quantity ? String(u.quantity) : '', hours: u.hours ? String(u.hours) : '' })) ?? [],
  );
  const [picking, setPicking] = useState(false);
  const [error, setError] = useState('');

  const itemById = new Map(items.map((i) => [i.id, i]));
  const machine = machineId ? catalog.machineById.get(machineId) : undefined;
  const hours = parseNumber(duration) ?? 0;

  // Suggest what fits the chosen machine first.
  const pickable = items
    .filter((i) => !lines.some((l) => l.itemId === i.id))
    .sort((a, b) => Number(b.compatibleMachineIds.includes(machineId)) - Number(a.compatibleMachineIds.includes(machineId)));

  const addLine = (item: Item) => {
    const tracksLife = catalog.typeById.get(item.itemTypeId)?.tracksLife ?? false;
    setLines((current) => [...current, { itemId: item.id, quantity: '', hours: tracksLife && hours ? String(hours) : '' }]);
    setPicking(false);
  };
  const patchLine = (itemId: string, patch: Partial<Line>) => setLines((current) => current.map((l) => (l.itemId === itemId ? { ...l, ...patch } : l)));

  const material = lines.reduce((sum, l) => sum + (parseNumber(l.quantity) ?? 0) * (itemById.get(l.itemId)?.unitCost ?? 0), 0);
  const tooling = lines.reduce((sum, l) => {
    const item = itemById.get(l.itemId);
    const used = parseNumber(l.hours) ?? 0;
    return sum + (item?.lifeHours && used ? (used / item.lifeHours) * item.unitCost : 0);
  }, 0);
  const machineCost = hours * (machine?.hourlyCost ?? 0);
  const total = material + tooling + machineCost + (parseNumber(extraCost) ?? 0);

  const save = async (finish: boolean) => {
    setError('');
    if (!name.trim()) return setError('Give the job a name.');
    const body = {
      name: name.trim(),
      machineId: machineId || null,
      durationHours: Math.max(0, hours),
      extraCost: Math.max(0, parseNumber(extraCost) ?? 0),
      notes,
      priority: Number(priority),
      usages: lines.map((l) => ({ itemId: l.itemId, quantity: Math.max(0, parseNumber(l.quantity) ?? 0), hours: Math.max(0, parseNumber(l.hours) ?? 0) })),
    };
    const ok = await run(async () => {
      const saved = job ? await api.patch<Job>(wsPath(`/jobs/${job.id}`)!, body) : await api.post<Job>(wsPath('/jobs')!, body);
      if (finish) await api.post(wsPath(`/jobs/${saved.id}/finish`)!, { outcome: 'completed' });
    }, finish ? 'Job finished. Stock and tool life updated.' : 'Job saved');
    if (ok) onClose();
  };

  return (
    <>
      <Modal
        title={job ? `Edit ${job.name}` : 'New job'}
        size="lg"
        onClose={onClose}
        onSubmit={() => save(false)}
        footer={
          <>
            <Button onClick={onClose}>Cancel</Button>
            <Button type="submit" disabled={busy}>
              {job ? 'Save' : 'Save as planned'}
            </Button>
            <Button variant="primary" disabled={busy} onClick={() => save(true)}>
              Save and finish
            </Button>
          </>
        }
      >
        <FormGrid>
          <TextField label="Job name *" value={name} onChange={setName} wide autoFocus={!job} placeholder="What is being made" />
          <SelectField label="Machine" value={machineId} onChange={setMachineId}>
            <option value="">None</option>
            {catalog.machines.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </SelectField>
          <NumberField label="Run time" value={duration} onChange={setDuration} suffix="h" placeholder="0" hint="Added to the machine's hours when finished, and used to estimate the queue." />
          <SelectField label="Priority" value={priority} onChange={setPriority}>
            {Object.entries(PRIORITY)
              .sort(([a], [b]) => Number(b) - Number(a))
              .map(([value, { label }]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
          </SelectField>
        </FormGrid>

        <div className={styles.lines}>
          <SectionTitle
            count={lines.length}
            action={
              <Button size="sm" icon={Plus} onClick={() => setPicking(true)}>
                Add
              </Button>
            }
          >
            Materials, tools and fixings
          </SectionTitle>
          {lines.length === 0 && <Muted>Add what this job uses. Finishing the job takes it out of stock and adds hours to the tooling.</Muted>}
          {lines.map((line) => {
            const item = itemById.get(line.itemId);
            if (!item) return null;
            const type = catalog.typeById.get(item.itemTypeId);
            const unit = item.unitId ? catalog.unitById.get(item.unitId) : null;
            const short = (parseNumber(line.quantity) ?? 0) > item.quantity;
            return (
              <div key={line.itemId} className={styles.line}>
                <div className={styles.lineHead}>
                  <TypeIcon icon={type?.icon} tone={type?.color} size="sm" />
                  <span className={styles.lineName}>{item.name}</span>
                  <Muted>{formatQuantity(item.quantity, unit)} in stock</Muted>
                  <IconButton icon={Trash2} label={`Remove ${item.name}`} size="sm" onClick={() => setLines((current) => current.filter((l) => l.itemId !== line.itemId))} />
                </div>
                <div className={styles.lineInputs}>
                  <NumberField label={type?.tracksLife ? 'Used up' : 'Quantity used'} value={line.quantity} onChange={(quantity) => patchLine(line.itemId, { quantity })} suffix={unit?.symbol} placeholder="0" />
                  {type?.tracksLife && <NumberField label="Cutting time" value={line.hours} onChange={(value) => patchLine(line.itemId, { hours: value })} suffix="h" placeholder="0" />}
                </div>
                {short && (
                  <p className={styles.warning}>
                    <TriangleAlert size={14} aria-hidden /> More than is in stock. Finishing will take it to zero.
                  </p>
                )}
              </div>
            );
          })}
        </div>

        <FormGrid>
          <NumberField label={`Other costs (${workspace?.currency ?? ''})`} value={extraCost} onChange={setExtraCost} placeholder="0.00" hint="Labour, outsourcing, anything not in stock." />
          <TextAreaField label="Notes" value={notes} onChange={setNotes} rows={2} />
        </FormGrid>

        <dl className={styles.costs}>
          <div><dt>Materials</dt><dd><Figure>{money(material)}</Figure></dd></div>
          <div><dt>Tool wear</dt><dd><Figure>{money(tooling)}</Figure></dd></div>
          <div><dt>Machine time</dt><dd><Figure>{money(machineCost)}</Figure></dd></div>
          <div className={styles.total}><dt>Estimated cost</dt><dd><Figure>{money(total)}</Figure></dd></div>
        </dl>
        {error && <ErrorNote>{error}</ErrorNote>}
      </Modal>

      {picking && <ItemPicker title="Add to job" items={pickable} catalog={catalog} onPick={addLine} onClose={() => setPicking(false)} note={(item) => (item.compatibleMachineIds.includes(machineId) ? `fits ${machine?.name ?? ''}` : '')} />}
    </>
  );
}
