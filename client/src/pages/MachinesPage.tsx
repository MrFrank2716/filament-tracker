import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Cog, Pencil, Plus } from 'lucide-react';
import { ItemPicker } from '@/components/items/ItemPicker';
import { MachineForm, SubUnitForm } from '@/components/machines/MachineForms';
import { ReadingBadges, SlotSummary, SubUnitPanel } from '@/components/machines/SubUnitPanel';
import { Button, IconButton } from '@/components/ui/Button';
import { Badge, Card, EmptyState, ErrorNote, Figure, Grid, Loading, Muted, PageHeader, SectionTitle, TypeIcon } from '@/components/ui/Display';
import { Modal } from '@/components/ui/Modal';
import { useAction } from '@/components/ui/Toast';
import { useMachineFocus } from '@/context/FocusContext';
import { useWorkspace, useWsQuery } from '@/context/WorkspaceContext';
import { useCatalog, useItems } from '@/hooks/useCatalog';
import { api } from '@/lib/api';
import { formatHours, formatQuantity, isLow } from '@/lib/format';
import { MACHINE_STATUS } from '@/lib/status';
import type { Machine, MaintenanceData, Slot, SubUnit } from '@/lib/types';
import styles from '@/components/machines/Machines.module.css';

type Dialog =
  | { kind: 'machine'; machine?: Machine }
  | { kind: 'subUnit'; subUnit?: SubUnit; machineId?: string }
  | { kind: 'slot'; subUnit: SubUnit; slot: Slot; picking: boolean };

export function MachinesPage() {
  const { canEdit, canOperate, wsPath, money } = useWorkspace();
  const catalog = useCatalog();
  const { items } = useItems();
  const subUnits = useWsQuery<SubUnit[]>('/sub-units');
  const maintenance = useWsQuery<MaintenanceData>('/maintenance');
  const { run, busy } = useAction();
  const { machine: focus } = useMachineFocus();
  const [dialog, setDialog] = useState<Dialog | null>(null);

  if (catalog.error || subUnits.error) return <ErrorNote>{catalog.error ?? subUnits.error}</ErrorNote>;
  if (catalog.loading || !subUnits.data) return <Loading />;

  const itemById = new Map(items.map((i) => [i.id, i]));
  const machines = focus ? [focus] : catalog.machines;
  // Loose hardware belongs to no machine, so it only shows in the whole-workshop view.
  const unattached = focus ? [] : subUnits.data.filter((s) => !s.machineId || !catalog.machineById.has(s.machineId));

  const setSlot = async (subUnit: SubUnit, slot: Slot, itemId: string | null) => {
    if (await run(() => api.put(wsPath(`/sub-units/${subUnit.id}/slots/${slot.position}`)!, { itemId }), itemId ? 'Loaded' : 'Unloaded')) setDialog(null);
  };

  const renderSubUnit = (subUnit: SubUnit) => (
    <SubUnitPanel
      key={subUnit.id}
      subUnit={subUnit}
      catalog={catalog}
      itemById={itemById}
      canEdit={canEdit}
      canLoad={canOperate}
      onEdit={() => setDialog({ kind: 'subUnit', subUnit })}
      onSlot={(slot) => setDialog({ kind: 'slot', subUnit, slot, picking: !slot.itemId })}
    />
  );

  return (
    <>
      <PageHeader
        title="Machines"
        subtitle="Equipment, attached hardware and what is loaded where."
        actions={
          canEdit && (
            <Button variant="primary" icon={Plus} onClick={() => setDialog({ kind: 'machine' })}>
              Add machine
            </Button>
          )
        }
      />

      {catalog.machines.length === 0 && (
        <EmptyState icon={Cog} title="No machines yet" action={canEdit && <Button variant="primary" icon={Plus} onClick={() => setDialog({ kind: 'machine' })}>Add a machine</Button>}>
          Add printers, routers, lasers, sanders, or a general entry for the workbench. Each gets its own hours, maintenance and compatible parts.
        </EmptyState>
      )}

      <Grid min="lg">
        {machines.map((machine) => {
          const machineType = machine.machineTypeId ? catalog.machineTypeById.get(machine.machineTypeId) : undefined;
          const attached = subUnits.data!.filter((s) => s.machineId === machine.id);
          const due = (maintenance.data?.schedule ?? []).filter((e) => e.machineId === machine.id);
          const overdue = due.filter((e) => e.status === 'overdue').length;
          const soon = due.filter((e) => e.status === 'soon').length;
          const parts = items.filter((i) => i.compatibleMachineIds.includes(machine.id));
          const status = MACHINE_STATUS[machine.status];
          // Skip the make/model line when it only repeats the name.
          const makeModel = [machine.manufacturer, machine.model].filter(Boolean).join(' ');

          return (
            <Card key={machine.id} className={styles.machine}>
              <header className={styles.machineHead}>
                <TypeIcon icon={machineType?.icon ?? 'Cog'} size="lg" />
                <div className={styles.machineTitle}>
                  <h2 className={styles.machineName}>{machine.name}</h2>
                  <Muted>{[machineType?.name, makeModel !== machine.name ? makeModel : ''].filter(Boolean).join(' · ')}</Muted>
                </div>
                {canEdit && <IconButton icon={Pencil} label={`Edit ${machine.name}`} onClick={() => setDialog({ kind: 'machine', machine })} />}
              </header>

              <div className={styles.machineFacts}>
                <Badge tone={status.tone}>{status.label}</Badge>
                <Figure>{formatHours(machine.usageHours)}</Figure>
                {machine.hourlyCost > 0 && <Muted>{money(machine.hourlyCost)}/h</Muted>}
                {machine.locationId && <Muted>{catalog.locationById.get(machine.locationId)?.name}</Muted>}
              </div>

              <ReadingBadges readings={machine.specs} />

              {(overdue > 0 || soon > 0 || due.length > 0) && (
                <Link to="/maintenance" className={styles.serviceLink}>
                  {overdue > 0 && <Badge tone="danger">{overdue} overdue</Badge>}
                  {soon > 0 && <Badge tone="warn">{soon} due soon</Badge>}
                  {overdue + soon === 0 && <Badge tone="ok">Maintenance on track</Badge>}
                  <Muted>{due.length} scheduled task{due.length === 1 ? '' : 's'}</Muted>
                </Link>
              )}

              {machine.notes && <p className={styles.notes}>{machine.notes}</p>}

              {attached.length > 0 && <div className={styles.subUnits}>{attached.map(renderSubUnit)}</div>}

              {parts.length > 0 && (
                <div className={styles.parts}>
                  <SectionTitle count={parts.length}>Compatible parts and tooling</SectionTitle>
                  <ul className={styles.partList}>
                    {parts.map((part) => (
                      <li key={part.id}>
                        <Link to={`/inventory?item=${part.id}`} className={styles.part}>
                          <span className={styles.partName}>{part.name}</span>
                          <Figure tone={isLow(part) ? 'danger' : undefined}>{formatQuantity(part.quantity, part.unitId ? catalog.unitById.get(part.unitId) : null)}</Figure>
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {canEdit && (
                <div>
                  <Button size="sm" icon={Plus} onClick={() => setDialog({ kind: 'subUnit', machineId: machine.id })}>
                    Attach hardware
                  </Button>
                </div>
              )}
            </Card>
          );
        })}
      </Grid>

      {unattached.length > 0 && (
        <>
          <SectionTitle count={unattached.length}>Not attached to a machine</SectionTitle>
          <Grid min="lg">{unattached.map(renderSubUnit)}</Grid>
        </>
      )}

      {dialog?.kind === 'machine' && <MachineForm catalog={catalog} machine={dialog.machine} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'subUnit' && <SubUnitForm catalog={catalog} subUnit={dialog.subUnit} machineId={dialog.machineId} onClose={() => setDialog(null)} />}

      {dialog?.kind === 'slot' && !dialog.picking && (
        <Modal
          title={`${dialog.subUnit.name} · slot ${dialog.slot.position}`}
          onClose={() => setDialog(null)}
          footer={
            <>
              <Button onClick={() => setSlot(dialog.subUnit, dialog.slot, null)} disabled={busy}>
                Unload
              </Button>
              <Button variant="primary" onClick={() => setDialog({ ...dialog, picking: true })}>
                Swap for another item
              </Button>
            </>
          }
        >
          <SlotSummary item={dialog.slot.itemId ? itemById.get(dialog.slot.itemId) : undefined} catalog={catalog} />
          <Muted>Unloading does not change stock. It only frees the slot.</Muted>
        </Modal>
      )}

      {dialog?.kind === 'slot' && dialog.picking && (
        <ItemPicker
          title={`Load ${dialog.subUnit.name} · slot ${dialog.slot.position}`}
          items={items.filter((i) => i.quantity > 0 && i.id !== dialog.slot.itemId)}
          catalog={catalog}
          note={(item) => (item.slot ? `currently in ${item.slot.subUnit.name}, slot ${item.slot.position}` : '')}
          onPick={(item) => setSlot(dialog.subUnit, dialog.slot, item.id)}
          onClose={() => setDialog(null)}
        />
      )}
    </>
  );
}
