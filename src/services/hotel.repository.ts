import type { Redis } from 'ioredis';
import type { CacheMeta, HotelOffer } from '../types/hotel';

/**
 * Redis storage for the de-duplicated offers of a city.
 *
 *   hotels:v1:<city>:by_price  ZSET   score = price, member = JSON(HotelOffer)
 *   hotels:v1:<city>:meta      STRING JSON(CacheMeta), same TTL as the ZSET
 *
 * Why a sorted set?  Price-range filtering then happens *inside Redis* with a
 * single O(log N + M) ZRANGEBYSCORE - the application never loads or scans the
 * full list. Because the workflow has already de-duplicated by name, every
 * member is unique, so JSON members are safe.
 *
 * A separate meta key lets us distinguish "city cached but has zero hotels"
 * from "city not cached", which a missing/empty ZSET cannot express.
 */

const KEY_VERSION = 'v1';

export const zsetKey = (city: string): string => `hotels:${KEY_VERSION}:${city}:by_price`;
export const metaKey = (city: string): string => `hotels:${KEY_VERSION}:${city}:meta`;

export interface PriceRange {
  minPrice?: number;
  maxPrice?: number;
}

export interface CachedQueryResult {
  /** null => the city is not cached (miss or expired). */
  meta: CacheMeta | null;
  hotels: HotelOffer[];
}

export class HotelRepository {
  constructor(private readonly redis: Redis) {}

  /**
   * Atomically replaces the cached list for a city (MULTI/EXEC), so readers
   * never observe a half-written list.
   */
  async replaceCity(
    city: string,
    hotels: readonly HotelOffer[],
    meta: Omit<CacheMeta, 'count'>,
    ttlSeconds: number,
  ): Promise<void> {
    const fullMeta: CacheMeta = { ...meta, count: hotels.length };
    const expiresAtMs = Date.now() + ttlSeconds * 1_000;
    const tx = this.redis.multi().del(zsetKey(city));
    // Use the same absolute deadline for both keys. Relative TTL commands
    // issued in sequence can otherwise leave a tiny window where only meta
    // remains and an expired cache looks like a cached empty city.
    tx.set(metaKey(city), JSON.stringify(fullMeta), 'PXAT', expiresAtMs);

    if (hotels.length > 0) {
      const scoreMembers: (string | number)[] = [];
      for (const hotel of hotels) {
        scoreMembers.push(hotel.price, JSON.stringify(hotel));
      }
      tx.zadd(zsetKey(city), ...scoreMembers);
      tx.pexpireat(zsetKey(city), expiresAtMs);
    }

    const results = await tx.exec();
    const failure = results?.find(([err]) => err !== null)?.[0];
    if (results === null || failure) {
      throw failure ?? new Error('Redis transaction was aborted');
    }
  }

  /**
   * Reads meta + filtered offers in ONE transaction, so a TTL expiry between
   * two round-trips can never make a cached city look like an empty city.
   * The price filter is executed by Redis (ZRANGEBYSCORE), ordered by price.
   */
  async query(city: string, range: PriceRange = {}): Promise<CachedQueryResult> {
    const min = range.minPrice ?? '-inf';
    const max = range.maxPrice ?? '+inf';

    const results = await this.redis
      .multi()
      .get(metaKey(city))
      .zrangebyscore(zsetKey(city), min, max)
      .exec();

    if (results === null) throw new Error('Redis transaction was aborted');
    const [[metaErr, rawMeta], [zErr, rawMembers]] = results as [
      [Error | null, string | null],
      [Error | null, string[]],
    ];
    if (metaErr) throw metaErr;
    if (zErr) throw zErr;

    if (rawMeta === null) return { meta: null, hotels: [] };

    return {
      meta: JSON.parse(rawMeta) as CacheMeta,
      hotels: rawMembers.map((m) => JSON.parse(m) as HotelOffer),
    };
  }
}
