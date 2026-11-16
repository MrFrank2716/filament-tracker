import { randomBytes } from 'node:crypto';
import os from 'node:os';
import { io, type Socket } from 'socket.io-client';
import {
  BRIDGE_NAMESPACE, PROTOCOL_VERSION, bridgeConfig, bridgeRate, jobRead, pairResponse, printerRefresh, printerTest,
  type BridgeConfig, type BridgeToServerEvents, type CodeState, type HandshakeAuth, type LinkStatus, type ServerToBridgeEvents, type TelemetryConfig,
} from '@filament-tracker/protocol';
import { BambuSession, testBambu, type PrinterSession, type SessionEvents } from './bambu';
import { VERSION, type ConfigStore, type StoredPrinter } from './config';
import { Discovery } from './discovery';
import { log } from './log';
import { Replicator } from './replicator';
import { MAX_PRINTERS, privateHost } from './safety';
import type { Simulator } from './simulate';

/**
 * The bridge itself: one outbound connection to the Wrkbench server, and one session per printer.
 * The server says which printers to hold (and passes on an access code the first time); the bridge connects to
 * them, keeps their status documents and replicates those upward.
 */

const DEFAULT_TELEMETRY: TelemetryConfig = { liveMs: 2000, idleMs: 15_000, urgentPaths: [], ignorePaths: [], arrayKey: 'id' };
const CAPABILITIES = ['bambu.monitor', 'discovery', 'job.files', 'job.images'];

interface Held {
  printer: StoredPrinter;
  session: PrinterSession;
  replicator: Replicator;
  link: LinkStatus;
  codeState: CodeState;
}

const platform = () => `${os.platform()} ${os.arch()} node ${process.versions.node}`.slice(0, 80);

/** Swap a one-time set-up code for this bridge's long-lived token. */
export async function pair(store: ConfigStore, server: string, code: string): Promise<string> {
  const response = await fetch(`${server}/api/bridge/pair`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ code, version: VERSION, platform: platform() }),
  });
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) throw new Error((body as { error?: string } | null)?.error ?? `The server answered ${response.status}`);
  const paired = pairResponse.parse(body);
  // A different bridge record means a different workspace: codes kept for the old one do not belong here.
  if (store.data.bridgeId && store.data.bridgeId !== paired.bridgeId) store.data.printers = {};
  store.data.server = server;
  store.data.bridgeId = paired.bridgeId;
  store.data.token = paired.token;
  store.save();
  return paired.workspaceName;
}

export class Bridge {
  private socket: Socket<ServerToBridgeEvents, BridgeToServerEvents> | null = null;
  private readonly held = new Map<string, Held>();
  private telemetry = DEFAULT_TELEMETRY;
  private mode: 'live' | 'idle' = 'live';
  /** True once the server has answered hello on the current connection. */
  private ready = false;
  private readonly discovery = new Discovery();
  private readonly instanceId = randomBytes(12).toString('hex');
  private reconnect: ReturnType<typeof setTimeout> | null = null;

  constructor(
    private readonly store: ConfigStore,
    private readonly simulator: Simulator | null,
    /** A set-up code given on the command line, kept in case the stored token turns out to be dead. */
    private pairingCode: string | null,
  ) {}

  start(): void {
    if (this.simulator) this.simulator.start();
    else this.discovery.start();
    // Printers we already know about start straight away; the server's list replaces this when it arrives.
    for (const [printerId, printer] of Object.entries(this.store.data.printers)) this.hold(printerId, printer);
    this.connect();
  }

  stop(): void {
    this.socket?.disconnect();
    for (const held of this.held.values()) {
      held.session.stop();
      held.replicator.stop();
    }
    this.discovery.stop();
    this.simulator?.stop();
  }

  // ---- The server ------------------------------------------------------------------

  private connect(): void {
    const { server, token } = this.store.data;
    const auth: HandshakeAuth = { token: token!, protocol: PROTOCOL_VERSION, version: VERSION, instanceId: this.instanceId, platform: platform() };
    const socket: Socket<ServerToBridgeEvents, BridgeToServerEvents> = io(`${server}${BRIDGE_NAMESPACE}`, {
      auth,
      transports: ['websocket', 'polling'],
      reconnectionDelay: 1000,
      reconnectionDelayMax: 30_000,
      randomizationFactor: 0.5,
    });
    this.socket = socket;

    const retryIn = (ms: number) => {
      if (this.reconnect) clearTimeout(this.reconnect);
      this.reconnect = setTimeout(() => socket.connect(), ms);
    };

    socket.on('connect', () => {
      log.info(`Connected to ${server}`);
      socket.emit('bridge.hello', { capabilities: CAPABILITIES, printers: this.linkStates() }, (reply) => {
        if (!reply.ok) return log.warn(`The server refused this bridge: ${reply.code}`);
        const config = bridgeConfig.safeParse(reply.config);
        if (config.success) this.apply(config.data);
        this.ready = true;
        for (const held of this.held.values()) held.replicator.restart();
      });
    });

    socket.on('disconnect', (reason) => {
      this.ready = false;
      log.warn(`Lost the connection to the server (${reason})`);
      // The client only reconnects by itself when the network dropped, not when the server closed the connection.
      if (reason === 'io server disconnect') retryIn(3000 + Math.random() * 4000);
    });

    socket.on('connect_error', (error) => {
      this.ready = false;
      const code = (error as { data?: { code?: string } }).data?.code;
      if (!code) return; // network trouble: the client keeps trying by itself
      switch (code) {
        case 'unauthorized':
          if (this.pairingCode) return void this.repair(socket);
          log.error('This bridge is no longer known to the server. Make a new set-up code in Wrkbench (Settings, Printers) and run the bridge again with --pair <code>.');
          return retryIn(5 * 60_000);
        case 'duplicate':
          log.warn('Another copy of this bridge is connected. Only one can run at a time; trying again shortly.');
          return retryIn(30_000);
        case 'upgrade_required':
          log.error('This bridge is too old for the server. Update it.');
          return retryIn(30 * 60_000);
        default:
          return retryIn(15_000);
      }
    });

    socket.on('bridge.config', (raw, ack) => {
      const config = bridgeConfig.safeParse(raw);
      if (!config.success) return ack?.({ ok: false, code: 'invalid' });
      this.apply(config.data);
      ack?.({ ok: true });
    });

    socket.on('bridge.rate', (raw) => {
      const rate = bridgeRate.safeParse(raw);
      if (!rate.success) return;
      this.mode = rate.data.mode;
      if (this.mode === 'live') for (const held of this.held.values()) held.replicator.kick();
    });

    socket.on('printer.refresh', (raw, ack) => {
      const request = printerRefresh.safeParse(raw);
      if (request.success) this.held.get(request.data.printerId)?.session.refresh();
      ack?.({ ok: true });
    });

    socket.on('printer.test', (raw, ack) => {
      const request = printerTest.safeParse(raw);
      if (!request.success) return ack?.({ ok: false, code: 'invalid' });
      const { serial, host, accessCode } = request.data;
      if (!privateHost(host)) return ack?.({ ok: false, code: 'not_allowed' });
      if (this.simulator) return ack?.(this.simulator.test(serial, accessCode));
      testBambu(host, serial, accessCode).then(
        (reply) => ack?.(reply),
        () => ack?.({ ok: false, code: 'unreachable' }),
      );
    });

    socket.on('job.read', (raw, ack) => {
      const request = jobRead.safeParse(raw);
      if (!request.success) return ack?.({ ok: false, code: 'invalid' });
      const held = this.held.get(request.data.printerId);
      if (!held) return ack?.({ ok: false, code: 'unknown_printer' });
      // Said out loud, because a print with no materials or no picture is otherwise a mystery from this side.
      const serial = held.printer.serial;
      held.session.readJobFile(request.data.entries).then(
        ({ entries, images, skipped }) => {
          const got = [...Object.keys(entries), ...Object.entries(images).map(([name, bytes]) => `${name} (${bytes.byteLength} bytes)`)];
          log.info(`Read the sliced file for ${serial}: ${got.join(', ') || 'nothing that was asked for'}${skipped?.length ? `. Left out: ${skipped.join('; ')}` : ''}`);
          ack?.({ ok: true, entries, images });
        },
        (cause: unknown) => {
          const reason = String((cause as Error).message).slice(0, 100);
          log.warn(`Could not read the sliced file for ${serial}: ${reason === 'no_file' ? 'the printer has not announced one since the bridge started (the print began earlier, or was not sent through Bambu\'s cloud)' : reason}`);
          ack?.({ ok: false, code: 'no_file', message: reason });
        },
      );
    });

    socket.on('discovery.list', (_raw, ack) => {
      ack?.({ ok: true, printers: this.simulator ? this.simulator.discovered() : this.discovery.list() });
    });
  }

  /** The stored token was refused and a set-up code is at hand: use it, once. */
  private async repair(socket: Socket<ServerToBridgeEvents, BridgeToServerEvents>): Promise<void> {
    const code = this.pairingCode!;
    this.pairingCode = null;
    try {
      const workspace = await pair(this.store, this.store.data.server, code);
      log.info(`Paired again with "${workspace}"`);
      socket.auth = { ...(socket.auth as HandshakeAuth), token: this.store.data.token! };
      socket.connect();
    } catch (cause) {
      log.error(`Could not pair: ${(cause as Error).message}`);
    }
  }

  // ---- Printers --------------------------------------------------------------------

  private linkStates() {
    return [...this.held.entries()].map(([printerId, held]) => ({ printerId, link: held.link, codeState: held.codeState }));
  }

  /** Make our printers match the server's list: start the new, restart the changed, forget the removed. */
  private apply(config: BridgeConfig): void {
    this.telemetry = config.telemetry;
    const wanted = new Map(config.printers.slice(0, MAX_PRINTERS).map((printer) => [printer.printerId, printer]));
    for (const printerId of [...this.held.keys()]) {
      if (!wanted.has(printerId)) this.drop(printerId, true);
    }
    for (const [printerId, incoming] of wanted) {
      const current = this.store.data.printers[printerId];
      const next: StoredPrinter = {
        vendor: incoming.vendor,
        serial: incoming.serial,
        host: incoming.host,
        accessCode: incoming.accessCode ?? current?.accessCode,
        // A new address or a new code is a fresh start; the certificate is pinned again on first contact.
        fingerprint: current && current.host === incoming.host && !incoming.accessCode ? current.fingerprint : undefined,
      };
      const unchanged = current && this.held.has(printerId) && current.host === next.host && current.serial === next.serial && current.accessCode === next.accessCode;
      if (unchanged) continue;
      this.drop(printerId, false);
      this.store.data.printers[printerId] = next;
      this.hold(printerId, next);
    }
    // Anything stored for a printer the server no longer lists goes, access code included.
    for (const printerId of Object.keys(this.store.data.printers)) if (!wanted.has(printerId)) delete this.store.data.printers[printerId];
    this.store.save();
  }

  private drop(printerId: string, forget: boolean): void {
    const held = this.held.get(printerId);
    if (held) {
      held.session.stop();
      held.replicator.stop();
      this.held.delete(printerId);
    }
    if (forget) delete this.store.data.printers[printerId];
  }

  private hold(printerId: string, printer: StoredPrinter): void {
    const replicator = new Replicator(printerId, {
      ready: () => this.ready && Boolean(this.socket?.connected),
      telemetry: () => this.telemetry,
      gapMs: () => (this.mode === 'live' ? this.telemetry.liveMs : this.telemetry.idleMs),
      send: (report) =>
        new Promise((resolve) => {
          if (!this.socket?.connected) return resolve(null);
          this.socket.timeout(8000).emit('printer.report', report, (error, reply) => resolve(error ? null : reply));
        }),
    });
    const events: SessionEvents = {
      onDoc: (delta) => replicator.merge(delta),
      onStatus: (link, codeState, detail) => {
        const held = this.held.get(printerId);
        if (!held || (held.link === link && held.codeState === codeState)) return;
        held.link = link;
        held.codeState = codeState;
        if (this.ready) this.socket?.emit('printer.status', { printerId, link, codeState, ...(detail ? { detail } : {}) });
      },
      onFingerprint: (fingerprint) => {
        printer.fingerprint = fingerprint;
        this.store.save();
      },
    };
    const allowed = privateHost(printer.host);
    const session: PrinterSession = !allowed
      ? { start: () => events.onStatus('unreachable', 'ok', 'Not an address on a private network'), stop: () => undefined, refresh: () => undefined, readJobFile: () => Promise.reject(new Error('no_file')) }
      : this.simulator?.has(printer.serial)
        ? this.simulator.session(printer.serial, printer.accessCode, events)
        : new BambuSession(printer, events);
    this.held.set(printerId, { printer, session, replicator, link: 'connecting', codeState: printer.accessCode ? 'ok' : 'missing' });
    session.start();
  }
}
