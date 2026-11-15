import readline from 'node:readline';
import type { DiscoveredPrinter, Doc, PrinterTestAck } from '@filament-tracker/protocol';
import { simDocument, simFleet, simTray, type SimPrinter, type SimSpool } from '@filament-tracker/protocol/fixtures';
import type { PrinterSession, SessionEvents } from './bambu';
import { log } from './log';

/**
 * Pretend printers, for trying Wrkbench without hardware (`--simulate`).
 *
 * Four made-up printers appear in discovery, accept the access code 12345678, and report in the same shape real
 * Bambu Lab printers do: a full status first, then small partial updates. One of them prints. Spools can be
 * swapped by typing commands on the bridge's standard input:
 *
 *   swap <serial> <feeder id> <tray 0-3> <type> <rrggbb> [tag seed]
 *   empty <serial> <feeder id> <tray 0-3>
 */

export const SIM_ACCESS_CODE = '12345678';

interface SimEntry {
  printer: SimPrinter;
  host: string;
  listeners: Set<(delta: Doc) => void>;
}

export class Simulator {
  private readonly entries = new Map<string, SimEntry>();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    simFleet().forEach((printer, index) => this.entries.set(printer.serial, { printer, host: `192.168.50.${11 + index}`, listeners: new Set() }));
  }

  has(serial: string): boolean {
    return this.entries.has(serial);
  }

  discovered(): DiscoveredPrinter[] {
    return [...this.entries.values()].map(({ printer, host }) => ({ serial: printer.serial, host, modelCode: printer.modelCode, name: printer.name }));
  }

  test(serial: string, accessCode: string): PrinterTestAck {
    const entry = this.entries.get(serial);
    if (!entry) return { ok: false, code: 'unreachable' };
    if (accessCode !== SIM_ACCESS_CODE) return { ok: false, code: 'auth_failed' };
    return { ok: true, modelName: entry.printer.productName, firmware: entry.printer.firmware };
  }

  session(serial: string, accessCode: string | undefined, events: SessionEvents): PrinterSession {
    const entry = this.entries.get(serial)!;
    const listener = (delta: Doc) => events.onDoc(delta);
    return {
      start: () => {
        if (!accessCode) return events.onStatus('unreachable', 'missing');
        if (accessCode !== SIM_ACCESS_CODE) return events.onStatus('auth_failed', 'rejected');
        events.onStatus('online', 'ok');
        events.onDoc(simDocument(entry.printer));
        entry.listeners.add(listener);
      },
      stop: () => void entry.listeners.delete(listener),
      refresh: () => events.onDoc(simDocument(entry.printer)),
    };
  }

  private emit(entry: SimEntry, print: Doc): void {
    entry.listeners.forEach((listener) => listener({ print: { command: 'push_status', ...print } }));
  }

  /** Move the printing printers along, and start the finished one again after a pause. */
  private tick(): void {
    for (const entry of this.entries.values()) {
      const { printer } = entry;
      if (printer.state === 'RUNNING' && printer.job) {
        const job = printer.job;
        job.percent = Math.min(100, job.percent + 1);
        job.remainingMinutes = Math.max(0, job.remainingMinutes - 2);
        job.layer = Math.round((job.totalLayers * job.percent) / 100);
        if (job.percent >= 100) printer.state = 'FINISH';
        this.emit(entry, { gcode_state: printer.state, mc_percent: job.percent, mc_remaining_time: job.remainingMinutes, layer_num: job.layer });
      }
    }
  }

  /** A tray changed: send only that tray, the way a printer that reports partial updates does. */
  setTray(serial: string, feederId: number, tray: number, spool: SimSpool | null): boolean {
    const entry = this.entries.get(serial);
    const feeder = entry?.printer.feeders.find((candidate) => candidate.id === feederId);
    if (!entry || !feeder || tray < 0 || tray >= feeder.trays.length) return false;
    feeder.trays[tray] = spool;
    this.emit(entry, { ams: { ams: [{ id: String(feederId), tray: [simTray(tray, spool)] }] } });
    return true;
  }

  start(): void {
    const speed = Number(process.env.SIM_SPEED ?? '1') || 1;
    this.timer = setInterval(() => this.tick(), 5000 / speed);
    const input = readline.createInterface({ input: process.stdin });
    input.on('line', (line) => {
      const [command, serial, feeder, tray, type, color, seed] = line.trim().split(/\s+/);
      if (command === 'swap' && serial && type && /^[0-9a-f]{6}$/i.test(color ?? '')) {
        const spool: SimSpool = { type, color: color.toLowerCase(), ...(seed ? { sub: `${type} Basic`, uuid: seed.repeat(32).slice(0, 32), remain: 100, weight: 1000 } : {}) };
        log.info(this.setTray(serial, Number(feeder), Number(tray), spool) ? `Simulator: swapped ${serial} feeder ${feeder} tray ${tray}` : 'Simulator: no such tray');
      } else if (command === 'empty' && serial) {
        log.info(this.setTray(serial, Number(feeder), Number(tray), null) ? `Simulator: emptied ${serial} feeder ${feeder} tray ${tray}` : 'Simulator: no such tray');
      } else if (command) log.info('Simulator commands: swap <serial> <feeder> <tray> <type> <rrggbb> [tag seed] | empty <serial> <feeder> <tray>');
    });
    log.info(`Simulating ${this.entries.size} printers. Their access code is ${SIM_ACCESS_CODE}.`);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }
}
