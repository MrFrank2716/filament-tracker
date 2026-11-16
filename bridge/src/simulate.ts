import readline from 'node:readline';
import { crc32, deflateSync } from 'node:zlib';
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

const SIM_SLICE_INFO = `<?xml version="1.0" encoding="UTF-8"?>
<config><plate>
 <metadata key="index" value="1"/><metadata key="prediction" value="6120"/><metadata key="weight" value="38.40"/>
 <filament id="1" tray_info_idx="GFA00" type="PLA" color="#000000" used_m="9.80" used_g="29.20"/>
 <filament id="2" tray_info_idx="GFA00" type="PLA" color="#FFFFFF" used_m="3.10" used_g="9.20"/>
</plate></config>`;

/**
 * A stand-in for the slicer's picture of the plate: a plain block seen from a corner, on a clear background.
 * Drawn here rather than shipped as a file, so the bridge stays a single bundle.
 */
function simPlatePng(size = 192): Uint8Array {
  const rows = Buffer.alloc(size * (1 + size * 4));
  const centre = size / 2;
  const half = size * 0.3; // half the block's width on screen
  const rise = half / 2; // how far a corner sits above or below the middle of its face
  const paint = (x: number, y: number, [r, g, b]: [number, number, number]) => rows.set([r, g, b, 255], y * (1 + size * 4) + 1 + x * 4);
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const dx = x + 0.5 - centre;
      const dy = y + 0.5 - centre;
      const slope = (Math.abs(dx) / half) * rise;
      if (Math.abs(dx) > half) continue;
      // Top face: a diamond around a point one `rise` above the centre. Sides: the two faces hanging below it.
      if (Math.abs(dy + 2 * rise) <= rise - slope) paint(x, y, [120, 200, 235]);
      else if (dy >= -rise - slope && dy <= 3 * rise - slope) paint(x, y, dx < 0 ? [60, 140, 190] : [35, 100, 150]);
    }
  }
  const chunk = (type: string, data: Buffer) => {
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const out = Buffer.alloc(body.length + 8);
    out.writeUInt32BE(data.length, 0);
    body.copy(out, 4);
    out.writeUInt32BE(crc32(body), body.length + 4);
    return out;
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 6, 0, 0, 0], 8); // 8 bits a channel, RGBA
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', header), chunk('IDAT', deflateSync(rows)), chunk('IEND', Buffer.alloc(0))]);
}

/** What a printer says when a print is sent to it: the job's name, plate, and which tray each filament uses. */
const announce = (name: string): Doc => ({ job: { announcedAt: Date.now(), subtask_name: name, param: 'Metadata/plate_1.gcode', use_ams: true, ams_mapping: [0, 1] } });

interface SimEntry {
  /** Ticks spent finished, before the next pretend print starts. */
  rest?: number;
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
        if (entry.printer.state === 'RUNNING' && entry.printer.job) events.onDoc(announce(entry.printer.job.name));
        entry.listeners.add(listener);
      },
      stop: () => void entry.listeners.delete(listener),
      refresh: () => events.onDoc(simDocument(entry.printer)),
      // What the slicer would have written for the pretend print: two filaments, from the first two trays, and a picture.
      readJobFile: async () => ({ entries: { 'Metadata/slice_info.config': SIM_SLICE_INFO }, images: { 'Metadata/plate_1.png': simPlatePng() }, skipped: [], listing: [] }),
    };
  }

  private emit(entry: SimEntry, print: Doc): void {
    entry.listeners.forEach((listener) => listener({ print: { command: 'push_status', ...print } }));
  }

  /** Move the printing printers along, and start the finished one again after a pause. */
  private tick(): void {
    for (const entry of this.entries.values()) {
      const { printer } = entry;
      if (printer.state === 'FINISH' && printer.job && printer.feeders[0]?.trays[0]) {
        entry.rest = (entry.rest ?? 0) + 1;
        if (entry.rest >= 6) {
          // Start another print, the way a real one starts: an announcement, then status.
          entry.rest = 0;
          printer.state = 'RUNNING';
          printer.job = { ...printer.job, name: `${printer.job.name.replace(/_\d+$/, '')}_${Math.floor(Date.now() / 1000) % 1000}`, percent: 0, remainingMinutes: 100, layer: 0 };
          entry.listeners.forEach((listener) => listener(announce(printer.job!.name)));
          this.emit(entry, { gcode_state: 'RUNNING', subtask_name: printer.job.name, mc_percent: 0, mc_remaining_time: 100, layer_num: 0 });
        }
      } else if (printer.state === 'RUNNING' && printer.job) {
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
