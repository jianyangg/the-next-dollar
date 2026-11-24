import { NEIGHBORHOODS } from './neighborhoods';
import type { SliceState } from './sliceModel';

/**
 * Daily rent the player owes: every leased or built plot in a business district,
 * plus $3/day for the seller's stand once the player has bought it.
 *
 * This loop used to be copy-pasted in App.tsx (the live HUD estimate and the
 * end-of-day close). One function guarantees the HUD shows the same rent the day
 * close actually charges.
 */
export const ACQUIRED_SELLER_STAND_RENT = 3;

export function getDailyPlotRent(s: Pick<SliceState, 'plots' | 'dealStatus'>): number {
  let total = 0;
  for (const n of NEIGHBORHOODS) {
    if (n.id !== 'market' && s.plots[n.id] !== 'empty') {
      total += n.dailyRent;
    }
  }
  if (s.dealStatus === 'won') {
    total += ACQUIRED_SELLER_STAND_RENT;
  }
  return +total.toFixed(2);
}
