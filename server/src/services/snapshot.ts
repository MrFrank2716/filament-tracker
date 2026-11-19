import { z } from 'zod';
import type { Db, Json } from '@/db';
import { TAG_PATTERN, tagIsFree } from '@/services/tags';

/**
 * A snapshot is a portable description of a workspace. The same format powers
 * JSON export/import, workspace templates and the seeded example environment.
 * Rows point at each other with `ref` strings instead of database ids.
 *
 * An export uses each row's id as its `ref`. Importing gives items and locations that same id back when
 * nothing else holds it, because printed QR labels and written NFC stickers carry it: a restore into an
 * emptied database then leaves every label working.
 */

export const FIELD_TYPES = ['text', 'number', 'select', 'boolean', 'color', 'date'] as const;
export const MACHINE_STATUSES = ['ready', 'in_use', 'needs_service', 'offline'] as const;
export const JOB_STATUSES = ['planned', 'in_progress', 'completed', 'failed', 'cancelled'] as const;
export const PROJECT_STAGES = ['open', 'invoiced', 'paid'] as const;

const ref = z.string().min(1);
const optRef = ref.nullish();
const text = z.string().default('');
const fieldValue = z.union([z.string(), z.number(), z.boolean(), z.null()]);

export const readingSchema = z.object({
  label: z.string().trim().min(1).max(60),
  value: z.string().trim().max(60),
  unit: z.string().trim().max(20).default(''),
});

export const customFieldSchema = z.object({
  key: z.string().trim().min(1).max(60),
  label: z.string().trim().min(1).max(80),
  fieldType: z.enum(FIELD_TYPES),
  unit: z.string().trim().max(20).default(''),
  options: z.array(z.string().trim().min(1)).default([]),
  required: z.boolean().default(false),
  showInList: z.boolean().default(true),
  isSizeDimension: z.boolean().default(false),
});

export const snapshotSchema = z.object({
  version: z.literal(1).default(1),
  workspace: z.object({ name: text, description: text, currency: z.string().default('GBP'), targetMargin: z.number().min(0).max(95).optional() }).optional(),
  units: z
    .array(z.object({ ref, name: z.string().min(1), symbol: z.string().min(1), decimals: z.number().int().min(0).max(4).default(0) }))
    .default([]),
  suppliers: z.array(z.object({ ref, name: z.string().min(1), website: text, email: text, notes: text })).default([]),
  locations: z
    .array(z.object({ ref, name: z.string().min(1), kind: text, code: text, parent: optRef }))
    .default([]),
  itemTypes: z
    .array(
      z.object({
        ref,
        name: z.string().min(1),
        icon: z.string().default('Package'),
        color: z.string().default('slate'),
        defaultUnit: optRef,
        tracksLife: z.boolean().default(false),
        fields: z.array(customFieldSchema).default([]),
      }),
    )
    .default([]),
  machineTypes: z.array(z.object({ ref, name: z.string().min(1), icon: z.string().default('Cog') })).default([]),
  machines: z
    .array(
      z.object({
        ref,
        name: z.string().min(1),
        type: optRef,
        manufacturer: text,
        model: text,
        serial: text,
        status: z.enum(MACHINE_STATUSES).default('ready'),
        usageHours: z.number().min(0).default(0),
        hourlyCost: z.number().min(0).default(0),
        location: optRef,
        notes: text,
        specs: z.array(readingSchema).max(12).default([]),
      }),
    )
    .default([]),
  items: z
    .array(
      z.object({
        ref,
        type: ref,
        name: z.string().min(1),
        sku: text,
        quantity: z.number().min(0).default(0),
        capacity: z.number().positive().nullish(),
        minQuantity: z.number().min(0).default(0),
        unitCost: z.number().min(0).default(0),
        unit: optRef,
        supplier: optRef,
        location: optRef,
        notes: text,
        fields: z.record(z.string(), fieldValue).default({}),
        usageHours: z.number().min(0).default(0),
        lifeHours: z.number().positive().nullish(),
        wearFlag: z.boolean().default(false),
        isRemnant: z.boolean().default(false),
        parent: optRef,
        tagId: z.string().regex(TAG_PATTERN).nullish(),
        compatibleMachines: z.array(ref).default([]),
      }),
    )
    .default([]),
  subUnits: z
    .array(
      z.object({
        ref,
        name: z.string().min(1),
        kind: text,
        machine: optRef,
        readings: z.array(readingSchema).default([]),
        statusNote: text,
        slots: z.array(z.object({ position: z.number().int().min(1), label: text, item: optRef })).default([]),
      }),
    )
    .default([]),
  maintenanceTasks: z
    .array(
      z.object({
        ref,
        name: z.string().min(1),
        description: text,
        machine: optRef,
        machineType: optRef,
        intervalDays: z.number().positive().nullish(),
        intervalHours: z.number().positive().nullish(),
        active: z.boolean().default(true),
        logs: z
          .array(z.object({ machine: ref, performedAt: z.string(), hoursAtService: z.number().min(0).default(0), notes: text }))
          .default([]),
      }),
    )
    .default([]),
  projects: z
    .array(
      z.object({
        ref,
        name: z.string().min(1),
        customer: text,
        notes: text,
        stage: z.enum(PROJECT_STAGES).default('open'),
        price: z.number().min(0).nullish(),
        marginPercent: z.number().min(0).max(95).nullish(),
        createdAt: z.string().optional(),
      }),
    )
    .default([]),
  jobs: z
    .array(
      z.object({
        name: z.string().min(1),
        machine: optRef,
        project: optRef,
        status: z.enum(JOB_STATUSES).default('planned'),
        durationHours: z.number().min(0).default(0),
        notes: text,
        extraCost: z.number().min(0).default(0),
        materialCost: z.number().min(0).default(0),
        toolingCost: z.number().min(0).default(0),
        machineCost: z.number().min(0).default(0),
        totalCost: z.number().min(0).default(0),
        createdAt: z.string().optional(),
        completedAt: z.string().nullish(),
        usages: z
          .array(z.object({ item: ref, quantity: z.number().min(0).default(0), hours: z.number().min(0).default(0), cost: z.number().min(0).default(0) }))
          .default([]),
      }),
    )
    .default([]),
});

export type Snapshot = z.output<typeof snapshotSchema>;
export type SnapshotInput = z.input<typeof snapshotSchema>;

export interface ImportSummary {
  units: number;
  suppliers: number;
  locations: number;
  itemTypes: number;
  machineTypes: number;
  machines: number;
  items: number;
  subUnits: number;
  maintenanceTasks: number;
  projects: number;
  jobs: number;
}

const toDate = (value: string | null | undefined): Date | undefined => {
  if (!value) return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
};

/**
 * Merge a snapshot into a workspace. Definitions with a natural key (units by symbol,
 * suppliers / types / machines by name) are reused when they already exist, so importing
 * twice does not duplicate configuration. Items and jobs are always added.
 * References that cannot be resolved are dropped rather than failing the whole import.
 */
export async function importSnapshot(db: Db, workspaceId: string, snapshot: Snapshot, userId: string | null): Promise<ImportSummary> {
  const summary: ImportSummary = {
    units: 0, suppliers: 0, locations: 0, itemTypes: 0, machineTypes: 0,
    machines: 0, items: 0, subUnits: 0, maintenanceTasks: 0, projects: 0, jobs: 0,
  };
  const ids = {
    unit: new Map<string, string>(),
    supplier: new Map<string, string>(),
    location: new Map<string, string>(),
    itemType: new Map<string, string>(),
    machineType: new Map<string, string>(),
    machine: new Map<string, string>(),
    item: new Map<string, string>(),
    project: new Map<string, string>(),
  };
  const lookup = (map: Map<string, string>, key: string | null | undefined) => (key ? (map.get(key) ?? null) : null);
  /** A ref that is a database id nobody holds can be the new row's id; a template's "shelf-a" cannot. */
  const looksLikeId = (value: string) => /^c[a-z0-9]{20,31}$/.test(value);

  // Units
  const existingUnits = await db.unit.findMany({ where: { workspaceId } });
  for (const unit of snapshot.units) {
    const found = existingUnits.find((u) => u.symbol.toLowerCase() === unit.symbol.toLowerCase());
    if (found) {
      ids.unit.set(unit.ref, found.id);
      continue;
    }
    const created = await db.unit.create({ data: { workspaceId, name: unit.name, symbol: unit.symbol, decimals: unit.decimals } });
    existingUnits.push(created);
    ids.unit.set(unit.ref, created.id);
    summary.units++;
  }

  // Suppliers
  const existingSuppliers = await db.supplier.findMany({ where: { workspaceId } });
  for (const supplier of snapshot.suppliers) {
    const found = existingSuppliers.find((s) => s.name.toLowerCase() === supplier.name.toLowerCase());
    if (found) {
      ids.supplier.set(supplier.ref, found.id);
      continue;
    }
    const { ref: supplierRef, ...data } = supplier;
    const created = await db.supplier.create({ data: { workspaceId, ...data } });
    existingSuppliers.push(created);
    ids.supplier.set(supplierRef, created.id);
    summary.suppliers++;
  }

  // Locations: parents may appear after children, so resolve in passes.
  const existingLocations = await db.location.findMany({ where: { workspaceId } });
  let pending = [...snapshot.locations];
  while (pending.length) {
    const next: typeof pending = [];
    let progressed = false;
    for (const location of pending) {
      const parentKnown = !location.parent || ids.location.has(location.parent);
      const parentExists = !location.parent || snapshot.locations.some((l) => l.ref === location.parent);
      if (!parentKnown && parentExists) {
        next.push(location);
        continue;
      }
      const parentId = lookup(ids.location, location.parent);
      const found = existingLocations.find((l) => l.name.toLowerCase() === location.name.toLowerCase() && l.parentId === parentId);
      if (found) {
        ids.location.set(location.ref, found.id);
      } else {
        const keepId = looksLikeId(location.ref) && !(await db.location.findUnique({ where: { id: location.ref }, select: { id: true } }));
        const created = await db.location.create({
          data: { ...(keepId ? { id: location.ref } : {}), workspaceId, name: location.name, kind: location.kind, code: location.code, parentId },
        });
        existingLocations.push(created);
        ids.location.set(location.ref, created.id);
        summary.locations++;
      }
      progressed = true;
    }
    if (!progressed) break; // circular parents: leave the rest out
    pending = next;
  }

  // Item types and their custom fields
  const existingTypes = await db.itemType.findMany({ where: { workspaceId }, include: { fields: true } });
  let typeOrder = existingTypes.length;
  for (const type of snapshot.itemTypes) {
    const found = existingTypes.find((t) => t.name.toLowerCase() === type.name.toLowerCase());
    let typeId: string;
    let knownKeys: string[] = [];
    if (found) {
      typeId = found.id;
      knownKeys = found.fields.map((f) => f.key);
    } else {
      const created = await db.itemType.create({
        data: {
          workspaceId,
          name: type.name,
          icon: type.icon,
          color: type.color,
          tracksLife: type.tracksLife,
          defaultUnitId: lookup(ids.unit, type.defaultUnit),
          sortOrder: typeOrder++,
        },
      });
      typeId = created.id;
      existingTypes.push({ ...created, fields: [] });
      summary.itemTypes++;
    }
    ids.itemType.set(type.ref, typeId);
    let fieldOrder = knownKeys.length;
    for (const field of type.fields) {
      if (knownKeys.includes(field.key)) continue;
      knownKeys.push(field.key);
      await db.customField.create({
        data: { itemTypeId: typeId, ...field, options: field.options as Json, sortOrder: fieldOrder++ },
      });
    }
  }

  // Machine types
  const existingMachineTypes = await db.machineType.findMany({ where: { workspaceId } });
  for (const type of snapshot.machineTypes) {
    const found = existingMachineTypes.find((t) => t.name.toLowerCase() === type.name.toLowerCase());
    if (found) {
      ids.machineType.set(type.ref, found.id);
      continue;
    }
    const created = await db.machineType.create({ data: { workspaceId, name: type.name, icon: type.icon } });
    existingMachineTypes.push(created);
    ids.machineType.set(type.ref, created.id);
    summary.machineTypes++;
  }

  // Machines
  const existingMachines = await db.machine.findMany({ where: { workspaceId } });
  for (const machine of snapshot.machines) {
    const found = existingMachines.find((m) => m.name.toLowerCase() === machine.name.toLowerCase());
    if (found) {
      ids.machine.set(machine.ref, found.id);
      continue;
    }
    const { ref: machineRef, type, location, specs, ...data } = machine;
    const created = await db.machine.create({
      data: {
        workspaceId,
        ...data,
        specs: specs as Json,
        machineTypeId: lookup(ids.machineType, type),
        locationId: lookup(ids.location, location),
      },
    });
    existingMachines.push(created);
    ids.machine.set(machineRef, created.id);
    summary.machines++;
  }

  // Items (parents first so offcuts can point at their source sheet)
  const orderedItems = [...snapshot.items].sort((a, b) => Number(Boolean(a.parent)) - Number(Boolean(b.parent)));
  for (const item of orderedItems) {
    const itemTypeId = lookup(ids.itemType, item.type);
    if (!itemTypeId) continue;
    const machineIds = item.compatibleMachines.map((m) => ids.machine.get(m)).filter((id): id is string => Boolean(id));
    const keepId = looksLikeId(item.ref) && !(await db.item.findUnique({ where: { id: item.ref }, select: { id: true } }));
    // A tag already on an item here stays with it: the spool in stock is the one known to carry it.
    const tagId = item.tagId && (await tagIsFree(db, workspaceId, item.tagId)) ? item.tagId : null;
    const created = await db.item.create({
      data: {
        ...(keepId ? { id: item.ref } : {}),
        workspaceId,
        itemTypeId,
        tagId,
        name: item.name,
        sku: item.sku,
        quantity: item.quantity,
        capacity: item.capacity ?? null,
        minQuantity: item.minQuantity,
        unitCost: item.unitCost,
        unitId: lookup(ids.unit, item.unit),
        supplierId: lookup(ids.supplier, item.supplier),
        locationId: lookup(ids.location, item.location),
        notes: item.notes,
        fields: item.fields as Json,
        usageHours: item.usageHours,
        lifeHours: item.lifeHours ?? null,
        wearFlag: item.wearFlag,
        isRemnant: item.isRemnant,
        parentId: lookup(ids.item, item.parent),
        compatibleMachines: { connect: machineIds.map((id) => ({ id })) },
      },
    });
    ids.item.set(item.ref, created.id);
    summary.items++;
    if (item.quantity > 0) {
      await db.stockMovement.create({
        data: { workspaceId, itemId: created.id, delta: item.quantity, balanceAfter: item.quantity, reason: 'import', userId },
      });
    }
  }

  // Sub-units and slots
  for (const subUnit of snapshot.subUnits) {
    const created = await db.subUnit.create({
      data: {
        workspaceId,
        name: subUnit.name,
        kind: subUnit.kind,
        machineId: lookup(ids.machine, subUnit.machine),
        readings: subUnit.readings as Json,
        statusNote: subUnit.statusNote,
      },
    });
    summary.subUnits++;
    const seen = new Set<number>();
    for (const slot of subUnit.slots) {
      if (seen.has(slot.position)) continue;
      seen.add(slot.position);
      let itemId = lookup(ids.item, slot.item);
      if (itemId && (await db.slot.findUnique({ where: { itemId } }))) itemId = null; // an item can only sit in one slot
      await db.slot.create({ data: { subUnitId: created.id, position: slot.position, label: slot.label, itemId } });
    }
  }

  // Maintenance tasks and service history
  const existingTasks = await db.maintenanceTask.findMany({ where: { workspaceId } });
  for (const task of snapshot.maintenanceTasks) {
    const machineId = lookup(ids.machine, task.machine);
    const machineTypeId = machineId ? null : lookup(ids.machineType, task.machineType);
    if (!machineId && !machineTypeId) continue;
    if (!task.intervalDays && !task.intervalHours) continue;
    const duplicate = existingTasks.find(
      (t) => t.name.toLowerCase() === task.name.toLowerCase() && t.machineId === machineId && t.machineTypeId === machineTypeId,
    );
    if (duplicate) continue;
    const created = await db.maintenanceTask.create({
      data: {
        workspaceId,
        name: task.name,
        description: task.description,
        machineId,
        machineTypeId,
        intervalDays: task.intervalDays ?? null,
        intervalHours: task.intervalHours ?? null,
        active: task.active,
      },
    });
    existingTasks.push(created);
    summary.maintenanceTasks++;
    for (const log of task.logs) {
      const logMachineId = lookup(ids.machine, log.machine);
      if (!logMachineId) continue;
      await db.maintenanceLog.create({
        data: {
          taskId: created.id,
          machineId: logMachineId,
          performedAt: toDate(log.performedAt) ?? new Date(),
          hoursAtService: log.hoursAtService,
          notes: log.notes,
          userId,
        },
      });
    }
  }

  // Projects are always added, like the jobs that belong to them. One that relied on its old workspace's target
  // margin takes that margin as its own when this workspace's differs, so it recommends the same price as before.
  // This workspace's own setting is left alone: an import merges, and its existing projects depend on it.
  const sourceMargin = snapshot.workspace?.targetMargin;
  const inheritedMargin =
    sourceMargin !== undefined && snapshot.projects.length > 0 && sourceMargin !== (await db.workspace.findUniqueOrThrow({ where: { id: workspaceId }, select: { targetMargin: true } })).targetMargin
      ? sourceMargin
      : null;
  for (const project of snapshot.projects) {
    const { ref: projectRef, createdAt, price, marginPercent, ...data } = project;
    // A project past "open" always has a price; one that lost it comes back as open.
    const stage = price == null ? 'open' : data.stage;
    const created = await db.project.create({
      data: { workspaceId, ...data, stage, price: price ?? null, marginPercent: marginPercent ?? inheritedMargin, createdAt: toDate(createdAt) },
    });
    ids.project.set(projectRef, created.id);
    summary.projects++;
  }

  // Jobs are imported as history: they never touch stock again.
  for (const job of snapshot.jobs) {
    const { machine, project, usages, createdAt, completedAt, ...data } = job;
    const lines = usages
      .map((u) => ({ itemId: ids.item.get(u.item), quantity: u.quantity, hours: u.hours, cost: u.cost }))
      .filter((u): u is { itemId: string; quantity: number; hours: number; cost: number } => Boolean(u.itemId));
    await db.job.create({
      data: {
        workspaceId,
        ...data,
        machineId: lookup(ids.machine, machine),
        projectId: lookup(ids.project, project),
        createdById: userId,
        createdAt: toDate(createdAt),
        completedAt: toDate(completedAt) ?? null,
        usages: { create: lines },
      },
    });
    summary.jobs++;
  }

  return summary;
}

/** The parts of a workspace that can be picked for an export. Keep in step with client/src/lib/exportParts.ts. */
export const EXPORT_PARTS = ['categories', 'units', 'suppliers', 'locations', 'machines', 'inventory', 'maintenance', 'jobs'] as const;
export type ExportPart = (typeof EXPORT_PARTS)[number];

/** What each part points at. Without these the import would drop the rows, or their links. */
const PART_NEEDS: Record<ExportPart, ExportPart[]> = {
  units: [],
  suppliers: [],
  locations: [],
  categories: ['units'],
  machines: ['locations'],
  inventory: ['categories', 'units', 'suppliers', 'locations'],
  maintenance: ['machines'],
  jobs: ['machines', 'inventory'],
};

/** The chosen parts plus everything they need, so a partial file still imports whole. */
export function withRequiredParts(parts: Iterable<ExportPart>): Set<ExportPart> {
  const all = new Set<ExportPart>();
  const add = (part: ExportPart) => {
    if (all.has(part)) return;
    all.add(part);
    PART_NEEDS[part].forEach(add);
  };
  for (const part of parts) add(part);
  return all;
}

/**
 * Everything, or only the given parts (and what they need). Parts left out come back as empty sections.
 * Inventory and machines link to each other only loosely (which machines an item fits, what sits in a slot);
 * with one of them left out those links are cleared rather than pulling the other in.
 */
export async function exportSnapshot(db: Db, workspaceId: string, parts?: Iterable<ExportPart>): Promise<Snapshot> {
  const workspace = await db.workspace.findUniqueOrThrow({ where: { id: workspaceId } });
  const want = withRequiredParts(parts ?? EXPORT_PARTS);
  const [units, suppliers, locations, itemTypes, machineTypes, machines, items, subUnits, tasks, projects, jobs] = await Promise.all([
    want.has('units') ? db.unit.findMany({ where: { workspaceId }, orderBy: { name: 'asc' } }) : [],
    want.has('suppliers') ? db.supplier.findMany({ where: { workspaceId }, orderBy: { name: 'asc' } }) : [],
    want.has('locations') ? db.location.findMany({ where: { workspaceId }, orderBy: { name: 'asc' } }) : [],
    want.has('categories')
      ? db.itemType.findMany({ where: { workspaceId }, orderBy: { sortOrder: 'asc' }, include: { fields: { orderBy: { sortOrder: 'asc' } } } })
      : [],
    want.has('machines') ? db.machineType.findMany({ where: { workspaceId }, orderBy: { name: 'asc' } }) : [],
    want.has('machines') ? db.machine.findMany({ where: { workspaceId }, orderBy: { createdAt: 'asc' } }) : [],
    want.has('inventory')
      ? db.item.findMany({ where: { workspaceId, archived: false }, orderBy: { createdAt: 'asc' }, include: { compatibleMachines: { select: { id: true } } } })
      : [],
    want.has('machines') ? db.subUnit.findMany({ where: { workspaceId }, include: { slots: { orderBy: { position: 'asc' } } } }) : [],
    want.has('maintenance') ? db.maintenanceTask.findMany({ where: { workspaceId }, include: { logs: { orderBy: { performedAt: 'asc' } } } }) : [],
    // Projects only group jobs, so they travel with them.
    want.has('jobs') ? db.project.findMany({ where: { workspaceId }, orderBy: { createdAt: 'asc' } }) : [],
    want.has('jobs') ? db.job.findMany({ where: { workspaceId }, orderBy: { createdAt: 'asc' }, include: { usages: true } }) : [],
  ]);

  return snapshotSchema.parse({
    version: 1,
    workspace: { name: workspace.name, description: workspace.description, currency: workspace.currency, targetMargin: workspace.targetMargin },
    units: units.map((u) => ({ ref: u.id, name: u.name, symbol: u.symbol, decimals: u.decimals })),
    suppliers: suppliers.map((s) => ({ ref: s.id, name: s.name, website: s.website, email: s.email, notes: s.notes })),
    locations: locations.map((l) => ({ ref: l.id, name: l.name, kind: l.kind, code: l.code, parent: l.parentId })),
    itemTypes: itemTypes.map((t) => ({
      ref: t.id,
      name: t.name,
      icon: t.icon,
      color: t.color,
      defaultUnit: t.defaultUnitId,
      tracksLife: t.tracksLife,
      fields: t.fields.map((f) => ({
        key: f.key, label: f.label, fieldType: f.fieldType, unit: f.unit, options: f.options,
        required: f.required, showInList: f.showInList, isSizeDimension: f.isSizeDimension,
      })),
    })),
    machineTypes: machineTypes.map((t) => ({ ref: t.id, name: t.name, icon: t.icon })),
    machines: machines.map((m) => ({
      ref: m.id, name: m.name, type: m.machineTypeId, manufacturer: m.manufacturer, model: m.model, serial: m.serial,
      status: m.status, usageHours: m.usageHours, hourlyCost: m.hourlyCost, location: m.locationId, notes: m.notes,
      specs: m.specs,
    })),
    items: items.map((i) => ({
      ref: i.id, type: i.itemTypeId, name: i.name, sku: i.sku, quantity: i.quantity, capacity: i.capacity,
      minQuantity: i.minQuantity, unitCost: i.unitCost, unit: i.unitId, supplier: i.supplierId, location: i.locationId,
      notes: i.notes, fields: i.fields, usageHours: i.usageHours, lifeHours: i.lifeHours, wearFlag: i.wearFlag,
      isRemnant: i.isRemnant, parent: i.parentId, tagId: i.tagId,
      // Links into a part that was left out could not be restored, so the file does not claim them.
      compatibleMachines: want.has('machines') ? i.compatibleMachines.map((m) => m.id) : [],
    })),
    subUnits: subUnits.map((s) => ({
      ref: s.id, name: s.name, kind: s.kind, machine: s.machineId, readings: s.readings, statusNote: s.statusNote,
      slots: s.slots.map((slot) => ({ position: slot.position, label: slot.label, item: want.has('inventory') ? slot.itemId : null })),
    })),
    maintenanceTasks: tasks.map((t) => ({
      ref: t.id, name: t.name, description: t.description, machine: t.machineId, machineType: t.machineTypeId,
      intervalDays: t.intervalDays, intervalHours: t.intervalHours, active: t.active,
      logs: t.logs.map((l) => ({ machine: l.machineId, performedAt: l.performedAt.toISOString(), hoursAtService: l.hoursAtService, notes: l.notes })),
    })),
    projects: projects.map((p) => ({
      ref: p.id, name: p.name, customer: p.customer, notes: p.notes, stage: p.stage, price: p.price,
      marginPercent: p.marginPercent, createdAt: p.createdAt.toISOString(),
    })),
    jobs: jobs.map((j) => ({
      name: j.name, machine: j.machineId, project: j.projectId, status: j.status, durationHours: j.durationHours, notes: j.notes,
      extraCost: j.extraCost, materialCost: j.materialCost, toolingCost: j.toolingCost, machineCost: j.machineCost,
      totalCost: j.totalCost, createdAt: j.createdAt.toISOString(), completedAt: j.completedAt?.toISOString() ?? null,
      usages: j.usages.map((u) => ({ item: u.itemId, quantity: u.quantity, hours: u.hours, cost: u.cost })),
    })),
  });
}
