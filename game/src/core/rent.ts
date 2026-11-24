import { getPlot, SELLER_PLOT_ID, SELLER_RENT_AFTER, SELLER_RENT_BEFORE, SELLER_RENT_STEP_DAYS } from './plots';
import type { SliceState } from './sliceModel';
import { type Tuning, TUNING } from './tuning';

/**
 * Daily rent the player owes: the rent of every plot they lease or have built on.
 *
 * Each plot has its own rent (core/plots.ts): corner = the district's rent, side
 * street $1 less, plaza $2 more. The bought seller's stand is a plot too; its rent is
 * $3 a day and steps up to $5 four days after the purchase. That step-up is one of the
 * seller's off-book facts, so here it is a real cost the player discovers (or learned
 * by asking the right question before bidding).
 *
 * One function, used by the live HUD meter, the Books and the day close, so all three
 * always charge the same rent.
 */
export function getPlotRent(
  s: Pick<SliceState, 'day' | 'sellerStandSince'>,
  plotId: string,
  t: Tuning = TUNING
): number {
  if (plotId === SELLER_PLOT_ID) {
    const since = s.sellerStandSince;
    const base = since !== null && s.day >= since + SELLER_RENT_STEP_DAYS ? SELLER_RENT_AFTER : SELLER_RENT_BEFORE;
    return +(base * t.rentScale).toFixed(2);
  }
  return +(getPlot(plotId).dailyRent * t.rentScale).toFixed(2);
}

export function getDailyPlotRent(
  s: Pick<SliceState, 'plots' | 'day' | 'sellerStandSince'>,
  t: Tuning = TUNING
): number {
  let total = 0;
  for (const [id, status] of Object.entries(s.plots)) {
    if (status !== 'empty') total += getPlotRent(s, id, t);
  }
  return +total.toFixed(2);
}
