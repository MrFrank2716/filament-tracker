import type { SnapshotInput } from '@/services/snapshot';
import { itemTypes, machineTypes, tasks, units } from '@/templates/library';

type Item = NonNullable<SnapshotInput['items']>[number];

const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

/**
 * The default example environment: a small mixed maker space.
 * It is only sample data - delete the workspace, or individual rows, at any time.
 */
export function buildExample(): SnapshotInput {
  const spool = (
    ref: string, name: string, material: string, colour: string, colourName: string, brand: string,
    quantity: number, pricePerKg: number, extra: Partial<Item> = {},
  ): Item => ({
    ref, type: 't-filament', name, unit: 'u-g', quantity, capacity: 1000, minQuantity: 150,
    unitCost: pricePerKg / 1000, supplier: 's-bambu', location: 'l-rack', compatibleMachines: ['m-h2d', 'm-x2d'],
    fields: { material, colour, colour_name: colourName, brand, diameter: 1.75 },
    ...extra,
  });

  const items: Item[] = [
    // Filament
    spool('i-pla-black', 'PLA Basic Black', 'PLA', '#161616', 'Black', 'Bambu Lab', 640, 19.99),
    spool('i-pla-white', 'PLA Basic White', 'PLA', '#f4f4f0', 'Jade White', 'Bambu Lab', 910, 19.99),
    spool('i-pla-matte', 'PLA Matte Charcoal', 'PLA', '#3b3d42', 'Charcoal', 'Bambu Lab', 120, 19.99),
    spool('i-pla-silk', 'PLA Silk Gold', 'PLA', '#c9a13b', 'Gold', 'Bambu Lab', 780, 26.99, { location: 'l-drybox' }),
    spool('i-petg-orange', 'PETG HF Orange', 'PETG', '#f26a1b', 'Orange', 'Bambu Lab', 455, 19.99),
    spool('i-petg-blue', 'PETG Translucent Blue', 'PETG', '#2f6fd6', 'Translucent Blue', 'Bambu Lab', 1000, 22.99, { location: 'l-drybox' }),
    spool('i-abs-black', 'ABS Black', 'ABS', '#1c1c1e', 'Black', 'Bambu Lab', 330, 21.99),
    spool('i-asa-grey', 'ASA Grey', 'ASA', '#8a8f98', 'Grey', 'Bambu Lab', 860, 26.99),
    spool('i-tpu-black', 'TPU 95A HF Black', 'TPU', '#202124', 'Black', 'Bambu Lab', 540, 35.99, { location: 'l-drybox' }),
    spool('i-pacf', 'PA6-CF Black', 'PA-CF', '#2a2a2a', 'Black', 'Bambu Lab', 90, 74.99, {
      capacity: 500, minQuantity: 100, location: 'l-drybox', notes: 'Abrasive: hardened nozzle only. Dry at 80 °C for 8 h before use.',
    }),
    spool('i-support', 'Support for PLA', 'Support', '#e9e4d8', 'Nature', 'Bambu Lab', 380, 59.98, { capacity: 500, minQuantity: 80 }),

    // CNC tooling (tracked by hours)
    {
      ref: 'i-em-3175', type: 't-endmill', name: '3.175 mm 2-flute flat', unit: 'u-pcs', quantity: 3, minQuantity: 2, unitCost: 6.5,
      supplier: 's-makera', location: 'l-tooldrawer', usageHours: 7.5, lifeHours: 20, compatibleMachines: ['m-z1'],
      fields: { diameter: 3.175, flutes: 2, cut_type: 'Flat', shank: 3.175, rated_for: 'Wood, plastics, aluminium', coating: 'Uncoated carbide' },
    },
    {
      ref: 'i-em-1ball', type: 't-endmill', name: '1 mm ball nose', unit: 'u-pcs', quantity: 2, minQuantity: 1, unitCost: 9.2,
      supplier: 's-makera', location: 'l-tooldrawer', usageHours: 3, lifeHours: 12, compatibleMachines: ['m-z1'],
      fields: { diameter: 1, flutes: 2, cut_type: 'Ball nose', shank: 3.175, rated_for: 'Wood, plastics, brass', coating: 'TiAlN' },
    },
    {
      ref: 'i-em-6o', type: 't-endmill', name: '6 mm single O-flute', unit: 'u-pcs', quantity: 1, minQuantity: 1, unitCost: 14.8,
      supplier: 's-makera', location: 'l-tooldrawer', usageHours: 16.5, lifeHours: 18, compatibleMachines: ['m-z1'],
      fields: { diameter: 6, flutes: 1, cut_type: 'O-flute', shank: 6, rated_for: 'Aluminium, acrylic', coating: 'Polished carbide' },
      notes: 'Getting close to end of life - finish is degrading on aluminium.',
    },
    {
      ref: 'i-em-vbit', type: 't-endmill', name: '30° V-bit engraver', unit: 'u-pcs', quantity: 4, minQuantity: 2, unitCost: 3.4,
      supplier: 's-makera', location: 'l-tooldrawer', usageHours: 10.2, lifeHours: 10, wearFlag: true, compatibleMachines: ['m-z1'],
      fields: { diameter: 0.2, flutes: 1, cut_type: 'V-bit', shank: 3.175, rated_for: 'PCB, wood, plastics', coating: 'Uncoated carbide' },
    },
    {
      ref: 'i-em-2flat', type: 't-endmill', name: '2 mm 2-flute flat', unit: 'u-pcs', quantity: 5, minQuantity: 2, unitCost: 5.9,
      supplier: 's-makera', location: 'l-tooldrawer', usageHours: 1.5, lifeHours: 15, compatibleMachines: ['m-z1'],
      fields: { diameter: 2, flutes: 2, cut_type: 'Flat', shank: 3.175, rated_for: 'Wood, plastics, aluminium', coating: 'TiAlN' },
    },

    // Laser sheet stock and offcuts
    {
      ref: 'i-ply3', type: 't-sheet', name: '3 mm birch plywood', unit: 'u-sheets', quantity: 12, minQuantity: 5, unitCost: 2.4,
      supplier: 's-sheets', location: 'l-sheetrack', compatibleMachines: ['m-h2d'], fields: { material: 'Plywood', thickness: 3, width: 300, length: 200, finish: 'Birch, laser grade' },
    },
    {
      ref: 'i-acr-clear', type: 't-sheet', name: '3 mm clear acrylic', unit: 'u-sheets', quantity: 3, minQuantity: 4, unitCost: 4.1,
      supplier: 's-sheets', location: 'l-sheetrack', compatibleMachines: ['m-h2d'], fields: { material: 'Acrylic', thickness: 3, width: 300, length: 300, finish: 'Clear cast' },
    },
    {
      ref: 'i-acr-black', type: 't-sheet', name: '2 mm black acrylic', unit: 'u-sheets', quantity: 6, minQuantity: 2, unitCost: 3.6,
      supplier: 's-sheets', location: 'l-sheetrack', compatibleMachines: ['m-h2d'], fields: { material: 'Acrylic', thickness: 2, width: 300, length: 200, finish: 'Gloss black' },
    },
    {
      ref: 'i-mdf6', type: 't-sheet', name: '6 mm MDF', unit: 'u-sheets', quantity: 4, minQuantity: 2, unitCost: 1.9,
      supplier: 's-sheets', location: 'l-sheetrack', compatibleMachines: ['m-h2d'], fields: { material: 'MDF', thickness: 6, width: 400, length: 300, finish: 'Plain' },
    },
    {
      ref: 'i-off-ply', type: 't-sheet', name: 'Offcut: 3 mm birch plywood', unit: 'u-sheets', quantity: 1, unitCost: 0, isRemnant: true, parent: 'i-ply3',
      location: 'l-offcuts', compatibleMachines: ['m-h2d'], fields: { material: 'Plywood', thickness: 3, width: 140, length: 90, finish: 'Birch, laser grade' },
    },
    {
      ref: 'i-off-acr', type: 't-sheet', name: 'Offcut: 3 mm clear acrylic', unit: 'u-sheets', quantity: 1, unitCost: 0, isRemnant: true, parent: 'i-acr-clear',
      location: 'l-offcuts', compatibleMachines: ['m-h2d'], fields: { material: 'Acrylic', thickness: 3, width: 120, length: 200, finish: 'Clear cast' },
    },
    {
      ref: 'i-off-mdf', type: 't-sheet', name: 'Offcut: 6 mm MDF', unit: 'u-sheets', quantity: 2, unitCost: 0, isRemnant: true, parent: 'i-mdf6',
      location: 'l-offcuts', compatibleMachines: ['m-h2d'], fields: { material: 'MDF', thickness: 6, width: 180, length: 150, finish: 'Plain' },
    },

    // Spare parts, linked to the machines they fit
    {
      ref: 'i-noz-04', type: 't-spare', name: '0.4 mm hardened steel nozzle', unit: 'u-pcs', quantity: 2, minQuantity: 2, unitCost: 13.99,
      supplier: 's-bambu', location: 'l-spares', compatibleMachines: ['m-h2d', 'm-x2d'], fields: { part_kind: 'Nozzle', spec: '0.4 mm, hardened steel' },
    },
    {
      ref: 'i-noz-06', type: 't-spare', name: '0.6 mm hardened steel nozzle', unit: 'u-pcs', quantity: 1, minQuantity: 1, unitCost: 13.99,
      supplier: 's-bambu', location: 'l-spares', compatibleMachines: ['m-h2d', 'm-x2d'], fields: { part_kind: 'Nozzle', spec: '0.6 mm, hardened steel' },
    },
    {
      ref: 'i-hotend', type: 't-spare', name: 'Complete hotend assembly', unit: 'u-pcs', quantity: 1, minQuantity: 1, unitCost: 34.99,
      supplier: 's-bambu', location: 'l-spares', compatibleMachines: ['m-h2d'], fields: { part_kind: 'Hotend', spec: '0.4 mm, with heater and thermistor' },
    },
    {
      ref: 'i-belts', type: 't-spare', name: 'XY belt set', unit: 'u-pcs', quantity: 1, minQuantity: 1, unitCost: 18.5,
      supplier: 's-bambu', location: 'l-spares', compatibleMachines: ['m-x2d'], fields: { part_kind: 'Belt', spec: 'GT2, 6 mm' },
    },
    {
      ref: 'i-plate-pei', type: 't-spare', name: 'Textured PEI build plate', unit: 'u-pcs', quantity: 2, minQuantity: 1, unitCost: 32.99,
      supplier: 's-bambu', location: 'l-spares', compatibleMachines: ['m-h2d'], fields: { part_kind: 'Build plate', spec: 'Textured PEI, double sided' },
    },
    {
      ref: 'i-ptfe', type: 't-spare', name: 'PTFE tube', unit: 'u-m', quantity: 1.4, minQuantity: 1, unitCost: 4.5,
      supplier: 's-bambu', location: 'l-spares', compatibleMachines: ['m-h2d', 'm-x2d'], fields: { part_kind: 'PTFE tube', spec: '4 mm OD / 2.5 mm ID' },
    },
    {
      ref: 'i-fan', type: 't-spare', name: 'Part cooling fan', unit: 'u-pcs', quantity: 0, minQuantity: 1, unitCost: 11.99,
      supplier: 's-bambu', location: 'l-spares', compatibleMachines: ['m-x2d'], fields: { part_kind: 'Fan', spec: '5015 blower, 24 V' },
    },
    {
      ref: 'i-lens', type: 't-spare', name: 'Laser lens protective window', unit: 'u-pcs', quantity: 3, minQuantity: 2, unitCost: 8.99,
      supplier: 's-bambu', location: 'l-spares', compatibleMachines: ['m-h2d'], fields: { part_kind: 'Optics', spec: 'For 40 W laser module' },
    },
    {
      ref: 'i-filter', type: 't-spare', name: 'Extraction filter cartridge', unit: 'u-pcs', quantity: 1, minQuantity: 1, unitCost: 39,
      supplier: 's-bambu', location: 'l-spares', compatibleMachines: ['m-h2d'], fields: { part_kind: 'Filter', spec: 'HEPA + activated carbon' },
    },
    {
      ref: 'i-collet', type: 't-spare', name: 'ER11 collet 3.175 mm', unit: 'u-pcs', quantity: 2, minQuantity: 1, unitCost: 7.5,
      supplier: 's-makera', location: 'l-tooldrawer', compatibleMachines: ['m-z1'], fields: { part_kind: 'Collet', spec: 'ER11, 1/8 in' },
    },

    // Fixings
    ...(
      [
        ['i-m3x8', 'M3 × 8 socket cap screw', 'Screw', 'M3', 8, 'Stainless', 'Socket cap', 180, 50, 0.04],
        ['i-m3x12', 'M3 × 12 socket cap screw', 'Screw', 'M3', 12, 'Stainless', 'Socket cap', 95, 50, 0.05],
        ['i-m4x10', 'M4 × 10 button head screw', 'Screw', 'M4', 10, 'Stainless', 'Button', 60, 30, 0.07],
        ['i-m3ins', 'M3 heat-set insert', 'Heat-set insert', 'M3', 5.7, 'Brass', '', 45, 50, 0.09],
        ['i-m4ins', 'M4 heat-set insert', 'Heat-set insert', 'M4', 8.1, 'Brass', '', 70, 30, 0.12],
        ['i-m3nut', 'M3 hex nut', 'Nut', 'M3', null, 'Stainless', '', 210, 50, 0.02],
        ['i-m3wash', 'M3 washer', 'Washer', 'M3', null, 'Stainless', '', 320, 50, 0.01],
        ['i-m5tnut', 'M5 T-nut for 2020 extrusion', 'T-nut', 'M5', null, 'Steel', '', 24, 20, 0.18],
      ] as const
    ).map(
      ([ref, name, kind, size, length, material, head, quantity, minQuantity, unitCost]): Item => ({
        ref, type: 't-fixing', name, unit: 'u-pcs', quantity, minQuantity, unitCost, supplier: 's-fixings', location: 'l-fixings',
        fields: { kind, size, length, material, head },
      }),
    ),

    // Finishing supplies
    {
      ref: 'i-disc-120', type: 't-finishing', name: 'Sanding disc 120 grit', unit: 'u-pcs', quantity: 14, minQuantity: 10, unitCost: 0.6,
      supplier: 's-hozo', location: 'l-finishing', compatibleMachines: ['m-sander'], fields: { kind: 'Sanding disc', grit: 120, size: '25 mm hook and loop' },
    },
    {
      ref: 'i-disc-240', type: 't-finishing', name: 'Sanding disc 240 grit', unit: 'u-pcs', quantity: 6, minQuantity: 10, unitCost: 0.6,
      supplier: 's-hozo', location: 'l-finishing', compatibleMachines: ['m-sander'], fields: { kind: 'Sanding disc', grit: 240, size: '25 mm hook and loop' },
    },
    {
      ref: 'i-disc-400', type: 't-finishing', name: 'Sanding disc 400 grit', unit: 'u-pcs', quantity: 22, minQuantity: 10, unitCost: 0.65,
      supplier: 's-hozo', location: 'l-finishing', compatibleMachines: ['m-sander'], fields: { kind: 'Sanding disc', grit: 400, size: '25 mm hook and loop' },
    },
    {
      ref: 'i-sponge', type: 't-finishing', name: 'Sanding sponge, fine', unit: 'u-pcs', quantity: 3, minQuantity: 2, unitCost: 1.8,
      supplier: 's-fixings', location: 'l-finishing', fields: { kind: 'Abrasive', grit: 320, size: '100 × 70 mm' },
    },
    {
      ref: 'i-primer', type: 't-finishing', name: 'Filler primer spray, grey', unit: 'u-ml', quantity: 150, capacity: 400, minQuantity: 100, unitCost: 0.0225,
      supplier: 's-fixings', location: 'l-finishing', fields: { kind: 'Primer', size: '400 ml can' },
    },
    {
      ref: 'i-ca', type: 't-finishing', name: 'CA glue, medium', unit: 'u-g', quantity: 12, capacity: 20, minQuantity: 5, unitCost: 0.3,
      supplier: 's-fixings', location: 'l-finishing', fields: { kind: 'Adhesive', size: '20 g bottle' },
    },
    {
      ref: 'i-epoxy', type: 't-finishing', name: 'Two-part epoxy, 5 minute', unit: 'u-ml', quantity: 18, capacity: 24, minQuantity: 6, unitCost: 0.25,
      supplier: 's-fixings', location: 'l-finishing', fields: { kind: 'Adhesive', size: '24 ml syringe' },
    },

    // Hand tool register
    ...(
      [
        ['i-calipers', 'Digital calipers', 'Mitutoyo', '150 mm', 'Good', 1, 89],
        ['i-cutters', 'Flush cutters', 'Knipex', '125 mm', 'Good', 2, 21],
        ['i-hexset', 'Hex key set', 'Wera', '1.5 - 10 mm', 'Good', 1, 28],
        ['i-deburr', 'Deburring tool', 'Noga', '', 'Worn', 1, 12],
        ['i-iron', 'Soldering iron with insert tips', 'Pinecil', 'M2 - M5 tips', 'Good', 1, 45],
        ['i-files', 'Needle file set', '', '10 piece', 'Good', 1, 14],
        ['i-torque', 'Torque screwdriver', 'Wera', '0.3 - 1.2 Nm', 'Good', 1, 95],
      ] as const
    ).map(
      ([ref, name, brand, size, condition, quantity, unitCost]): Item => ({
        ref, type: 't-handtool', name, unit: 'u-pcs', quantity, unitCost, location: 'l-bench', compatibleMachines: ['m-bench'], fields: { brand, size, condition },
      }),
    ),
  ];

  const cost = (ref: string, quantity: number, hours = 0) => {
    const item = items.find((i) => i.ref === ref);
    const unitCost = item?.unitCost ?? 0;
    const tooling = item?.lifeHours && hours ? (hours / item.lifeHours) * unitCost : 0;
    return Math.round((quantity * unitCost + tooling) * 100) / 100;
  };
  const finishedJob = (
    name: string, machine: string, hourlyCost: number, durationHours: number, completedDaysAgo: number,
    lines: Array<[item: string, quantity: number, hours?: number]>, notes = '',
  ): NonNullable<SnapshotInput['jobs']>[number] => {
    const usages = lines.map(([item, quantity, hours = 0]) => ({ item, quantity, hours, cost: cost(item, quantity, hours) }));
    const materialCost = Math.round(lines.reduce((sum, [item, quantity]) => sum + cost(item, quantity), 0) * 100) / 100;
    const total = usages.reduce((sum, u) => sum + u.cost, 0);
    const machineCost = Math.round(durationHours * hourlyCost * 100) / 100;
    return {
      name, machine, status: 'completed', durationHours, notes, materialCost,
      toolingCost: Math.round((total - materialCost) * 100) / 100, machineCost,
      totalCost: Math.round((total + machineCost) * 100) / 100,
      createdAt: daysAgo(completedDaysAgo), completedAt: daysAgo(completedDaysAgo), usages,
    };
  };

  return {
    version: 1,
    workspace: { name: 'Example maker space', description: 'Sample data: printers, CNC, laser and finishing in one small workshop.', currency: 'GBP' },
    units: Object.values(units),
    suppliers: [
      { ref: 's-bambu', name: 'Bambu Lab Store', website: 'https://store.bambulab.com' },
      { ref: 's-makera', name: 'Makera', website: 'https://www.makera.com' },
      { ref: 's-hozo', name: 'Hozo Design', website: 'https://hozodesign.com' },
      { ref: 's-sheets', name: 'Sheet materials supplier', notes: 'Replace with your laser sheet supplier.' },
      { ref: 's-fixings', name: 'Fixings and consumables supplier', notes: 'Replace with your fastener supplier.' },
    ],
    locations: [
      { ref: 'l-room', name: 'Workshop', kind: 'Room', code: 'LOC-001' },
      { ref: 'l-rack', name: 'Filament rack', kind: 'Shelf', code: 'LOC-010', parent: 'l-room' },
      { ref: 'l-drybox', name: 'Dry box A', kind: 'Bin', code: 'LOC-011', parent: 'l-rack' },
      { ref: 'l-cnc', name: 'CNC bench', kind: 'Bench', code: 'LOC-020', parent: 'l-room' },
      { ref: 'l-tooldrawer', name: 'Tooling drawer', kind: 'Drawer', code: 'LOC-021', parent: 'l-cnc' },
      { ref: 'l-sheetrack', name: 'Sheet rack', kind: 'Shelf', code: 'LOC-030', parent: 'l-room' },
      { ref: 'l-offcuts', name: 'Offcut bin', kind: 'Bin', code: 'LOC-031', parent: 'l-sheetrack' },
      { ref: 'l-cabinet', name: 'Parts cabinet', kind: 'Cabinet', code: 'LOC-040', parent: 'l-room' },
      { ref: 'l-fixings', name: 'Drawer 1: fixings', kind: 'Drawer', code: 'LOC-041', parent: 'l-cabinet' },
      { ref: 'l-spares', name: 'Drawer 2: spares', kind: 'Drawer', code: 'LOC-042', parent: 'l-cabinet' },
      { ref: 'l-finishing', name: 'Finishing station', kind: 'Bench', code: 'LOC-050', parent: 'l-room' },
      { ref: 'l-bench', name: 'Main workbench', kind: 'Bench', code: 'LOC-060', parent: 'l-room' },
    ],
    itemTypes: [
      itemTypes.filament, itemTypes.endmill, itemTypes.sheet, itemTypes.spare,
      itemTypes.fixing, itemTypes.finishing, itemTypes.handTool,
    ],
    machineTypes: [machineTypes.printer, machineTypes.cnc, machineTypes.laser, machineTypes.finishing, machineTypes.general],
    machines: [
      { ref: 'm-h2d', name: 'Bambu Lab H2D', type: 'mt-printer', manufacturer: 'Bambu Lab', model: 'H2D', usageHours: 412, hourlyCost: 0.35, location: 'l-room', notes: 'Dual nozzle. 40 W laser module fitted (see attached hardware).' },
      { ref: 'm-x2d', name: 'Bambu Lab X2D', type: 'mt-printer', manufacturer: 'Bambu Lab', model: 'X2D', usageHours: 268, hourlyCost: 0.25, location: 'l-room' },
      { ref: 'm-z1', name: 'Makera Z1', type: 'mt-cnc', manufacturer: 'Makera', model: 'Z1', usageHours: 96, hourlyCost: 0.5, location: 'l-cnc' },
      { ref: 'm-sander', name: 'Hozo NeoSander', type: 'mt-finishing', manufacturer: 'Hozo Design', model: 'NeoSander', usageHours: 31, location: 'l-finishing' },
      { ref: 'm-bench', name: 'Hand tools and general workshop equipment', type: 'mt-general', location: 'l-bench', notes: 'Use this for assembly and hand-finishing jobs.' },
    ],
    items,
    subUnits: [
      {
        ref: 'su-ams2-1', name: 'AMS 2 Pro #1', kind: 'AMS 2 Pro', machine: 'm-h2d', statusNote: 'Idle',
        readings: [{ label: 'Humidity', value: '14', unit: '%' }, { label: 'Temperature', value: '24', unit: '°C' }],
        slots: [{ position: 1, item: 'i-pla-black' }, { position: 2, item: 'i-pla-white' }, { position: 3, item: 'i-petg-orange' }, { position: 4 }],
      },
      {
        ref: 'su-ams2-2', name: 'AMS 2 Pro #2', kind: 'AMS 2 Pro', machine: 'm-h2d', statusNote: 'Drying at 65 °C, about 3 h left',
        readings: [{ label: 'Humidity', value: '31', unit: '%' }, { label: 'Temperature', value: '63', unit: '°C' }],
        slots: [{ position: 1, item: 'i-abs-black' }, { position: 2, item: 'i-asa-grey' }, { position: 3 }, { position: 4 }],
      },
      {
        ref: 'su-ams2-3', name: 'AMS 2 Pro #3', kind: 'AMS 2 Pro', machine: 'm-x2d', statusNote: 'Idle',
        readings: [{ label: 'Humidity', value: '18', unit: '%' }, { label: 'Temperature', value: '23', unit: '°C' }],
        slots: [{ position: 1, item: 'i-pla-matte' }, { position: 2, item: 'i-pla-silk' }, { position: 3, item: 'i-support' }, { position: 4 }],
      },
      {
        ref: 'su-amsht-1', name: 'AMS HT #1', kind: 'AMS HT', machine: 'm-h2d', statusNote: 'Holding at 80 °C',
        readings: [{ label: 'Humidity', value: '8', unit: '%' }, { label: 'Temperature', value: '80', unit: '°C' }],
        slots: [{ position: 1, item: 'i-pacf' }],
      },
      {
        ref: 'su-amsht-2', name: 'AMS HT #2', kind: 'AMS HT', machine: 'm-x2d', statusNote: 'Idle',
        readings: [{ label: 'Humidity', value: '12', unit: '%' }, { label: 'Temperature', value: '25', unit: '°C' }],
        slots: [{ position: 1, item: 'i-tpu-black' }],
      },
      {
        ref: 'su-ams-1', name: 'AMS (original)', kind: 'AMS', machine: 'm-x2d', statusNote: 'Desiccant due a change',
        readings: [{ label: 'Humidity', value: '38', unit: '%' }],
        slots: [{ position: 1, item: 'i-petg-blue' }, { position: 2 }, { position: 3 }, { position: 4 }],
      },
      { ref: 'su-laser', name: '40 W laser module', kind: 'Laser module', machine: 'm-h2d', statusNote: 'Stored in dock', readings: [], slots: [] },
    ],
    maintenanceTasks: [
      {
        ...tasks.printer[0],
        logs: [
          { machine: 'm-h2d', performedAt: daysAgo(40), hoursAtService: 300, notes: 'Rails cleaned, light oil.' },
          { machine: 'm-x2d', performedAt: daysAgo(101), hoursAtService: 150, notes: '' },
        ],
      },
      {
        ...tasks.printer[1],
        logs: [
          { machine: 'm-h2d', performedAt: daysAgo(52), hoursAtService: 280, notes: 'Tension within spec.' },
          { machine: 'm-x2d', performedAt: daysAgo(20), hoursAtService: 230, notes: '' },
        ],
      },
      {
        ...tasks.printer[2],
        logs: [
          { machine: 'm-h2d', performedAt: daysAgo(70), hoursAtService: 190, notes: 'Swapped to new 0.4 hardened nozzle after PA-CF run.' },
          { machine: 'm-x2d', performedAt: daysAgo(30), hoursAtService: 200, notes: 'Nozzle fine.' },
        ],
      },
      {
        ...tasks.printer[3],
        logs: [
          { machine: 'm-h2d', performedAt: daysAgo(30), hoursAtService: 330, notes: '' },
          { machine: 'm-x2d', performedAt: daysAgo(112), hoursAtService: 140, notes: 'Replaced one worn tube from AMS hub.' },
        ],
      },
      {
        ref: 'mt-h2d-optics', name: 'Clean laser optics and lens window', machine: 'm-h2d', intervalDays: 14,
        description: 'Lens tissue and approved cleaner only. Replace the protective window if marked.',
        logs: [{ machine: 'm-h2d', performedAt: daysAgo(19), hoursAtService: 395, notes: 'Light residue removed.' }],
      },
      {
        ref: 'mt-h2d-filter', name: 'Replace extraction filter', machine: 'm-h2d', intervalDays: 180, intervalHours: 100,
        description: 'Swap the cartridge and check the duct seal.',
        logs: [{ machine: 'm-h2d', performedAt: daysAgo(60), hoursAtService: 322, notes: 'New cartridge fitted.' }],
      },
      { ...tasks.cnc[0], logs: [{ machine: 'm-z1', performedAt: daysAgo(25), hoursAtService: 52, notes: 'Collet clean, no scoring.' }] },
      { ...tasks.cnc[1], logs: [{ machine: 'm-z1', performedAt: daysAgo(90), hoursAtService: 20, notes: 'Runout 0.01 mm.' }] },
      { ...tasks.cnc[2], logs: [{ machine: 'm-z1', performedAt: daysAgo(12), hoursAtService: 88, notes: '' }] },
      { ...tasks.finishing[0], logs: [{ machine: 'm-sander', performedAt: daysAgo(6), hoursAtService: 28, notes: '240 grit fitted.' }] },
      { ...tasks.finishing[1], logs: [{ machine: 'm-sander', performedAt: daysAgo(9), hoursAtService: 27, notes: '' }] },
      { ...tasks.general[0], logs: [{ machine: 'm-bench', performedAt: daysAgo(150), hoursAtService: 0, notes: 'All tools present. Calipers checked against gauge block.' }] },
    ],
    projects: [
      { ref: 'p-enclosure', name: 'Printer enclosure', customer: 'Riverside Makers', notes: 'Panels printed, then sanded and primed. Not priced yet.', createdAt: daysAgo(10) },
      { ref: 'p-bracket', name: 'Motor bracket batch', customer: 'Northfield Robotics', stage: 'invoiced', price: 12, createdAt: daysAgo(7) },
      { ref: 'p-storage', name: 'Workshop storage', notes: 'For our own shelves.', createdAt: daysAgo(5) },
    ],
    jobs: [
      { ...finishedJob('Enclosure panels', 'm-h2d', 0.35, 6.5, 9, [['i-petg-orange', 310]], 'PETG HF, 0.2 mm layers.'), project: 'p-enclosure' },
      { ...finishedJob('Aluminium motor bracket', 'm-z1', 0.5, 1.8, 6, [['i-em-6o', 0, 1.8], ['i-em-3175', 0, 0.4]], '6061, two setups.'), project: 'p-bracket' },
      { ...finishedJob('Laser-cut storage box', 'm-h2d', 0.35, 0.6, 4, [['i-ply3', 2]], 'Finger joints, 3 mm birch.'), project: 'p-storage' },
      { ...finishedJob('Sand and prime enclosure', 'm-sander', 0, 0.8, 3, [['i-disc-240', 2], ['i-primer', 60]]), project: 'p-enclosure' },
      {
        name: 'Drawer organiser set', machine: 'm-x2d', project: 'p-storage', status: 'planned', durationHours: 9,
        notes: 'Uses the matte charcoal - check there is enough on the spool first.',
        usages: [{ item: 'i-pla-matte', quantity: 420 }, { item: 'i-m3ins', quantity: 8 }],
      },
    ],
  };
}
