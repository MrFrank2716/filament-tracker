import type {
  DRIVES, ENDMILL_TYPES, FILAMENT_MATERIALS, FINISH_BASES, FINISH_KINDS, FIXING_KINDS, FIXING_MATERIALS,
  machineTypes, SHEENS, SHEET_MATERIALS, TOOL_MATERIALS,
} from '@/templates/library';

/**
 * The reference catalogue: real machines and materials a workspace can add in one step.
 * It is read-only data shipped with the app. Adding an entry copies it into the workspace,
 * after which it is an ordinary, editable row with no link back here.
 */

export const REFERENCE_KINDS = ['machine', 'filament', 'endmill', 'fastener', 'sheet', 'finish'] as const;
export type ReferenceKind = (typeof REFERENCE_KINDS)[number];
export type ItemKind = Exclude<ReferenceKind, 'machine'>;

export type MachineTypeKey = keyof typeof machineTypes;

/** Same shape as a machine spec or sub-unit reading. */
export interface Spec {
  label: string;
  value: string;
  unit?: string;
}

export interface ReferenceTask {
  name: string;
  description?: string;
  intervalDays?: number;
  intervalHours?: number;
}

/** Hardware that can come with a machine. Each one ticked becomes a sub-unit with slots. */
export interface ReferenceAttachment {
  id: string;
  name: string;
  kind: string;
  slots: number;
  /** Fitted as standard, so ticked by default. */
  builtIn?: boolean;
}

export interface ReferenceMachine {
  id: string;
  /** Empty for generic equipment. */
  brand: string;
  model: string;
  machineType: MachineTypeKey;
  /** One line for the picker, e.g. "Enclosed CoreXY". */
  summary?: string;
  specs: Spec[];
  attachments?: ReferenceAttachment[];
  /** Schedules for this machine only, for equipment whose type-level schedules would not fit. */
  tasks?: ReferenceTask[];
  /** Set for equipment that is better tracked as standalone attached hardware, such as a filament dryer. */
  asUnit?: { kind: string; slots: number };
}

export interface FilamentLine {
  id: string;
  brand: string;
  /** The product line without the colour, e.g. "PLA Matte". */
  name: string;
  material: (typeof FILAMENT_MATERIALS)[number];
  /** The maker's own material code, e.g. "PA6-CF". */
  materialCode: string;
  density: number;
  diameters: number[];
  /** Net filament weight and, where known, the empty spool's weight, both in grams. */
  weights: { g: number; spool?: number }[];
  nozzle?: [number, number];
  bed?: [number, number];
  finish?: string;
  /** [colour name, #rrggbb] */
  colours: [string, string][];
}

export interface ReferenceEndmill {
  id: string;
  name: string;
  cutType: (typeof ENDMILL_TYPES)[number];
  diameter: number;
  shank: number;
  flutes: number;
  fluteLength?: number;
  overallLength?: number;
  /** Included angle for V-bits and chamfer tools. */
  angle?: number;
  toolMaterial: (typeof TOOL_MATERIALS)[number];
  coating?: string;
  ratedFor?: string;
  imperial?: boolean;
}

export interface FastenerSize {
  size: string;
  /** Coarse thread pitch in mm (metric only). */
  pitch?: number;
  /** Offered lengths in mm. Empty for parts without a length, such as nuts and washers. */
  lengths: number[];
}

export interface ReferenceFastener {
  id: string;
  /** e.g. "Socket cap screw" */
  name: string;
  kind: (typeof FIXING_KINDS)[number];
  standard?: string;
  head?: string;
  drive?: (typeof DRIVES)[number];
  /** Material and grade combinations commonly stocked. The first is the default. */
  materials: { material: (typeof FIXING_MATERIALS)[number]; grade?: string }[];
  sizes: FastenerSize[];
  imperial?: boolean;
}

export interface ReferenceSheet {
  id: string;
  name: string;
  material: (typeof SHEET_MATERIALS)[number];
  finish?: string;
  /** Commonly stocked thicknesses in mm. */
  thicknesses: number[];
  /** Safety or suitability note shown in the picker, e.g. "Not for laser cutting". */
  note?: string;
}

export interface ReferenceFinish {
  id: string;
  name: string;
  kind: (typeof FINISH_KINDS)[number];
  base?: (typeof FINISH_BASES)[number];
  sheen?: (typeof SHEENS)[number];
  /** Free-text size such as "125 mm hook and loop", for abrasives. */
  size?: string;
  /** Liquids are tracked in ml, everything else in pieces. */
  unit: 'ml' | 'pcs';
  /** Pick one or more: grits for abrasives, container sizes for liquids. */
  variants: { label: string; grit?: number; capacity?: number }[];
}

/** Common sheet sizes offered when adding sheet stock, in mm. */
export interface SheetSize {
  label: string;
  width: number;
  length: number;
}
