import { describe, expect, it } from 'vitest';
import { buyLemons, buyStallKit } from './purchases';
import { createInitialState, type SliceState } from './sliceModel';
import { missingStarterItems, starterShortfall } from './tutorial';

const bought = (r: ReturnType<typeof buyLemons>): SliceState => {
  if (!r.ok) throw new Error(`purchase refused: ${r.reason}`);
  return r.state;
};

describe('tutorial spending guard', () => {
  it('a fresh run is missing all three starter items', () => {
    expect(missingStarterItems(createInitialState())).toEqual(['stall-kit', 'pitcher', 'lemons']);
  });

  it('blocks the second crate that would strand the player without a pitcher', () => {
    // $30 -> kit ($12) -> $18 -> crate ($5) -> $13. A second crate would leave $8 < $10 pitcher.
    const afterKitAndCrate = bought(buyLemons(bought(buyStallKit(createInitialState()))));
    expect(afterKitAndCrate.cash).toBe(13);
    expect(starterShortfall(afterKitAndCrate, 'lemons')).toEqual({ reservedFor: ['pitcher'], reserve: 10 });
    // The pitcher itself is still allowed ($13 - $10 = $3, nothing else missing).
    expect(starterShortfall(afterKitAndCrate, 'pitcher')).toBeNull();
  });

  it('reserves money for the other missing items, not the one being bought', () => {
    const s = { ...createInitialState(), cash: 20 };
    // Buying the kit ($12) leaves $8, but pitcher + lemons need $15.
    expect(starterShortfall(s, 'stall-kit')).toEqual({ reservedFor: ['pitcher', 'lemons'], reserve: 15 });
    // Buying lemons ($5) leaves $15, but kit + pitcher need $22.
    expect(starterShortfall(s, 'lemons')).toEqual({ reservedFor: ['stall-kit', 'pitcher'], reserve: 22 });
  });

  it('the full starter set ($27) fits in the starting $30 in any order', () => {
    const s = createInitialState();
    expect(starterShortfall(s, 'stall-kit')).toBeNull();
    expect(starterShortfall(s, 'pitcher')).toBeNull();
    expect(starterShortfall(s, 'lemons')).toBeNull();
  });

  it('an owned stand counts as having the kit', () => {
    const s = { ...createInitialState(), ownedStands: 1 };
    expect(missingStarterItems(s)).toEqual(['pitcher', 'lemons']);
  });
});
