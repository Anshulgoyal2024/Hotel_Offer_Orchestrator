import type { Redis } from 'ioredis';
import type { TemporalClientProvider } from './temporal.provider';
import { errorMessage } from '../utils/errors';

export interface DependencyHealth {
  status: 'up' | 'down';
  latencyMs: number;
  error?: string;
}

export interface HealthReport {
  status: 'ok' | 'degraded' | 'down';
  timestamp: string;
  uptimeSeconds: number;
  dependencies: {
    supplierA: DependencyHealth;
    supplierB: DependencyHealth;
    redis: DependencyHealth;
    temporal: DependencyHealth;
  };
}

export interface HealthService {
  check(): Promise<HealthReport>;
}

export interface HealthServiceDeps {
  redis: Pick<Redis, 'ping'>;
  temporal: Pick<TemporalClientProvider, 'ping'>;
  supplierUrls: { A: string; B: string };
  timeoutMs?: number;
}

/**
 * Readiness check.
 *   ok       every dependency is up
 *   degraded exactly one supplier is down (we can still serve partial results)
 *   down     Redis or Temporal is down, or BOTH suppliers are down -> HTTP 503
 */
export class DefaultHealthService implements HealthService {
  private readonly timeoutMs: number;

  constructor(private readonly deps: HealthServiceDeps) {
    this.timeoutMs = deps.timeoutMs ?? 2_000;
  }

  async check(): Promise<HealthReport> {
    const [supplierA, supplierB, redis, temporal] = await Promise.all([
      this.probe(() => this.pingSupplier(this.deps.supplierUrls.A)),
      this.probe(() => this.pingSupplier(this.deps.supplierUrls.B)),
      this.probe(async () => {
        await this.deps.redis.ping();
      }),
      this.probe(() => this.deps.temporal.ping(this.timeoutMs)),
    ]);

    const suppliersUp = [supplierA, supplierB].filter((s) => s.status === 'up').length;
    let status: HealthReport['status'] = 'ok';
    if (redis.status === 'down' || temporal.status === 'down' || suppliersUp === 0) {
      status = 'down';
    } else if (suppliersUp < 2) {
      status = 'degraded';
    }

    return {
      status,
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
      dependencies: { supplierA, supplierB, redis, temporal },
    };
  }

  private async pingSupplier(baseUrl: string): Promise<void> {
    const url = new URL(baseUrl);
    url.searchParams.set('city', '__healthcheck__');
    const response = await fetch(url, { signal: AbortSignal.timeout(this.timeoutMs) });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    await response.arrayBuffer(); // drain the body so the socket can be reused
  }

  private async probe(fn: () => Promise<void>): Promise<DependencyHealth> {
    const startedAt = Date.now();
    try {
      await Promise.race([
        fn(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`timed out after ${this.timeoutMs}ms`)), this.timeoutMs).unref(),
        ),
      ]);
      return { status: 'up', latencyMs: Date.now() - startedAt };
    } catch (err) {
      return { status: 'down', latencyMs: Date.now() - startedAt, error: errorMessage(err) };
    }
  }
}
