import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Cog, Pencil, Plus } from 'lucide-react';
import { ItemForm } from '@/components/items/ItemForm';
import { ItemPicker } from '@/components/items/ItemPicker';
import { MachineForm, SubUnitForm } from '@/components/machines/MachineForms';
import { PrinterPanel } from '@/components/machines/PrinterPanel';
import { SlotSummary, SubUnitPanel } from '@/components/machines/SubUnitPanel';
import { Button, IconButton } from '@/components/ui/Button';
import { Badge, Card, EmptyState, ErrorNote, Figure, Grid, Loading, Muted, PageHeader, SectionTitle, Swatch, TypeIcon } from '@/components/ui/Display';
import { Modal } from '@/components/ui/Modal';
import { useAction } from '@/components/ui/Toast';
import { useMachineFocus } from '@/context/FocusContext';
import { useWorkspace, useWsQuery } from '@/context/WorkspaceContext';
import { useCatalog, useItems } from '@/hooks/useCatalog';
import { feederFor, usePrinterStates } from '@/hooks/usePrinters';
import { api } from '@/lib/api';
import { formatHours, formatQuantity, isLow } from '@/lib/format';
import { describeDetected, detectedGrams, newSpoolFrom, rankForTray } from '@/lib/spoolMatch';
import { MACHINE_STATUS } from '@/lib/status';
import type { Detected, Item, Machine, MaintenanceData, Slot, SubUnit } from '@/lib/types';
import styles from '@/components/machines/Machines.module.css';

type Dialog =
  | { kind: 'machine'; machine?: Machine }
  | { kind: 'subUnit'; subUnit?: SubUnit; machineId?: string }
  | { kind: 'slot'; subUnit: SubUnit; slot: Slot; picking: boolean }
  | { kind: 'newSpool'; subUnit: SubUnit; slot: Slot; initial: Partial<Item> };

export function MachinesPage() {
  const { canEdit, canOperate, wsPath, money } = useWorkspace();
  const catalog = useCatalog();
  const { items } = useItems();
  const subUnits = useWsQuery<SubUnit[]>('/sub-units');
  const maintenance = useWsQuery<MaintenanceData>('/maintenance');
  const { run, busy } = useAction();
  const { machine: focus } = useMachineFocus();
  const printers = usePrinterStates();
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

  /** What the printer sees in a slot: live while it is reporting, otherwise what was last saved. */
  const detectedIn = (subUnit: SubUnit, slot: Slot): Detected | null =>
    feederFor(subUnit, subUnit.machineId ? printers.get(subUnit.machineId) : undefined)?.trays.find((tray) => tray.position === slot.position) ?? slot.detected;

  /** Bring the item's stock in line with what the printer reads off the spool's tag. Audited like any adjustment. */
  const applyPrinterFigure = (item: Item, grams: number) =>
    run(() => api.post(wsPath(`/items/${item.id}/adjust`)!, { mode: 'set', value: grams, note: 'Read from the printer' }), `${item.name} set to ${grams} g`);

  const renderSubUnit = (subUnit: SubUnit) => (
    <SubUnitPanel
      key={subUnit.id}
      subUnit={subUnit}
      catalog={catalog}
      itemById={itemById}
      canEdit={canEdit}
      canLoad={canOperate}
      feeder={feederFor(subUnit, subUnit.machineId ? printers.get(subUnit.machineId) : undefined)}
      onEdit={() => setDialog({ kind: 'subUnit', subUnit })}
      // An empty slot goes straight to choosing; one the printer sees a spool in first shows what it sees.
      onSlot={(slot) => setDialog({ kind: 'slot', subUnit, slot, picking: !slot.itemId && detectedIn(subUnit, slot)?.state !== 'loaded' })}
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
          const printer = printers.get(machine.id);

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

              {(overdue > 0 || soon > 0 || due.length > 0) && (
                <Link to="/maintenance" className={styles.serviceLink}>
                  {overdue > 0 && <Badge tone="danger">{overdue} overdue</Badge>}
                  {soon > 0 && <Badge tone="warn">{soon} due soon</Badge>}
                  {overdue + soon === 0 && <Badge tone="ok">Maintenance on track</Badge>}
                  <Muted>{due.length} scheduled task{due.length === 1 ? '' : 's'}</Muted>
                </Link>
              )}

              {machine.notes && <p className={styles.notes}>{machine.notes}</p>}

              {printer && <PrinterPanel state={printer} />}

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

      {dialog?.kind === 'slot' && !dialog.picking && (() => {
        const { subUnit, slot } = dialog;
        const item = slot.itemId ? itemById.get(slot.itemId) : undefined;
        const detected = detectedIn(subUnit, slot);
        const seen = detected?.state === 'loaded' ? detected : null;
        const grams = detectedGrams(seen);
        const inGrams = item?.unitId ? catalog.unitById.get(item.unitId)?.symbol === 'g' : false;
        // Worth offering only when the two figures really disagree, and only downward for someone who cannot add stock.
        const differs = item && grams !== null && inGrams && Math.abs(item.quantity - grams) >= Math.max(5, (item.capacity ?? 0) * 0.02) && (canEdit || grams < item.quantity);
        return (
          <Modal
            title={`${subUnit.name} · slot ${slot.position}`}
            onClose={() => setDialog(null)}
            footer={
              item ? (
                <>
                  <Button onClick={() => setSlot(subUnit, slot, null)} disabled={busy}>
                    Unload
                  </Button>
                  <Button variant="primary" onClick={() => setDialog({ ...dialog, picking: true })}>
                    Swap for another item
                  </Button>
                </>
              ) : (
                <>
                  {canEdit && seen && (
                    <Button onClick={() => setDialog({ kind: 'newSpool', subUnit, slot, initial: newSpoolFrom(seen, catalog) })}>Add as a new spool</Button>
                  )}
                  <Button variant="primary" onClick={() => setDialog({ ...dialog, picking: true })}>
                    Choose from stock
                  </Button>
                </>
              )
            }
          >
            {item && <SlotSummary item={item} catalog={catalog} />}
            {seen && (
              <div className={styles.detected}>
                {seen.colour && <Swatch color={seen.colour} size={28} />}
                <div className={styles.detectedText}>
                  <Muted>The printer reports</Muted>
                  <strong>{describeDetected(seen)}</strong>
                  {grams !== null && <Muted>about {grams} g of {seen.spoolWeightGrams} g</Muted>}
                </div>
                {differs && (
                  <Button size="sm" onClick={() => applyPrinterFigure(item, grams!)} disabled={busy}>
                    Set stock to {grams} g
                  </Button>
                )}
              </div>
            )}
            {item ? (
              <Muted>
                {subUnit.externalId
                  ? 'This slot follows the printer: it unloads by itself when the spool is taken out. Unloading does not change stock.'
                  : 'Unloading does not change stock. It only frees the slot.'}
              </Muted>
            ) : (
              <Muted>
                This spool is not tied to anything in stock yet. Choose the item it is, or add it as a new one.
                {seen?.tagId ? ' It has a tag, so from then on it is recognised by itself wherever it is loaded.' : ''}
              </Muted>
            )}
          </Modal>
        );
      })()}

      {dialog?.kind === 'slot' && dialog.picking && (() => {
        const detected = detectedIn(dialog.subUnit, dialog.slot);
        const ranked = rankForTray(items.filter((i) => i.quantity > 0 && i.id !== dialog.slot.itemId), detected, catalog);
        const score = new Map(ranked.map((entry) => [entry.item.id, entry.score]));
        return (
          <ItemPicker
            title={`Load ${dialog.subUnit.name} · slot ${dialog.slot.position}`}
            items={ranked.map((entry) => entry.item)}
            catalog={catalog}
            note={(item) =>
              [
                (score.get(item.id) ?? 0) >= 2 ? 'matches what the printer reports' : score.get(item.id) === 1 ? 'same material' : '',
                item.slot ? `currently in ${item.slot.subUnit.name}, slot ${item.slot.position}` : '',
              ].filter(Boolean).join(' · ')
            }
            onPick={(item) => setSlot(dialog.subUnit, dialog.slot, item.id)}
            onClose={() => setDialog(null)}
          />
        );
      })()}

      {dialog?.kind === 'newSpool' && (
        <ItemForm
          catalog={catalog}
          initial={dialog.initial}
          onClose={() => setDialog(null)}
          // Once it exists, put it in the slot it was read from.
          onSaved={(saved) => void setSlot(dialog.subUnit, dialog.slot, saved.id)}
        />
      )}
    </>
  );
}
