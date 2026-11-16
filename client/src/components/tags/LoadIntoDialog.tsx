import { useEffect, useState } from 'react';
import { PlugZap, ScanLine } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Badge, EmptyState, List, Loading, Muted, Row, SectionTitle, Swatch } from '@/components/ui/Display';
import { Modal } from '@/components/ui/Modal';
import { useAction, useToast } from '@/components/ui/Toast';
import { useWorkspace, useWsQuery } from '@/context/WorkspaceContext';
import { api } from '@/lib/api';
import { watchPendingSpool } from '@/lib/printerStore';
import { refreshAll } from '@/lib/store';
import styles from '@/components/tags/Tags.module.css';
import type { Catalog } from '@/hooks/useCatalog';
import { feederFor, usePrinterStates } from '@/hooks/usePrinters';
import { useSlotActions } from '@/hooks/useSlotActions';
import { describeDetected, matchScore } from '@/lib/spoolMatch';
import type { Detected, Item, Machine, Slot, SubUnit } from '@/lib/types';

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

  // ---- Scan, then insert: "the next spool put into this printer is this one" ----
  const { wsPath } = useWorkspace();
  const { run, busy: arming } = useAction();
  const toast = useToast();
  const [waiting, setWaiting] = useState<{ machine: Machine; expiresAt: number } | null>(null);
  const [stopped, setStopped] = useState('');
  const [now, setNow] = useState(() => Date.now());
  // Only a printer that is reporting right now can be seen taking a spool.
  const livePrinters = catalog.machines.filter((machine) => printers.get(machine.id)?.connection === 'live');
  const pendingPath = (machine: Machine) => wsPath(`/printers/by-machine/${machine.id}/pending-spool`)!;

  const arm = async (machine: Machine) => {
    setStopped('');
    let expiresAt = 0;
    if (await run(async () => { expiresAt = (await api.put<{ expiresAt: number }>(pendingPath(machine), { itemId: item.id })).expiresAt; })) {
      setNow(Date.now());
      setWaiting({ machine, expiresAt });
    }
  };
  const cancel = async () => {
    if (!waiting) return;
    const { machine } = waiting;
    setWaiting(null);
    await run(() => api.delete(pendingPath(machine)));
  };

  useEffect(() => {
    if (!waiting) return;
    const tick = window.setInterval(() => setNow(Date.now()), 1000);
    const unwatch = watchPendingSpool((event) => {
      if (event.machineId !== waiting.machine.id || event.itemId !== item.id || event.state === 'armed') return;
      if (event.state === 'linked') {
        refreshAll();
        toast(`${item.name} is in ${event.place}${event.mismatch ? '. The printer describes that tray as a different filament: check its setting on the printer.' : ''}`);
        onClose();
        return;
      }
      setWaiting(null);
      setStopped(
        event.state === 'dropped'
          ? event.reason === 'several' ? 'More than one tray was loaded at once, so there was no telling which holds this spool. Choose its slot below.' : 'This spool is no longer in stock.'
          : event.state === 'expired' ? 'No spool went in within two minutes. Try again, or choose its slot below.' : '',
      );
    });
    return () => {
      window.clearInterval(tick);
      unwatch();
    };
  }, [waiting, item.id, item.name, toast, onClose]);

  const left = waiting ? Math.max(0, Math.ceil((waiting.expiresAt - now) / 1000)) : 0;

  return (
    <Modal title={`Load ${item.name} into…`} onClose={onClose}>
      {waiting ? (
        <div className={styles.steps}>
          <div className={styles.status}>
            <ScanLine size={22} aria-hidden /> Put the spool into {waiting.machine.name} now
          </div>
          <Muted>
            The next tray that is loaded on {waiting.machine.name} becomes this spool. {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')} left. Load one spool at a time.
          </Muted>
          <div className={styles.row}>
            <Button onClick={cancel}>Cancel</Button>
          </div>
        </div>
      ) : (
        livePrinters.length > 0 && (
          <div className={styles.section}>
            <SectionTitle>About to put it in?</SectionTitle>
            <Muted>Choose the printer, then insert the spool: whichever tray it goes into is linked to it by itself. For spools the printer cannot identify.</Muted>
            <div className={styles.row}>
              {livePrinters.map((machine) => (
                <Button key={machine.id} icon={ScanLine} onClick={() => void arm(machine)} disabled={arming}>
                  Next into {machine.name}
                </Button>
              ))}
            </div>
            {stopped && <p className={styles.warning}>{stopped}</p>}
          </div>
        )
      )}
      {waiting ? null : !subUnits ? (
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
