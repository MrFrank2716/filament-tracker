/**
 * Made-up printer status documents in the shape Bambu Lab printers report over MQTT.
 *
 * SYNTHETIC: written from the public protocol notes, not recorded from hardware. They drive the bridge's
 * simulator and the server's tests. They test our reading of the protocol, not the protocol itself; replace
 * them with tapes from `wrkbench-bridge record` as real printers are connected.
 */
import type { Doc } from './mergePatch';

export interface SimSpool {
  /** "PLA", "PETG" ... */
  type: string;
  /** "PLA Basic", "PETG HF" ... Empty for spools without a tag. */
  sub?: string;
  /** "rrggbb" */
  color: string;
  /** 32 hex characters for a tagged Bambu spool; left out for anything else. */
  uuid?: string;
  /** Percent left, tagged spools only. */
  remain?: number;
  /** Grams when full. */
  weight?: number;
}

export interface SimFeeder {
  id: number;
  /** Module name prefix the printer reports: "ams" (AMS), "ams_f1" (AMS Lite), "n3f" (AMS 2 Pro), "n3s" (AMS HT). */
  module: 'ams' | 'ams_f1' | 'n3f' | 'n3s';
  humidityLevel: number;
  humidityPercent?: number;
  temp: number;
  /** Minutes of drying left, for feeders that can dry. */
  dryMinutes?: number;
  trays: Array<SimSpool | null>;
}

export interface SimPrinter {
  serial: string;
  /** The printer's own model code ("BL-P001", "C12", "N2S", "O1D"). */
  modelCode: string;
  productName: string;
  name: string;
  firmware: string;
  nozzles: Array<{ diameter: number; type: string }>;
  feeders: SimFeeder[];
  external: Array<SimSpool | null>;
  /** IDLE | PREPARE | RUNNING | PAUSE | FINISH | FAILED */
  state: string;
  job?: { name: string; percent: number; remainingMinutes: number; layer: number; totalLayers: number };
  hms?: Array<{ attr: number; code: number }>;
  /** Global tray index feeding now; 255 for none. */
  trayNow?: number;
}

const NO_TAG = '0'.repeat(16);
const NO_UUID = '0'.repeat(32);

export function simTray(id: number, spool: SimSpool | null): Doc {
  if (!spool) return { id: String(id) };
  const tagged = Boolean(spool.uuid);
  const colour = `${spool.color.toUpperCase()}FF`;
  return {
    id: String(id),
    tray_type: spool.type,
    tray_sub_brands: spool.sub ?? '',
    tray_color: colour,
    cols: [colour],
    tray_weight: String(tagged ? (spool.weight ?? 1000) : 0),
    tray_diameter: '1.75',
    tray_info_idx: tagged ? 'GFA00' : 'GFL99',
    tag_uid: tagged ? spool.uuid!.slice(0, 16).toUpperCase() : NO_TAG,
    tray_uuid: tagged ? spool.uuid!.toUpperCase() : NO_UUID,
    remain: tagged ? (spool.remain ?? 100) : -1,
    nozzle_temp_min: '190',
    nozzle_temp_max: '230',
  };
}

/** The whole status document for a printer, as the bridge holds it after merging: `print` plus `info`. */
export function simDocument(printer: SimPrinter): Doc {
  const dual = printer.nozzles.length > 1;
  const print: Doc = {
    command: 'push_status',
    gcode_state: printer.state,
    mc_percent: printer.job?.percent ?? 0,
    mc_remaining_time: printer.job?.remainingMinutes ?? 0,
    layer_num: printer.job?.layer ?? 0,
    total_layer_num: printer.job?.totalLayers ?? 0,
    subtask_name: printer.job?.name ?? '',
    gcode_file: printer.job ? `${printer.job.name}.gcode.3mf` : '',
    bed_temper: printer.state === 'RUNNING' ? 60 : 24,
    bed_target_temper: printer.state === 'RUNNING' ? 60 : 0,
    chamber_temper: 31,
    wifi_signal: '-48dBm',
    print_error: 0,
    hms: printer.hms ?? [],
    ams: {
      ams: printer.feeders.map((feeder) => ({
        id: String(feeder.id),
        humidity: String(feeder.humidityLevel),
        ...(feeder.humidityPercent !== undefined ? { humidity_raw: String(feeder.humidityPercent) } : {}),
        temp: feeder.temp.toFixed(1),
        ...(feeder.dryMinutes !== undefined ? { dry_time: feeder.dryMinutes } : {}),
        tray: feeder.trays.map((spool, index) => simTray(index, spool)),
      })),
      ams_exist_bits: printer.feeders.reduce((bits, feeder) => bits | (feeder.id < 32 ? 1 << feeder.id : 0), 0).toString(16),
      tray_now: String(printer.trayNow ?? 255),
      tray_tar: String(printer.trayNow ?? 255),
      version: 4,
    },
  };
  if (dual) {
    print.device = {
      extruder: {
        state: printer.nozzles.length,
        info: printer.nozzles.map((_nozzle, index) => ({ id: index, temp: printer.state === 'RUNNING' ? (220 << 16) | 219 : 26, snow: 0xffff })),
      },
      nozzle: { info: printer.nozzles.map((nozzle, index) => ({ id: index, diameter: nozzle.diameter, type: nozzle.type })) },
    };
    print.vir_slot = printer.external.map((spool, index) => simTray(254 + index, spool));
  } else {
    print.nozzle_temper = printer.state === 'RUNNING' ? 219 : 26;
    print.nozzle_target_temper = printer.state === 'RUNNING' ? 220 : 0;
    print.nozzle_diameter = String(printer.nozzles[0]?.diameter ?? 0.4);
    print.nozzle_type = printer.nozzles[0]?.type ?? 'hardened_steel';
    print.vt_tray = simTray(254, printer.external[0] ?? null);
  }
  const info: Doc = {
    command: 'get_version',
    module: [
      { name: 'ota', project_name: printer.modelCode, product_name: printer.productName, sw_ver: printer.firmware, sn: printer.serial },
      ...printer.feeders.map((feeder) => ({ name: `${feeder.module}/${feeder.id}`, sw_ver: '00.00.06.49', sn: `AMS${feeder.id}` })),
    ],
  };
  return { print, info };
}

const tagged = (type: string, sub: string, color: string, seed: string, remain: number): SimSpool => ({
  type, sub, color, remain, weight: 1000, uuid: seed.repeat(32).slice(0, 32),
});

/** Four printers that between them cover every shape the reader has to handle. */
export function simFleet(): SimPrinter[] {
  return [
    {
      serial: '00M00A000000001', modelCode: 'BL-P001', productName: 'X1 Carbon', name: 'X1C Sim', firmware: '01.09.00.00',
      nozzles: [{ diameter: 0.4, type: 'hardened_steel' }],
      feeders: [
        { id: 0, module: 'ams', humidityLevel: 4, temp: 26.5, trays: [
          tagged('PLA', 'PLA Basic', '000000', 'a1', 82), tagged('PLA', 'PLA Basic', 'ffffff', 'b2', 41),
          { type: 'PETG', color: '1f6feb' }, null,
        ] },
        { id: 1, module: 'ams', humidityLevel: 3, temp: 27.1, trays: [tagged('PLA', 'PLA Matte', 'c12e1f', 'c3', 67), null, null, null] },
      ],
      external: [null],
      state: 'RUNNING', trayNow: 0,
      job: { name: 'bracket_v3', percent: 37, remainingMinutes: 94, layer: 112, totalLayers: 300 },
    },
    {
      serial: '01P00A000000002', modelCode: 'C12', productName: 'P1S', name: 'P1S Sim', firmware: '01.08.02.00',
      nozzles: [{ diameter: 0.4, type: 'stainless_steel' }],
      feeders: [{ id: 0, module: 'ams', humidityLevel: 2, temp: 24.0, trays: [
        tagged('PETG', 'PETG HF', '2e8b57', 'd4', 15), { type: 'PLA', color: 'f5c518' }, null, null,
      ] }],
      external: [{ type: 'TPU', color: '333333' }],
      state: 'IDLE',
    },
    {
      serial: '03900A000000003', modelCode: 'N2S', productName: 'A1', name: 'A1 Sim', firmware: '01.05.00.00',
      nozzles: [{ diameter: 0.4, type: 'stainless_steel' }],
      feeders: [{ id: 0, module: 'ams_f1', humidityLevel: 5, temp: 23.0, trays: [
        tagged('PLA', 'PLA Basic', '0a2989', 'e5', 90), null, null, null,
      ] }],
      external: [null],
      state: 'FAILED',
      hms: [{ attr: 0x07008011, code: 0x00020002 }],
    },
    {
      serial: '09400A000000004', modelCode: 'O1D', productName: 'H2D', name: 'H2D Sim', firmware: '01.02.00.00',
      nozzles: [{ diameter: 0.4, type: 'hardened_steel' }, { diameter: 0.6, type: 'hardened_steel' }],
      feeders: [
        { id: 0, module: 'n3f', humidityLevel: 5, humidityPercent: 14, temp: 24.0, trays: [
          tagged('PLA', 'PLA Basic', '000000', 'f6', 55), tagged('ABS', 'ABS', 'd9d9d9', 'a7', 100), null, null,
        ] },
        { id: 128, module: 'n3s', humidityLevel: 5, humidityPercent: 9, temp: 65.0, dryMinutes: 180, trays: [tagged('PA-CF', 'PAHT-CF', '111111', 'b8', 73)] },
      ],
      external: [null, { type: 'PLA', color: 'ff7f00' }],
      state: 'FINISH',
      job: { name: 'enclosure_lid', percent: 100, remainingMinutes: 0, layer: 240, totalLayers: 240 },
    },
  ];
}
