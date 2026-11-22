import pino, { type Logger } from 'pino';
import type { Logger as TemporalLogger, LogLevel, LogMetadata } from '@temporalio/worker';
import type { AppConfig } from '../config';

export type AppLogger = Logger;

export function createLogger(
  config: Pick<AppConfig, 'LOG_LEVEL' | 'NODE_ENV'>,
  component: string,
): AppLogger {
  return pino({
    level: config.NODE_ENV === 'test' ? 'silent' : config.LOG_LEVEL,
    base: { service: 'hotel-offer-orchestrator', component },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: ['req.headers.authorization', 'req.headers.cookie'],
  });
}

/**
 * Routes the Temporal SDK's own logs (worker, workflow `log.*`, activity
 * `Context.log`) through pino so everything is structured JSON in one stream.
 */
export function createTemporalLogger(logger: AppLogger): TemporalLogger {
  const write = (level: LogLevel, message: string, meta?: LogMetadata): void => {
    const method = level.toLowerCase() as 'trace' | 'debug' | 'info' | 'warn' | 'error';
    logger[method]({ temporal: meta }, message);
  };
  return {
    log: write,
    trace: (m, meta) => write('TRACE', m, meta),
    debug: (m, meta) => write('DEBUG', m, meta),
    info: (m, meta) => write('INFO', m, meta),
    warn: (m, meta) => write('WARN', m, meta),
    error: (m, meta) => write('ERROR', m, meta),
  };
}
