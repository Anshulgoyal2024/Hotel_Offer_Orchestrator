import { z } from 'zod';
import type { SupplierHotel } from '../types/hotel';

/**
 * Thin HTTP client for a supplier API. It knows nothing about Temporal: it
 * throws `SupplierRequestError` and tags whether a retry could help, and the
 * activity layer translates that into Temporal retryable / non-retryable errors.
 */

export class SupplierRequestError extends Error {
  constructor(
    message: string,
    public readonly retryable: boolean,
    public readonly status?: number,
  ) {
    super(message);
    this.name = 'SupplierRequestError';
  }
}

const supplierHotelSchema = z.object({
  hotelId: z.string().min(1),
  name: z.string().trim().min(1),
  price: z.number().finite().nonnegative(),
  city: z.string().min(1),
  commissionPct: z.number().finite().min(0).max(100),
});

export interface SupplierFetchResult {
  hotels: SupplierHotel[];
  /** Records that failed validation and were skipped (reported, never fatal). */
  droppedRecords: number;
}

export async function fetchHotelsFromSupplier(
  baseUrl: string,
  city: string,
  timeoutMs: number,
): Promise<SupplierFetchResult> {
  const url = new URL(baseUrl);
  url.searchParams.set('city', city);

  let response: Response;
  try {
    response = await fetch(url, {
      headers: { accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    // Network failure, DNS, connection refused or timeout: transient by nature.
    const reason = err instanceof Error ? err.message : String(err);
    throw new SupplierRequestError(`Request to ${url.origin}${url.pathname} failed: ${reason}`, true);
  }

  if (!response.ok) {
    const transient = response.status >= 500 || response.status === 429 || response.status === 408;
    throw new SupplierRequestError(
      `Supplier responded with HTTP ${response.status}`,
      transient,
      response.status,
    );
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new SupplierRequestError('Supplier returned a body that is not valid JSON', false, response.status);
  }

  if (!Array.isArray(body)) {
    throw new SupplierRequestError('Supplier response is not a JSON array', false, response.status);
  }

  const hotels: SupplierHotel[] = [];
  let droppedRecords = 0;
  for (const record of body) {
    const parsed = supplierHotelSchema.safeParse(record);
    if (parsed.success) {
      hotels.push(parsed.data);
    } else {
      droppedRecords++;
    }
  }
  return { hotels, droppedRecords };
}
