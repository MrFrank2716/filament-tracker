import type { Router } from 'express';
import { z } from 'zod';
import { prisma, type Json } from '@/db';
import { HttpError, parse } from '@/http';
import { parseCsv, toCsv } from '@/services/csv';
import { exportSnapshot, importSnapshot, snapshotSchema } from '@/services/snapshot';
import { normalizeFields } from '@/routes/items';
import { TAG_PATTERN, tagIsFree } from '@/services/tags';

const BASE_COLUMNS = ['type', 'name', 'sku', 'quantity', 'unit', 'capacity', 'min_quantity', 'unit_cost', 'supplier', 'location', 'notes', 'usage_hours', 'life_hours', 'tag_id'] as const;

const slug = (value: string) => value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
const toNumber = (value: string | undefined): number | undefined => {
  if (value === undefined || value.trim() === '') return undefined;
  const number = Number(value.replace(/,/g, ''));
  return Number.isFinite(number) ? number : undefined;
};

export function registerTransferRoutes(router: Router): void {
  /** Whole workspace as one JSON document: move it to another environment or keep it as a backup. */
  router.get('/export', async (req, res) => {
    const snapshot = await exportSnapshot(prisma, req.workspaceId);
    res.setHeader('Content-Disposition', 'attachment; filename="workspace.json"');
    res.json(snapshot);
  });

  router.post('/import', async (req, res) => {
    const snapshot = parse(snapshotSchema, req.body);
    const summary = await prisma.$transaction((tx) => importSnapshot(tx, req.workspaceId, snapshot, req.userId), {
      timeout: 120_000,
      maxWait: 10_000,
    });
    res.json({ summary });
  });

  /** Flat inventory sheet. Custom fields become extra columns named after their key. */
  router.get('/export/items.csv', async (req, res) => {
    const [items, types] = await Promise.all([
      prisma.item.findMany({
        where: { workspaceId: req.workspaceId, archived: false },
        orderBy: [{ itemTypeId: 'asc' }, { name: 'asc' }],
        include: { unit: true, supplier: true, location: true },
      }),
      prisma.itemType.findMany({ where: { workspaceId: req.workspaceId }, include: { fields: { orderBy: { sortOrder: 'asc' } } } }),
    ]);
    const typeById = new Map(types.map((t) => [t.id, t]));
    const fieldKeys = [...new Set(types.flatMap((t) => t.fields.map((f) => f.key)))];

    const rows = items.map((item) => {
      const values = (item.fields ?? {}) as Record<string, unknown>;
      return [
        typeById.get(item.itemTypeId)?.name ?? '', item.name, item.sku, item.quantity, item.unit?.symbol ?? '',
        item.capacity ?? '', item.minQuantity, item.unitCost, item.supplier?.name ?? '', item.location?.name ?? '',
        item.notes, item.usageHours, item.lifeHours ?? '', item.tagId ?? '',
        ...fieldKeys.map((key) => values[key] ?? ''),
      ];
    });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="inventory.csv"');
    res.send('﻿' + toCsv([...BASE_COLUMNS, ...fieldKeys], rows));
  });

  /**
   * Bulk add items from a spreadsheet. Needs `name`, plus a `type` column or a default type.
   * Unknown suppliers and locations are created; rows that cannot be read are reported, not guessed.
   */
  router.post('/import/items.csv', async (req, res) => {
    const { csv, defaultTypeId } = parse(z.object({ csv: z.string().min(1).max(2_000_000), defaultTypeId: z.string().optional() }), req.body);
    const workspaceId = req.workspaceId;
    const [header, ...rows] = parseCsv(csv);
    if (!header) throw new HttpError(400, 'The file is empty');
    const columns = header.map(slug);
    if (!columns.includes('name')) throw new HttpError(400, 'The first row must contain a "name" column');
    if (rows.length > 5000) throw new HttpError(400, 'Import at most 5,000 rows at a time');

    const result = await prisma.$transaction(
      async (tx) => {
        const [types, units, suppliers, locations] = await Promise.all([
          tx.itemType.findMany({ where: { workspaceId }, include: { fields: true } }),
          tx.unit.findMany({ where: { workspaceId } }),
          tx.supplier.findMany({ where: { workspaceId } }),
          tx.location.findMany({ where: { workspaceId } }),
        ]);
        const errors: Array<{ row: number; message: string }> = [];
        let created = 0;

        for (const [index, cells] of rows.entries()) {
          const rowNumber = index + 2;
          const record: Record<string, string> = {};
          columns.forEach((column, i) => (record[column] = (cells[i] ?? '').trim()));
          try {
            if (!record.name) throw new Error('name is empty');
            const type = record.type
              ? types.find((t) => t.name.toLowerCase() === record.type.toLowerCase())
              : types.find((t) => t.id === defaultTypeId);
            if (!type) throw new Error(record.type ? `unknown type "${record.type}"` : 'no type given');

            const unit = record.unit
              ? units.find((u) => u.symbol.toLowerCase() === record.unit.toLowerCase() || u.name.toLowerCase() === record.unit.toLowerCase())
              : undefined;
            if (record.unit && !unit) throw new Error(`unknown unit "${record.unit}"`);

            let supplier = record.supplier ? suppliers.find((s) => s.name.toLowerCase() === record.supplier.toLowerCase()) : undefined;
            if (record.supplier && !supplier) {
              supplier = await tx.supplier.create({ data: { workspaceId, name: record.supplier } });
              suppliers.push(supplier);
            }
            let location = record.location ? locations.find((l) => l.name.toLowerCase() === record.location.toLowerCase()) : undefined;
            if (record.location && !location) {
              location = await tx.location.create({ data: { workspaceId, name: record.location } });
              locations.push(location);
            }

            // Custom columns may be headed by the field key or by its label.
            const raw: Record<string, string> = {};
            for (const field of type.fields) {
              const value = record[slug(field.key)] ?? record[slug(field.label)];
              if (value !== undefined && value !== '') raw[field.key] = value;
            }
            const fields = normalizeFields(type.fields, raw);

            // A spool's tag comes back with it, unless an item already in stock carries that tag.
            const tag = (record.tag_id ?? '').toUpperCase();
            if (tag && !TAG_PATTERN.test(tag)) throw new Error(`tag_id "${record.tag_id}" is not a tag`);
            const tagId = tag && (await tagIsFree(tx, workspaceId, tag)) ? tag : null;

            const quantity = Math.max(0, toNumber(record.quantity) ?? 0);
            const item = await tx.item.create({
              data: {
                workspaceId,
                itemTypeId: type.id,
                name: record.name.slice(0, 200),
                sku: record.sku ?? '',
                quantity,
                capacity: toNumber(record.capacity) || null,
                minQuantity: Math.max(0, toNumber(record.min_quantity) ?? 0),
                unitCost: Math.max(0, toNumber(record.unit_cost) ?? 0),
                unitId: unit?.id ?? type.defaultUnitId,
                supplierId: supplier?.id ?? null,
                locationId: location?.id ?? null,
                notes: record.notes ?? '',
                usageHours: Math.max(0, toNumber(record.usage_hours) ?? 0),
                lifeHours: toNumber(record.life_hours) || null,
                fields: fields as Json,
                tagId,
              },
            });
            if (quantity > 0) {
              await tx.stockMovement.create({
                data: { workspaceId, itemId: item.id, delta: quantity, balanceAfter: quantity, reason: 'import', userId: req.userId },
              });
            }
            created++;
          } catch (error) {
            errors.push({ row: rowNumber, message: error instanceof Error ? error.message : 'could not be read' });
          }
        }
        return { created, errors };
      },
      { timeout: 120_000, maxWait: 10_000 },
    );
    res.json(result);
  });
}
