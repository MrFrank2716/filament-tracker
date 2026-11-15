import type { Doc } from '@filament-tracker/protocol';
import { bambuModelName } from '@/integrations/bambu/models';
import { emptyReading, type Feeder, type PrinterAdapter, type PrinterError, type PrinterPhase, type PrinterReading, type Temp, type Tray } from '@/integrations/types';

/**
 * Reads a Bambu Lab printer's status document (its MQTT "push_status" report, plus its version list)
 * into the app's own terms. Everything here is defensive: printers differ by model and firmware, fields
 * come and go, and numbers often arrive as text.
 *
 * Written from the public protocol notes (OpenBambuAPI, ha-bambulab). Where a detail is not confirmed on
 * real hardware the code says so.
 */

const obj = (value: unknown): Doc | null => (typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Doc) : null);
const list = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const text = (value: unknown, max = 80): string | null => {
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  const cleaned = String(value).trim().slice(0, max);
  return cleaned ? cleaned : null;
};
const num = (value: unknown): number | null => {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value !== 'string' || !value.trim()) return null;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const int = (value: unknown): number | null => {
  const parsed = num(value);
  return parsed === null ? null : Math.trunc(parsed);
};

const PHASES: Record<string, PrinterPhase> = {
  IDLE: 'idle', PREPARE: 'preparing', SLICING: 'preparing', INIT: 'preparing',
  RUNNING: 'printing', PAUSE: 'paused', FINISH: 'finished', FAILED: 'failed',
};

/** "RRGGBBAA" or "RRGGBB" to "#rrggbb". */
export function bambuColour(value: unknown): string | null {
  const raw = text(value, 9);
  const match = raw ? /^#?([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(raw) : null;
  return match ? `#${match[1].toLowerCase()}` : null;
}

/** A tag id of all zeros (or nothing) means the spool has no tag. */
const tagId = (value: unknown): string | null => {
  const raw = text(value, 64);
  return raw && /[^0]/.test(raw) ? raw.toUpperCase() : null;
};

/** attr and code are 32-bit numbers; the printer's screen shows them as four groups of four hex digits. */
export function formatHmsCode(attr: number, code: number): string {
  const group = (value: number) => (value & 0xffff).toString(16).toUpperCase().padStart(4, '0');
  return `${group(attr >>> 16)}_${group(attr)}_${group(code >>> 16)}_${group(code)}`;
}

/** The severity sits in the high half of `code`: 1 fatal, 2 serious, 3 common, 4 information. */
function hmsSeverity(code: number): PrinterError['severity'] {
  switch (code >>> 16) {
    case 1: return 'fatal';
    case 2: return 'error';
    case 3: return 'warning';
    default: return 'info';
  }
}

const hmsUrl = (code: string) => `https://wiki.bambulab.com/en/x1/troubleshooting/hmscode/${code}`;

function readErrors(print: Doc): PrinterError[] {
  const errors: PrinterError[] = [];
  for (const entry of list(print.hms).slice(0, 20)) {
    const attr = int(obj(entry)?.attr);
    const code = int(obj(entry)?.code);
    if (attr === null || code === null) continue;
    const formatted = formatHmsCode(attr, code);
    errors.push({ kind: 'hms', code: formatted, severity: hmsSeverity(code), url: hmsUrl(formatted) });
  }
  const printError = int(print.print_error);
  if (printError) {
    const hex = (printError >>> 0).toString(16).toUpperCase().padStart(8, '0');
    errors.push({ kind: 'print_error', code: `${hex.slice(0, 4)}_${hex.slice(4)}`, severity: 'error', url: null });
  }
  return errors;
}

function readTray(raw: unknown, position: number, active: boolean): Tray {
  const tray = obj(raw) ?? {};
  const material = text(tray.tray_type, 30);
  const colours = list(tray.cols).map(bambuColour).filter((c): c is string => c !== null);
  const tag = tagId(tray.tray_uuid);
  const remaining = num(tray.remain);
  const weight = num(tray.tray_weight);
  if (!material) {
    return { position, state: 'empty', material: null, subType: null, colour: null, colours: [], brand: null, tagId: null, remainingPercent: null, spoolWeightGrams: null, active: false };
  }
  return {
    position,
    state: 'loaded',
    material,
    subType: text(tray.tray_sub_brands, 40),
    colour: bambuColour(tray.tray_color) ?? colours[0] ?? null,
    colours: colours.length > 1 ? colours.slice(0, 8) : [],
    // Only Bambu Lab's own spools carry a tag.
    brand: tag ? 'Bambu Lab' : null,
    tagId: tag,
    remainingPercent: remaining !== null && remaining >= 0 && remaining <= 100 ? remaining : null,
    spoolWeightGrams: weight !== null && weight > 0 ? weight : null,
    active,
  };
}

const KINDS: Record<string, { kind: Feeder['kind']; label: string }> = {
  ams: { kind: 'ams', label: 'AMS' },
  ams_f1: { kind: 'ams_lite', label: 'AMS Lite' },
  n3f: { kind: 'ams_2_pro', label: 'AMS 2 Pro' },
  n3s: { kind: 'ams_ht', label: 'AMS HT' },
};

/** The feeder kinds the printer lists among its modules, as "ams/0", "n3f/1", "n3s/128". */
function feederKinds(info: Doc | null): Map<number, { kind: Feeder['kind']; label: string }> {
  const kinds = new Map<number, { kind: Feeder['kind']; label: string }>();
  for (const entry of list(info?.module)) {
    const match = /^([a-z0-9_]+)\/(\d+)$/.exec(text(obj(entry)?.name, 40) ?? '');
    if (match && KINDS[match[1]]) kinds.set(Number(match[2]), KINDS[match[1]]);
  }
  return kinds;
}

function readFeeders(print: Doc, info: Doc | null, modelName: string | null): Feeder[] {
  const ams = obj(print.ams);
  const kinds = feederKinds(info);
  const trayNow = int(ams?.tray_now);
  const feeders: Feeder[] = [];
  const counters = new Map<string, number>();

  for (const raw of list(ams?.ams).slice(0, 16)) {
    const unit = obj(raw);
    const id = int(unit?.id);
    if (!unit || id === null) continue;
    // Ids from 128 are single-spool AMS HT units; an A1-series printer's feeder is an AMS Lite.
    const known = kinds.get(id) ?? (id >= 128 ? KINDS.n3s : modelName?.startsWith('A1') ? KINDS.ams_f1 : KINDS.ams);
    const order = (counters.get(known.kind) ?? 0) + 1;
    counters.set(known.kind, order);
    const dryMinutes = int(unit.dry_time);
    const level = int(unit.humidity);
    feeders.push({
      key: `ams:${id}`,
      kind: known.kind,
      label: `${known.label} ${order}`,
      kindLabel: known.label,
      humidityPercent: num(unit.humidity_raw),
      humidityLevel: level !== null && level >= 1 && level <= 5 ? level : null,
      temperature: num(unit.temp),
      drying: dryMinutes && dryMinutes > 0 ? { remainingMinutes: dryMinutes } : null,
      trays: list(unit.tray).slice(0, 8).map((tray, index) => {
        const slot = int(obj(tray)?.id) ?? index;
        // A regular feeder's trays are numbered across feeders (feeder x 4 + tray); an HT unit is its own number.
        const globalIndex = id >= 128 ? id : id * 4 + slot;
        return readTray(tray, slot + 1, trayNow !== null && trayNow === globalIndex);
      }),
    });
  }

  // Spool holders outside any feeder: one on most printers, one per nozzle on dual-nozzle ones.
  const holders = list(print.vir_slot).length ? list(print.vir_slot) : obj(print.vt_tray) ? [print.vt_tray] : [];
  holders.slice(0, 2).forEach((raw, index) => {
    const id = int(obj(raw)?.id);
    const tray = readTray(raw, 1, trayNow !== null && id !== null && trayNow === id);
    feeders.push({
      key: `external:${index}`,
      kind: 'external',
      label: holders.length > 1 ? `External spool ${index + 1}` : 'External spool',
      kindLabel: 'Spool holder',
      humidityPercent: null, humidityLevel: null, temperature: null, drying: null,
      trays: [tray],
    });
  });
  return feeders;
}

const NOZZLE_TYPES: Record<string, string> = {
  hardened_steel: 'Hardened steel',
  stainless_steel: 'Stainless steel',
  tungsten_carbide: 'Tungsten carbide',
};
const nozzleType = (value: unknown): string | null => {
  const raw = text(value, 40);
  return raw ? (NOZZLE_TYPES[raw] ?? raw.replace(/_/g, ' ')) : null;
};

function readExtruders(print: Doc): PrinterReading['extruders'] {
  const device = obj(print.device);
  const extruderInfo = list(obj(device?.extruder)?.info);
  if (extruderInfo.length >= 2) {
    // Dual-nozzle printers pack current and target temperature into one number: low half current, high half target.
    const nozzles = list(obj(device?.nozzle)?.info).map(obj);
    const labels = ['Right nozzle', 'Left nozzle'];
    return extruderInfo.slice(0, 4).map((raw, index) => {
      const entry = obj(raw) ?? {};
      const id = int(entry.id) ?? index;
      const packed = int(entry.temp);
      const nozzle = nozzles.find((candidate) => int(candidate?.id) === id) ?? nozzles[index] ?? null;
      const temp: Temp | null = packed === null ? null : { current: packed & 0xffff, target: (packed >>> 16) & 0xffff };
      return { label: labels[id] ?? `Nozzle ${id + 1}`, temp, nozzle: { diameter: num(nozzle?.diameter), type: nozzleType(nozzle?.type) } };
    });
  }
  const current = num(print.nozzle_temper);
  const diameter = num(print.nozzle_diameter);
  const type = nozzleType(print.nozzle_type);
  if (current === null && diameter === null && type === null) return [];
  return [{ label: 'Nozzle', temp: current === null ? null : { current, target: num(print.nozzle_target_temper) }, nozzle: { diameter, type } }];
}

export function readBambu(doc: Doc): PrinterReading {
  const print = obj(doc.print);
  if (!print) return emptyReading();
  const info = obj(doc.info);
  const ota = list(info?.module).map(obj).find((entry) => text(entry?.name) === 'ota') ?? null;
  const modelName = text(ota?.product_name, 40)?.replace(/^Bambu Lab\s+/i, '') ?? (bambuModelName(text(ota?.project_name, 40), text(ota?.sn, 40) ?? undefined) || null);

  const rawState = text(print.gcode_state, 20) ?? '';
  const phase = PHASES[rawState.toUpperCase()] ?? 'unknown';
  const busy = phase === 'preparing' || phase === 'printing' || phase === 'paused';
  const name = text(print.subtask_name, 160) ?? text(print.gcode_file, 160);
  const totalLayers = int(print.total_layer_num);
  const bed = num(print.bed_temper);
  // Only the enclosed, sensor-fitted models measure the chamber; the P1 and A1 series report a fixed 5 instead.
  const hasChamberSensor = !/^(P1|A1)/i.test(modelName ?? '');
  const chamber = hasChamberSensor ? num(print.chamber_temper) : null;
  const wifi = /-?\d+/.exec(text(print.wifi_signal, 20) ?? '');

  const feeders = readFeeders(print, info, modelName);
  // "Feeding now" only means something during a print; between prints the printer's tray number is left over.
  if (!busy) for (const feeder of feeders) for (const tray of feeder.trays) tray.active = false;

  return {
    phase,
    rawState,
    // Once a print is over the printer keeps its name and 100 %; that is still worth showing until the next one.
    print: name && (busy || phase === 'finished' || phase === 'failed')
      ? {
          name,
          progress: int(print.mc_percent),
          layer: int(print.layer_num),
          totalLayers: totalLayers && totalLayers > 0 ? totalLayers : null,
          remainingMinutes: busy ? int(print.mc_remaining_time) : null,
        }
      : null,
    bed: bed === null ? null : { current: bed, target: num(print.bed_target_temper) },
    chamber: chamber === null ? null : { current: chamber, target: null },
    extruders: readExtruders(print),
    feeders,
    errors: readErrors(print),
    wifiSignal: wifi ? Number(wifi[0]) : null,
    firmware: text(ota?.sw_ver, 40),
    modelName,
  };
}

export const bambuAdapter: PrinterAdapter = {
  vendor: 'bambu',
  telemetry: {
    liveMs: 2000,
    idleMs: 15_000,
    // What is loaded, what state it is in and what is wrong should never wait.
    urgentPaths: ['print.gcode_state', 'print.ams', 'print.vt_tray', 'print.vir_slot', 'print.hms', 'print.print_error', 'info'],
    ignorePaths: ['print.sequence_id', 'print.msg', 'info.sequence_id'],
    arrayKey: 'id',
  },
  read: readBambu,
  externalId: (serial, feederKey) => `bambu:${serial}:${feederKey}`,
};
