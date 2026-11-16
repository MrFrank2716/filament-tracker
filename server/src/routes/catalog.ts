import type { Router } from 'express';
import { z } from 'zod';
import { prisma, type Json } from '@/db';
import { HttpError, notFound, param, parse } from '@/http';
import { customFieldSchema, FIELD_TYPES } from '@/services/snapshot';
import { assertInWorkspace } from '@/services/stock';

/**
 * User-defined configuration: units, suppliers, locations, machine types and item types.
 * Everything a workspace needs to describe its own environment without code changes.
 */
export function registerCatalogRoutes(router: Router): void {
  // ---- Units ---------------------------------------------------------------
  const unitInput = z.object({
    name: z.string().trim().min(1).max(40),
    symbol: z.string().trim().min(1).max(12),
    decimals: z.number().int().min(0).max(4).optional(),
  });

  router.get('/units', async (req, res) => {
    res.json(await prisma.unit.findMany({ where: { workspaceId: req.workspaceId }, orderBy: { name: 'asc' } }));
  });
  router.post('/units', async (req, res) => {
    const data = parse(unitInput, req.body);
    res.status(201).json(await prisma.unit.create({ data: { ...data, workspaceId: req.workspaceId } }));
  });
  router.patch('/units/:id', async (req, res) => {
    const data = parse(unitInput.partial(), req.body);
    const id = param(req, 'id');
    await assertInWorkspace(prisma, req.workspaceId, { unit: id });
    res.json(await prisma.unit.update({ where: { id }, data }));
  });
  router.delete('/units/:id', async (req, res) => {
    const id = param(req, 'id');
    await assertInWorkspace(prisma, req.workspaceId, { unit: id });
    await prisma.unit.delete({ where: { id } });
    res.status(204).end();
  });

  // ---- Suppliers -----------------------------------------------------------
  const supplierInput = z.object({
    name: z.string().trim().min(1).max(120),
    website: z.string().trim().max(300).optional(),
    email: z.string().trim().max(200).optional(),
    notes: z.string().trim().max(2000).optional(),
  });

  router.get('/suppliers', async (req, res) => {
    res.json(await prisma.supplier.findMany({ where: { workspaceId: req.workspaceId }, orderBy: { name: 'asc' } }));
  });
  router.post('/suppliers', async (req, res) => {
    const data = parse(supplierInput, req.body);
    res.status(201).json(await prisma.supplier.create({ data: { ...data, workspaceId: req.workspaceId } }));
  });
  router.patch('/suppliers/:id', async (req, res) => {
    const data = parse(supplierInput.partial(), req.body);
    const id = param(req, 'id');
    await assertInWorkspace(prisma, req.workspaceId, { supplier: id });
    res.json(await prisma.supplier.update({ where: { id }, data }));
  });
  router.delete('/suppliers/:id', async (req, res) => {
    const id = param(req, 'id');
    await assertInWorkspace(prisma, req.workspaceId, { supplier: id });
    await prisma.supplier.delete({ where: { id } });
    res.status(204).end();
  });

  // ---- Locations -----------------------------------------------------------
  const locationInput = z.object({
    name: z.string().trim().min(1).max(120),
    kind: z.string().trim().max(40).optional(),
    code: z.string().trim().max(80).optional(),
    parentId: z.string().nullable().optional(),
  });

  /** A location may not become its own ancestor. */
  async function assertNoCycle(workspaceId: string, id: string, parentId: string | null | undefined) {
    if (!parentId) return;
    const all = await prisma.location.findMany({ where: { workspaceId }, select: { id: true, parentId: true } });
    const parentOf = new Map(all.map((l) => [l.id, l.parentId]));
    for (let cursor: string | null | undefined = parentId; cursor; cursor = parentOf.get(cursor)) {
      if (cursor === id) throw new HttpError(400, 'A location cannot be placed inside itself');
    }
  }

  router.get('/locations', async (req, res) => {
    res.json(await prisma.location.findMany({ where: { workspaceId: req.workspaceId }, orderBy: { name: 'asc' } }));
  });
  router.post('/locations', async (req, res) => {
    const data = parse(locationInput, req.body);
    await assertInWorkspace(prisma, req.workspaceId, { location: data.parentId });
    res.status(201).json(await prisma.location.create({ data: { ...data, workspaceId: req.workspaceId } }));
  });
  router.patch('/locations/:id', async (req, res) => {
    const data = parse(locationInput.partial(), req.body);
    const id = param(req, 'id');
    await assertInWorkspace(prisma, req.workspaceId, { location: [id, ...(data.parentId ? [data.parentId] : [])] });
    await assertNoCycle(req.workspaceId, id, data.parentId);
    res.json(await prisma.location.update({ where: { id }, data }));
  });
  router.delete('/locations/:id', async (req, res) => {
    const id = param(req, 'id');
    const location = await prisma.location.findFirst({ where: { id, workspaceId: req.workspaceId }, select: { parentId: true } });
    if (!location) throw notFound('Location');
    // What was inside moves up one level, to wherever this location was. Items and machines stored directly in
    // it are left without a location (the database does that), since "up a level" may not be where they are.
    await prisma.$transaction([
      prisma.location.updateMany({ where: { parentId: id, workspaceId: req.workspaceId }, data: { parentId: location.parentId } }),
      prisma.location.delete({ where: { id } }),
    ]);
    res.status(204).end();
  });

  // ---- Machine types -------------------------------------------------------
  const machineTypeInput = z.object({
    name: z.string().trim().min(1).max(80),
    icon: z.string().trim().max(60).optional(),
  });

  router.get('/machine-types', async (req, res) => {
    res.json(await prisma.machineType.findMany({ where: { workspaceId: req.workspaceId }, orderBy: { name: 'asc' } }));
  });
  router.post('/machine-types', async (req, res) => {
    const data = parse(machineTypeInput, req.body);
    res.status(201).json(await prisma.machineType.create({ data: { ...data, workspaceId: req.workspaceId } }));
  });
  router.patch('/machine-types/:id', async (req, res) => {
    const data = parse(machineTypeInput.partial(), req.body);
    const id = param(req, 'id');
    await assertInWorkspace(prisma, req.workspaceId, { machineType: id });
    res.json(await prisma.machineType.update({ where: { id }, data }));
  });
  router.delete('/machine-types/:id', async (req, res) => {
    const id = param(req, 'id');
    await assertInWorkspace(prisma, req.workspaceId, { machineType: id });
    await prisma.machineType.delete({ where: { id } });
    res.status(204).end();
  });

  // ---- Item types and custom fields ---------------------------------------
  const fieldInput = customFieldSchema.extend({
    id: z.string().optional(),
    fieldType: z.enum(FIELD_TYPES),
  });
  const itemTypeInput = z.object({
    name: z.string().trim().min(1).max(80),
    icon: z.string().trim().max(60).optional(),
    color: z.string().trim().max(30).optional(),
    defaultUnitId: z.string().nullable().optional(),
    tracksLife: z.boolean().optional(),
    sortOrder: z.number().int().optional(),
    fields: z.array(fieldInput).max(40).optional(),
  });

  const withFields = { fields: { orderBy: { sortOrder: 'asc' as const } }, _count: { select: { items: true } } };

  function assertUniqueKeys(fields: Array<{ key: string }> | undefined) {
    if (!fields) return;
    const keys = fields.map((f) => f.key);
    if (new Set(keys).size !== keys.length) throw new HttpError(400, 'Two fields share the same key');
  }

  router.get('/item-types', async (req, res) => {
    res.json(
      await prisma.itemType.findMany({
        where: { workspaceId: req.workspaceId },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        include: withFields,
      }),
    );
  });

  router.post('/item-types', async (req, res) => {
    const { fields = [], ...data } = parse(itemTypeInput, req.body);
    assertUniqueKeys(fields);
    await assertInWorkspace(prisma, req.workspaceId, { unit: data.defaultUnitId });
    const count = await prisma.itemType.count({ where: { workspaceId: req.workspaceId } });
    const created = await prisma.itemType.create({
      data: {
        ...data,
        sortOrder: data.sortOrder ?? count,
        workspaceId: req.workspaceId,
        fields: {
          create: fields.map(({ id: _id, ...field }, index) => ({ ...field, options: field.options as Json, sortOrder: index })),
        },
      },
      include: withFields,
    });
    res.status(201).json(created);
  });

  /** Replaces the field list: fields with an id are updated, new ones created, missing ones removed. */
  router.patch('/item-types/:id', async (req, res) => {
    const { fields, ...data } = parse(itemTypeInput.partial(), req.body);
    const id = param(req, 'id');
    assertUniqueKeys(fields);
    await assertInWorkspace(prisma, req.workspaceId, { itemType: id, unit: data.defaultUnitId });

    const updated = await prisma.$transaction(async (tx) => {
      await tx.itemType.update({ where: { id }, data });
      if (fields) {
        const existing = await tx.customField.findMany({ where: { itemTypeId: id } });
        const keep = new Set(fields.map((f) => f.id).filter(Boolean));
        const remove = existing.filter((f) => !keep.has(f.id)).map((f) => f.id);
        if (remove.length) await tx.customField.deleteMany({ where: { id: { in: remove } } });
        for (const [index, { id: fieldId, ...field }] of fields.entries()) {
          const payload = { ...field, options: field.options as Json, sortOrder: index };
          if (fieldId && existing.some((f) => f.id === fieldId)) {
            await tx.customField.update({ where: { id: fieldId }, data: payload });
          } else {
            await tx.customField.create({ data: { ...payload, itemTypeId: id } });
          }
        }
      }
      return tx.itemType.findUniqueOrThrow({ where: { id }, include: withFields });
    });
    res.json(updated);
  });

  router.delete('/item-types/:id', async (req, res) => {
    const id = param(req, 'id');
    const type = await prisma.itemType.findFirst({ where: { id, workspaceId: req.workspaceId }, include: { _count: { select: { items: true } } } });
    if (!type) throw notFound('Item type');
    if (type._count.items > 0) {
      throw new HttpError(409, `${type._count.items} item(s) still use this type. Move or delete them first.`);
    }
    await prisma.itemType.delete({ where: { id } });
    res.status(204).end();
  });
}
