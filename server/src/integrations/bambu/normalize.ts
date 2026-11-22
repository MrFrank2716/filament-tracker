import type { Doc } from '@filament-tracker/protocol';
import { readHms, readPrintError } from '@/integrations/bambu/hms';
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
/** A number that means something only when above zero (the printer sends -1 for "not set"). */
const positive = (value: unknown): number | null => {
  const parsed = num(value);
  return parsed !== null && parsed > 0 ? parsed : null;
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

function readErrors(print: Doc, modelName: string | null): PrinterError[] {
  const errors: PrinterError[] = [];
  for (const entry of list(print.hms).slice(0, 20)) {
    const attr = int(obj(entry)?.attr);
    const code = int(obj(entry)?.code);
    if (!attr || !code) continue;
    errors.push(readHms(attr, code, modelName));
  }
  const printError = readPrintError(int(print.print_error) ?? 0, modelName);
  if (printError) errors.push(printError);
  return errors;
}

function readTray(raw: unknown, position: number, active: boolean): Tray {
  const tray = obj(raw) ?? {};
  const material = text(tray.tray_type, 30);
  const colours = list(tray.cols).map(bambuColour).filter((c): c is string => c !== null);
  const tag = tagId(tray.tray_uuid);
  const remaining = num(tray.remain);
  const weight = num(tray.tray_weight);
  const low = num(tray.nozzle_temp_min);
  const high = num(tray.nozzle_temp_max);
  const diameter = num(tray.tray_diameter);
  if (!material) {
    return { position, state: 'empty', material: null, subType: null, colour: null, colours: [], brand: null, tagId: null, remainingPercent: null, spoolWeightGrams: null, nozzleTemp: null, diameter: null, active: false };
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
    // Only a tagged spool has a real figure; without a tag the printer sends -1 or a meaningless 0.
    remainingPercent: tag && remaining !== null && remaining >= 0 && remaining <= 100 ? remaining : null,
    spoolWeightGrams: weight !== null && weight > 0 ? weight : null,
    nozzleTemp: low !== null && high !== null && low > 0 && high >= low ? [low, high] : null,
    diameter: diameter !== null && diameter > 0 ? diameter : null,
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
  // Dual-nozzle printers say what each nozzle is fed from instead: feeder in the high byte, tray in the low one.
  const feeding = new Set<string>();
  for (const raw of list(obj(obj(print.device)?.extruder)?.info)) {
    const snow = int(obj(raw)?.snow);
    if (snow === null || (snow & 0xff) === 0xff) continue;
    feeding.add(`${snow >> 8}:${snow & 0xff}`);
  }
  const fedFrom = (feederId: number, tray: number, globalIndex: number) => feeding.has(`${feederId}:${tray}`) || (feeding.size === 0 && trayNow !== null && trayNow === globalIndex);
  const feeders: Feeder[] = [];

  for (const raw of list(ams?.ams).slice(0, 16)) {
    const unit = obj(raw);
    const id = int(unit?.id);
    if (!unit || id === null) continue;
    // Ids from 128 are single-spool AMS HT units; an A1-series printer's feeder is an AMS Lite.
    const known = kinds.get(id) ?? (id >= 128 ? KINDS.n3s : modelName?.startsWith('A1') ? KINDS.ams_f1 : KINDS.ams);
    // The printer's own numbering, so the name here matches its screen: regular feeders count from their id
    // (a real H2D calls ids 1 and 2 "AMS 2 Pro (2)" and "(3)"), single-spool HT units from 128.
    const order = id >= 128 ? id - 127 : id + 1;
    const dryMinutes = int(unit.dry_time);
    const drySetting = obj(unit.dry_setting);
    const level = int(unit.humidity);
    feeders.push({
      key: `ams:${id}`,
      kind: known.kind,
      label: `${known.label} ${order}`,
      kindLabel: known.label,
      humidityPercent: num(unit.humidity_raw),
      humidityLevel: level !== null && level >= 1 && level <= 5 ? level : null,
      temperature: num(unit.temp),
      // Minutes left, counting down (seen on a real AMS HT: 716 with twelve hours set). The settings say what for.
      drying: dryMinutes && dryMinutes > 0 ? { remainingMinutes: dryMinutes, targetTemp: positive(drySetting?.dry_temperature), filament: text(drySetting?.dry_filament, 30) } : null,
      trays: list(unit.tray).slice(0, 8).map((tray, index) => {
        const slot = int(obj(tray)?.id) ?? index;
        // A regular feeder's trays are numbered across feeders (feeder x 4 + tray); an HT unit is its own number.
        const globalIndex = id >= 128 ? id : id * 4 + slot;
        return readTray(tray, slot + 1, fedFrom(id, slot, globalIndex));
      }),
    });
  }

  // Spool holders outside any feeder: one on most printers, one per nozzle on dual-nozzle ones.
  const holders = list(print.vir_slot).length ? list(print.vir_slot) : obj(print.vt_tray) ? [print.vt_tray] : [];
  holders.slice(0, 2).forEach((raw, index) => {
    const id = int(obj(raw)?.id);
    const tray = readTray(raw, 1, id !== null && fedFrom(id, 0, id));
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
/**
 * Newer printers give a short code instead of a name: a letter for the material (H hardened steel, S stainless
 * steel), a letter for the flow (S standard, H high flow) and a size. Seen on a real X2D as "HS01" and "HH01".
 */
function nozzleType(value: unknown): string | null {
  const raw = text(value, 40);
  if (!raw) return null;
  if (NOZZLE_TYPES[raw]) return NOZZLE_TYPES[raw];
  const code = /^([HS])([SH])\d{2}$/.exec(raw);
  if (code) return `${code[1] === 'H' ? 'Hardened steel' : 'Stainless steel'}${code[2] === 'H' ? ', high flow' : ''}`;
  return raw.replace(/_/g, ' ');
}

/**
 * Which nozzle of a dual-nozzle printer is printing, by its id.
 *
 * `device.extruder.state` is packed: bits 0-3 the number of nozzles, bits 4-7 the nozzle in use, bits 8-11 the one
 * it is switching to; 0xF in bits 4-7 means it is between nozzles. That layout is Bambu Studio's own reading
 * (ExtderSystemParser::ParseV2_0 in src/slic3r/GUI/DeviceCore/DevExtruderSystem.cpp), and our recordings agree
 * (X2D 274 = 0x112: two nozzles, 1 in use; H2D 32770 = 0x8002: two, 0 in use). That the number is the same `id` as
 * in `extruder.info` (0 right, 1 left) is not stated there, only consistent with it, and the recordings' nozzles
 * were cold. So the temperatures decide when they disagree: a nozzle with no target set is not printing while the
 * other one heats. Without a usable state, the nozzle heating to the highest target is taken, else none.
 */
function activeNozzle(state: number | null, nozzles: Array<{ id: number; temp: Temp | null }>): number | null {
  const target = (id: number) => nozzles.find((n) => n.id === id)?.temp?.target ?? 0;
  const heating = nozzles.filter((n) => (n.temp?.target ?? 0) > 0).sort((a, b) => target(b.id) - target(a.id));
  const reported = state === null ? null : (state >> 4) & 0xf;
  if (reported !== null && nozzles.some((n) => n.id === reported)) {
    if (target(reported) === 0 && heating.length === 1) return heating[0].id;
    return reported;
  }
  return heating[0]?.id ?? null;
}

function readExtruders(print: Doc): PrinterReading['extruders'] {
  const device = obj(print.device);
  const extruder = obj(device?.extruder);
  const extruderInfo = list(extruder?.info);
  if (extruderInfo.length >= 2) {
    // Dual-nozzle printers pack current and target temperature into one number: low half current, high half target.
    const nozzles = list(obj(device?.nozzle)?.info).map(obj);
    const labels = ['Right nozzle', 'Left nozzle'];
    const read = extruderInfo.slice(0, 4).map((raw, index) => {
      const entry = obj(raw) ?? {};
      const id = int(entry.id) ?? index;
      const packed = int(entry.temp);
      const nozzle = nozzles.find((candidate) => int(candidate?.id) === id) ?? nozzles[index] ?? null;
      const temp: Temp | null = packed === null ? null : { current: packed & 0xffff, target: (packed >>> 16) & 0xffff };
      return { id, label: labels[id] ?? `Nozzle ${id + 1}`, temp, nozzle: { diameter: num(nozzle?.diameter), type: nozzleType(nozzle?.type) } };
    });
    const active = activeNozzle(int(extruder?.state), read);
    return read.map(({ id, ...rest }) => ({ ...rest, active: id === active }));
  }
  const current = num(print.nozzle_temper);
  const diameter = num(print.nozzle_diameter);
  const type = nozzleType(print.nozzle_type);
  if (current === null && diameter === null && type === null) return [];
  return [{ label: 'Nozzle', temp: current === null ? null : { current, target: num(print.nozzle_target_temper) }, nozzle: { diameter, type }, active: true }];
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
  // Newer printers report it under device.ctc, packed like the nozzle temperatures (current in the low half).
  const ctc = int(obj(obj(obj(print.device)?.ctc)?.info)?.temp);
  const chamber = hasChamberSensor ? (num(print.chamber_temper) ?? (ctc === null ? null : ctc & 0xffff)) : null;
  const wifi = /-?\d+/.exec(text(print.wifi_signal, 20) ?? '');

  const feeders = readFeeders(print, info, modelName);
  // "Feeding now" only means something during a print; between prints the printer's tray number is left over.
  if (!busy) for (const feeder of feeders) for (const tray of feeder.trays) tray.active = false;

  // The printer runs routines of its own (fitting the laser, calibrating) and reports them like jobs, with
  // print_type "system". They are not work anyone asked for, so they are not shown or followed as prints.
  const housekeeping = text(print.print_type, 20) === 'system';
  // Laser, cutting and drawing jobs run from the sliced file's 2D section (seen on a real H2D with a 40 W laser).
  const flat = /\/Metadata2D\//.test(text(print.gcode_file, 200) ?? '');
  // A tool fitted in place of printing: the printer says one is mounted, and lists it among its modules by name.
  const mounted = int(obj(obj(print.device)?.ext_tool)?.mount) === 1;
  const laserModule = list(info?.module).map(obj).find((entry) => text(entry?.name) === 'lc');
  const tool = mounted ? (text(laserModule?.product_name, 40) ?? 'Laser or cutting tool') : null;

  return {
    phase,
    rawState,
    tool,
    // Once a print is over the printer keeps its name and 100 %; that is still worth showing until the next one.
    print: name && !housekeeping && (busy || phase === 'finished' || phase === 'failed')
      ? {
          name,
          kind: flat ? 'laser' : 'print',
          progress: int(print.mc_percent),
          layer: int(print.layer_num),
          totalLayers: totalLayers && totalLayers > 0 ? totalLayers : null,
          // While it is still preparing the printer says 0, which means "not worked out yet", not "done".
          remainingMinutes: busy && !(phase === 'preparing' && !int(print.mc_remaining_time)) ? int(print.mc_remaining_time) : null,
        }
      : null,
    bed: bed === null ? null : { current: bed, target: num(print.bed_target_temper) },
    chamber: chamber === null ? null : { current: chamber, target: null },
    extruders: readExtruders(print),
    feeders,
    errors: readErrors(print, modelName),
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
    urgentPaths: ['job', 'print.gcode_state', 'print.ams', 'print.vt_tray', 'print.vir_slot', 'print.hms', 'print.print_error', 'info'],
    ignorePaths: ['print.sequence_id', 'print.msg', 'info.sequence_id'],
    arrayKey: 'id',
  },
  read: readBambu,
  externalId: (serial, feederKey) => `bambu:${serial}:${feederKey}`,
};
