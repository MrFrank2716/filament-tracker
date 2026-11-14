import type { Router } from 'express';
import { z } from 'zod';
import { notFound, parse } from '@/http';
import { filamentBrands, REFERENCE_KINDS, referenceSummary, searchReference } from '@/reference';

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
