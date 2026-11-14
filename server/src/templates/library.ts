import type { SnapshotInput } from '@/services/snapshot';

/**
 * Reusable building blocks for workspace templates. This is starter *data*, not behaviour:
 * once a workspace is created every one of these rows can be renamed, changed or deleted.
 */

type Units = NonNullable<SnapshotInput['units']>;
type ItemTypes = NonNullable<SnapshotInput['itemTypes']>;
type MachineTypes = NonNullable<SnapshotInput['machineTypes']>;
type Tasks = NonNullable<SnapshotInput['maintenanceTasks']>;

/*
 * Select options, exported so the reference catalogue (src/reference) is type-checked against them.
 * Only ever append: existing workspaces keep the lists they were created with, and the catalogue
 * adds any value it needs to a workspace's list when an entry is added.
 */
export const FILAMENT_MATERIALS = [
  'PLA', 'PLA+', 'PLA-CF', 'PETG', 'PETG-CF', 'PCTG', 'PET', 'ABS', 'ASA', 'HIPS', 'TPU', 'TPE',
  'PA', 'PA-CF', 'PA-GF', 'PC', 'PC-CF', 'PC+ABS', 'PP', 'PVA', 'BVOH', 'PVB', 'Support', 'High-temp', 'Other',
] as const;
export const ENDMILL_TYPES = [
  'Flat', 'Ball nose', 'Bull nose', 'Tapered ball nose', 'V-bit', 'O-flute', 'Downcut', 'Compression',
  'Chamfer', 'Engraving', 'Surfacing', 'Roundover', 'Dovetail', 'Drill',
] as const;
export const TOOL_MATERIALS = ['Carbide', 'HSS', 'Cobalt HSS', 'Diamond (PCD)'] as const;
export const SHEET_MATERIALS = [
  'Plywood', 'MDF', 'HDF', 'Hardwood', 'Veneer', 'Bamboo', 'Cork', 'Acrylic', 'PETG', 'Polypropylene', 'HDPE',
  'Acetal', 'Polycarbonate', 'PVC foam', 'Engraving laminate', 'Card', 'Greyboard', 'Paper', 'Leather', 'Felt',
  'Fabric', 'Rubber', 'Foam', 'Slate', 'Glass', 'Aluminium', 'Brass', 'Stainless steel', 'Other',
] as const;
export const FIXING_KINDS = [
  'Screw', 'Bolt', 'Grub screw', 'Wood screw', 'Self-tapping screw', 'Heat-set insert', 'Nut', 'Washer', 'T-nut',
  'Standoff', 'Threaded rod', 'Dowel pin', 'Rivet', 'Other',
] as const;
export const FIXING_MATERIALS = ['Stainless', 'Steel', 'Zinc-plated steel', 'Black oxide steel', 'Brass', 'Nylon', 'Aluminium'] as const;
export const DRIVES = ['Hex socket', 'Torx', 'Phillips', 'Pozidriv', 'Slotted', 'Hex head', 'None'] as const;
export const FINISH_KINDS = [
  'Sanding disc', 'Sanding sheet', 'Sanding sponge', 'Abrasive', 'Primer', 'Paint', 'Filler', 'Oil', 'Hardwax oil',
  'Wax', 'Varnish', 'Lacquer', 'Shellac', 'Stain', 'Sealer', 'Clear coat', 'Epoxy resin', 'Adhesive', 'Polish',
  'Thinner / cleaner',
] as const;
export const FINISH_BASES = ['Water', 'Solvent', 'Oil', 'Spirit', 'Two-part', 'None'] as const;
export const SHEENS = ['Matt', 'Satin', 'Semi-gloss', 'Gloss'] as const;

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
      { key: 'material', label: 'Material', fieldType: 'select', options: [...FILAMENT_MATERIALS], required: true },
      { key: 'colour', label: 'Colour', fieldType: 'color' },
      { key: 'colour_name', label: 'Colour name', fieldType: 'text' },
      { key: 'brand', label: 'Brand', fieldType: 'text' },
      { key: 'diameter', label: 'Diameter', fieldType: 'number', unit: 'mm', showInList: false },
      { key: 'last_dried', label: 'Last dried', fieldType: 'date', showInList: false },
      { key: 'finish', label: 'Finish', fieldType: 'text', showInList: false },
      { key: 'nozzle_temp', label: 'Nozzle temperature', fieldType: 'text', unit: '°C', showInList: false },
      { key: 'bed_temp', label: 'Bed temperature', fieldType: 'text', unit: '°C', showInList: false },
      { key: 'density', label: 'Density', fieldType: 'number', unit: 'g/cm³', showInList: false },
      { key: 'spool_weight', label: 'Empty spool weight', fieldType: 'number', unit: 'g', showInList: false },
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
      { key: 'cut_type', label: 'Type', fieldType: 'select', options: [...ENDMILL_TYPES] },
      { key: 'shank', label: 'Shank', fieldType: 'number', unit: 'mm' },
      { key: 'rated_for', label: 'Rated for', fieldType: 'text' },
      { key: 'coating', label: 'Coating', fieldType: 'text', showInList: false },
      { key: 'flute_length', label: 'Flute length', fieldType: 'number', unit: 'mm', showInList: false },
      { key: 'overall_length', label: 'Overall length', fieldType: 'number', unit: 'mm', showInList: false },
      { key: 'angle', label: 'Angle', fieldType: 'number', unit: '°', showInList: false },
      { key: 'tool_material', label: 'Tool material', fieldType: 'select', options: [...TOOL_MATERIALS], showInList: false },
    ],
  },
  sheet: {
    ref: 't-sheet',
    name: 'Sheet stock',
    icon: 'Layers',
    color: 'amber',
    defaultUnit: 'u-sheets',
    fields: [
      { key: 'material', label: 'Material', fieldType: 'select', options: [...SHEET_MATERIALS], required: true },
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
      { key: 'kind', label: 'Kind', fieldType: 'select', options: [...FIXING_KINDS], required: true },
      { key: 'size', label: 'Size', fieldType: 'text' },
      { key: 'length', label: 'Length', fieldType: 'number', unit: 'mm' },
      { key: 'material', label: 'Material', fieldType: 'select', options: [...FIXING_MATERIALS] },
      { key: 'head', label: 'Head', fieldType: 'text', showInList: false },
      { key: 'standard', label: 'Standard', fieldType: 'text', showInList: false },
      { key: 'thread_pitch', label: 'Thread pitch', fieldType: 'number', unit: 'mm', showInList: false },
      { key: 'drive', label: 'Drive', fieldType: 'select', options: [...DRIVES], showInList: false },
      { key: 'grade', label: 'Grade', fieldType: 'text', showInList: false },
    ],
  },
  finishing: {
    ref: 't-finishing',
    name: 'Finishing supply',
    icon: 'SprayCan',
    color: 'pink',
    defaultUnit: 'u-pcs',
    fields: [
      { key: 'kind', label: 'Kind', fieldType: 'select', options: [...FINISH_KINDS], required: true },
      { key: 'grit', label: 'Grit', fieldType: 'number' },
      { key: 'size', label: 'Size', fieldType: 'text' },
      { key: 'brand', label: 'Brand', fieldType: 'text', showInList: false },
      { key: 'base', label: 'Base', fieldType: 'select', options: [...FINISH_BASES], showInList: false },
      { key: 'sheen', label: 'Sheen', fieldType: 'select', options: [...SHEENS], showInList: false },
      { key: 'coverage', label: 'Coverage', fieldType: 'number', unit: 'm²/l', showInList: false },
      { key: 'cure_time', label: 'Cure time', fieldType: 'text', showInList: false },
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
  resin: { ref: 'mt-resin', name: 'Resin printer', icon: 'Droplets' },
  vinyl: { ref: 'mt-vinyl', name: 'Vinyl cutter', icon: 'Scissors' },
  air: { ref: 'mt-air', name: 'Extraction and air', icon: 'Fan' },
} satisfies Record<string, MachineTypes[number]>;

/**
 * Sample schedules attached to machine *types*, so they apply to any machine of that type you add.
 * Append only: templates/example.ts picks tasks out of these arrays by position.
 */
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
  resin: [
    { ref: 'mt-r-film', name: 'Inspect vat release film', machineType: 'mt-resin', intervalDays: 30, description: 'Look for clouding, dents or punctures in the FEP/PFA film. Replace it if damaged.' },
    { ref: 'mt-r-vat', name: 'Filter resin and clean the vat', machineType: 'mt-resin', intervalDays: 14, description: 'Strain resin through a paint filter to remove cured flakes. Wipe the vat with a soft scraper only.' },
    { ref: 'mt-r-plate', name: 'Check build plate and screen', machineType: 'mt-resin', intervalDays: 60, description: 'Re-level the build plate if prints fail to stick. Check the LCD for dead pixels with the exposure test.' },
  ],
  vinyl: [
    { ref: 'mt-v-blade', name: 'Check or replace the blade', machineType: 'mt-vinyl', intervalDays: 90, description: 'Replace when cuts tear or need a second pass. Clean the blade holder of adhesive.' },
    { ref: 'mt-v-rollers', name: 'Clean rollers and cutting strip', machineType: 'mt-vinyl', intervalDays: 30, description: 'Wipe pinch rollers and the cutting strip with isopropyl alcohol. Check the strip for grooves.' },
  ],
  air: [
    { ref: 'mt-a-filter', name: 'Replace filters', machineType: 'mt-air', intervalDays: 90, description: 'Change the pre-filter, and the HEPA and carbon stages as the maker recommends. Note the date on the housing.' },
    { ref: 'mt-a-duct', name: 'Check ducting, fan and seals', machineType: 'mt-air', intervalDays: 180, description: 'Look for leaks, loose clamps and build-up in the ducting. Listen for fan bearing noise.' },
  ],
} satisfies Record<string, Tasks>;
