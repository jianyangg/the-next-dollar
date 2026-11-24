import { describe, expect, it } from 'vitest';
import { awayCupsPerDay, stepAwaySales } from './awaySales';
import { SELLER_PLOT_ID } from './plots';
import { LONE_PLOT } from './standSales';
import { createInitialState, type SliceState } from './sliceModel';
import { cupCost, TUNING } from './tuning';

const CP = 'central-park/corner';
/** Central Park's side street: quiet enough that one worker can serve every buyer. */
const CP_SIDE = 'central-park/side';
const FIFTH = 'fifth-ave/corner';

/** A state with built, staffed stands on `plots` and `cups` lemons in stock. */
function staffed(plots: string[], cups: number, extra: Partial<SliceState> = {}): SliceState {
  const s = createInitialState();
  return {
    ...s,
    cupsInStock: cups,
    inventoryValue: cups * cupCost(),
    plots: { ...s.plots, ...Object.fromEntries(plots.map((p) => [p, 'built' as const])) },
    staffedPlots: plots,
    ...extra,
  };
}

const step = (state: SliceState, opts: Partial<Parameters<typeof stepAwaySales>[0]> = {}) =>
  stepAwaySales({ state, livePlotId: null, reservedCups: 0, dayFraction: 1, carry: {}, nextReviewId: 1, ...opts });

describe('away sales (staffed stands sell while the player is elsewhere)', () => {
  it('a staffed stand sells walkers x buy chance cups over a full day, as real sales', () => {
    // Central Park side street: 36 x 0.6 = 22 walkers; 78% buy at $3 -> 17.16 cups/day.
    expect(awayCupsPerDay(CP_SIDE, 3, LONE_PLOT)).toBeCloseTo(17.16);
    const r = step(staffed([CP_SIDE], 30));
    expect(r.sold).toBe(17);
    expect(r.carry[CP_SIDE]).toBeCloseTo(0.16); // the 0.16 of a cup waits for the next tick
    expect(r.state.dayRevenue).toBe(51);
    expect(r.state.dayCogs).toBe(17); // $1 of lemons a cup
    expect(r.state.cupsInStock).toBe(13);
    expect(r.nextReviewId).toBe(18);
  });

  it('one worker can pour only so many cups: a busy corner is capped at 20 a day', () => {
    // Central Park corner: 36 walkers x 78% = 28 buyers, but one worker serves 20.
    expect(TUNING.workerCupsPerDay).toBe(20);
    expect(awayCupsPerDay(CP, 3, LONE_PLOT)).toBe(20);
    expect(step(staffed([CP], 40)).sold).toBe(20);
  });

  it('price drives away demand the same way it drives the live queue', () => {
    expect(awayCupsPerDay(CP, 5, LONE_PLOT)).toBeLessThan(awayCupsPerDay(CP, 3, LONE_PLOT));
    // Fifth Ave shoppers pay up: $5 there out-sells $5 in the park by a wide margin.
    expect(awayCupsPerDay(FIFTH, 5, LONE_PLOT)).toBeGreaterThan(awayCupsPerDay(CP, 5, LONE_PLOT) * 2);
  });

  it('stands in one district share its crowd: two stands each keep 80% of their walkers', () => {
    const alone = step(staffed([CP_SIDE], 60)).sold; // 17
    const both = step(staffed([CP_SIDE, CP], 60));
    // Side street: 17.16 x 0.8 = 13.7 -> 13 cups. The second stand cost the first 4 cups.
    expect(both.carry[CP_SIDE]).toBeCloseTo(0.73, 1);
    expect(both.sold).toBe(13 + 20); // the corner is still capped by its one worker
    expect(13).toBeLessThan(alone);
  });

  it('a stand bought from a seller brings its own regulars: it does not split the crowd', () => {
    const withSeller = step(staffed([CP_SIDE, SELLER_PLOT_ID], 60));
    // The side street still sells its full 17; the seller's stand adds its own 5 (7 walkers x 78%).
    expect(withSeller.sold).toBe(17 + 5);
  });

  it('small ticks add up to the same cups as one big tick (nothing lost to rounding)', () => {
    let state = staffed([CP_SIDE], 30);
    let carry = {};
    let sold = 0;
    for (let i = 0; i < 100; i++) {
      const r = step(state, { dayFraction: 0.01, carry });
      state = r.state;
      carry = r.carry;
      sold += r.sold;
    }
    expect(sold).toBe(17);
  });

  it('skips the stand the player is serving in person, and unstaffed stands', () => {
    expect(step(staffed([CP], 20), { livePlotId: CP }).sold).toBe(0);
    const unstaffed = { ...staffed([CP], 20), staffedPlots: [] };
    expect(step(unstaffed).sold).toBe(0);
  });

  it('never sells cups already brewed at the live counter; a due cup with no lemons is a missed sale', () => {
    const r = step(staffed([CP_SIDE], 5), { reservedCups: 2 });
    expect(r.sold).toBe(3);
    expect(r.missed).toBe(14);
    expect(r.state.cupsInStock).toBe(2);
  });
});
