import { useEffect, useState } from 'react';
import { Copy, KeyRound, Plus, RefreshCw, Trash2, Unplug } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Badge, ErrorNote, Loading, Muted, SectionTitle } from '@/components/ui/Display';
import { FormGrid, SelectField, TextField } from '@/components/ui/Form';
import { Modal, useConfirm } from '@/components/ui/Modal';
import { useAction, useToast } from '@/components/ui/Toast';
import { useWorkspace, useWsQuery } from '@/context/WorkspaceContext';
import type { Catalog } from '@/hooks/useCatalog';
import { api } from '@/lib/api';
import { formatDateTime } from '@/lib/format';
import { refresh } from '@/lib/store';
import type { Bridge, DiscoveredPrinter, Pairing, PrinterLink } from '@/lib/types';
import styles from '@/components/settings/Settings.module.css';

type Dialog =
  | { kind: 'bridge' }
  | { kind: 'printer'; bridge: Bridge }
  | { kind: 'code'; link: PrinterLink };

/** Bridges on the workshop's network and the printers reached through them. */
export function PrintersSection({ catalog }: { catalog: Catalog }) {
  const { canEdit, wsPath } = useWorkspace();
  const bridges = useWsQuery<Bridge[]>('/bridges');
  const links = useWsQuery<PrinterLink[]>('/printers');
  const { run, busy } = useAction();
  const confirm = useConfirm();
  const [dialog, setDialog] = useState<Dialog | null>(null);
  // A set-up code is only ever shown by the request that made it, so it lives here until the page is left.
  const [pairings, setPairings] = useState<Record<string, Pairing>>({});

  if (bridges.error || links.error) return <ErrorNote>{bridges.error ?? links.error}</ErrorNote>;
  if (!bridges.data || !links.data) return <Loading />;

  const remember = (bridge: Bridge) => {
    if (bridge.pairing) setPairings((current) => ({ ...current, [bridge.id]: bridge.pairing! }));
  };

  const newCode = (bridge: Bridge) => run(async () => remember(await api.post<Bridge>(wsPath(`/bridges/${bridge.id}/pairing`)!, {})), 'New set-up code made');

  const removeBridge = async (bridge: Bridge) => {
    const ok = await confirm({
      title: `Remove ${bridge.name}?`,
      message: bridge.printerCount
        ? `Its ${bridge.printerCount === 1 ? 'printer stops' : `${bridge.printerCount} printers stop`} updating. The machines, their hardware and what is loaded in them stay as they are.`
        : 'The bridge program can then be stopped and deleted from the computer it runs on.',
      confirmLabel: 'Remove bridge',
      danger: true,
    });
    if (ok) await run(() => api.delete(wsPath(`/bridges/${bridge.id}`)!), 'Bridge removed');
  };

  const unlink = async (link: PrinterLink) => {
    const ok = await confirm({
      title: `Disconnect ${link.machine.name}?`,
      message: 'The machine stays, with its hardware and whatever is loaded. It just stops updating from the printer, and the bridge forgets the access code.',
      confirmLabel: 'Disconnect',
      danger: true,
    });
    if (ok) await run(() => api.delete(wsPath(`/printers/${link.id}`)!), 'Printer disconnected');
  };

  return (
    <>
      <SectionTitle
        action={
          canEdit && (
            <Button size="sm" icon={Plus} onClick={() => setDialog({ kind: 'bridge' })}>
              Add bridge
            </Button>
          )
        }
      >
        Connected printers
      </SectionTitle>
      <Muted>
        Wrkbench can read your Bambu Lab printers: what is in each AMS slot, how much is left, nozzle, progress and error codes. A small program,
        the bridge, runs on a computer that is always on and on the same network as the printers (a Raspberry Pi, a mini PC, a NAS). It only
        reads. It cannot start, stop or change a print, and the printers stay exactly as they are set up now, Bambu Handy included.
      </Muted>

      {bridges.data.length === 0 && (
        <div className={styles.general}>
          <Muted>No bridge yet. {canEdit ? 'Add one to get a set-up command to run on that computer.' : 'An admin or owner can add one.'}</Muted>
        </div>
      )}

      {bridges.data.map((bridge) => {
        const pairing = pairings[bridge.id];
        const printers = links.data!.filter((link) => link.bridgeId === bridge.id);
        return (
          <div key={bridge.id} className={styles.general}>
            <div className={styles.bridgeHead}>
              <div className={styles.memberText}>
                <strong>{bridge.name}</strong>
                <Muted>
                  {bridge.online
                    ? `Version ${bridge.version || 'unknown'}`
                    : bridge.paired
                      ? `Last seen ${bridge.lastSeenAt ? formatDateTime(bridge.lastSeenAt) : 'never'}`
                      : 'Waiting for the set-up command to be run'}
                </Muted>
              </div>
              <Badge tone={bridge.online ? 'ok' : bridge.paired ? 'warn' : 'neutral'}>{bridge.online ? 'Connected' : bridge.paired ? 'Offline' : 'Not set up'}</Badge>
            </div>

            {pairing && !bridge.online && <PairingBox pairing={pairing} />}
            {!pairing && !bridge.paired && canEdit && <Muted>The set-up command is only shown once. Make a new code to see it again.</Muted>}
            {bridge.paired && !bridge.online && !pairing && (
              <Muted>Check that the computer it runs on is switched on and online. To move the bridge to another computer, make a new set-up code and run the command there.</Muted>
            )}

            {printers.length > 0 && (
              <div className={styles.members}>
                {printers.map((link) => (
                  <div key={link.id} className={styles.member}>
                    <div className={styles.memberText}>
                      <strong>{link.machine.name}</strong>
                      <Muted>{[link.modelName, link.serial, link.host, link.firmware && `firmware ${link.firmware}`].filter(Boolean).join(' · ')}</Muted>
                    </div>
                    {link.codeState !== 'ok' && <Badge tone="warn">{link.codeState === 'missing' ? 'Needs access code' : 'Access code refused'}</Badge>}
                    {canEdit && (
                      <>
                        <Button size="sm" icon={KeyRound} onClick={() => setDialog({ kind: 'code', link })}>
                          Access code
                        </Button>
                        <Button size="sm" icon={Unplug} onClick={() => unlink(link)} disabled={busy}>
                          Disconnect
                        </Button>
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}

            {canEdit && (
              <div className={styles.danger}>
                <Button variant="primary" icon={Plus} onClick={() => setDialog({ kind: 'printer', bridge })} disabled={!bridge.online}>
                  Add printer
                </Button>
                <Button icon={RefreshCw} onClick={() => newCode(bridge)} disabled={busy}>
                  New set-up code
                </Button>
                <Button variant="danger" icon={Trash2} onClick={() => removeBridge(bridge)} disabled={busy}>
                  Remove
                </Button>
              </div>
            )}
          </div>
        );
      })}

      <Muted>
        The printer's access code goes straight to the bridge and is kept only there, never on this server. Find it on the printer's screen
        under Settings, then Network (or LAN Only Mode).
      </Muted>

      {dialog?.kind === 'bridge' && <BridgeForm onClose={() => setDialog(null)} onCreated={remember} />}
      {dialog?.kind === 'printer' && <PrinterSetup bridge={dialog.bridge} catalog={catalog} linked={links.data} onClose={() => setDialog(null)} />}
      {dialog?.kind === 'code' && <AccessCodeForm link={dialog.link} onClose={() => setDialog(null)} />}
    </>
  );
}

function PairingBox({ pairing }: { pairing: Pairing }) {
  const toast = useToast();
  const [, tick] = useState(0);
  // Re-render each half minute so the countdown and the "run out" note stay true.
  useEffect(() => {
    const timer = window.setInterval(() => tick((n) => n + 1), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  const minutes = Math.ceil((new Date(pairing.expiresAt).getTime() - Date.now()) / 60_000);

  const copy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      toast('Command copied');
    } catch {
      toast('Could not copy. Select the command and copy it by hand.', 'danger');
    }
  };

  if (minutes <= 0) return <Muted>That set-up code has run out. Make a new one.</Muted>;
  return (
    <>
      <Muted>
        Run this on the computer that will be the bridge. It needs Docker. The code works once, for the next {minutes} minute{minutes === 1 ? '' : 's'}.
      </Muted>
      <div className={styles.command}>
        <code className={styles.commandText}>{pairing.docker}</code>
        <Button icon={Copy} onClick={() => copy(pairing.docker)}>
          Copy
        </Button>
      </div>
      <Muted>Without Docker, from a copy of the Wrkbench source with Node.js installed:</Muted>
      <div className={styles.command}>
        <code className={styles.commandText}>{pairing.source}</code>
        <Button icon={Copy} onClick={() => copy(pairing.source)}>
          Copy
        </Button>
      </div>
    </>
  );
}

function BridgeForm({ onClose, onCreated }: { onClose: () => void; onCreated: (bridge: Bridge) => void }) {
  const { wsPath } = useWorkspace();
  const { run, busy } = useAction();
  const [name, setName] = useState('');

  const save = async () => {
    const ok = await run(async () => onCreated(await api.post<Bridge>(wsPath('/bridges')!, { name })), 'Bridge added');
    if (ok) onClose();
  };

  return (
    <Modal
      title="Add a bridge"
      onClose={onClose}
      onSubmit={save}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" disabled={busy || !name.trim()}>
            Add and show set-up command
          </Button>
        </>
      }
    >
      <TextField label="Name" value={name} onChange={setName} placeholder="Workshop Pi" hint="Where it runs, so you can tell bridges apart." autoFocus maxLength={80} />
    </Modal>
  );
}

function AccessCodeForm({ link, onClose }: { link: PrinterLink; onClose: () => void }) {
  const { wsPath } = useWorkspace();
  const { run, busy } = useAction();
  const [accessCode, setAccessCode] = useState('');
  const [host, setHost] = useState(link.host);

  const save = async () => {
    const ok = await run(() => api.put(wsPath(`/printers/${link.id}/access-code`)!, { accessCode: accessCode.trim(), host: host.trim() }), 'Access code checked and saved on the bridge');
    if (ok) onClose();
  };

  return (
    <Modal
      title={`${link.machine.name}: access code`}
      onClose={onClose}
      onSubmit={save}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" disabled={busy || !accessCode.trim()}>
            {busy ? 'Checking with the printer…' : 'Check and save'}
          </Button>
        </>
      }
    >
      <FormGrid>
        <TextField label="Access code" value={accessCode} onChange={setAccessCode} hint="On the printer's screen: Settings, then Network." autoFocus autoComplete="off" spellCheck={false} />
        <TextField label="Address on your network" value={host} onChange={setHost} hint="Change it if the printer was given a new address." inputMode="decimal" />
      </FormGrid>
    </Modal>
  );
}

const NEW_MACHINE = '__new__';

function PrinterSetup({ bridge, catalog, linked, onClose }: { bridge: Bridge; catalog: Catalog; linked: PrinterLink[]; onClose: () => void }) {
  const { wsPath } = useWorkspace();
  const { run, busy } = useAction();
  const found = useWsQuery<DiscoveredPrinter[]>(`/bridges/${bridge.id}/discovered`);
  const [serial, setSerial] = useState('');
  const [host, setHost] = useState('');
  const [accessCode, setAccessCode] = useState('');
  const [machineId, setMachineId] = useState(NEW_MACHINE);
  const [machineName, setMachineName] = useState('');
  const [byHand, setByHand] = useState(false);

  const taken = new Set(linked.map((link) => link.machineId));
  const freeMachines = catalog.machines.filter((machine) => !taken.has(machine.id));
  const available = (found.data ?? []).filter((printer) => !printer.linked);
  const chosen = available.find((printer) => printer.serial === serial);

  const choose = (printer: DiscoveredPrinter) => {
    setSerial(printer.serial);
    setHost(printer.host);
    setMachineName((current) => current || printer.name || printer.modelName);
    // A machine already entered with this serial number is almost certainly the same printer.
    const same = freeMachines.find((machine) => machine.serial && machine.serial.toUpperCase() === printer.serial);
    if (same) setMachineId(same.id);
  };

  const ready = serial.trim() && host.trim() && accessCode.trim() && (machineId !== NEW_MACHINE || machineName.trim());

  const save = async () => {
    const ok = await run(
      () =>
        api.post(wsPath('/printers')!, {
          bridgeId: bridge.id,
          serial: serial.trim(),
          host: host.trim(),
          accessCode: accessCode.trim(),
          ...(machineId === NEW_MACHINE ? { machineName: machineName.trim() } : { machineId }),
        }),
      'Printer connected',
    );
    if (ok) onClose();
  };

  return (
    <Modal
      title={`Add a printer to ${bridge.name}`}
      onClose={onClose}
      onSubmit={save}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" disabled={busy || !ready}>
            {busy ? 'Checking with the printer…' : 'Connect'}
          </Button>
        </>
      }
    >
      {!byHand && (
        <>
          {found.error && <ErrorNote>{found.error}</ErrorNote>}
          {!found.data && !found.error && <Loading label="Looking for printers" />}
          {found.data && available.length === 0 && (
            <Muted>
              No new printers heard on the bridge's network yet. They announce themselves every few seconds, so try again in a moment, or enter
              the printer's details by hand. (A bridge in Docker only hears them when started with host networking.)
            </Muted>
          )}
          {available.length > 0 && (
            <div className={styles.members}>
              {available.map((printer) => (
                <button key={printer.serial} type="button" className={`${styles.member} ${styles.choice} ${printer.serial === serial ? styles.choiceActive : ''}`} aria-pressed={printer.serial === serial} onClick={() => choose(printer)}>
                  <span className={styles.memberText}>
                    <strong>{printer.name || printer.modelName || 'Printer'}</strong>
                    <Muted>{[printer.modelName, printer.serial, printer.host].filter(Boolean).join(' · ')}</Muted>
                  </span>
                </button>
              ))}
            </div>
          )}
          <div className={styles.danger}>
            <Button size="sm" icon={RefreshCw} onClick={() => refresh(wsPath(`/bridges/${bridge.id}/discovered`)!)}>
              Look again
            </Button>
            <Button size="sm" onClick={() => setByHand(true)}>
              Enter address and serial number by hand
            </Button>
          </div>
        </>
      )}

      {(byHand || chosen) && (
        <FormGrid>
          {byHand && (
            <>
              <TextField label="Address on your network" value={host} onChange={setHost} placeholder="192.168.1.50" hint="Printer's screen: Settings, then Network." inputMode="decimal" />
              <TextField label="Serial number" value={serial} onChange={(value) => setSerial(value.toUpperCase())} hint="Printer's screen: Settings, then Device." autoComplete="off" spellCheck={false} />
            </>
          )}
          <TextField label="Access code" value={accessCode} onChange={setAccessCode} hint="Printer's screen: Settings, then Network. Sent to the bridge and kept only there." autoComplete="off" spellCheck={false} />
          <SelectField label="Machine in Wrkbench" value={machineId} onChange={setMachineId} hint="Link it to a machine you already have, or add it as a new one.">
            <option value={NEW_MACHINE}>Add as a new machine</option>
            {freeMachines.map((machine) => (
              <option key={machine.id} value={machine.id}>
                {machine.name}
              </option>
            ))}
          </SelectField>
          {machineId === NEW_MACHINE && <TextField label="Name for the new machine" value={machineName} onChange={setMachineName} maxLength={120} />}
        </FormGrid>
      )}
    </Modal>
  );
}
