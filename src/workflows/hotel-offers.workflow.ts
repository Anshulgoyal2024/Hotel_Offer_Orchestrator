import { ApplicationFailure, log, proxyActivities } from '@temporalio/workflow';
// Type-only import: erased at compile time, so no Node code reaches the sandbox.
import type { Activities } from '../activities';
import { selectBestOffers } from '../domain/dedupe';
import {
  ERROR_TYPES,
  SUPPLIER_IDS,
  SUPPLIER_LABEL,
  type HotelOffer,
  type HotelOffersWorkflowInput,
  type HotelOffersWorkflowResult,
  type SupplierId,
} from '../types/hotel';

/**
 * Supplier calls: transient failures (5xx, timeouts, connection errors) are
 * retried with exponential backoff, 3 attempts max, so a flaky supplier gets
 * a chance without holding the HTTP request hostage for long.
 * Non-retryable errors (4xx, malformed payload) fail immediately.
 */
const { fetchSupplierHotels } = proxyActivities<Activities>({
  startToCloseTimeout: '10 seconds',
  retry: {
    initialInterval: '500 milliseconds',
    backoffCoefficient: 2,
    maximumInterval: '4 seconds',
    maximumAttempts: 3,
    nonRetryableErrorTypes: [ERROR_TYPES.INVALID_SUPPLIER_RESPONSE, ERROR_TYPES.SUPPLIER_CLIENT_ERROR],
  },
});

/** Redis write: cheap and idempotent, so retry more aggressively. */
const { saveHotelsToCache } = proxyActivities<Activities>({
  startToCloseTimeout: '10 seconds',
  retry: {
    initialInterval: '200 milliseconds',
    backoffCoefficient: 2,
    maximumInterval: '2 seconds',
    maximumAttempts: 5,
  },
});

function describeFailure(reason: unknown): string {
  if (reason instanceof Error) {
    // ActivityFailure wraps the real cause one level down.
    const cause = (reason as Error & { cause?: Error }).cause;
    return cause?.message ?? reason.message;
  }
  return String(reason);
}

/**
 * Orchestrates one aggregation for a city:
 *   1. call Supplier A and Supplier B in PARALLEL
 *   2. tolerate one supplier failing (degraded result); fail if both fail
 *   3. de-duplicate by hotel name keeping the cheapest offer
 *   4. persist the result in Redis
 *   5. return the list
 */
export async function hotelOffersWorkflow(
  input: HotelOffersWorkflowInput,
): Promise<HotelOffersWorkflowResult> {
  const { city } = input;
  log.info('Aggregation started', { city });

  const settled = await Promise.allSettled(
    SUPPLIER_IDS.map((supplier: SupplierId) => fetchSupplierHotels({ supplier, city })),
  );

  const offers: HotelOffer[] = [];
  const failedSuppliers: string[] = [];
  const failureReasons: string[] = [];

  settled.forEach((outcome, index) => {
    const label = SUPPLIER_LABEL[SUPPLIER_IDS[index] as SupplierId];
    if (outcome.status === 'fulfilled') {
      log.info('Supplier returned offers', { city, supplier: label, count: outcome.value.length });
      offers.push(...outcome.value);
    } else {
      const reason = describeFailure(outcome.reason);
      failedSuppliers.push(label);
      failureReasons.push(`${label}: ${reason}`);
      log.error('Supplier failed after retries', { city, supplier: label, reason });
    }
  });

  if (failedSuppliers.length === SUPPLIER_IDS.length) {
    throw ApplicationFailure.nonRetryable(
      `All suppliers are unavailable for city "${city}"`,
      ERROR_TYPES.ALL_SUPPLIERS_UNAVAILABLE,
      failureReasons,
    );
  }

  const hotels = selectBestOffers(offers);
  const degraded = failedSuppliers.length > 0;

  await saveHotelsToCache({ city, hotels, degraded, failedSuppliers });

  log.info('Aggregation finished', { city, hotels: hotels.length, degraded });

  return {
    city,
    hotels,
    degraded,
    failedSuppliers,
    generatedAt: new Date().toISOString(),
  };
}
