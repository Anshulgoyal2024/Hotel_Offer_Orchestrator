import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import type { SupplierHotel } from '../types/hotel';
import { SUPPLIER_A_HOTELS, SUPPLIER_B_HOTELS } from './supplier.data';
import { sleep } from '../utils/errors';

interface ChaosState {
  down: boolean;
  latencyMs: number;
}

const chaosSchema = z
  .object({
    down: z.boolean().optional(),
    latencyMs: z.number().int().min(0).max(30_000).optional(),
  })
  .strict();

/**
 * Builds the router for one mocked supplier.
 *
 *   GET  /hotels?city=delhi   -> static JSON array (optionally filtered by city)
 *   GET  /_chaos              -> current failure-injection state
 *   POST /_chaos              -> { "down": true, "latencyMs": 1500 } to simulate outages
 *
 * Chaos state is in-memory and per supplier. It exists so the "supplier is
 * down" scenario can be demonstrated (Postman / README) without touching code.
 */
function createSupplierRouter(
  label: string,
  catalogue: readonly SupplierHotel[],
  chaosEnabled: boolean,
): Router {
  const router = Router();
  const chaos: ChaosState = { down: false, latencyMs: 0 };

  router.get('/hotels', async (req: Request, res: Response) => {
    if (chaos.latencyMs > 0) await sleep(chaos.latencyMs);

    if (chaos.down) {
      res.status(503).json({ error: `${label} is temporarily unavailable` });
      return;
    }

    const city = typeof req.query.city === 'string' ? req.query.city.trim().toLowerCase() : undefined;
    const hotels = city ? catalogue.filter((h) => h.city === city) : catalogue;
    res.json(hotels);
  });

  if (chaosEnabled) {
    router.get('/_chaos', (_req, res) => {
      res.json({ supplier: label, ...chaos });
    });

    router.post('/_chaos', (req, res) => {
      const parsed = chaosSchema.safeParse(req.body ?? {});
      if (!parsed.success) {
        res.status(400).json({
          error: 'Body must be JSON like {"down": true, "latencyMs": 0}',
          issues: parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
        });
        return;
      }
      if (parsed.data.down !== undefined) chaos.down = parsed.data.down;
      if (parsed.data.latencyMs !== undefined) chaos.latencyMs = parsed.data.latencyMs;
      res.json({ supplier: label, ...chaos });
    });
  }

  return router;
}

export function createMockSupplierRouters(chaosEnabled: boolean): { supplierA: Router; supplierB: Router } {
  return {
    supplierA: createSupplierRouter('Supplier A', SUPPLIER_A_HOTELS, chaosEnabled),
    supplierB: createSupplierRouter('Supplier B', SUPPLIER_B_HOTELS, chaosEnabled),
  };
}
