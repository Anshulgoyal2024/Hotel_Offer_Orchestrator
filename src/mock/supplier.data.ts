import type { SupplierHotel } from '../types/hotel';

/**
 * Deterministic mock catalogue. Hotel names deliberately overlap between the
 * two suppliers so that the de-duplication / best-price logic is meaningful:
 *
 *  - Holtin / Radison / Taj Palace / ITC Maurya: A and B disagree on price
 *  - "LEMON  TREE" (B) vs "Lemon Tree" (A): same hotel, different spelling
 *  - Ibis: identical price at both suppliers (tie-break on commission)
 *  - Hotel Aravali (A only) and Leela Ambience (B only): single-supplier hotels
 */

export const SUPPLIER_A_HOTELS: readonly SupplierHotel[] = [
  { hotelId: 'a1', name: 'Holtin', price: 6000, city: 'delhi', commissionPct: 10 },
  { hotelId: 'a2', name: 'Radison', price: 5900, city: 'delhi', commissionPct: 13 },
  { hotelId: 'a3', name: 'Taj Palace', price: 12500, city: 'delhi', commissionPct: 15 },
  { hotelId: 'a4', name: 'ITC Maurya', price: 11000, city: 'delhi', commissionPct: 12 },
  { hotelId: 'a5', name: 'Lemon Tree', price: 4200, city: 'delhi', commissionPct: 11 },
  { hotelId: 'a6', name: 'Ibis', price: 3800, city: 'delhi', commissionPct: 9 },
  { hotelId: 'a7', name: 'Hotel Aravali', price: 2900, city: 'delhi', commissionPct: 8 },

  { hotelId: 'a8', name: 'Taj Mahal Palace', price: 18000, city: 'mumbai', commissionPct: 15 },
  { hotelId: 'a9', name: 'Trident', price: 9500, city: 'mumbai', commissionPct: 12 },
  { hotelId: 'a10', name: 'Sea Princess', price: 6500, city: 'mumbai', commissionPct: 10 },

  { hotelId: 'a11', name: 'The Leela Palace', price: 14000, city: 'bangalore', commissionPct: 14 },
  { hotelId: 'a12', name: 'Ibis', price: 3500, city: 'bangalore', commissionPct: 9 },
];

export const SUPPLIER_B_HOTELS: readonly SupplierHotel[] = [
  { hotelId: 'b1', name: 'Holtin', price: 5340, city: 'delhi', commissionPct: 20 },
  { hotelId: 'b2', name: 'Radison', price: 6200, city: 'delhi', commissionPct: 15 },
  { hotelId: 'b3', name: 'Taj Palace', price: 12000, city: 'delhi', commissionPct: 18 },
  { hotelId: 'b4', name: 'ITC Maurya', price: 11500, city: 'delhi', commissionPct: 10 },
  { hotelId: 'b5', name: 'LEMON  TREE', price: 4300, city: 'delhi', commissionPct: 14 },
  { hotelId: 'b6', name: 'Ibis', price: 3800, city: 'delhi', commissionPct: 12 },
  { hotelId: 'b7', name: 'Leela Ambience', price: 9800, city: 'delhi', commissionPct: 14 },

  { hotelId: 'b8', name: 'Taj Mahal Palace', price: 17200, city: 'mumbai', commissionPct: 16 },
  { hotelId: 'b9', name: 'Trident', price: 9800, city: 'mumbai', commissionPct: 11 },
  { hotelId: 'b10', name: 'Lemon Tree Premier', price: 5200, city: 'mumbai', commissionPct: 13 },

  { hotelId: 'b11', name: 'The Leela Palace', price: 13500, city: 'bangalore', commissionPct: 15 },
  { hotelId: 'b12', name: 'Taj MG Road', price: 9000, city: 'bangalore', commissionPct: 12 },
];
