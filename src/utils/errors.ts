/** Errors that map 1:1 to an HTTP response. Anything else becomes a 500. */
export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: unknown) {
    super(400, 'VALIDATION_ERROR', message, details);
  }
}

/** Every supplier failed - we have nothing to serve. */
export class UpstreamUnavailableError extends AppError {
  constructor(message: string, details?: unknown) {
    super(502, 'UPSTREAM_UNAVAILABLE', message, details);
  }
}

/** A required dependency (Temporal / Redis) is not reachable. */
export class DependencyUnavailableError extends AppError {
  constructor(message: string, details?: unknown) {
    super(503, 'DEPENDENCY_UNAVAILABLE', message, details);
  }
}

export class GatewayTimeoutError extends AppError {
  constructor(message: string) {
    super(504, 'GATEWAY_TIMEOUT', message);
  }
}

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

/** Retries `fn` with capped exponential backoff. Used for start-up connections. */
export async function retry<T>(
  fn: (attempt: number) => Promise<T>,
  opts: {
    attempts: number;
    initialDelayMs: number;
    maxDelayMs: number;
    onRetry?: (err: unknown, attempt: number, delayMs: number) => void;
  },
): Promise<T> {
  let delay = opts.initialDelayMs;
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn(attempt);
    } catch (err) {
      if (attempt >= opts.attempts) throw err;
      opts.onRetry?.(err, attempt, delay);
      await sleep(delay);
      delay = Math.min(delay * 2, opts.maxDelayMs);
    }
  }
}
