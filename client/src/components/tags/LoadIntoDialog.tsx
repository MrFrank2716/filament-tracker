import { PlugZap } from 'lucide-react';
import { Badge, EmptyState, List, Loading, Row, Swatch } from '@/components/ui/Display';
import { Modal } from '@/components/ui/Modal';
import { useWsQuery } from '@/context/WorkspaceContext';
import type { Catalog } from '@/hooks/useCatalog';
import { feederFor, usePrinterStates } from '@/hooks/usePrinters';
import { useSlotActions } from '@/hooks/useSlotActions';
import { describeDetected, matchScore } from '@/lib/spoolMatch';
import type { Detected, Item, Slot, SubUnit } from '@/lib/types';

interface Props {
  item: Item;
  items: Item[];
  catalog: Catalog;
  onClose: () => void;
}

interface Choice {
  subUnit: SubUnit;
  slot: Slot;
  detected: Detected | null;
  occupant: Item | undefined;
  score: number;
}

/**
 * Put a spool into a slot starting from the spool (its sheet, or a scan of its label) rather than from the
 * machine. Slots where the printer reports a matching filament come first, then free ones.
 */
export function LoadIntoDialog({ item, items, catalog, onClose }: Props) {
  const { data: subUnits } = useWsQuery<SubUnit[]>('/sub-units');
  const printers = usePrinterStates();
  const { setSlot, busy } = useSlotActions();

  const choices: Choice[] = (subUnits ?? []).flatMap((subUnit) =>
    subUnit.slots
      .filter((slot) => slot.itemId !== item.id)
      .map((slot) => {
        // Live while the printer is reporting, otherwise what was last saved.
        const detected = feederFor(subUnit, subUnit.machineId ? printers.get(subUnit.machineId) : undefined)?.trays.find((tray) => tray.position === slot.position) ?? slot.detected;
        return {
          subUnit, slot, detected,
          occupant: slot.itemId ? items.find((candidate) => candidate.id === slot.itemId) : undefined,
          score: detected?.state === 'loaded' ? matchScore(item, detected, catalog) : 0,
        };
      }),
  );
  choices.sort((a, b) => b.score - a.score || Number(Boolean(a.slot.itemId)) - Number(Boolean(b.slot.itemId)) || a.subUnit.name.localeCompare(b.subUnit.name) || a.slot.position - b.slot.position);

  const load = async (choice: Choice) => {
    if (await setSlot(choice.subUnit, choice.slot, item.id)) onClose();
  };

  return (
    <Modal title={`Load ${item.name} into…`} onClose={onClose}>
      {!subUnits ? (
        <Loading />
      ) : choices.length === 0 ? (
        <EmptyState icon={PlugZap} title="Nowhere to load it yet">
          Slots belong to the feeders and holders attached to a machine. Add one on the Machines page, or connect a printer and its AMS units appear by themselves.
        </EmptyState>
      ) : (
        <List>
          {choices.map((choice) => {
            const machine = choice.subUnit.machineId ? catalog.machineById.get(choice.subUnit.machineId)?.name : undefined;
            const seen = choice.detected?.state === 'loaded' ? choice.detected : null;
            return (
              <Row
                key={choice.slot.id}
                onClick={busy ? undefined : () => void load(choice)}
                leading={seen?.colour ? <Swatch color={seen.colour} size={22} /> : undefined}
                title={`${choice.subUnit.name} · slot ${choice.slot.position}${choice.slot.label ? ` (${choice.slot.label})` : ''}`}
                subtitle={[
                  machine,
                  seen ? `printer reports ${describeDetected(seen)}` : choice.detected?.state === 'empty' ? 'printer reports it empty' : '',
                  choice.occupant ? `holds ${choice.occupant.name}, which will be unloaded` : choice.slot.itemId ? 'in use' : 'free',
                ].filter(Boolean).join(' · ')}
                trailing={choice.score >= 2 ? <Badge tone="ok">Matches</Badge> : choice.score === 1 ? <Badge>Same material</Badge> : undefined}
              />
            );
          })}
        </List>
      )}
    </Modal>
  );
}
