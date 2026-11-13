import { useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button, IconButton } from '@/components/ui/Button';
import { ErrorNote, Muted } from '@/components/ui/Display';
import { FormGrid, NumberField, SelectField, TextAreaField, TextField } from '@/components/ui/Form';
import { Modal, useConfirm } from '@/components/ui/Modal';
import { useAction } from '@/components/ui/Toast';
import { useWorkspace } from '@/context/WorkspaceContext';
import type { Catalog } from '@/hooks/useCatalog';
import { api } from '@/lib/api';
import { flattenLocations, parseNumber } from '@/lib/format';
import { MACHINE_STATUS } from '@/lib/status';
import type { Machine, MachineStatus, Reading, SubUnit } from '@/lib/types';
import styles from '@/components/machines/Machines.module.css';

export function MachineForm({ catalog, machine, onClose }: { catalog: Catalog; machine?: Machine; onClose: () => void }) {
  const { wsPath, workspace } = useWorkspace();
  const { run, busy } = useAction();
  const confirm = useConfirm();
  const [name, setName] = useState(machine?.name ?? '');
  const [machineTypeId, setMachineTypeId] = useState(machine?.machineTypeId ?? '');
  const [manufacturer, setManufacturer] = useState(machine?.manufacturer ?? '');
  const [model, setModel] = useState(machine?.model ?? '');
  const [serial, setSerial] = useState(machine?.serial ?? '');
  const [status, setStatus] = useState<MachineStatus>(machine?.status ?? 'ready');
  const [usageHours, setUsageHours] = useState(machine ? String(machine.usageHours) : '');
  const [hourlyCost, setHourlyCost] = useState(machine?.hourlyCost ? String(machine.hourlyCost) : '');
  const [locationId, setLocationId] = useState(machine?.locationId ?? '');
  const [notes, setNotes] = useState(machine?.notes ?? '');
  const [error, setError] = useState('');
  const locations = useMemo(() => flattenLocations(catalog.locations), [catalog.locations]);

  const save = async () => {
    if (!name.trim()) return setError('Give the machine a name.');
    const body = {
      name: name.trim(), machineTypeId: machineTypeId || null, manufacturer, model, serial, status,
      usageHours: Math.max(0, parseNumber(usageHours) ?? 0), hourlyCost: Math.max(0, parseNumber(hourlyCost) ?? 0),
      locationId: locationId || null, notes,
    };
    const ok = await run(() => (machine ? api.patch(wsPath(`/machines/${machine.id}`)!, body) : api.post(wsPath('/machines')!, body)), machine ? 'Saved' : 'Machine added');
    if (ok) onClose();
  };

  const remove = async () => {
    if (!machine) return;
    const ok = await confirm({
      title: 'Delete machine?',
      message: `"${machine.name}" and the maintenance tasks and service history attached to it will be removed. Jobs keep their record but lose the link.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (ok && (await run(() => api.delete(wsPath(`/machines/${machine.id}`)!), 'Machine deleted'))) onClose();
  };

  return (
    <Modal
      title={machine ? `Edit ${machine.name}` : 'Add machine'}
      size="lg"
      onClose={onClose}
      onSubmit={save}
      footer={
        <>
          {machine && (
            <Button variant="danger" icon={Trash2} onClick={remove} disabled={busy}>
              Delete
            </Button>
          )}
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={busy}>
            {machine ? 'Save changes' : 'Add machine'}
          </Button>
        </>
      }
    >
      <FormGrid>
        <TextField label="Name *" value={name} onChange={setName} wide autoFocus={!machine} placeholder="What you call it in the workshop" />
        <SelectField label="Type" value={machineTypeId} onChange={setMachineTypeId} hint="Maintenance schedules set on a type apply to every machine of that type.">
          <option value="">No type</option>
          {catalog.machineTypes.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </SelectField>
        <SelectField label="Status" value={status} onChange={(value) => setStatus(value as MachineStatus)}>
          {Object.entries(MACHINE_STATUS).map(([id, { label }]) => (
            <option key={id} value={id}>
              {label}
            </option>
          ))}
        </SelectField>
        <TextField label="Manufacturer" value={manufacturer} onChange={setManufacturer} />
        <TextField label="Model" value={model} onChange={setModel} />
        <TextField label="Serial number" value={serial} onChange={setSerial} />
        <SelectField label="Location" value={locationId} onChange={setLocationId}>
          <option value="">None</option>
          {locations.map((l) => (
            <option key={l.id} value={l.id}>
              {'  '.repeat(l.depth)}
              {l.name}
            </option>
          ))}
        </SelectField>
        <NumberField label="Usage hours" value={usageHours} onChange={setUsageHours} suffix="h" placeholder="0" hint="Finished jobs add to this automatically." />
        <NumberField label={`Running cost per hour (${workspace?.currency ?? ''})`} value={hourlyCost} onChange={setHourlyCost} placeholder="0.00" hint="Added to the cost of each job." />
        <TextAreaField label="Notes" value={notes} onChange={setNotes} />
      </FormGrid>
      {error && <ErrorNote>{error}</ErrorNote>}
    </Modal>
  );
}

export function SubUnitForm({ catalog, subUnit, machineId, onClose }: { catalog: Catalog; subUnit?: SubUnit; machineId?: string; onClose: () => void }) {
  const { wsPath } = useWorkspace();
  const { run, busy } = useAction();
  const confirm = useConfirm();
  const [name, setName] = useState(subUnit?.name ?? '');
  const [kind, setKind] = useState(subUnit?.kind ?? '');
  const [attachedTo, setAttachedTo] = useState(subUnit?.machineId ?? machineId ?? '');
  const [slotCount, setSlotCount] = useState(String(subUnit?.slots.length ?? 4));
  const [statusNote, setStatusNote] = useState(subUnit?.statusNote ?? '');
  const [readings, setReadings] = useState<Reading[]>(subUnit?.readings ?? []);
  const [error, setError] = useState('');

  const setReading = (index: number, patch: Partial<Reading>) => setReadings((current) => current.map((r, i) => (i === index ? { ...r, ...patch } : r)));

  const save = async () => {
    if (!name.trim()) return setError('Give the unit a name.');
    const count = parseNumber(slotCount) ?? 0;
    if (!Number.isInteger(count) || count < 0 || count > 64) return setError('Slots must be a whole number from 0 to 64.');
    if (subUnit && count < subUnit.slots.length && subUnit.slots.some((s) => s.position > count && s.itemId)) {
      const ok = await confirm({ title: 'Remove loaded slots?', message: 'Some of the slots being removed have items loaded. Those items will be unloaded (stock is not changed).', confirmLabel: 'Remove slots' });
      if (!ok) return;
    }
    const body = {
      name: name.trim(), kind: kind.trim(), machineId: attachedTo || null, slotCount: count, statusNote: statusNote.trim(),
      readings: readings.filter((r) => r.label.trim()).map((r) => ({ label: r.label.trim(), value: r.value.trim(), unit: r.unit.trim() })),
    };
    const ok = await run(() => (subUnit ? api.patch(wsPath(`/sub-units/${subUnit.id}`)!, body) : api.post(wsPath('/sub-units')!, body)), subUnit ? 'Saved' : 'Unit added');
    if (ok) onClose();
  };

  const remove = async () => {
    if (!subUnit) return;
    const ok = await confirm({ title: 'Delete this unit?', message: `"${subUnit.name}" and its slot assignments will be removed. Items stay in inventory.`, confirmLabel: 'Delete', danger: true });
    if (ok && (await run(() => api.delete(wsPath(`/sub-units/${subUnit.id}`)!), 'Unit deleted'))) onClose();
  };

  return (
    <Modal
      title={subUnit ? `Edit ${subUnit.name}` : 'Add attached hardware'}
      size="lg"
      onClose={onClose}
      onSubmit={save}
      footer={
        <>
          {subUnit && (
            <Button variant="danger" icon={Trash2} onClick={remove} disabled={busy}>
              Delete
            </Button>
          )}
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={busy}>
            {subUnit ? 'Save changes' : 'Add'}
          </Button>
        </>
      }
    >
      <Muted>Feeders, tool changers, dryers, modules: anything fitted to a machine. Give it slots if it holds material or tooling.</Muted>
      <FormGrid>
        <TextField label="Name *" value={name} onChange={setName} autoFocus={!subUnit} placeholder="e.g. Feeder #1" />
        <TextField label="Kind" value={kind} onChange={setKind} placeholder="e.g. 4-slot feeder" />
        <SelectField label="Attached to" value={attachedTo} onChange={setAttachedTo}>
          <option value="">Not attached</option>
          {catalog.machines.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </SelectField>
        <NumberField label="Number of slots" value={slotCount} onChange={setSlotCount} inputMode="numeric" />
        <TextField label="Status note" value={statusNote} onChange={setStatusNote} wide placeholder="e.g. Drying at 65 °C, 3 h left" />
      </FormGrid>

      <div className={styles.readings}>
        <strong>Readings</strong>
        <Muted>Anything you want to see at a glance: humidity, temperature, pressure…</Muted>
        {readings.map((reading, index) => (
          <div key={index} className={styles.readingRow}>
            <TextField label="Label" value={reading.label} onChange={(label) => setReading(index, { label })} />
            <TextField label="Value" value={reading.value} onChange={(value) => setReading(index, { value })} inputMode="decimal" />
            <TextField label="Unit" value={reading.unit} onChange={(unit) => setReading(index, { unit })} />
            <IconButton icon={Trash2} label="Remove reading" onClick={() => setReadings((current) => current.filter((_, i) => i !== index))} />
          </div>
        ))}
        <div>
          <Button size="sm" icon={Plus} onClick={() => setReadings((current) => [...current, { label: '', value: '', unit: '' }])}>
            Add reading
          </Button>
        </div>
      </div>
      {error && <ErrorNote>{error}</ErrorNote>}
    </Modal>
  );
}
