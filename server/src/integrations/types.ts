import type { Doc, TelemetryConfig } from '@filament-tracker/protocol';

/**
 * What the app knows about a connected printer right now, whatever make it is.
 * The server works this out from the printer's own status document and sends it to browsers as it changes.
 * Mirrored by hand in client/src/lib/types.ts.
 */

/** live: reporting now. The others say why the figures may be old. */
export type PrinterConnection = 'live' | 'printer_unreachable' | 'bridge_offline' | 'needs_code' | 'never_seen';
export type PrinterPhase = 'idle' | 'preparing' | 'printing' | 'paused' | 'finished' | 'failed' | 'unknown';

/** Degrees C. */
export interface Temp {
  current: number | null;
  target: number | null;
}

export interface Tray {
  /** 1-based, to line up with Slot.position. */
  position: number;
  state: 'empty' | 'loaded';
  /** "PLA", "PETG-CF" */
  material: string | null;
  /** "PLA Basic" */
  subType: string | null;
  /** "#rrggbb" */
  colour: string | null;
  /** More than one for multi-colour spools, else empty. */
  colours: string[];
  brand: string | null;
  /** The spool's own tag id; null when it has no tag. */
  tagId: string | null;
  remainingPercent: number | null;
  spoolWeightGrams: number | null;
  /** Feeding the print right now. */
  active: boolean;
}

export interface Feeder {
  /** Stable per printer: "ams:0", "ams:128", "external:0". */
  key: string;
  kind: 'ams' | 'ams_lite' | 'ams_2_pro' | 'ams_ht' | 'external';
  /** "AMS 1", "AMS HT 1", "External spool". */
  label: string;
  /** "AMS 2 Pro" */
  kindLabel: string;
  humidityPercent: number | null;
  /** The printer's own 1 (wet) to 5 (dry) scale, when that is all it gives. */
  humidityLevel: number | null;
  temperature: number | null;
  drying: { remainingMinutes: number | null } | null;
  trays: Tray[];
}

export interface PrinterError {
  kind: 'hms' | 'print_error';
  /** As the printer's screen shows it: "0700_8011_0002_0002". */
  code: string;
  severity: 'info' | 'warning' | 'error' | 'fatal';
  /** What it means, in the maker's words; null when the code is not in our table. */
  message: string | null;
  /** Where the maker explains the code. */
  url: string | null;
}

/** The part worked out from the printer's document. */
export interface PrinterReading {
  phase: PrinterPhase;
  /** The printer's own word for its state, for display. */
  rawState: string;
  print: {
    name: string | null;
    progress: number | null;
    layer: number | null;
    totalLayers: number | null;
    remainingMinutes: number | null;
  } | null;
  bed: Temp | null;
  chamber: Temp | null;
  /** One per extruder: one entry on most printers, two on dual-nozzle ones. */
  extruders: Array<{ label: string; temp: Temp | null; nozzle: { diameter: number | null; type: string | null } }>;
  /** Filament feeders in the printer's own order, then outside spool holders. */
  feeders: Feeder[];
  errors: PrinterError[];
  wifiSignal: number | null;
  firmware: string | null;
  modelName: string | null;
}

export interface PrinterState extends PrinterReading {
  v: 1;
  machineId: string;
  printerLinkId: string;
  connection: PrinterConnection;
  /** ms since epoch when the reading was taken; null when the printer has never reported. */
  asOf: number | null;
  /** When the print should end, worked out when the reading was taken. */
  endsAt: number | null;
}

/** Everything the server needs to know about one make of printer. */
export interface PrinterAdapter {
  vendor: string;
  /** How the bridge should replicate this make's status document. */
  telemetry: TelemetryConfig;
  read(doc: Doc): PrinterReading;
  /** The id a feeder or holder keeps on a sub-unit ("bambu:<serial>:ams:0"). */
  externalId(serial: string, feederKey: string): string;
}

export const emptyReading = (): PrinterReading => ({
  phase: 'unknown', rawState: '', print: null, bed: null, chamber: null, extruders: [], feeders: [], errors: [],
  wifiSignal: null, firmware: null, modelName: null,
});
