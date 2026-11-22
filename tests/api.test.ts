import request from 'supertest';
import { describe, expect, it, vi } from 'vitest';
import { createApp } from '../src/api/app';
import { createLogger } from '../src/utils/logger';
import type { GetHotelsResult, HotelOffersService } from '../src/services/hotel-offers.service';
import type { HealthReport, HealthService } from '../src/services/health.service';
import { DependencyUnavailableError, UpstreamUnavailableError } from '../src/utils/errors';

const logger = createLogger({ LOG_LEVEL: 'info', NODE_ENV: 'test' }, 'test');

const sample: GetHotelsResult = {
  hotels: [{ name: 'Holtin', price: 5340, supplier: 'Supplier B', commissionPct: 20 }],
  cache: 'MISS',
  degraded: false,
  failedSuppliers: [],
  workflowId: 'hotel-offers:delhi',
};

const okReport: HealthReport = {
  status: 'ok',
  timestamp: new Date().toISOString(),
  uptimeSeconds: 1,
  dependencies: {
    supplierA: { status: 'up', latencyMs: 1 },
    supplierB: { status: 'up', latencyMs: 1 },
    redis: { status: 'up', latencyMs: 1 },
    temporal: { status: 'up', latencyMs: 1 },
  },
};

function build(overrides: { getHotels?: HotelOffersService['getHotels']; check?: HealthService['check'] } = {}) {
  const getHotels = vi.fn(overrides.getHotels ?? (async () => sample));
  const check = vi.fn(overrides.check ?? (async () => okReport));
  const app = createApp({
    logger,
    mockChaosEnabled: true,
    hotelOffers: { getHotels },
    health: { check },
  });
  return { app, getHotels, check };
}

describe('GET /api/hotels', () => {
  it('returns the bare array and normalises the city', async () => {
    const { app, getHotels } = build();
    const res = await request(app).get('/api/hotels?city=%20Delhi%20');

    expect(res.status).toBe(200);
    expect(res.body).toEqual(sample.hotels);
    expect(res.headers['x-cache']).toBe('MISS');
    expect(getHotels).toHaveBeenCalledWith({
      city: 'delhi',
      minPrice: undefined,
      maxPrice: undefined,
      refresh: false,
    });
  });

  it('passes the price range through as numbers', async () => {
    const { app, getHotels } = build();
    await request(app).get('/api/hotels?city=delhi&minPrice=5000&maxPrice=10000.5&refresh=true').expect(200);
    expect(getHotels).toHaveBeenCalledWith({ city: 'delhi', minPrice: 5000, maxPrice: 10000.5, refresh: true });
  });

  it('accepts only one bound', async () => {
    const { app, getHotels } = build();
    await request(app).get('/api/hotels?city=delhi&maxPrice=4000').expect(200);
    expect(getHotels).toHaveBeenCalledWith(expect.objectContaining({ minPrice: undefined, maxPrice: 4000 }));
  });

  it.each([
    ['missing city', '/api/hotels'],
    ['blank city', '/api/hotels?city=%20'],
    ['city with illegal characters', '/api/hotels?city=de%3Blhi'],
    ['non numeric minPrice', '/api/hotels?city=delhi&minPrice=abc'],
    ['overflowing minPrice', `/api/hotels?city=delhi&minPrice=${'9'.repeat(400)}`],
    ['negative maxPrice', '/api/hotels?city=delhi&maxPrice=-1'],
    ['empty minPrice', '/api/hotels?city=delhi&minPrice='],
    ['minPrice > maxPrice', '/api/hotels?city=delhi&minPrice=10&maxPrice=5'],
    ['bad refresh flag', '/api/hotels?city=delhi&refresh=yes'],
    ['duplicated city param', '/api/hotels?city=a&city=b'],
  ])('rejects %s with 400 and never calls the service', async (_label, url) => {
    const { app, getHotels } = build();
    const res = await request(app).get(url);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(getHotels).not.toHaveBeenCalled();
  });

  it('surfaces degraded results through headers, not the body', async () => {
    const { app } = build({
      getHotels: async () => ({ ...sample, degraded: true, failedSuppliers: ['Supplier A'] }),
    });
    const res = await request(app).get('/api/hotels?city=delhi');

    expect(res.status).toBe(200);
    expect(res.headers['x-data-degraded']).toBe('true');
    expect(res.headers['x-failed-suppliers']).toBe('Supplier A');
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('maps "all suppliers down" to 502', async () => {
    const { app } = build({
      getHotels: async () => {
        throw new UpstreamUnavailableError('All hotel suppliers are currently unavailable', ['a', 'b']);
      },
    });
    const res = await request(app).get('/api/hotels?city=delhi');
    expect(res.status).toBe(502);
    expect(res.body.error).toMatchObject({ code: 'UPSTREAM_UNAVAILABLE', details: ['a', 'b'] });
  });

  it('maps an unreachable dependency to 503', async () => {
    const { app } = build({
      getHotels: async () => {
        throw new DependencyUnavailableError('Redis is unavailable');
      },
    });
    await request(app).get('/api/hotels?city=delhi').expect(503);
  });

  it('hides internals of unexpected errors behind a generic 500', async () => {
    const { app } = build({
      getHotels: async () => {
        throw new Error('secret connection string leaked');
      },
    });
    const res = await request(app).get('/api/hotels?city=delhi');
    expect(res.status).toBe(500);
    expect(JSON.stringify(res.body)).not.toContain('secret');
  });
});

describe('GET /health', () => {
  it('returns 200 when healthy', async () => {
    const { app } = build();
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.dependencies).toHaveProperty('supplierA');
    expect(res.body.dependencies).toHaveProperty('supplierB');
  });

  it('returns 200 when degraded and 503 when down', async () => {
    const degraded = build({ check: async () => ({ ...okReport, status: 'degraded' }) });
    await request(degraded.app).get('/health').expect(200);

    const down = build({ check: async () => ({ ...okReport, status: 'down' }) });
    await request(down.app).get('/health').expect(503);
  });

  it('exposes a liveness probe that does not touch dependencies', async () => {
    const { app, check } = build();
    await request(app).get('/health/live').expect(200);
    expect(check).not.toHaveBeenCalled();
  });
});

describe('mock supplier APIs', () => {
  it('returns static JSON for the requested city, with overlapping names across suppliers', async () => {
    const { app } = build();
    const [a, b] = await Promise.all([
      request(app).get('/supplierA/hotels?city=delhi'),
      request(app).get('/supplierB/hotels?city=DELHI'),
    ]);
    expect(a.status).toBe(200);
    expect(b.status).toBe(200);

    const namesA = new Set((a.body as { name: string }[]).map((h) => h.name.toLowerCase()));
    const overlap = (b.body as { name: string }[]).filter((h) => namesA.has(h.name.toLowerCase()));
    expect(overlap.length).toBeGreaterThan(0);
    expect(a.body[0]).toEqual(
      expect.objectContaining({ hotelId: expect.any(String), name: expect.any(String), price: expect.any(Number), city: 'delhi' }),
    );
  });

  it('returns an empty array for an unknown city', async () => {
    const { app } = build();
    const res = await request(app).get('/supplierA/hotels?city=atlantis');
    expect(res.status).toBe(200);
    expect(res.body).toEqual([]);
  });

  it('can be switched down and back up at runtime', async () => {
    const { app } = build();
    await request(app).post('/supplierA/_chaos').send({ down: true }).expect(200);
    await request(app).get('/supplierA/hotels?city=delhi').expect(503);
    await request(app).get('/supplierB/hotels?city=delhi').expect(200); // independent
    await request(app).post('/supplierA/_chaos').send({ down: false }).expect(200);
    await request(app).get('/supplierA/hotels?city=delhi').expect(200);
  });

  it('rejects malformed chaos payloads', async () => {
    const { app } = build();
    await request(app).post('/supplierA/_chaos').send({ down: 'yes' }).expect(400);
  });
});

describe('misc', () => {
  it('returns a JSON 404 for unknown routes', async () => {
    const { app } = build();
    const res = await request(app).get('/nope');
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('returns 400 for malformed JSON bodies', async () => {
    const { app } = build();
    const res = await request(app)
      .post('/supplierA/_chaos')
      .set('content-type', 'application/json')
      .send('{not json');
    expect(res.status).toBe(400);
  });
});
