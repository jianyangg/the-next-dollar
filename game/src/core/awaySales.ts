import { getConversionProb } from './demand';
import { getNeighborhood } from './neighborhoods';
import { getPlot, type PlotId } from './plots';
import { applySale } from './sales';
import type { SliceState } from './sliceModel';

/**
 * AWAY SALES: a stand with a hired worker keeps selling while the player is somewhere
 * else (another plot, another district, the market).
 *
 * Why this exists: owner decision (2026-11-24) "Staffed stands sell". Before, a worker
 * only widened the brew sweet spots, so a second stand was rent with no income and the
 * only way to grow was to stand at one counter. Now every extra stand is a real bet:
 * rent + a $3 wage against walkers x buy chance x price, using the SAME demand rule
 * (core/demand.ts) and the SAME sale rule (core/sales.ts) as the live stand.
 *
 * How it works (deterministic, no dice):
 *   - Each clock tick moves the day forward by `dayFraction` (0..1 of the whole day).
 *   - Each staffed, built plot the player is NOT running in person "expects" to sell
 *     walkersPerDay x buyChance x dayFraction cups in that slice of time.
 *   - Those fractions pile up in `carry` (per plot). Every time a plot's carry reaches a
 *     whole cup, one real sale happens through `applySale`, so cash, revenue, COGS and
 *     the day's line meter all move exactly as for a cup the player sells.
 *   Using expected values instead of random rolls keeps away income steady and easy to
 *   reason about (and tests exact); the live stand is where the chance lives.
 *
 * Stock is shared: every stand sells from the same lemons. Cups the player has already
 * brewed at the live counter (`reservedCups`) are not available to the away stands.
 * When the lemons run out, a whole cup that was due becomes a MISSED sale: the walker
 * wanted one and left. The store reports those so the player learns stock is the limit.
 *
 * Reviews: an away cup gets a middling review (patience 0.6). The worker served it, not
 * the player, and a stand you never visit should not earn five stars.
 */

export const AWAY_SALE_PATIENCE = 0.6;

export interface AwayStepInput {
  state: SliceState;
  /** The plot the player is running in person (its sales come from the 3D scene), or null. */
  livePlotId: PlotId | null;
  /** Cups already brewed at the live counter, which away stands must not sell. */
  reservedCups: number;
  /** Share of the whole day this tick covers (0..1). */
  dayFraction: number;
  /** Fractional cups owed to each plot from earlier ticks. */
  carry: Readonly<Record<PlotId, number>>;
  nextReviewId: number;
}

export interface AwayStepResult {
  state: SliceState;
  carry: Record<PlotId, number>;
  nextReviewId: number;
  /** Cups sold by away stands in this tick. */
  sold: number;
  /** Cups that walkers wanted but there were no lemons left for. */
  missed: number;
}

/** Cups per full day a staffed plot is expected to sell at the current price. */
export function awayCupsPerDay(plotId: PlotId, pricePerCup: number): number {
  const plot = getPlot(plotId);
  const buyChance = getConversionProb(pricePerCup, getNeighborhood(plot.district).priceSensitivity);
  return plot.walkersPerDay * buyChance;
}

export function stepAwaySales(input: AwayStepInput): AwayStepResult {
  let { state, nextReviewId } = input;
  const carry: Record<PlotId, number> = { ...input.carry };
  let sold = 0;
  let missed = 0;
  if (input.dayFraction <= 0) return { state, carry, nextReviewId, sold, missed };

  for (const plotId of state.staffedPlots) {
    if (plotId === input.livePlotId || state.plots[plotId] !== 'built') continue;
    let owed = (carry[plotId] ?? 0) + awayCupsPerDay(plotId, state.pricePerCup) * input.dayFraction;
    while (owed >= 1) {
      owed -= 1;
      if (state.cupsInStock - input.reservedCups >= 1) {
        state = applySale(state, AWAY_SALE_PATIENCE, nextReviewId);
        nextReviewId += 1;
        sold += 1;
      } else {
        missed += 1;
      }
    }
    carry[plotId] = owed;
  }
  return { state, carry, nextReviewId, sold, missed };
}
