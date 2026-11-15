import type { CustomField } from '@prisma/client';
import { z } from 'zod';
import type { Db, Json } from '@/db';
import { HttpError } from '@/http';
import { getEntry, KIND_CATEGORY, type ItemKind } from '@/reference';
import type { FilamentLine, ReferenceEndmill, ReferenceFastener, ReferenceFinish, ReferenceMachine, ReferenceSheet } from '@/reference/types';
import { normalizeFields } from '@/routes/items';
import { importSnapshot, snapshotSchema } from '@/services/snapshot';
import { assertInWorkspace } from '@/services/stock';
import { machineTypes, tasks, units } from '@/templates/library';

/**
 * Adding catalogue entries to a workspace. Entries are copied in as ordinary rows; the workspace's
 * own categories are extended (missing fields, missing select options) so that what was added
 * can be edited and saved through the normal forms afterwards.
 */

type FieldValue = string | number | boolean | null;

// ---- Input -------------------------------------------------------------------------------------

const id = z.string().min(1).max(120);
const count = z.number().int().min(0).max(1000).default(0);

export const pickSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('machine'), id, attachments: z.array(z.string()).max(12).default([]) }),
  z.object({
    kind: z.literal('filament'), id,
    colours: z.array(z.string().min(1)).min(1).max(100),
    weight: z.number().positive(),
    diameter: z.number().positive(),
    /** Spools of each colour. Each spool is its own item, so it can sit in a feeder slot. */
    count: z.number().int().min(1).max(20).default(1),
  }),
  z.object({ kind: z.literal('endmill'), id, count }),
  z.object({
    kind: z.literal('fastener'), id,
    size: z.string().min(1),
    lengths: z.array(z.number().positive()).max(40).default([]),
    material: z.number().int().min(0).default(0),
    count,
  }),
  z.object({
    kind: z.literal('sheet'), id,
    thicknesses: z.array(z.number().positive()).min(1).max(20),
    width: z.number().positive().max(10_000),
    length: z.number().positive().max(10_000),
    count,
  }),
  z.object({ kind: z.literal('finish'), id, variants: z.array(z.string().min(1)).min(1).max(20), count }),
]);

export type Pick = z.output<typeof pickSchema>;

export const referenceAddInput = z.object({
  picks: z.array(pickSchema).min(1).max(50),
  /** Put items in this category instead of the one named like the starter category. */
  itemTypeId: z.string().nullish(),
  locationId: z.string().nullish(),
  /** Mark the items added as fitting these machines (a spool found in a printer fits that printer). */
  machineIds: z.array(z.string().min(1)).max(20).optional(),
});

export type ReferenceAddInput = z.output<typeof referenceAddInput>;

/** One request can add at most this many items, so a mis-click cannot flood a workspace. */
export const MAX_ITEMS = 300;

// ---- Turning entries into item drafts (pure, no database) -------------------------------------

export interface ItemDraft {
  name: string;
  unit: keyof typeof units;
  quantity: number;
  capacity: number | null;
  fields: Record<string, FieldValue>;
}

const lower = (value: string) => value.charAt(0).toLowerCase() + value.slice(1);
const fmt = (value: number) => String(Number(value.toFixed(3)));
const range = (span: [number, number] | undefined) => (span ? (span[0] === span[1] ? String(span[0]) : `${span[0]}-${span[1]}`) : null);

/** 12.7 mm -> 1/2", 25.4 -> 1", 31.75 -> 1-1/4" (to the nearest 1/16"). */
export function inchLabel(millimetres: number): string {
  const sixteenths = Math.round((millimetres / 25.4) * 16);
  const whole = Math.floor(sixteenths / 16);
  let numerator = sixteenths % 16;
  let denominator = 16;
  while (numerator && numerator % 2 === 0) {
    numerator /= 2;
    denominator /= 2;
  }
  const fraction = numerator ? `${numerator}/${denominator}` : '';
  return `${whole && fraction ? `${whole}-${fraction}` : whole || fraction || '0'}"`;
}

function filamentDrafts(line: FilamentLine, pick: Extract<Pick, { kind: 'filament' }>): ItemDraft[] {
  const weight = line.weights.find((w) => w.g === pick.weight);
  if (!weight) throw new HttpError(400, `${line.brand} ${line.name} does not come in ${pick.weight} g spools`);
  if (!line.diameters.includes(pick.diameter)) throw new HttpError(400, `${line.brand} ${line.name} does not come in ${pick.diameter} mm`);
  // Name the material when the line name does not already ("Budget" -> "Budget PETG").
  const label = line.name.toUpperCase().includes(line.materialCode.toUpperCase()) ? line.name : `${line.name} ${line.materialCode}`;
  return pick.colours.flatMap((colourName) => {
    const colour = line.colours.find(([name]) => name === colourName);
    if (!colour) throw new HttpError(400, `${line.brand} ${line.name} has no colour called ${colourName}`);
    const draft: ItemDraft = {
      name: `${line.brand} ${label} ${colour[0]}`,
      unit: 'g',
      quantity: weight.g,
      capacity: weight.g,
      fields: {
        material: line.material,
        colour: colour[1],
        colour_name: colour[0],
        brand: line.brand,
        diameter: pick.diameter,
        finish: line.finish ?? null,
        nozzle_temp: range(line.nozzle),
        bed_temp: range(line.bed),
        density: line.density,
        spool_weight: weight.spool ?? null,
      },
    };
    return Array.from({ length: pick.count }, () => ({ ...draft, fields: { ...draft.fields } }));
  });
}

function endmillDrafts(entry: ReferenceEndmill, pick: Extract<Pick, { kind: 'endmill' }>): ItemDraft[] {
  return [{
    name: entry.name,
    unit: 'pcs',
    quantity: pick.count,
    capacity: null,
    fields: {
      diameter: entry.diameter,
      flutes: entry.flutes,
      cut_type: entry.cutType,
      shank: entry.shank,
      rated_for: entry.ratedFor ?? null,
      coating: entry.coating ?? null,
      flute_length: entry.fluteLength ?? null,
      overall_length: entry.overallLength ?? null,
      angle: entry.angle ?? null,
      tool_material: entry.toolMaterial,
    },
  }];
}

function fastenerDrafts(entry: ReferenceFastener, pick: Extract<Pick, { kind: 'fastener' }>): ItemDraft[] {
  const size = entry.sizes.find((s) => s.size === pick.size);
  if (!size) throw new HttpError(400, `${entry.name} does not come in ${pick.size}`);
  const variant = entry.materials[pick.material];
  if (!variant) throw new HttpError(400, `Unknown material option for ${entry.name}`);
  const lengths = size.lengths.length ? pick.lengths : [];
  if (size.lengths.length && !lengths.length) throw new HttpError(400, `Choose at least one length of ${pick.size} ${lower(entry.name)}`);
  const bad = lengths.find((l) => !size.lengths.includes(l));
  if (bad !== undefined) throw new HttpError(400, `${pick.size} ${lower(entry.name)} is not listed in ${fmt(bad)} mm`);

  const finish = [entry.imperial ? '' : entry.standard, variant.grade ?? variant.material].filter(Boolean).join(', ');
  const fields = (length: number | null): Record<string, FieldValue> => ({
    kind: entry.kind,
    size: size.size,
    length,
    material: variant.material,
    head: entry.head ?? null,
    standard: entry.standard ?? null,
    thread_pitch: size.pitch ?? null,
    drive: entry.drive ?? null,
    grade: variant.grade ?? null,
  });
  const describe = (length: number | null) => {
    const sized = length === null ? size.size : `${size.size} × ${entry.imperial ? inchLabel(length) : `${fmt(length)} mm`}`;
    return `${sized} ${lower(entry.name)}${finish ? `, ${finish}` : ''}`;
  };
  const rows = lengths.length ? lengths : [null];
  return rows.map((length) => ({ name: describe(length), unit: 'pcs', quantity: pick.count, capacity: null, fields: fields(length) }));
}

function sheetDrafts(entry: ReferenceSheet, pick: Extract<Pick, { kind: 'sheet' }>): ItemDraft[] {
  const bad = pick.thicknesses.find((t) => !entry.thicknesses.includes(t));
  if (bad !== undefined) throw new HttpError(400, `${entry.name} is not listed in ${fmt(bad)} mm`);
  return pick.thicknesses.map((thickness) => ({
    name: `${entry.name}, ${fmt(thickness)} mm, ${fmt(pick.width)} × ${fmt(pick.length)}`,
    unit: 'sheets',
    quantity: pick.count,
    capacity: null,
    fields: { material: entry.material, thickness, width: pick.width, length: pick.length, finish: entry.finish ?? null },
  }));
}

function finishDrafts(entry: ReferenceFinish, pick: Extract<Pick, { kind: 'finish' }>): ItemDraft[] {
  return pick.variants.map((label) => {
    const variant = entry.variants.find((v) => v.label === label);
    if (!variant) throw new HttpError(400, `${entry.name} has no option ${label}`);
    const liquid = entry.unit === 'ml';
    return {
      name: `${entry.name}, ${variant.label}`,
      unit: liquid ? 'ml' : 'pcs',
      // Liquids are tracked by volume: "2 tins of 500 ml" is 1000 ml in a 500 ml container.
      quantity: liquid ? pick.count * (variant.capacity ?? 0) : pick.count,
      capacity: liquid ? (variant.capacity ?? null) : null,
      fields: { kind: entry.kind, grit: variant.grit ?? null, size: entry.size ?? null, base: entry.base ?? null, sheen: entry.sheen ?? null },
    };
  });
}

function entryOrThrow<K extends Pick['kind']>(kind: K, entryId: string) {
  const entry = getEntry(kind, entryId);
  if (!entry) throw new HttpError(400, 'That catalogue entry no longer exists. Reload and try again.');
  return entry;
}

/** Expand item picks into the items they create. All picks must be the same kind. */
export function itemDrafts(picks: Exclude<Pick, { kind: 'machine' }>[]): ItemDraft[] {
  const drafts = picks.flatMap((pick): ItemDraft[] => {
    switch (pick.kind) {
      case 'filament': return filamentDrafts(entryOrThrow('filament', pick.id) as FilamentLine, pick);
      case 'endmill': return endmillDrafts(entryOrThrow('endmill', pick.id) as ReferenceEndmill, pick);
      case 'fastener': return fastenerDrafts(entryOrThrow('fastener', pick.id) as ReferenceFastener, pick);
      case 'sheet': return sheetDrafts(entryOrThrow('sheet', pick.id) as ReferenceSheet, pick);
      case 'finish': return finishDrafts(entryOrThrow('finish', pick.id) as ReferenceFinish, pick);
    }
  });
  if (drafts.length > MAX_ITEMS) throw new HttpError(400, `That would add ${drafts.length} items. Add at most ${MAX_ITEMS} at a time.`);
  return drafts;
}

// ---- Writing to the workspace -----------------------------------------------------------------

export interface AddResult {
  machines: { id: string; name: string }[];
  subUnits: number;
  items: number;
  /** The items created, in the order asked for, so the caller can go on to use one (load it into a slot). */
  itemIds: string[];
  /** Items left out because the category already has one with that name. */
  skipped: string[];
  category: { id: string; name: string } | null;
}

/** Make a name unique among existing ones: "Bambu Lab A1", "Bambu Lab A1 2", ... */
function uniqueName(name: string, taken: Set<string>): string {
  let candidate = name;
  for (let n = 2; taken.has(candidate.toLowerCase()); n++) candidate = `${name} ${n}`;
  taken.add(candidate.toLowerCase());
  return candidate;
}

async function ensureMachineType(db: Db, workspaceId: string, key: ReferenceMachine['machineType'], userId: string | null): Promise<string> {
  const type = machineTypes[key];
  const existing = await db.machineType.findMany({ where: { workspaceId } });
  const found = existing.find((t) => t.name.toLowerCase() === type.name.toLowerCase());
  if (found) return found.id; // keep the workspace's own schedules as they are
  await importSnapshot(db, workspaceId, snapshotSchema.parse({ machineTypes: [type], maintenanceTasks: tasks[key] }), userId);
  const created = await db.machineType.findFirst({ where: { workspaceId, name: type.name } });
  if (!created) throw new HttpError(500, 'Could not create the machine type');
  return created.id;
}

async function addMachines(db: Db, workspaceId: string, picks: Extract<Pick, { kind: 'machine' }>[], locationId: string | null, userId: string | null, result: AddResult) {
  if (!picks.length) return;
  const taken = new Set((await db.machine.findMany({ where: { workspaceId }, select: { name: true } })).map((m) => m.name.toLowerCase()));
  const takenUnits = new Set((await db.subUnit.findMany({ where: { workspaceId }, select: { name: true } })).map((s) => s.name.toLowerCase()));

  for (const pick of picks) {
    const entry = entryOrThrow('machine', pick.id) as ReferenceMachine;
    const title = entry.brand ? `${entry.brand} ${entry.model}` : entry.model;

    if (entry.asUnit) {
      await db.subUnit.create({
        data: {
          workspaceId, name: uniqueName(title, takenUnits), kind: entry.asUnit.kind, readings: [] as Json,
          slots: { create: Array.from({ length: entry.asUnit.slots }, (_, i) => ({ position: i + 1 })) },
        },
      });
      result.subUnits++;
      continue;
    }

    const machineTypeId = await ensureMachineType(db, workspaceId, entry.machineType, userId);
    const machine = await db.machine.create({
      data: {
        workspaceId, machineTypeId, locationId,
        name: uniqueName(title, taken),
        manufacturer: entry.brand,
        model: entry.model,
        specs: entry.specs.map((s) => ({ label: s.label, value: s.value, unit: s.unit ?? '' })) as Json,
      },
    });
    result.machines.push({ id: machine.id, name: machine.name });

    for (const attachment of (entry.attachments ?? []).filter((a) => pick.attachments.includes(a.id))) {
      await db.subUnit.create({
        data: {
          workspaceId, machineId: machine.id, name: attachment.name, kind: attachment.kind, readings: [] as Json,
          slots: { create: Array.from({ length: attachment.slots }, (_, i) => ({ position: i + 1 })) },
        },
      });
      result.subUnits++;
    }
    for (const task of entry.tasks ?? []) {
      await db.maintenanceTask.create({
        data: {
          workspaceId, machineId: machine.id, name: task.name, description: task.description ?? '',
          intervalDays: task.intervalDays ?? null, intervalHours: task.intervalHours ?? null,
        },
      });
    }
  }
}

/**
 * Coerce each value against the category's actual field definitions, one field at a time:
 * a field the user has changed to another type simply loses that value instead of failing the add.
 */
export function coerceFields(definitions: CustomField[], values: Record<string, FieldValue>): Record<string, FieldValue> {
  const output: Record<string, FieldValue> = {};
  for (const field of definitions) {
    const value = values[field.key];
    if (value === undefined || value === null || value === '') continue;
    try {
      Object.assign(output, normalizeFields([{ ...field, required: false }], { [field.key]: value }));
    } catch {
      // Leave it out: the user can fill it in by hand.
    }
  }
  return output;
}

async function addItems(db: Db, workspaceId: string, picks: Exclude<Pick, { kind: 'machine' }>[], input: ReferenceAddInput, userId: string | null, result: AddResult) {
  if (!picks.length) return;
  const kind: ItemKind = picks[0].kind;
  if (picks.some((p) => p.kind !== kind)) throw new HttpError(400, 'Add one kind of item at a time');
  const drafts = itemDrafts(picks);
  const library = KIND_CATEGORY[kind];

  // The target category: the one asked for, else the one named like the starter category, else a new one.
  let target = input.itemTypeId
    ? await db.itemType.findFirst({ where: { id: input.itemTypeId, workspaceId } })
    : (await db.itemType.findMany({ where: { workspaceId } })).find((t) => t.name.toLowerCase() === library.name.toLowerCase()) ?? null;
  if (input.itemTypeId && !target) throw new HttpError(400, 'That category is not in this workspace');

  // Creates the category and units if missing, and adds any starter fields the category lacks.
  // Matching is by name, so passing the target's current name merges into a renamed category.
  const neededUnits = [...new Set(drafts.map((d) => d.unit))].map((key) => units[key]);
  await importSnapshot(db, workspaceId, snapshotSchema.parse({
    units: [...neededUnits, ...Object.values(units).filter((u) => u.ref === library.defaultUnit && !neededUnits.includes(u))],
    itemTypes: [{ ...library, name: target?.name ?? library.name }],
  }), userId);
  target = await db.itemType.findFirst({ where: { workspaceId, name: target?.name ?? library.name } });
  if (!target) throw new HttpError(500, 'Could not prepare the category');

  // Select fields gain only the options these items need, so existing lists stay as the user left them.
  let fields = await db.customField.findMany({ where: { itemTypeId: target.id } });
  for (const field of fields.filter((f) => f.fieldType === 'select')) {
    const options = Array.isArray(field.options) ? field.options.map(String) : [];
    const missing = [...new Set(drafts.map((d) => d.fields[field.key]).filter((v): v is string => typeof v === 'string' && v !== ''))]
      .filter((value) => !options.some((o) => o.toLowerCase() === value.toLowerCase()));
    if (missing.length) await db.customField.update({ where: { id: field.id }, data: { options: [...options, ...missing] } });
  }
  fields = await db.customField.findMany({ where: { itemTypeId: target.id } });

  const required = fields.filter((f) => f.required);
  const unitIds = new Map((await db.unit.findMany({ where: { workspaceId } })).map((u) => [u.symbol.toLowerCase(), u.id]));
  const counted = kind !== 'filament'; // one spool is one item, so repeated spools are expected
  const existing = new Set(
    (await db.item.findMany({ where: { workspaceId, itemTypeId: target.id, archived: false }, select: { name: true } })).map((i) => i.name.toLowerCase()),
  );

  for (const draft of drafts) {
    if (counted && existing.has(draft.name.toLowerCase())) {
      result.skipped.push(draft.name);
      continue;
    }
    const values = coerceFields(fields, draft.fields);
    const gap = required.find((f) => values[f.key] === undefined);
    if (gap) throw new HttpError(400, `"${target.name}" requires ${gap.label}, which the catalogue cannot fill in. Make it optional in Settings, or add these by hand.`);
    const created = await db.item.create({
      data: {
        workspaceId,
        itemTypeId: target.id,
        name: draft.name,
        quantity: draft.quantity,
        capacity: draft.capacity,
        unitId: unitIds.get(units[draft.unit].symbol) ?? target.defaultUnitId,
        locationId: input.locationId ?? null,
        fields: values as Json,
        ...(input.machineIds?.length ? { compatibleMachines: { connect: input.machineIds.map((machineId) => ({ id: machineId })) } } : {}),
      },
    });
    result.itemIds.push(created.id);
    if (created.quantity > 0) {
      await db.stockMovement.create({
        data: { workspaceId, itemId: created.id, delta: created.quantity, balanceAfter: created.quantity, reason: 'initial', userId },
      });
    }
    existing.add(draft.name.toLowerCase());
    result.items++;
  }
  result.category = { id: target.id, name: target.name };
}

/** Run inside a transaction: either everything picked is added, or nothing is. */
export async function addFromReference(db: Db, workspaceId: string, input: ReferenceAddInput, userId: string | null): Promise<AddResult> {
  await assertInWorkspace(db, workspaceId, { location: input.locationId ?? null, machine: input.machineIds });
  const result: AddResult = { machines: [], subUnits: 0, items: 0, itemIds: [], skipped: [], category: null };
  const machinePicks = input.picks.filter((p): p is Extract<Pick, { kind: 'machine' }> => p.kind === 'machine');
  const itemPicks = input.picks.filter((p): p is Exclude<Pick, { kind: 'machine' }> => p.kind !== 'machine');
  await addMachines(db, workspaceId, machinePicks, input.locationId ?? null, userId, result);
  await addItems(db, workspaceId, itemPicks, input, userId, result);
  return result;
}
