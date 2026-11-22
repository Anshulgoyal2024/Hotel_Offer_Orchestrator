import { randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { HotelRepository, metaKey, zsetKey } from '../src/services/hotel.repository';
import type { HotelOffer } from '../src/types/hotel';

/**
 * Integration test against a real Redis (REDIS_URL, default localhost:6379).
 * Skips itself - rather than failing - when Redis is not reachable.
 */

const hotels: HotelOffer[] = [
  { name: 'Hotel Aravali', price: 2900, supplier: 'Supplier A', commissionPct: 8 },
  { name: 'Holtin', price: 5340, supplier: 'Supplier B', commissionPct: 20 },
  { name: 'Radison', price: 5900, supplier: 'Supplier A', commissionPct: 13 },
  { name: 'Leela Ambience', price: 9800, supplier: 'Supplier B', commissionPct: 14 },
  { name: 'Taj Palace', price: 12000, supplier: 'Supplier B', commissionPct: 18 },
];

const city = `test-${randomUUID()}`;
const meta = { updatedAt: new Date().toISOString(), degraded: false, failedSuppliers: [] as string[] };

let redis: Redis;
let repo: HotelRepository;
let available = false;

beforeAll(async () => {
  redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
    lazyConnect: true,
    maxRetriesPerRequest: 0,
    retryStrategy: () => null,
  });
  redis.on('error', () => undefined);
  try {
    await redis.connect();
    available = (await redis.ping()) === 'PONG';
  } catch {
    available = false;
  }
  repo = new HotelRepository(redis);
});

afterAll(async () => {
  if (available) await redis.del(zsetKey(city), metaKey(city));
  redis.disconnect();
});

describe('HotelRepository (real Redis)', () => {
  it('reports a miss for an unknown city', async (ctx) => {
    if (!available) return ctx.skip();
    expect(await repo.query(`missing-${randomUUID()}`)).toEqual({ meta: null, hotels: [] });
  });

  it('stores a list and returns it ordered by price', async (ctx) => {
    if (!available) return ctx.skip();
    await repo.replaceCity(city, hotels, meta, 30);

    const res = await repo.query(city);
    expect(res.meta).toMatchObject({ count: 5, degraded: false });
    expect(res.hotels).toEqual(hotels);
    expect(await redis.ttl(zsetKey(city))).toBeGreaterThan(0);
    expect(await redis.ttl(metaKey(city))).toBeGreaterThan(0);
    expect(await redis.call('PEXPIRETIME', metaKey(city))).toBe(await redis.call('PEXPIRETIME', zsetKey(city)));
  });

  it('filters by price range inside Redis, inclusive on both ends', async (ctx) => {
    if (!available) return ctx.skip();
    const names = async (min?: number, max?: number) =>
      (await repo.query(city, { minPrice: min, maxPrice: max })).hotels.map((h) => h.name);

    expect(await names(5000, 10000)).toEqual(['Holtin', 'Radison', 'Leela Ambience']);
    expect(await names(5340, 5900)).toEqual(['Holtin', 'Radison']); // inclusive bounds
    expect(await names(undefined, 3000)).toEqual(['Hotel Aravali']);
    expect(await names(10000, undefined)).toEqual(['Taj Palace']);
    expect(await names(100000, undefined)).toEqual([]);
  });

  it('distinguishes "cached but empty" from "not cached"', async (ctx) => {
    if (!available) return ctx.skip();
    await repo.replaceCity(city, [], meta, 30);
    const res = await repo.query(city);
    expect(res.meta).toMatchObject({ count: 0 });
    expect(res.hotels).toEqual([]);
  });

  it('replaces (not merges) the previous list', async (ctx) => {
    if (!available) return ctx.skip();
    await repo.replaceCity(city, hotels, meta, 30);
    await repo.replaceCity(city, [hotels[0] as HotelOffer], { ...meta, degraded: true, failedSuppliers: ['Supplier A'] }, 30);

    const res = await repo.query(city);
    expect(res.hotels).toHaveLength(1);
    expect(res.meta).toMatchObject({ degraded: true, failedSuppliers: ['Supplier A'], count: 1 });
  });
});
