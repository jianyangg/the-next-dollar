import { describe, expect, it } from 'vitest';
import { CENTRAL_PARK_DEAL, toPublicView, type PublicDealView as CorePublicDealView } from '../src/core/deal.ts';
import type { NeighborhoodId } from '../src/core/neighborhoods.ts';
import { NEIGHBORHOOD_IDS, publicDealViewSchema, type PublicDealData } from './dealSchema.ts';
import { PUBLIC_DEALS, getPublicDeal, type PublicDealView } from './deals/index.ts';

// Compile-time proof that the zod schema and the shared PublicDealView describe
// the same shape. If either side changes alone, `npm run typecheck` fails here.
type Equal<A, B> = (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
const sameShape: Equal<PublicDealData, PublicDealView> = true;
const coreReexportsShared: Equal<CorePublicDealView, PublicDealView> = true;
const sameNeighborhoods: Equal<(typeof NEIGHBORHOOD_IDS)[number], NeighborhoodId> = true;

describe('publicDealViewSchema', () => {
  it('keeps the schema and the shared type in step (compile-time check)', () => {
    expect(sameShape && sameNeighborhoods && coreReexportsShared).toBe(true);
  });

  it('accepts the Central Park deal after toPublicView strips the hidden minimum', () => {
    const result = publicDealViewSchema.safeParse(toPublicView(CENTRAL_PARK_DEAL));
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toEqual(toPublicView(CENTRAL_PARK_DEAL));
  });

  it('rejects a deal that still carries reservationPrice (strict object)', () => {
    // CENTRAL_PARK_DEAL itself is a full Deal: it has reservationPrice: 42.
    expect(publicDealViewSchema.safeParse(CENTRAL_PARK_DEAL).success).toBe(false);
  });

  it('rejects reservationPrice smuggled inside a nested object', () => {
    const nested = { ...toPublicView(CENTRAL_PARK_DEAL), books: [{ ...CENTRAL_PARK_DEAL.books[0], reservationPrice: 42 }] };
    expect(publicDealViewSchema.safeParse(nested).success).toBe(false);
  });
});

describe('the server-owned deal registry', () => {
  it('only holds well-formed public deals, keyed by their own id, with no hidden minimum', () => {
    for (const [id, entry] of Object.entries(PUBLIC_DEALS)) {
      expect(entry.deal.id).toBe(id);
      expect(publicDealViewSchema.safeParse(entry.deal).success).toBe(true);
      expect(JSON.stringify(entry)).not.toMatch(/reservation/i);
    }
  });

  it('the game deal is the registry deal plus only the hidden minimum', () => {
    expect(toPublicView(CENTRAL_PARK_DEAL)).toEqual(PUBLIC_DEALS['central-park-seller-1']?.deal);
    expect(CENTRAL_PARK_DEAL.reservationPrice).toBe(42);
  });

  it('getPublicDeal finds registered ids and nothing else, even inherited object keys', () => {
    expect(getPublicDeal('central-park-seller-1')?.persona.name).toBe('Dana Reyes');
    for (const id of ['nope', '', 'constructor', '__proto__', 'toString', 'hasOwnProperty']) {
      expect(getPublicDeal(id)).toBeUndefined();
    }
  });
});
