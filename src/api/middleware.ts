import { randomUUID } from 'node:crypto';
import type { ErrorRequestHandler, RequestHandler } from 'express';
import { pinoHttp } from 'pino-http';
import type { AppLogger } from '../utils/logger';
import { AppError } from '../utils/errors';

export function requestLogger(logger: AppLogger): RequestHandler {
  return pinoHttp({
    logger,
    genReqId: (req, res) => {
      const incoming = req.headers['x-request-id'];
      const id = typeof incoming === 'string' && incoming.length <= 128 ? incoming : randomUUID();
      res.setHeader('X-Request-Id', id);
      return id;
    },
    customLogLevel: (_req, res, err) => {
      if (err || res.statusCode >= 500) return 'error';
      if (res.statusCode >= 400) return 'warn';
      return 'info';
    },
    // Keep health-check polling out of the logs.
    autoLogging: { ignore: (req) => req.url?.startsWith('/health') ?? false },
    serializers: {
      req: (req: { id: unknown; method: string; url: string }) => ({
        id: req.id,
        method: req.method,
        url: req.url,
      }),
      res: (res: { statusCode: number }) => ({ statusCode: res.statusCode }),
    },
  });
}

export const notFoundHandler: RequestHandler = (req, res) => {
  res.status(404).json({
    error: {
      code: 'NOT_FOUND',
      message: `Route ${req.method} ${req.path} not found`,
      requestId: req.id,
    },
  });
};

export function errorHandler(logger: AppLogger): ErrorRequestHandler {
  // Express identifies error middleware by its 4-argument signature.
  return (err, req, res, _next) => {
    if (err instanceof AppError) {
      res.status(err.statusCode).json({
        error: { code: err.code, message: err.message, details: err.details, requestId: req.id },
      });
      return;
    }

    // Malformed JSON bodies surface from express.json() as 400s.
    const status = (err as { status?: number; statusCode?: number }).status;
    if (status === 400) {
      res.status(400).json({
        error: { code: 'BAD_REQUEST', message: 'Malformed request body', requestId: req.id },
      });
      return;
    }

    logger.error({ err, requestId: req.id }, 'Unhandled error');
    res.status(500).json({
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error', requestId: req.id },
    });
  };
}
