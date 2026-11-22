/**
 * Shared types. This file MUST stay free of Node/IO imports because it is
 * imported by Temporal workflow code, which runs in a deterministic sandbox.
 */

export type SupplierId = 'A' | 'B';

export const SUPPLIER_IDS: readonly SupplierId[] = ['A', 'B'] as const;

export const SUPPLIER_LABEL: Record<SupplierId, string> = {
  A: 'Supplier A',
  B: 'Supplier B',
};

/** Raw record as returned by a supplier API. */
export interface SupplierHotel {
  hotelId: string;
  name: string;
  price: number;
  city: string;
  commissionPct: number;
}

/** Normalised offer exposed by this service (the public response shape). */
export interface HotelOffer {
  name: string;
  price: number;
  supplier: string;
  commissionPct: number;
}

export interface HotelOffersWorkflowInput {
  city: string;
}

export interface HotelOffersWorkflowResult {
  city: string;
  hotels: HotelOffer[];
  /** true when at least one supplier could not be reached. */
  degraded: boolean;
  failedSuppliers: string[];
  generatedAt: string;
}

export interface FetchSupplierHotelsInput {
  supplier: SupplierId;
  city: string;
}

export interface SaveHotelsInput {
  city: string;
  hotels: HotelOffer[];
  degraded: boolean;
  failedSuppliers: string[];
}

export interface SaveHotelsResult {
  count: number;
  ttlSeconds: number;
}

export interface CacheMeta {
  updatedAt: string;
  count: number;
  degraded: boolean;
  failedSuppliers: string[];
}

/** Stable Temporal error type names shared between worker and API. */
export const ERROR_TYPES = {
  ALL_SUPPLIERS_UNAVAILABLE: 'AllSuppliersUnavailable',
  INVALID_SUPPLIER_RESPONSE: 'InvalidSupplierResponse',
  SUPPLIER_CLIENT_ERROR: 'SupplierClientError',
} as const;
