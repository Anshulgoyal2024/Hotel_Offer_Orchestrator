import { NativeConnection, Runtime, Worker } from '@temporalio/worker';
import { loadConfig } from './config';
import { createLogger, createTemporalLogger } from './utils/logger';
import { createRedis } from './services/redis';
import { HotelRepository } from './services/hotel.repository';
import { createActivities } from './activities';
import { errorMessage, retry } from './utils/errors';

async function main(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config, 'worker');

  // Must run before any other Temporal API: sends SDK logs through pino.
  Runtime.install({ logger: createTemporalLogger(logger) });

  const redis = createRedis(config.REDIS_URL, logger);
  const repository = new HotelRepository(redis);

  // Temporal may still be booting (docker compose) - retry instead of crashing.
  const connection = await retry(
    () => NativeConnection.connect({ address: config.TEMPORAL_ADDRESS }),
    {
      attempts: 30,
      initialDelayMs: 500,
      maxDelayMs: 5_000,
      onRetry: (err, attempt, delayMs) =>
        logger.warn({ attempt, delayMs, err: errorMessage(err) }, 'Temporal not reachable yet, retrying'),
    },
  );

  const worker = await Worker.create({
    connection,
    namespace: config.TEMPORAL_NAMESPACE,
    taskQueue: config.TEMPORAL_TASK_QUEUE,
    // Bundled by the SDK into the deterministic workflow sandbox.
    workflowsPath: require.resolve('./workflows'),
    activities: createActivities({
      logger,
      repository,
      supplierUrls: { A: config.SUPPLIER_A_URL, B: config.SUPPLIER_B_URL },
      supplierTimeoutMs: config.SUPPLIER_TIMEOUT_MS,
      cacheTtlSeconds: config.CACHE_TTL_SECONDS,
      degradedCacheTtlSeconds: config.DEGRADED_CACHE_TTL_SECONDS,
    }),
    shutdownGraceTime: '10s',
  });

  const stop = (signal: string): void => {
    logger.info({ signal }, 'Shutting down worker');
    worker.shutdown();
  };
  process.on('SIGTERM', () => stop('SIGTERM'));
  process.on('SIGINT', () => stop('SIGINT'));

  logger.info(
    { taskQueue: config.TEMPORAL_TASK_QUEUE, namespace: config.TEMPORAL_NAMESPACE, address: config.TEMPORAL_ADDRESS },
    'Worker started',
  );

  await worker.run(); // resolves after worker.shutdown() has drained in-flight tasks

  await Promise.allSettled([connection.close(), redis.quit()]);
  logger.info('Worker stopped');
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Fatal worker error:', err);
  process.exit(1);
});
