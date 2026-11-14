import { snapshotSchema, type Snapshot, type SnapshotInput } from '@/services/snapshot';
import { buildExample } from '@/templates/example';
import { itemTypes, machineTypes, tasks, units } from '@/templates/library';

interface TemplateDefinition {
  id: string;
  name: string;
  description: string;
  /** Lucide icon name. */
  icon: string;
  /** True when the template brings machines and inventory, not just configuration. */
  sampleData: boolean;
  build(): SnapshotInput;
}

const definitions: TemplateDefinition[] = [
  {
    id: 'printing',
    name: '3D printing',
    description: 'Filament by weight, resin, nozzles and spares, printer maintenance schedules.',
    icon: 'Printer',
    sampleData: false,
    build: () => ({
      units: [units.g, units.pcs, units.m, units.ml],
      itemTypes: [itemTypes.filament, itemTypes.spare, itemTypes.fixing, itemTypes.consumable, itemTypes.handTool],
      machineTypes: [machineTypes.printer, machineTypes.resin, machineTypes.general],
      maintenanceTasks: [...tasks.printer, ...tasks.resin, ...tasks.general],
    }),
  },
  {
    id: 'cnc',
    name: 'CNC machining',
    description: 'Endmills with tool-life hours, bar and block stock, collet and spindle checks.',
    icon: 'Drill',
    sampleData: false,
    build: () => ({
      units: [units.pcs, units.m, units.ml],
      itemTypes: [itemTypes.endmill, itemTypes.stock, itemTypes.sheet, itemTypes.spare, itemTypes.fixing, itemTypes.consumable, itemTypes.handTool],
      machineTypes: [machineTypes.cnc, machineTypes.general],
      maintenanceTasks: [...tasks.cnc, ...tasks.general],
    }),
  },
  {
    id: 'laser',
    name: 'Laser cutting',
    description: 'Sheet stock with searchable offcuts, optics and extraction filter schedules.',
    icon: 'Zap',
    sampleData: false,
    build: () => ({
      units: [units.sheets, units.pcs, units.ml],
      itemTypes: [itemTypes.sheet, itemTypes.spare, itemTypes.consumable, itemTypes.finishing],
      machineTypes: [machineTypes.laser, machineTypes.air, machineTypes.general],
      maintenanceTasks: [...tasks.laser, ...tasks.air, ...tasks.general],
    }),
  },
  {
    id: 'mixed',
    name: 'Mixed workshop',
    description: 'Printing, CNC, laser and finishing together, with every starter category.',
    icon: 'Wrench',
    sampleData: false,
    build: () => ({
      units: Object.values(units),
      itemTypes: [
        itemTypes.filament, itemTypes.endmill, itemTypes.sheet, itemTypes.stock, itemTypes.spare,
        itemTypes.fixing, itemTypes.finishing, itemTypes.consumable, itemTypes.handTool,
      ],
      // Listed explicitly so new library types are a deliberate choice here, not a side effect.
      machineTypes: [
        machineTypes.printer, machineTypes.resin, machineTypes.cnc, machineTypes.laser, machineTypes.vinyl,
        machineTypes.finishing, machineTypes.air, machineTypes.general,
      ],
      maintenanceTasks: [
        ...tasks.printer, ...tasks.resin, ...tasks.cnc, ...tasks.laser, ...tasks.vinyl,
        ...tasks.finishing, ...tasks.air, ...tasks.general,
      ],
    }),
  },
  {
    id: 'school-lab',
    name: 'School lab',
    description: 'Class kits, safety equipment and shared machines, set up for staff editors and student viewers.',
    icon: 'GraduationCap',
    sampleData: false,
    build: () => ({
      units: [units.pcs, units.g, units.sheets, units.ml],
      itemTypes: [
        itemTypes.classKit, itemTypes.safety, itemTypes.filament, itemTypes.sheet,
        itemTypes.fixing, itemTypes.consumable, itemTypes.handTool, itemTypes.spare,
      ],
      machineTypes: [machineTypes.printer, machineTypes.laser, machineTypes.vinyl, machineTypes.general],
      locations: [
        { ref: 'l-lab', name: 'Design lab', kind: 'Room' },
        { ref: 'l-prep', name: 'Prep room', kind: 'Room' },
        { ref: 'l-store', name: 'Locked store', kind: 'Cupboard', parent: 'l-prep' },
      ],
      maintenanceTasks: [
        ...tasks.printer,
        ...tasks.laser,
        ...tasks.vinyl,
        { ref: 'mt-s-safety', name: 'Termly safety inspection', machineType: 'mt-general', intervalDays: 90, description: 'Guards, emergency stops, extraction, PPE stock and signage.' },
        { ref: 'mt-s-audit', name: 'Tool count after class sets', machineType: 'mt-general', intervalDays: 7, description: 'Count shared tools back into their trays.' },
      ],
    }),
  },
  {
    id: 'example',
    name: 'Example maker space',
    description: 'A fully populated sample: two printers with AMS units, a desktop CNC, laser module, sander and stocked shelves.',
    icon: 'Sparkles',
    sampleData: true,
    build: buildExample,
  },
];

const count = (snapshot: Snapshot) => ({
  itemTypes: snapshot.itemTypes.length,
  machineTypes: snapshot.machineTypes.length,
  maintenanceTasks: snapshot.maintenanceTasks.length,
  machines: snapshot.machines.length,
  items: snapshot.items.length,
});

export function listTemplates() {
  return definitions.map(({ build, ...meta }) => ({ ...meta, counts: count(snapshotSchema.parse(build())) }));
}

export function getTemplate(id: string) {
  const definition = definitions.find((d) => d.id === id);
  if (!definition) return null;
  const { build, ...meta } = definition;
  return { ...meta, snapshot: snapshotSchema.parse(build()) };
}
