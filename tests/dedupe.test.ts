import { describe, expect, it } from 'vitest';
import { normalizeHotelName, selectBestOffers } from '../src/domain/dedupe';
import type { HotelOffer } from '../src/types/hotel';

const offer = (
  name: string,
  price: number,
  supplier: 'Supplier A' | 'Supplier B',
  commissionPct = 10,
): HotelOffer => ({ name, price, supplier, commissionPct });

describe('normalizeHotelName', () => {
  it('ignores case, accents and repeated whitespace', () => {
    expect(normalizeHotelName('  LEMON   Tree ')).toBe('lemon tree');
    expect(normalizeHotelName('Hôtel Métropole')).toBe('hotel metropole');
  });
});

describe('selectBestOffers', () => {
  it('keeps the cheaper offer when a hotel appears at both suppliers', () => {
    const result = selectBestOffers([
      offer('Holtin', 6000, 'Supplier A', 10),
      offer('Holtin', 5340, 'Supplier B', 20),
    ]);
    expect(result).toEqual([offer('Holtin', 5340, 'Supplier B', 20)]);
  });

  it('keeps single-supplier hotels untouched', () => {
    const result = selectBestOffers([
      offer('Hotel Aravali', 2900, 'Supplier A'),
      offer('Leela Ambience', 9800, 'Supplier B'),
    ]);
    expect(result.map((h) => h.name)).toEqual(['Hotel Aravali', 'Leela Ambience']);
  });

  it('treats differently-spelled names as the same hotel', () => {
    const result = selectBestOffers([
      offer('Lemon Tree', 4200, 'Supplier A'),
      offer('LEMON  TREE', 4300, 'Supplier B'),
    ]);
    expect(result).toHaveLength(1);
    expect(result[0]).toMatchObject({ name: 'Lemon Tree', price: 4200, supplier: 'Supplier A' });
  });

  it('breaks price ties by higher commission', () => {
    const result = selectBestOffers([
      offer('Ibis', 3800, 'Supplier A', 9),
      offer('Ibis', 3800, 'Supplier B', 12),
    ]);
    expect(result).toEqual([offer('Ibis', 3800, 'Supplier B', 12)]);
  });

  it('is independent of input order (full tie falls back to supplier label)', () => {
    const a = offer('Ibis', 3800, 'Supplier A', 10);
    const b = offer('Ibis', 3800, 'Supplier B', 10);
    expect(selectBestOffers([a, b])).toEqual(selectBestOffers([b, a]));
    expect(selectBestOffers([b, a])[0]?.supplier).toBe('Supplier A');
  });

  it('collapses duplicates within a single supplier too', () => {
    const result = selectBestOffers([offer('Ibis', 4000, 'Supplier A'), offer('Ibis', 3900, 'Supplier A')]);
    expect(result).toHaveLength(1);
    expect(result[0]?.price).toBe(3900);
  });

  it('sorts the output by price ascending', () => {
    const result = selectBestOffers([
      offer('C', 300, 'Supplier A'),
      offer('A', 100, 'Supplier B'),
      offer('B', 200, 'Supplier A'),
    ]);
    expect(result.map((h) => h.price)).toEqual([100, 200, 300]);
  });

  it('returns an empty list for no offers and never mutates its input', () => {
    expect(selectBestOffers([])).toEqual([]);
    const input = [offer('B', 2, 'Supplier A'), offer('A', 1, 'Supplier B')];
    const snapshot = structuredClone(input);
    selectBestOffers(input);
    expect(input).toEqual(snapshot);
  });
});
