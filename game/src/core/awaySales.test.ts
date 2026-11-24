import { describe, expect, it } from 'vitest';
import { awayCupsPerDay, stepAwaySales } from './awaySales';
import { createInitialState, type SliceState } from './sliceModel';

const CP = 'central-park/corner';
const FIFTH = 'fifth-ave/corner';

/** A state with built, staffed stands on `plots` and `cups` lemons in stock. */
function staffed(plots: string[], cups: number, extra: Partial<SliceState> = {}): SliceState {
  const s = createInitialState();
  return {
    ...s,
    cupsInStock: cups,
    inventoryValue: cups * 0.5,
    plots: { ...s.plots, ...Object.fromEntries(plots.map((p) => [p, 'built' as const])) },
    staffedPlots: plots,
    ...extra,
  };
}

const step = (state: SliceState, opts: Partial<Parameters<typeof stepAwaySales>[0]> = {}) =>
  stepAwaySales({ state, livePlotId: null, reservedCups: 0, dayFraction: 1, carry: {}, nextReviewId: 1, ...opts });

describe('away sales (staffed stands sell while the player is elsewhere)', () => {
  it('a staffed corner sells walkers x buy chance cups over a full day, as real sales', () => {
    // Central Park corner: 6 + 2 x $2 rent = 10 walkers; 78% buy at $3 -> 7.8 cups/day.
    expect(awayCupsPerDay(CP, 3)).toBeCloseTo(7.8);
    const r = step(staffed([CP], 20));
    expect(r.sold).toBe(7);
    expect(r.carry[CP]).toBeCloseTo(0.8); // the 0.8 of a cup waits for the next tick
    expect(r.state.dayRevenue).toBe(21);
    expect(r.state.dayCogs).toBe(3.5);
    expect(r.state.cupsInStock).toBe(13);
    expect(r.nextReviewId).toBe(8);
  });

  it('price drives away demand the same way it drives the live queue', () => {
    expect(awayCupsPerDay(CP, 5)).toBeLessThan(awayCupsPerDay(CP, 3));
    // Fifth Ave shoppers pay up: $5 there out-sells $5 in the park by a wide margin.
    expect(awayCupsPerDay(FIFTH, 5)).toBeGreaterThan(awayCupsPerDay(CP, 5) * 2);
  });

  it('small ticks add up to the same cups as one big tick (nothing lost to rounding)', () => {
    let state = staffed([CP], 20);
    let carry = {};
    let sold = 0;
    for (let i = 0; i < 100; i++) {
      const r = step(state, { dayFraction: 0.01, carry });
      state = r.state;
      carry = r.carry;
      sold += r.sold;
    }
    expect(sold).toBe(7);
  });

  it('skips the stand the player is serving in person, and unstaffed stands', () => {
    expect(step(staffed([CP], 20), { livePlotId: CP }).sold).toBe(0);
    const unstaffed = { ...staffed([CP], 20), staffedPlots: [] };
    expect(step(unstaffed).sold).toBe(0);
  });

  it('never sells cups already brewed at the live counter; a due cup with no lemons is a missed sale', () => {
    const r = step(staffed([CP], 5), { reservedCups: 2 });
    expect(r.sold).toBe(3);
    expect(r.missed).toBe(4);
    expect(r.state.cupsInStock).toBe(2);
  });
});
