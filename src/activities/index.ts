import { Context } from '@temporalio/activity';
import { ApplicationFailure } from '@temporalio/common';
import type { AppLogger } from '../utils/logger';
import type { HotelRepository } from '../services/hotel.repository';
import { fetchHotelsFromSupplier, SupplierRequestError } from '../services/supplier.client';
import {
  ERROR_TYPES,
  SUPPLIER_LABEL,
  type FetchSupplierHotelsInput,
  type HotelOffer,
  type SaveHotelsInput,
  type SaveHotelsResult,
  type SupplierId,
} from '../types/hotel';

export interface ActivityDeps {
  logger: AppLogger;
  repository: HotelRepository;
  supplierUrls: Record<SupplierId, string>;
  supplierTimeoutMs: number;
  cacheTtlSeconds: number;
  degradedCacheTtlSeconds: number;
}

/**
 * Activities hold ALL side effects (HTTP, Redis). They are created through a
 * factory so their dependencies are injected - the worker wires real ones, tests
 * can wire fakes - and the workflow only ever sees the resulting type.
 */
export function createActivities(deps: ActivityDeps) {
  return {
    /**
     * Calls one supplier and returns its hotels mapped to the public offer shape.
     * Throwing a *retryable* ApplicationFailure lets Temporal apply the retry
     * policy (backoff); a *non-retryable* one fails fast (e.g. malformed payload).
     */
    async fetchSupplierHotels(input: FetchSupplierHotelsInput): Promise<HotelOffer[]> {
      const info = Context.current().info;
      const log = deps.logger.child({
        activity: 'fetchSupplierHotels',
        workflowId: info.workflowExecution?.workflowId,
        runId: info.workflowExecution?.runId,
        attempt: info.attempt,
        supplier: input.supplier,
        city: input.city,
      });

      const startedAt = Date.now();
      try {
        const { hotels, droppedRecords } = await fetchHotelsFromSupplier(
          deps.supplierUrls[input.supplier],
          input.city,
          deps.supplierTimeoutMs,
        );

        if (droppedRecords > 0) {
          log.warn({ droppedRecords }, 'Dropped invalid supplier records');
        }
        log.info({ count: hotels.length, durationMs: Date.now() - startedAt }, 'Supplier call succeeded');

        return hotels.map((h) => ({
          name: h.name,
          price: h.price,
          supplier: SUPPLIER_LABEL[input.supplier],
          commissionPct: h.commissionPct,
        }));
      } catch (err) {
        if (err instanceof SupplierRequestError) {
          log.warn(
            { status: err.status, retryable: err.retryable, durationMs: Date.now() - startedAt },
            `Supplier call failed: ${err.message}`,
          );
          if (err.retryable) {
            throw ApplicationFailure.retryable(err.message, 'SupplierUnavailable');
          }
          const type =
            err.status !== undefined && err.status >= 400 && err.status < 500
              ? ERROR_TYPES.SUPPLIER_CLIENT_ERROR
              : ERROR_TYPES.INVALID_SUPPLIER_RESPONSE;
          throw ApplicationFailure.nonRetryable(err.message, type);
        }
        log.error({ err }, 'Unexpected error while calling supplier');
        throw err;
      }
    },

    /**
     * Persists the de-duplicated list in Redis (sorted set keyed by price).
     * Idempotent: it replaces the whole city atomically, so a retry is harmless.
     */
    async saveHotelsToCache(input: SaveHotelsInput): Promise<SaveHotelsResult> {
      const info = Context.current().info;
      const log = deps.logger.child({
        activity: 'saveHotelsToCache',
        workflowId: info.workflowExecution?.workflowId,
        attempt: info.attempt,
        city: input.city,
      });

      // Partial results are cached briefly so we re-check the failed supplier soon.
      const ttlSeconds = input.degraded ? deps.degradedCacheTtlSeconds : deps.cacheTtlSeconds;

      await deps.repository.replaceCity(
        input.city,
        input.hotels,
        {
          updatedAt: new Date().toISOString(),
          degraded: input.degraded,
          failedSuppliers: input.failedSuppliers,
        },
        ttlSeconds,
      );

      log.info({ count: input.hotels.length, ttlSeconds, degraded: input.degraded }, 'Saved hotels to Redis');
      return { count: input.hotels.length, ttlSeconds };
    },
  };
}

export type Activities = ReturnType<typeof createActivities>;
