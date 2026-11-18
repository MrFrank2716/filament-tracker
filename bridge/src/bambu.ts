import { randomBytes } from 'node:crypto';
import tls from 'node:tls';
import mqtt, { type MqttClient } from 'mqtt';
import type { CodeState, Doc, LinkStatus, PrinterTestAck } from '@filament-tracker/protocol';
import type { StoredPrinter } from './config';
import { readZipEntries, type JobFileEntries } from './jobFile';
import { log } from './log';

/**
 * Reading a Bambu Lab printer over the local network.
 *
 * The printer runs an MQTT broker on port 8883 (TLS, its own certificate). Signing in as "bblp" with the LAN
 * access code and listening on device/<serial>/report gives its status. This works with the printer in its
 * normal cloud mode; nothing here needs LAN-only or Developer Mode.
 *
 * READ-ONLY BY CONSTRUCTION: the only things this file ever publishes are the two requests below, which ask
 * the printer to send its full status and its version list. There is no code path for anything else.
 */

const PORT = 8883;
const PUSH_ALL = JSON.stringify({ pushing: { sequence_id: '0', command: 'pushall', version: 1, push_target: 1 } });
const GET_VERSION = JSON.stringify({ info: { sequence_id: '0', command: 'get_version' } });
/** Some models are slow to answer a full-status request; never ask more often than this. */

export interface SessionEvents {
  onDoc(delta: Doc): void;
  onStatus(link: LinkStatus, codeState: CodeState, detail?: string): void;
  /** The printer's certificate, the first time it is seen. */
  onFingerprint(fingerprint: string): void;
}

export interface PrinterSession {
  start(): void;
  stop(): void;
  /** Named entries (text, and plate pictures) from the sliced file of the print the printer last announced. */
  readJobFile(entries: string[]): Promise<JobFileEntries>;
}

/** The SHA-256 of the certificate presented at host:8883, without sending anything. */
export function certificateFingerprint(host: string, timeoutMs = 8000): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = tls.connect({ host, port: PORT, rejectUnauthorized: false, timeout: timeoutMs }, () => {
      const fingerprint = socket.getPeerCertificate().fingerprint256;
      socket.destroy();
      if (fingerprint) resolve(fingerprint);
      else reject(new Error('no certificate'));
    });
    socket.on('timeout', () => socket.destroy(new Error('timeout')));
    socket.on('error', reject);
  });
}

function connect(host: string, accessCode: string): MqttClient {
  return mqtt.connect(`mqtts://${host}:${PORT}`, {
    username: 'bblp',
    password: accessCode,
    clientId: `wrkbench-${randomBytes(6).toString('hex')}`,
    // The printer signs its own certificate; identity is checked by pinning its fingerprint instead.
    rejectUnauthorized: false,
    protocolVersion: 4,
    keepalive: 30,
    connectTimeout: 10_000,
    // Reconnecting is done here, so the certificate is checked before every attempt.
    reconnectPeriod: 0,
  });
}

/** MQTT's own refusal codes for a wrong user name or password. */
const refusedCredentials = (error: unknown): boolean => {
  const code = (error as { code?: unknown } | null)?.code;
  return code === 4 || code === 5 || /not authorized|bad user ?name or password/i.test(String((error as Error | null)?.message ?? ''));
};

/** The parts of a "print is starting" announcement worth keeping. The download link is left out on purpose. */
const JOB_KEYS = ['subtask_name', 'task_id', 'subtask_id', 'project_id', 'profile_id', 'param', 'file', 'use_ams', 'ams_mapping', 'ams_mapping2', 'plate_idx'];

/** Which printer messages belong in the status document. Everything else (replies to other clients' commands) is noise. */
function statusPart(message: unknown): Doc | null {
  if (typeof message !== 'object' || message === null) return null;
  const { print, info } = message as { print?: Doc; info?: Doc };
  if (print && typeof print === 'object' && print.command === 'push_status') return { print };
  // When a print is sent to it, the printer announces the job: its name, plate, and which tray each filament uses.
  // That last part is said once and never repeated on some firmware, so it is kept in the document under "job".
  if (print && typeof print === 'object' && print.command === 'project_file') {
    const job: Doc = { announcedAt: Date.now() };
    for (const key of JOB_KEYS) if (print[key] !== undefined) job[key] = print[key];
    return { job };
  }
  if (info && typeof info === 'object' && info.command === 'get_version') return { info };
  return null;
}

export class BambuSession implements PrinterSession {
  private client: MqttClient | null = null;
  private stopped = false;
  private retry: ReturnType<typeof setTimeout> | null = null;
  private attempts = 0;
  /** Where the printer said the current print's sliced file is. Stays on the bridge. */
  private jobUrl: string | null = null;

  constructor(
    private readonly printer: StoredPrinter,
    private readonly events: SessionEvents,
  ) {}

  start(): void {
    void this.attempt();
  }

  stop(): void {
    this.stopped = true;
    if (this.retry) clearTimeout(this.retry);
    this.client?.end(true);
    this.client = null;
  }

  async readJobFile(entries: string[]): Promise<JobFileEntries> {
    if (!this.jobUrl) throw new Error('no_file');
    return readZipEntries(this.jobUrl, entries);
  }

  private again(ms: number): void {
    if (this.stopped) return;
    if (this.retry) clearTimeout(this.retry);
    this.retry = setTimeout(() => void this.attempt(), ms);
  }

  private async attempt(): Promise<void> {
    if (this.stopped) return;
    const { host, serial, accessCode } = this.printer;
    if (!accessCode) return this.events.onStatus('unreachable', 'missing', 'No access code is stored for this printer');
    this.events.onStatus('connecting', 'ok');
    this.attempts += 1;
    const backOff = Math.min(60_000, 5000 * this.attempts);

    try {
      const fingerprint = await certificateFingerprint(host);
      if (!this.printer.fingerprint) this.events.onFingerprint(fingerprint);
      else if (this.printer.fingerprint !== fingerprint) {
        // Something else answers at this address now. Do not hand it the access code.
        log.warn(`${serial}: the device at ${host} is not the printer that was set up. Not connecting.`);
        this.events.onStatus('identity_changed', 'ok', 'A different device answers at this address');
        return this.again(5 * 60_000);
      }
    } catch {
      this.events.onStatus('unreachable', 'ok');
      return this.again(backOff);
    }
    if (this.stopped) return;

    const client = connect(host, accessCode);
    this.client = client;
    let refused = false;

    client.on('connect', () => {
      this.attempts = 0;
      client.subscribe(`device/${serial}/report`, { qos: 0 }, (error) => {
        if (error) return log.warn(`${serial}: could not listen for reports (${error.message})`);
        client.publish(`device/${serial}/request`, PUSH_ALL, { qos: 1 });
        client.publish(`device/${serial}/request`, GET_VERSION, { qos: 1 });
      });
      log.info(`${serial}: connected`);
      this.events.onStatus('online', 'ok');
    });
    client.on('message', (_topic, payload) => {
      try {
        const message: unknown = JSON.parse(payload.toString('utf8'));
        const part = statusPart(message);
        if (part?.job) {
          const url = (message as { print?: { url?: unknown } }).print?.url;
          this.jobUrl = typeof url === 'string' && url.startsWith('https://') ? url : null;
        }
        if (part) this.events.onDoc(part);
      } catch {
        /* not JSON: ignore */
      }
    });
    client.on('error', (error) => {
      if (refusedCredentials(error)) {
        refused = true;
        log.warn(`${serial}: the printer refused the access code`);
      }
    });
    client.on('close', () => {
      if (this.client !== client) return;
      this.client = null;
      client.end(true);
      if (this.stopped) return;
      if (refused) {
        this.events.onStatus('auth_failed', 'rejected', 'The printer refused the access code');
        return this.again(5 * 60_000);
      }
      this.events.onStatus('unreachable', 'ok');
      this.again(backOff);
    });
  }
}

/** Try a printer once with a code, keep nothing. Used before a printer is linked, so mistakes show up straight away. */
export function testBambu(host: string, serial: string, accessCode: string): Promise<PrinterTestAck> {
  return new Promise((resolve) => {
    const client = connect(host, accessCode);
    let settled = false;
    let reported = false;
    let modelName: string | undefined;
    let firmware: string | undefined;
    const finish = (reply: PrinterTestAck) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      client.end(true);
      resolve(reply);
    };
    const timer = setTimeout(
      () => finish(client.connected ? { ok: false, code: 'wrong_printer' } : { ok: false, code: 'unreachable' }),
      15_000,
    );
    client.on('connect', () => {
      client.subscribe(`device/${serial}/report`, { qos: 0 }, (error) => {
        if (error) return finish({ ok: false, code: 'wrong_printer' });
        client.publish(`device/${serial}/request`, GET_VERSION, { qos: 1 });
        client.publish(`device/${serial}/request`, PUSH_ALL, { qos: 1 });
      });
    });
    client.on('message', (_topic, payload) => {
      try {
        const part = statusPart(JSON.parse(payload.toString('utf8')));
        if (part?.print) reported = true;
        const modules = (part?.info as { module?: Array<Record<string, unknown>> } | undefined)?.module;
        const ota = Array.isArray(modules) ? modules.find((entry) => entry?.name === 'ota') : undefined;
        if (ota) {
          if (typeof ota.product_name === 'string') modelName = ota.product_name.replace(/^Bambu Lab\s+/i, '').slice(0, 60);
          if (typeof ota.sw_ver === 'string') firmware = ota.sw_ver.slice(0, 40);
        }
        // A status report proves the serial is right; give the version list a moment to arrive too.
        if (reported && (ota || firmware)) finish({ ok: true, modelName, firmware });
        else if (reported) setTimeout(() => finish({ ok: true, modelName, firmware }), 1500);
      } catch {
        /* ignore */
      }
    });
    client.on('error', (error) => finish({ ok: false, code: refusedCredentials(error) ? 'auth_failed' : 'unreachable' }));
  });
}
