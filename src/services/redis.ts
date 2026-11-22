import { Redis } from 'ioredis';
import type { AppLogger } from '../utils/logger';

export function createRedis(url: string, logger: AppLogger): Redis {
  const redis = new Redis(url, {
    // Fail commands fast instead of queueing forever when Redis is down, so an
    // HTTP request returns a clean 503 rather than hanging.
    maxRetriesPerRequest: 2,
    enableOfflineQueue: true,
    retryStrategy: (times) => Math.min(times * 200, 2_000),
    connectionName: 'hotel-offer-orchestrator',
  });

  redis.on('connect', () => logger.info('Redis connected'));
  redis.on('reconnecting', () => logger.warn('Redis reconnecting'));
  // Without a listener ioredis would throw on connection errors.
  redis.on('error', (err) => logger.error({ err: err.message }, 'Redis error'));

  return redis;
}
