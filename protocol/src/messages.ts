import { z } from 'zod';

/**
 * What a bridge and the server say to each other, over a socket.io namespace ("/bridge").
 *
 * Rules that keep old bridges working:
 * - within a protocol version, changes only add things; unknown keys are ignored, never rejected;
 * - a bridge says what it can do in `capabilities`, and the server asks only for those;
 * - the server refuses a bridge older than MIN_PROTOCOL with "upgrade_required".
 */
export const PROTOCOL_VERSION = 1;
export const MIN_PROTOCOL = 1;
export const BRIDGE_NAMESPACE = '/bridge';

const id = z.string().min(1).max(64);
const text = z.string().max(200);
/** A literal private address on the workshop's network. Hostnames are never accepted. */
export const host = z.string().regex(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/, 'Use an address like 192.168.1.50');
export const serial = z.string().regex(/^[A-Za-z0-9]{8,32}$/, 'A serial number is 8 to 32 letters and digits');
export const accessCode = z.string().regex(/^[A-Za-z0-9]{4,32}$/, 'An access code is 4 to 32 letters and digits');

/** link: how the bridge's connection to one printer stands. */
export const linkStatus = z.enum(['connecting', 'online', 'unreachable', 'auth_failed', 'identity_changed']).catch('unreachable');
export type LinkStatus = z.output<typeof linkStatus>;
/** codeState: whether the bridge holds a working access code for the printer. The code itself never travels upward. */
export const codeState = z.enum(['ok', 'missing', 'rejected']).catch('missing');
export type CodeState = z.output<typeof codeState>;

// ---- Bridge to server ------------------------------------------------------------

export const handshakeAuth = z.object({
  token: z.string().min(32).max(128),
  protocol: z.number().int().min(1),
  version: z.string().max(40),
  /** Made up once per install, so two copies of one bridge can be told apart. */
  instanceId: z.string().min(8).max(64),
  platform: z.string().max(80).optional(),
});
export type HandshakeAuth = z.output<typeof handshakeAuth>;

const printerLinkState = z.object({ printerId: id, link: linkStatus, codeState, detail: text.optional() });

export const bridgeHello = z.object({
  capabilities: z.array(z.string().max(40)).max(64),
  printers: z.array(printerLinkState).max(64),
});
export type BridgeHello = z.output<typeof bridgeHello>;

export const printerStatus = printerLinkState;
export type PrinterStatus = z.output<typeof printerStatus>;

/**
 * One step of a printer's status document. `full` carries all of it, `patch` a JSON merge patch on the last one.
 * seq starts at 0 for every connection and goes up by one; the first report after connecting is always full.
 */
export const printerReport = z.object({
  printerId: id,
  seq: z.number().int().min(0),
  kind: z.enum(['full', 'patch']),
  data: z.record(z.string(), z.unknown()),
});
export type PrinterReport = z.output<typeof printerReport>;
export type ReportAck = { ok: true } | { ok: false; resync: true };

// ---- Server to bridge ------------------------------------------------------------

export const telemetryConfig = z.object({
  /** Slowest gap between reports while someone is looking at the workspace, and while nobody is. */
  liveMs: z.number().int().min(500).max(60_000),
  idleMs: z.number().int().min(1000).max(300_000),
  /** Changes under these dot paths are sent at once. */
  urgentPaths: z.array(z.string().max(80)).max(64).default([]),
  /** Dot paths left out of the document. */
  ignorePaths: z.array(z.string().max(80)).max(64).default([]),
  /** The key that lists of objects are merged on, or null to always replace lists. */
  arrayKey: z.string().max(20).nullable().default('id'),
});
export type TelemetryConfig = z.output<typeof telemetryConfig>;

export const configPrinter = z.object({
  printerId: id,
  vendor: z.string().max(20),
  serial,
  host,
  /** Only present in the one push that follows a member typing it. */
  accessCode: accessCode.optional(),
});
export type ConfigPrinter = z.output<typeof configPrinter>;

/** The printers this bridge should be connected to. Anything it holds that is not listed is forgotten. */
export const bridgeConfig = z.object({
  printers: z.array(configPrinter).max(64),
  telemetry: telemetryConfig,
});
export type BridgeConfig = z.output<typeof bridgeConfig>;

export const bridgeRate = z.object({ mode: z.enum(['live', 'idle']) });
export const printerRefresh = z.object({ printerId: id });
export const printerTest = z.object({ vendor: z.string().max(20), serial, host, accessCode });
export type PrinterTest = z.output<typeof printerTest>;

export const ackError = z.object({ ok: z.literal(false), code: z.string().max(40), message: text.optional() });
export type AckError = z.output<typeof ackError>;
export const plainAck = z.union([z.object({ ok: z.literal(true) }), ackError]);
export type PlainAck = z.output<typeof plainAck>;

export const helloAck = z.union([z.object({ ok: z.literal(true), config: bridgeConfig }), ackError]);
export type HelloAck = z.output<typeof helloAck>;

export const printerTestAck = z.union([
  z.object({ ok: z.literal(true), modelName: z.string().max(60).optional(), firmware: z.string().max(40).optional() }),
  ackError,
]);
export type PrinterTestAck = z.output<typeof printerTestAck>;

export const discoveredPrinter = z.object({
  serial,
  host,
  modelCode: z.string().max(40).default(''),
  name: z.string().max(80).default(''),
});
export type DiscoveredPrinter = z.output<typeof discoveredPrinter>;
export const discoveryAck = z.union([z.object({ ok: z.literal(true), printers: z.array(discoveredPrinter).max(64) }), ackError]);
export type DiscoveryAck = z.output<typeof discoveryAck>;

/**
 * Ask the bridge for small text files from inside the sliced file of the print a printer is running now.
 * The server names entries only; where the file comes from is the bridge's business (the printer announced it),
 * so this can never be used to make a bridge fetch something of the server's choosing.
 */
export const jobRead = z.object({
  printerId: id,
  entries: z.array(z.string().regex(/^Metadata\/[A-Za-z0-9_.]{1,60}$/)).min(1).max(4),
});
export type JobRead = z.output<typeof jobRead>;
export const jobReadAck = z.union([
  z.object({ ok: z.literal(true), entries: z.record(z.string(), z.string().max(400_000)) }),
  ackError,
]);
export type JobReadAck = z.output<typeof jobReadAck>;

// ---- Pairing (plain HTTPS, before the bridge has a token) -----------------------------

export const pairRequest = z.object({
  code: z.string().min(8).max(16),
  version: z.string().max(40).default(''),
  platform: z.string().max(80).default(''),
});
export const pairResponse = z.object({ token: z.string(), bridgeId: id, workspaceName: z.string() });
export type PairResponse = z.output<typeof pairResponse>;

// ---- socket.io typings -----------------------------------------------------------

export interface BridgeToServerEvents {
  'bridge.hello': (payload: BridgeHello, ack: (reply: HelloAck) => void) => void;
  'printer.status': (payload: PrinterStatus) => void;
  'printer.report': (payload: PrinterReport, ack: (reply: ReportAck) => void) => void;
}

export interface ServerToBridgeEvents {
  'bridge.config': (payload: BridgeConfig, ack: (reply: PlainAck) => void) => void;
  'bridge.rate': (payload: z.output<typeof bridgeRate>) => void;
  'printer.refresh': (payload: z.output<typeof printerRefresh>, ack: (reply: PlainAck) => void) => void;
  'printer.test': (payload: PrinterTest, ack: (reply: PrinterTestAck) => void) => void;
  'discovery.list': (payload: Record<string, never>, ack: (reply: DiscoveryAck) => void) => void;
  /** Only sent to bridges that list the "job.files" capability. */
  'job.read': (payload: JobRead, ack: (reply: JobReadAck) => void) => void;
}
