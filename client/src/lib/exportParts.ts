/*
 * The parts of a workspace that can be picked for an export, and what each one needs so the file still
 * imports whole. Keep in step with EXPORT_PARTS and PART_NEEDS in server/src/services/snapshot.ts;
 * the server adds anything missing, so a mismatch only makes the ticks misleading.
 */

export const EXPORT_PARTS = ['categories', 'units', 'suppliers', 'locations', 'machines', 'inventory', 'maintenance', 'jobs'] as const;
export type ExportPart = (typeof EXPORT_PARTS)[number];

export const EXPORT_PART_INFO: Record<ExportPart, { label: string; detail: string; needs: ExportPart[] }> = {
  categories: { label: 'Categories and fields', detail: 'Item categories with their custom fields.', needs: ['units'] },
  units: { label: 'Units', detail: 'Units of measure.', needs: [] },
  suppliers: { label: 'Suppliers', detail: 'Names, websites and contact details.', needs: [] },
  locations: { label: 'Locations', detail: 'Rooms, shelves and bins.', needs: [] },
  machines: { label: 'Machines', detail: 'Machine types, machines and their material slots.', needs: ['locations'] },
  inventory: { label: 'Inventory', detail: 'Every item in stock, with quantities and tags.', needs: ['categories', 'units', 'suppliers', 'locations'] },
  maintenance: { label: 'Maintenance', detail: 'Tasks and service history.', needs: ['machines'] },
  jobs: { label: 'Jobs', detail: 'Job history with material use and costs.', needs: ['machines', 'inventory'] },
};

/** The part and everything it needs, directly or through another part. */
function withNeeds(part: ExportPart, into = new Set<ExportPart>()): Set<ExportPart> {
  if (into.has(part)) return into;
  into.add(part);
  for (const need of EXPORT_PART_INFO[part].needs) withNeeds(need, into);
  return into;
}

/** Tick or untick a part. Ticking brings what it needs; unticking also unticks whatever needs it. */
export function toggleExportPart(chosen: ReadonlySet<ExportPart>, part: ExportPart, on: boolean): Set<ExportPart> {
  const next = new Set(chosen);
  if (on) {
    for (const needed of withNeeds(part)) next.add(needed);
  } else {
    for (const other of EXPORT_PARTS) if (withNeeds(other).has(part)) next.delete(other);
  }
  return next;
}

/** The ticked parts that another ticked part needs, for saying why. */
export function neededBy(chosen: ReadonlySet<ExportPart>, part: ExportPart): ExportPart[] {
  return EXPORT_PARTS.filter((other) => other !== part && chosen.has(other) && withNeeds(other).has(part));
}

/** Links between inventory and machines that a choice leaves out, since neither part needs the other. */
export function droppedLinks(chosen: ReadonlySet<ExportPart>): string[] {
  const inventory = chosen.has('inventory');
  const machines = chosen.has('machines');
  if (inventory && !machines) return ['Items will not say which machines they fit, because machines are left out.'];
  if (machines && !inventory) return ['Material slots will be empty, because inventory is left out.'];
  return [];
}
