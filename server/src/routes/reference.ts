import type { Router } from 'express';
import { z } from 'zod';
import { prisma } from '@/db';
import { notFound, parse } from '@/http';
import { filamentBrands, REFERENCE_KINDS, referenceSummary, searchReference } from '@/reference';
import { describeActivity } from '@/services/activity';
import { addFromReference, referenceAddInput, type AddResult } from '@/services/reference';

const FILAMENT_LIMIT = 50;

const searchQuery = z.object({
  q: z.string().trim().max(100).optional(),
  brand: z.string().trim().max(100).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});

/**
 * The read-only reference catalogue. Signed-in users may browse it without a workspace,
 * so it can be used while a workspace is being set up.
 */
export function registerReferenceRoutes(router: Router): void {
  router.get('/reference', (_req, res) => {
    res.json(referenceSummary());
  });

  router.get('/reference/filament/brands', (_req, res) => {
    res.json(filamentBrands());
  });

  router.get('/reference/:kind', (req, res) => {
    const kind = REFERENCE_KINDS.find((k) => k === req.params.kind);
    if (!kind) throw notFound('Catalogue');
    const query = parse(searchQuery, req.query);
    // Filament runs to thousands of colours, so it is always searched and capped; the rest are small.
    const limit = kind === 'filament' ? Math.min(query.limit ?? FILAMENT_LIMIT, FILAMENT_LIMIT) : query.limit;
    res.json(searchReference(kind, { ...query, limit }));
  });
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

export function describeAdd(result: AddResult): string {
  const parts = [
    result.machines.length === 1 ? result.machines[0].name : result.machines.length ? plural(result.machines.length, 'machine') : '',
    result.items ? `${plural(result.items, 'item')}${result.category ? ` to ${result.category.name}` : ''}` : '',
    result.subUnits && !result.machines.length ? plural(result.subUnits, 'attachment') : '',
  ].filter(Boolean);
  return `Added ${parts.join(' and ') || 'nothing'} from the catalogue`;
}

/**
 * Copy catalogue entries into a workspace. Admin-only (not in OPERATOR_WRITES): it adds stock
 * and can extend categories, both of which are set-up changes.
 */
export function registerReferenceAddRoute(router: Router): void {
  router.post('/reference/add', async (req, res) => {
    const input = parse(referenceAddInput, req.body);
    const result = await prisma.$transaction((tx) => addFromReference(tx, req.workspaceId, input, req.userId), { timeout: 60_000, maxWait: 10_000 });
    describeActivity(describeAdd(result), { type: 'reference', id: null });
    res.status(201).json(result);
  });
}
