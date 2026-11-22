import { useEffect, useRef, useState } from 'react';
import { Usb } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { ErrorNote, Loading, Muted } from '@/components/ui/Display';
import { Checkbox, FormGrid, SelectField, TextField } from '@/components/ui/Form';
import { Modal } from '@/components/ui/Modal';
import { useWsQuery, useWorkspace } from '@/context/WorkspaceContext';
import { api } from '@/lib/api';
import type { Device } from '@/lib/types';
import styles from '@/components/settings/Settings.module.css';

interface FirmwareList {
  version: string | null;
  builds: Array<{ model: string; name: string; size: number }>;
}

type Stage =
  | { kind: 'ready' }
  | { kind: 'working'; step: string; percent: number | null }
  /** Flashed and, when asked, set up: `connected` once the display has paired with this server. */
  | { kind: 'done'; version: string; name: string | null; connected: boolean }
  /** Flashed, but the board did not take its set-up over USB: finish from a phone with this code. */
  | { kind: 'phone'; version: string; name: string; code: string; server: string; why: string }
  | { kind: 'failed'; message: string };

/** Web Serial is only in Chromium browsers on a computer: Chrome, Edge, Opera. */
const canFlash = () => typeof navigator !== 'undefined' && 'serial' in navigator;
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Sends the set-up line to a board that has just been flashed and waits for its answer ("WBSETUP OK" or
 * "WBSETUP ERR <why>"). It is sent again every two seconds while the board is still starting. Resolves to null
 * when it took it, or why not.
 */
async function sendSetup(port: SerialPort, line: string, timeoutMs = 25_000): Promise<string | null> {
  await port.open({ baudRate: 115200 });
  // Both lines low: the board's auto-reset circuit then leaves it running.
  await port.setSignals({ dataTerminalReady: false, requestToSend: false });
  const reader = port.readable!.getReader();
  const writer = port.writable!.getWriter();
  const decoder = new TextDecoder();
  let text = '';
  let answer: string | null | undefined;
  const reading = (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) return;
        text += decoder.decode(value, { stream: true });
        const match = /WBSETUP (OK|ERR ([^\r\n]*))/.exec(text);
        if (match) {
          answer = match[1] === 'OK' ? null : match[2] || 'The board refused the set-up';
          return;
        }
      }
    } catch {
      // closed below
    }
  })();
  const bytes = new TextEncoder().encode(`${line}\n`);
  const started = Date.now();
  while (answer === undefined && Date.now() - started < timeoutMs) {
    await writer.write(bytes);
    for (let i = 0; i < 20 && answer === undefined; i++) await sleep(100);
  }
  await reader.cancel().catch(() => {});
  await reading;
  reader.releaseLock();
  writer.releaseLock();
  await port.close().catch(() => {});
  return answer === undefined ? 'The board did not answer over USB' : answer;
}

/**
 * Puts Wrkbench's firmware on a new display straight from the browser, over USB (Web Serial and esptool-js),
 * and, when asked, sets it up over the same cable: the display is added here, and its Wi-Fi, this server's
 * address and the new set-up code are sent to the board, which joins the Wi-Fi and pairs by itself. The Wi-Fi
 * password goes from this page to the board only; it is never sent to the server.
 */
export function FlashDisplay({ locations, onClose }: { locations: Array<{ id: string; path: string }>; onClose: () => void }) {
  const firmware = useWsQuery<FirmwareList>('/firmware');
  const { wsPath } = useWorkspace();
  const [model, setModel] = useState('');
  const [eraseAll, setEraseAll] = useState(true);
  const [setUp, setSetUp] = useState(true);
  const [name, setName] = useState('');
  const [locationId, setLocationId] = useState('');
  const [ssid, setSsid] = useState('');
  const [password, setPassword] = useState('');
  const [stage, setStage] = useState<Stage>({ kind: 'ready' });
  const cancelled = useRef(false);

  useEffect(() => {
    if (!model && firmware.data?.builds[0]) setModel(firmware.data.builds[0].model);
  }, [firmware.data, model]);
  useEffect(
    () => () => {
      cancelled.current = true;
    },
    [],
  );

  const working = stage.kind === 'working';
  const build = firmware.data?.builds.find((b) => b.model === model);
  const passwordOk = password.length === 0 || (password.length >= 8 && password.length <= 63);
  // What still stops the button, said under it rather than leaving it greyed out without a reason.
  const missing = !setUp ? null : !name.trim() ? 'Give the display a name' : !ssid.trim() ? 'Enter the Wi-Fi name' : !passwordOk ? 'A Wi-Fi password has 8 to 63 characters' : null;
  const ready = !!build && canFlash() && !missing;

  const flash = async () => {
    if (!build || !firmware.data?.version) return;
    const version = firmware.data.version;
    const fail = (error: unknown) => {
      console.error('Flashing a display failed', error);
      if (!cancelled.current) setStage({ kind: 'failed', message: error instanceof Error ? error.message : String(error) });
    };
    let port: SerialPort;
    try {
      // The browser lists the USB serial ports; the person picks the board's (often "USB-SERIAL CH340").
      port = await navigator.serial.requestPort();
    } catch (error) {
      // Closing the picker without choosing is not a failure; anything else is said.
      if (error instanceof DOMException && error.name === 'NotFoundError') return;
      fail(error);
      return;
    }
    const update = (step: string, percent: number | null = null) => !cancelled.current && setStage({ kind: 'working', step, percent });
    update('Getting ready');
    let transport: import('esptool-js').Transport;
    let ESPLoader: typeof import('esptool-js').ESPLoader;
    try {
      // Loaded only now: the flasher is only needed by the few who set up a display.
      const esptool = await import('esptool-js');
      ESPLoader = esptool.ESPLoader;
      transport = new esptool.Transport(port, false);
    } catch (error) {
      fail(error);
      return;
    }
    try {
      update('Downloading the firmware');
      const image = new Uint8Array(await (await api.blob(wsPath(`/firmware/${build.model}/full`)!)).arrayBuffer());

      update('Connecting to the board');
      const loader = new ESPLoader({ transport, baudrate: 460800 });
      let chip: string;
      try {
        chip = await loader.main();
      } catch {
        throw new Error(
          'The board did not answer. Hold its BOOT button, press and release RST, let go of BOOT, and try again. ' +
            'If no port was listed, the computer may need the CH340 USB driver.',
        );
      }
      // The family, not the description: a CYD's chip describes itself as e.g. "ESP32-D0WD-V3 (revision 3)".
      if (loader.chip.CHIP_NAME !== 'ESP32') throw new Error(`That board is an ${chip}, not the ESP32 a CYD has. Check the port you chose.`);

      update(eraseAll ? 'Erasing the board' : 'Writing the firmware', eraseAll ? null : 0);
      await loader.writeFlash({
        fileArray: [{ data: image, address: 0 }],
        flashMode: 'keep',
        flashFreq: 'keep',
        flashSize: 'keep',
        eraseAll,
        compress: true,
        reportProgress: (_file, written, total) => update('Writing the firmware', Math.round((written / total) * 100)),
      });
      update('Restarting the board');
      await loader.after('hard_reset');
    } catch (error) {
      fail(error);
      return;
    } finally {
      await transport.disconnect().catch(() => {});
    }

    if (!setUp) {
      if (!cancelled.current) setStage({ kind: 'done', version, name: null, connected: false });
      return;
    }
    try {
      update('Adding the display');
      const created = await api.post<Device>(wsPath('/devices')!, { name: name.trim(), locationId: locationId || null });
      const pairing = created.pairing!;
      update('Sending the set-up over USB');
      const line = JSON.stringify({ ssid, password, url: pairing.server, code: pairing.code });
      const refused = await sendSetup(port, line);
      setPassword('');
      if (refused) {
        if (!cancelled.current) setStage({ kind: 'phone', version, name: created.name, code: pairing.code, server: pairing.server, why: refused });
        return;
      }
      update('Joining the Wi-Fi and connecting');
      const started = Date.now();
      while (!cancelled.current && Date.now() - started < 90_000) {
        await sleep(3000);
        const devices = await api.get<Device[]>(wsPath('/devices')!);
        if (devices.find((d) => d.id === created.id)?.paired) {
          setStage({ kind: 'done', version, name: created.name, connected: true });
          return;
        }
      }
      if (!cancelled.current) setStage({ kind: 'done', version, name: created.name, connected: false });
    } catch (error) {
      fail(error);
    }
  };

  const finished = stage.kind === 'done' || stage.kind === 'phone';
  const footer = finished ? (
    <Button variant="primary" onClick={onClose}>
      Done
    </Button>
  ) : (
    <>
      <Button onClick={onClose} disabled={working}>
        Cancel
      </Button>
      <Button variant="primary" icon={Usb} onClick={flash} disabled={working || !ready}>
        {stage.kind === 'failed' ? 'Try again' : setUp ? 'Connect, flash and set up' : 'Connect and flash'}
      </Button>
    </>
  );

  return (
    <Modal title="Flash a new display" onClose={working ? () => {} : onClose} footer={footer}>
      {!canFlash() ? (
        <ErrorNote>
          This browser cannot reach USB devices. Open Wrkbench in Chrome or Edge on a computer to flash a display; phones and Safari or Firefox cannot.
        </ErrorNote>
      ) : firmware.error ? (
        <ErrorNote>{firmware.error}</ErrorNote>
      ) : !firmware.data ? (
        <Loading />
      ) : !firmware.data.version ? (
        <ErrorNote>No display firmware is published yet, so there is nothing to flash. Try again later.</ErrorNote>
      ) : stage.kind === 'done' ? (
        <div className={styles.general}>
          <strong>Firmware {stage.version} is on the display.</strong>
          <Muted>
            {stage.name === null
              ? 'It restarts and shows the name and password of its own Wi-Fi network. Add it here to get a set-up code, and follow the steps on its screen.'
              : stage.connected
                ? `${stage.name} is set up and connected. You can unplug it from the computer and fix it in place.`
                : `${stage.name} has its set-up but has not connected yet. Check the Wi-Fi name and password; its card below turns to Connected once it does. If it never does, use Set up again on the display and set it up from a phone.`}
          </Muted>
        </div>
      ) : stage.kind === 'phone' ? (
        <div className={styles.general}>
          <strong>Firmware {stage.version} is on the display, but it did not take its set-up over USB.</strong>
          <Muted>
            {stage.why}. {stage.name} was added: finish from a phone. Join the display's own Wi-Fi (its name and password are on its screen), then on the page
            that opens enter your Wi-Fi, the address {stage.server} and the code below. The code works once, for ten minutes.
          </Muted>
          <div className={styles.command}>
            <span className={styles.pairCode}>{stage.code}</span>
          </div>
        </div>
      ) : (
        <>
          <Muted>
            Plug the display into this computer with a USB cable and press Connect. The browser asks which USB port to use: pick the board's (often
            “USB-SERIAL CH340”). It takes a minute or two. Firmware {firmware.data.version}.
          </Muted>
          <FormGrid>
            <SelectField label="Board" value={model} onChange={setModel} disabled={working} hint="Printed on the board or its listing. If the colours look wrong afterwards, flash the other 2.8 inch kind.">
              {firmware.data.builds.map((b) => (
                <option key={b.model} value={b.model}>
                  {b.name}
                </option>
              ))}
            </SelectField>
          </FormGrid>
          <Checkbox
            label="Erase everything first"
            hint="Clears whatever was on the board, including a Wi-Fi and set-up it had. Leave on for a new board."
            checked={eraseAll}
            disabled={working}
            onChange={setEraseAll}
          />
          <Checkbox
            label="Set it up over USB too"
            hint="Adds the display here and sends it your Wi-Fi and a set-up code over the cable, so no phone is needed."
            checked={setUp}
            disabled={working}
            onChange={setSetUp}
          />
          {setUp && (
            <FormGrid>
              <TextField label="Name" value={name} onChange={setName} placeholder="Rack A display" maxLength={80} disabled={working} hint="Where it hangs, so you can tell displays apart." />
              <SelectField label="Shows" value={locationId} onChange={setLocationId} disabled={working} hint="You can change this at any time.">
                <option value="">Choose later</option>
                {locations.map((location) => (
                  <option key={location.id} value={location.id}>
                    {location.path}
                  </option>
                ))}
              </SelectField>
              <TextField label="Wi-Fi name" value={ssid} onChange={setSsid} maxLength={32} autoComplete="off" disabled={working} hint="Exactly as your phone shows it. 2.4 GHz networks only." />
              <TextField
                label="Wi-Fi password"
                type="password"
                value={password}
                onChange={setPassword}
                maxLength={63}
                autoComplete="off"
                disabled={working}
                hint={passwordOk ? 'Sent to the display over the cable only, never to Wrkbench. Leave empty for an open network.' : 'A Wi-Fi password has 8 to 63 characters.'}
              />
            </FormGrid>
          )}
          {working && (
            <div className={styles.general} role="status" aria-live="polite">
              <strong>
                {stage.step}
                {stage.percent !== null ? `: ${stage.percent}%` : '…'}
              </strong>
              {stage.percent !== null && <progress max={100} value={stage.percent} style={{ width: '100%' }} />}
              <Muted>Keep this page open and the board plugged in.</Muted>
            </div>
          )}
          {stage.kind === 'failed' && <ErrorNote>{stage.message}</ErrorNote>}
          {!working && missing && <Muted>{missing} to start.</Muted>}
        </>
      )}
    </Modal>
  );
}
