import { ApplicationFailure, TimeoutFailure, WorkflowFailedError } from '@temporalio/client';
import type { AppLogger } from '../utils/logger';
import type { TemporalClientProvider } from './temporal.provider';
import type { HotelRepository, PriceRange } from './hotel.repository';
import type { hotelOffersWorkflow } from '../workflows';
import {
  ERROR_TYPES,
  type HotelOffer,
  type HotelOffersWorkflowResult,
} from '../types/hotel';
import {
  DependencyUnavailableError,
  GatewayTimeoutError,
  UpstreamUnavailableError,
  errorMessage,
} from '../utils/errors';

export interface GetHotelsParams extends PriceRange {
  city: string;
  /** Bypass the Redis cache and force a fresh Temporal workflow run. */
  refresh: boolean;
}

export type CacheStatus = 'HIT' | 'MISS' | 'REFRESH';

export interface GetHotelsResult {
  hotels: HotelOffer[];
  cache: CacheStatus;
  degraded: boolean;
  failedSuppliers: string[];
  workflowId?: string;
}

export interface HotelOffersService {
  getHotels(params: GetHotelsParams): Promise<GetHotelsResult>;
}

export interface HotelOffersServiceOptions {
  taskQueue: string;
  workflowTimeoutSeconds: number;
}

/**
 * Application service behind GET /api/hotels.
 *
 *   cache hit  -> answer straight from Redis (price filter runs in Redis)
 *   cache miss -> run the Temporal workflow (parallel supplier calls, dedupe,
 *                 write to Redis) and answer from its result / from Redis.
 */
export class TemporalHotelOffersService implements HotelOffersService {
  constructor(
    private readonly temporal: TemporalClientProvider,
    private readonly repository: HotelRepository,
    private readonly options: HotelOffersServiceOptions,
    private readonly logger: AppLogger,
  ) {}

  async getHotels(params: GetHotelsParams): Promise<GetHotelsResult> {
    const { city, refresh, minPrice, maxPrice } = params;
    const range: PriceRange = { minPrice, maxPrice };
    const hasFilter = minPrice !== undefined || maxPrice !== undefined;

    if (!refresh) {
      const cached = await this.queryRedis(city, range);
      if (cached.meta) {
        this.logger.debug({ city, count: cached.hotels.length }, 'Served from Redis cache');
        return {
          hotels: cached.hotels,
          cache: 'HIT',
          degraded: cached.meta.degraded,
          failedSuppliers: cached.meta.failedSuppliers,
        };
      }
    }

    const { result, workflowId } = await this.runWorkflow(city);
    const cache: CacheStatus = refresh ? 'REFRESH' : 'MISS';

    // Without a filter the workflow result *is* the answer. With a filter, the
    // workflow has just written the list to Redis, so let Redis do the filtering.
    if (!hasFilter) {
      return {
        hotels: result.hotels,
        cache,
        degraded: result.degraded,
        failedSuppliers: result.failedSuppliers,
        workflowId,
      };
    }

    const filtered = await this.queryRedis(city, range);
    if (!filtered.meta) {
      // Written by the workflow a moment ago, so this means Redis dropped it (eviction / flush).
      throw new DependencyUnavailableError('Cached hotel list disappeared from Redis; please retry');
    }
    return {
      hotels: filtered.hotels,
      cache,
      degraded: result.degraded,
      failedSuppliers: result.failedSuppliers,
      workflowId,
    };
  }

  private async queryRedis(city: string, range: PriceRange) {
    try {
      return await this.repository.query(city, range);
    } catch (err) {
      this.logger.error({ err: errorMessage(err), city }, 'Redis query failed');
      throw new DependencyUnavailableError('Redis is unavailable');
    }
  }

  private async runWorkflow(city: string): Promise<{ result: HotelOffersWorkflowResult; workflowId: string }> {
    const workflowId = `hotel-offers:${city}`;

    try {
      const client = await this.temporal.getClient();

      // Deterministic workflow ID + USE_EXISTING: concurrent requests for the
      // same city attach to ONE in-flight aggregation instead of stampeding
      // the suppliers. Once it completes, the next request starts a fresh run.
      const handle = await client.workflow.start<typeof hotelOffersWorkflow>('hotelOffersWorkflow', {
        taskQueue: this.options.taskQueue,
        workflowId,
        args: [{ city }],
        workflowExecutionTimeout: `${this.options.workflowTimeoutSeconds} seconds`,
        workflowIdConflictPolicy: 'USE_EXISTING',
      });

      this.logger.info({ workflowId, runId: handle.firstExecutionRunId, city }, 'Workflow started');
      const result = await handle.result();
      return { result, workflowId };
    } catch (err) {
      throw this.mapWorkflowError(err, city, workflowId);
    }
  }

  private mapWorkflowError(err: unknown, city: string, workflowId: string): Error {
    if (err instanceof WorkflowFailedError) {
      const cause = err.cause;
      if (cause instanceof ApplicationFailure && cause.type === ERROR_TYPES.ALL_SUPPLIERS_UNAVAILABLE) {
        // The workflow passes one array of per-supplier reasons as its single detail.
        const reasons = cause.details?.flat();
        this.logger.error({ workflowId, city, reasons }, 'All suppliers unavailable');
        return new UpstreamUnavailableError('All hotel suppliers are currently unavailable', reasons);
      }
      if (cause instanceof TimeoutFailure) {
        this.logger.error({ workflowId, city }, 'Workflow timed out');
        return new GatewayTimeoutError('Hotel aggregation timed out');
      }
      this.logger.error({ workflowId, city, cause: errorMessage(cause) }, 'Workflow failed');
      return new UpstreamUnavailableError('Hotel aggregation failed');
    }

    if (err instanceof DependencyUnavailableError) return err;

    // Could not reach Temporal at all (connection refused, deadline exceeded...).
    this.logger.error({ workflowId, city, err: errorMessage(err) }, 'Temporal unavailable');
    return new DependencyUnavailableError('Workflow engine (Temporal) is unavailable');
  }
}
