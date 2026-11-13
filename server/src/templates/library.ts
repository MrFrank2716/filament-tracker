import type { SnapshotInput } from '@/services/snapshot';

/**
 * Reusable building blocks for workspace templates. This is starter *data*, not behaviour:
 * once a workspace is created every one of these rows can be renamed, changed or deleted.
 */

type Units = NonNullable<SnapshotInput['units']>;
type ItemTypes = NonNullable<SnapshotInput['itemTypes']>;
type MachineTypes = NonNullable<SnapshotInput['machineTypes']>;
type Tasks = NonNullable<SnapshotInput['maintenanceTasks']>;

export const units = {
  g: { ref: 'u-g', name: 'Grams', symbol: 'g', decimals: 0 },
  pcs: { ref: 'u-pcs', name: 'Pieces', symbol: 'pcs', decimals: 0 },
  m: { ref: 'u-m', name: 'Metres', symbol: 'm', decimals: 2 },
  ml: { ref: 'u-ml', name: 'Millilitres', symbol: 'ml', decimals: 0 },
  sheets: { ref: 'u-sheets', name: 'Sheets', symbol: 'sheets', decimals: 0 },
} satisfies Record<string, Units[number]>;

export const itemTypes = {
  filament: {
    ref: 't-filament',
    name: 'Filament',
    icon: 'Spool',
    color: 'orange',
    defaultUnit: 'u-g',
    fields: [
      { key: 'material', label: 'Material', fieldType: 'select', options: ['PLA', 'PETG', 'ABS', 'ASA', 'TPU', 'PA', 'PA-CF', 'PC', 'PVA', 'Support'], required: true },
      { key: 'colour', label: 'Colour', fieldType: 'color' },
      { key: 'colour_name', label: 'Colour name', fieldType: 'text' },
      { key: 'brand', label: 'Brand', fieldType: 'text' },
      { key: 'diameter', label: 'Diameter', fieldType: 'number', unit: 'mm', showInList: false },
      { key: 'last_dried', label: 'Last dried', fieldType: 'date', showInList: false },
    ],
  },
  endmill: {
    ref: 't-endmill',
    name: 'Endmill',
    icon: 'Drill',
    color: 'blue',
    defaultUnit: 'u-pcs',
    tracksLife: true,
    fields: [
      { key: 'diameter', label: 'Diameter', fieldType: 'number', unit: 'mm', required: true },
      { key: 'flutes', label: 'Flutes', fieldType: 'number' },
      { key: 'cut_type', label: 'Type', fieldType: 'select', options: ['Flat', 'Ball nose', 'V-bit', 'O-flute', 'Compression', 'Chamfer', 'Engraving', 'Drill'] },
      { key: 'shank', label: 'Shank', fieldType: 'number', unit: 'mm' },
      { key: 'rated_for', label: 'Rated for', fieldType: 'text' },
      { key: 'coating', label: 'Coating', fieldType: 'text', showInList: false },
    ],
  },
  sheet: {
    ref: 't-sheet',
    name: 'Sheet stock',
    icon: 'Layers',
    color: 'amber',
    defaultUnit: 'u-sheets',
    fields: [
      { key: 'material', label: 'Material', fieldType: 'select', options: ['Plywood', 'MDF', 'Acrylic', 'Hardwood', 'Card', 'Leather', 'Aluminium', 'Other'], required: true },
      { key: 'thickness', label: 'Thickness', fieldType: 'number', unit: 'mm' },
      { key: 'width', label: 'Width', fieldType: 'number', unit: 'mm', isSizeDimension: true },
      { key: 'length', label: 'Length', fieldType: 'number', unit: 'mm', isSizeDimension: true },
      { key: 'finish', label: 'Colour / finish', fieldType: 'text' },
    ],
  },
  stock: {
    ref: 't-stock',
    name: 'Bar and block stock',
    icon: 'Box',
    color: 'slate',
    defaultUnit: 'u-pcs',
    fields: [
      { key: 'material', label: 'Material', fieldType: 'text', required: true },
      { key: 'width', label: 'Width', fieldType: 'number', unit: 'mm', isSizeDimension: true },
      { key: 'length', label: 'Length', fieldType: 'number', unit: 'mm', isSizeDimension: true },
      { key: 'height', label: 'Height', fieldType: 'number', unit: 'mm', isSizeDimension: true },
    ],
  },
  spare: {
    ref: 't-spare',
    name: 'Spare part',
    icon: 'Cog',
    color: 'violet',
    defaultUnit: 'u-pcs',
    fields: [
      { key: 'part_kind', label: 'Kind', fieldType: 'text' },
      { key: 'part_number', label: 'Part number', fieldType: 'text', showInList: false },
      { key: 'spec', label: 'Spec', fieldType: 'text' },
    ],
  },
  fixing: {
    ref: 't-fixing',
    name: 'Fixing',
    icon: 'Bolt',
    color: 'teal',
    defaultUnit: 'u-pcs',
    fields: [
      { key: 'kind', label: 'Kind', fieldType: 'select', options: ['Screw', 'Heat-set insert', 'Nut', 'Washer', 'T-nut', 'Standoff', 'Rivet', 'Other'], required: true },
      { key: 'size', label: 'Size', fieldType: 'text' },
      { key: 'length', label: 'Length', fieldType: 'number', unit: 'mm' },
      { key: 'material', label: 'Material', fieldType: 'select', options: ['Stainless', 'Steel', 'Brass', 'Nylon', 'Aluminium'] },
      { key: 'head', label: 'Head', fieldType: 'text', showInList: false },
    ],
  },
  finishing: {
    ref: 't-finishing',
    name: 'Finishing supply',
    icon: 'SprayCan',
    color: 'pink',
    defaultUnit: 'u-pcs',
    fields: [
      { key: 'kind', label: 'Kind', fieldType: 'select', options: ['Sanding disc', 'Abrasive', 'Primer', 'Paint', 'Filler', 'Adhesive', 'Polish'], required: true },
      { key: 'grit', label: 'Grit', fieldType: 'number' },
      { key: 'size', label: 'Size', fieldType: 'text' },
    ],
  },
  consumable: {
    ref: 't-consumable',
    name: 'Consumable',
    icon: 'Droplets',
    color: 'green',
    defaultUnit: 'u-pcs',
    fields: [{ key: 'kind', label: 'Kind', fieldType: 'text' }],
  },
  handTool: {
    ref: 't-handtool',
    name: 'Hand tool',
    icon: 'Hammer',
    color: 'red',
    defaultUnit: 'u-pcs',
    fields: [
      { key: 'brand', label: 'Brand', fieldType: 'text' },
      { key: 'size', label: 'Size', fieldType: 'text' },
      { key: 'condition', label: 'Condition', fieldType: 'select', options: ['Good', 'Worn', 'Needs replacing'] },
      { key: 'calibration_due', label: 'Calibration due', fieldType: 'date', showInList: false },
    ],
  },
  safety: {
    ref: 't-safety',
    name: 'Safety equipment',
    icon: 'HardHat',
    color: 'red',
    defaultUnit: 'u-pcs',
    fields: [
      { key: 'kind', label: 'Kind', fieldType: 'select', options: ['Eye protection', 'Hearing protection', 'Gloves', 'Dust mask', 'Apron', 'First aid', 'Fire safety'] },
      { key: 'size', label: 'Size', fieldType: 'text' },
      { key: 'expires', label: 'Expires', fieldType: 'date' },
    ],
  },
  classKit: {
    ref: 't-kit',
    name: 'Class kit',
    icon: 'Boxes',
    color: 'blue',
    defaultUnit: 'u-pcs',
    fields: [
      { key: 'subject', label: 'Subject', fieldType: 'text' },
      { key: 'year_group', label: 'Year group', fieldType: 'text' },
      { key: 'pieces_per_kit', label: 'Pieces per kit', fieldType: 'number' },
    ],
  },
} satisfies Record<string, ItemTypes[number]>;

export const machineTypes = {
  printer: { ref: 'mt-printer', name: '3D printer', icon: 'Printer' },
  cnc: { ref: 'mt-cnc', name: 'CNC machine', icon: 'Drill' },
  laser: { ref: 'mt-laser', name: 'Laser cutter', icon: 'Zap' },
  finishing: { ref: 'mt-finishing', name: 'Finishing equipment', icon: 'Sparkles' },
  general: { ref: 'mt-general', name: 'General workshop', icon: 'Wrench' },
} satisfies Record<string, MachineTypes[number]>;

/** Sample schedules attached to machine *types*, so they apply to any machine of that type you add. */
export const tasks = {
  printer: [
    { ref: 'mt-p-rails', name: 'Clean and lubricate rails and lead screws', machineType: 'mt-printer', intervalDays: 90, intervalHours: 300, description: 'Wipe rails clean, apply a thin film of the recommended grease or oil, run each axis end to end.' },
    { ref: 'mt-p-belts', name: 'Check belt tension and condition', machineType: 'mt-printer', intervalDays: 60, intervalHours: 200, description: 'Look for fraying or missing teeth. Re-tension following the manufacturer procedure.' },
    { ref: 'mt-p-nozzle', name: 'Inspect nozzle, change if worn', machineType: 'mt-printer', intervalHours: 250, description: 'Check for a widened or scored orifice, especially after abrasive filaments.' },
    { ref: 'mt-p-ptfe', name: 'Check feeder and PTFE tubes', machineType: 'mt-printer', intervalDays: 120, description: 'Look for kinks, grooves and loose couplings along the filament path.' },
  ],
  cnc: [
    { ref: 'mt-c-collet', name: 'Check collet and nut for wear', machineType: 'mt-cnc', intervalHours: 50, description: 'Clean the taper, check for scoring and that tools seat without runout.' },
    { ref: 'mt-c-spindle', name: 'Spindle runout and bearing check', machineType: 'mt-cnc', intervalDays: 180, intervalHours: 200, description: 'Measure runout with a dial indicator. Listen for bearing noise at speed.' },
    { ref: 'mt-c-rails', name: 'Clean and lubricate rails and lead screws', machineType: 'mt-cnc', intervalDays: 30, description: 'Vacuum chips first, then wipe and re-lubricate.' },
  ],
  laser: [
    { ref: 'mt-l-optics', name: 'Clean optics and lens window', machineType: 'mt-laser', intervalDays: 14, intervalHours: 20, description: 'Use lens tissue and the recommended cleaner only. Check for burn marks.' },
    { ref: 'mt-l-filter', name: 'Replace extraction filter', machineType: 'mt-laser', intervalDays: 180, intervalHours: 100, description: 'Swap pre-filter and carbon/HEPA stage. Check ducting for leaks.' },
    { ref: 'mt-l-bed', name: 'Clean bed and check focus', machineType: 'mt-laser', intervalDays: 30, description: 'Remove residue from the bed slats and verify focus height.' },
  ],
  finishing: [
    { ref: 'mt-f-disc', name: 'Change sanding disc', machineType: 'mt-finishing', intervalHours: 5, description: 'Replace when clogged or cutting slowly.' },
    { ref: 'mt-f-dust', name: 'Empty dust collection', machineType: 'mt-finishing', intervalDays: 14, description: 'Empty the bin and check the filter.' },
  ],
  general: [
    { ref: 'mt-g-audit', name: 'Tool audit and calibration check', machineType: 'mt-general', intervalDays: 180, description: 'Count tools against the register. Check measuring tools against a reference.' },
  ],
} satisfies Record<string, Tasks>;
