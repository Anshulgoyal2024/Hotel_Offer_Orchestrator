import type { HotelOffer } from '../types/hotel';

/**
 * Pure, deterministic business logic (no I/O, no clocks, no randomness) so it
 * can run inside a Temporal workflow and be unit-tested in isolation.
 */

/**
 * Canonical key used to decide whether two listings are "the same hotel":
 * case-insensitive, accent-insensitive and whitespace-insensitive.
 *   "LEMON  TREE " === "Lemon Tree"
 */
export function normalizeHotelName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/**
 * Is `candidate` a strictly better offer than `current` for the same hotel?
 *  1. cheaper price wins
 *  2. on equal price, higher commission wins (better margin for the marketplace)
 *  3. on equal price and commission, the lexicographically smaller supplier
 *     label wins - this makes the result independent of input order.
 */
export function isBetterOffer(candidate: HotelOffer, current: HotelOffer): boolean {
  if (candidate.price !== current.price) return candidate.price < current.price;
  if (candidate.commissionPct !== current.commissionPct) {
    return candidate.commissionPct > current.commissionPct;
  }
  return candidate.supplier < current.supplier;
}

/**
 * Collapses offers from any number of suppliers to the single best offer per
 * hotel name. Hotels present at only one supplier are kept as-is.
 * Output is sorted by price (asc) then name, so it is stable and cache friendly.
 */
export function selectBestOffers(offers: readonly HotelOffer[]): HotelOffer[] {
  const best = new Map<string, HotelOffer>();

  for (const offer of offers) {
    const key = normalizeHotelName(offer.name);
    const current = best.get(key);
    if (current === undefined || isBetterOffer(offer, current)) {
      best.set(key, offer);
    }
  }

  return [...best.values()].sort((a, b) => {
    if (a.price !== b.price) return a.price - b.price;
    if (a.name !== b.name) return a.name < b.name ? -1 : 1;
    return 0;
  });
}
