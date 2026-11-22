import { Router } from 'express';
import { z } from 'zod';
import type { HotelOffersService } from '../services/hotel-offers.service';
import { ValidationError } from '../utils/errors';

const priceParam = z
  .string()
  .trim()
  .regex(/^\d+(\.\d+)?$/, 'must be a non-negative number')
  .transform(Number)
  .pipe(z.number().finite().nonnegative());

const querySchema = z
  .object({
    city: z
      .string({ error: 'city query parameter is required' })
      .trim()
      .min(1, 'city query parameter is required')
      .max(64, 'city must be at most 64 characters')
      .regex(/^[\p{L}\p{N}][\p{L}\p{N} .'-]*$/u, 'city contains invalid characters')
      .transform((v) => v.toLowerCase()),
    minPrice: priceParam.optional(),
    maxPrice: priceParam.optional(),
    refresh: z
      .enum(['true', 'false'], { error: 'refresh must be "true" or "false"' })
      .optional()
      .transform((v) => v === 'true'),
  })
  .refine((q) => q.minPrice === undefined || q.maxPrice === undefined || q.minPrice <= q.maxPrice, {
    message: 'minPrice must be less than or equal to maxPrice',
    path: ['minPrice'],
  });

export function createHotelsRouter(service: HotelOffersService): Router {
  const router = Router();

  /**
   * GET /api/hotels?city=delhi[&minPrice=..][&maxPrice=..][&refresh=true]
   * Responds with a bare JSON array of offers, sorted by price ascending.
   * Operational metadata travels in headers so the body matches the contract.
   */
  router.get('/', async (req, res) => {
    const parsed = querySchema.safeParse(req.query);
    if (!parsed.success) {
      throw new ValidationError(
        'Invalid query parameters',
        parsed.error.issues.map((i) => ({ field: i.path.join('.'), message: i.message })),
      );
    }

    const { city, minPrice, maxPrice, refresh } = parsed.data;
    const result = await service.getHotels({ city, minPrice, maxPrice, refresh });

    res.set('X-Cache', result.cache);
    if (result.workflowId) res.set('X-Workflow-Id', result.workflowId);
    if (result.degraded) {
      res.set('X-Data-Degraded', 'true');
      res.set('X-Failed-Suppliers', result.failedSuppliers.join(', '));
    }
    res.json(result.hotels);
  });

  return router;
}
