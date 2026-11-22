import type { Server } from 'node:http';
import { loadConfig } from './config';
import { createLogger } from './utils/logger';
import { createRedis } from './services/redis';
import { HotelRepository } from './services/hotel.repository';
import { TemporalClientProvider } from './services/temporal.provider';
import { TemporalHotelOffersService } from './services/hotel-offers.service';
import { DefaultHealthService } from './services/health.service';
import { createApp } from './api/app';

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config, 'api');

  const redis = createRedis(config.REDIS_URL, logger);
  const temporal = new TemporalClientProvider(config.TEMPORAL_ADDRESS, config.TEMPORAL_NAMESPACE, logger);
  const repository = new HotelRepository(redis);

  const app = createApp({
    logger,
    mockChaosEnabled: config.MOCK_CHAOS_ENABLED,
    hotelOffers: new TemporalHotelOffersService(
      temporal,
      repository,
      { taskQueue: config.TEMPORAL_TASK_QUEUE, workflowTimeoutSeconds: config.WORKFLOW_TIMEOUT_SECONDS },
      logger,
    ),
    health: new DefaultHealthService({
      redis,
      temporal,
      supplierUrls: { A: config.SUPPLIER_A_URL, B: config.SUPPLIER_B_URL },
    }),
  });

  const server: Server = app.listen(config.PORT, () => {
    logger.info({ port: config.PORT }, 'API listening');
  });

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Shutting down');

    // Hard stop if connections refuse to drain.
    const force = setTimeout(() => {
      logger.error('Forced shutdown after timeout');
      process.exit(1);
    }, 10_000);
    force.unref();

    server.close(async () => {
      await Promise.allSettled([redis.quit(), temporal.close()]);
      logger.info('Shutdown complete');
      process.exit(0);
    });
    server.closeIdleConnections();
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('unhandledRejection', (reason) => {
    logger.error({ reason }, 'Unhandled promise rejection');
  });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Fatal start-up error:', err);
  process.exit(1);
});
