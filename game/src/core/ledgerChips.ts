import { cents } from './money';
import { projectDay } from './dayEnd';
import { getDailyHurdleCharge, type SliceState } from './sliceModel';

/**
 * Money chips: the in-world "receipt" that floats up when the player spends or earns.
 *
 *   Buy a pitcher  ->  [CASH −$10]  [GEAR +$10]  [PROFIT $0]
 *
 * WHY CHIPS ARE COMPUTED, NOT TYPED
 *   The old toasts were hand-written strings ("Cash -$10 · Equip +$10 · Profit $0").
 *   Each one restated a rule that already lives in core/purchases.ts, so the two could
 *   drift apart silently (change a price, forget the toast, and the game shows a false
 *   number). Here the chips are the DIFFERENCE between the economy before and after the
 *   action, so they are true by construction: whatever the rule did is what the player
 *   sees.
 *
 * WHAT THE CHIPS TEACH (the game's core lesson, capital allocation)
 *   - Buying stock or equipment moves money from CASH into STOCK or GEAR; PROFIT does
 *     not move. Showing "PROFIT $0" right next to "CASH −$10" is the whole point:
 *     spending is not the same as losing money.
 *   - PROFIT is today's profit exactly as the closing receipt will book it
 *     (core/dayEnd.ts projectDay: earned minus rent, wages and marketing), so a lease,
 *     a hire or a campaign shows what it really takes off today's profit.
 *   - The LINE chip shows only Grandma's part of the line (her rate on the money the
 *     day started with), which is fixed at the opening bell, so it never appears for
 *     same-day actions. A campaign does raise today's line, but by its own cost, and
 *     that cost is already in the PROFIT chip; showing it twice would read as a double
 *     loss. The chip is kept for comparisons across a bell.
 */

export type ChipKind = 'cash' | 'stock' | 'gear' | 'profit' | 'line';

export interface MoneyChip {
  kind: ChipKind;
  /**
   * Signed dollars, rounded to cents. For 'line' this is the change in the daily
   * charge of Grandma's rate (so +0.5 means "today asks for $0.50 more than before").
   */
  delta: number;
}

/** Display order: where the money came from, where it went, then what it means. */
const ORDER: ChipKind[] = ['cash', 'stock', 'gear', 'profit', 'line'];

/**
 * The chips for one action, from the economy before and after it.
 *
 * Rules:
 *   - cash / stock / gear appear only when they changed.
 *   - profit appears whenever any balance moved, INCLUDING when it is $0 (that zero is
 *     the lesson), and also on its own when only profit changed.
 *   - line appears only when the daily charge changed (never within one day, see above).
 * An action that changed none of these returns [] (callers show no chip strip).
 */
export function ledgerChips(before: SliceState, after: SliceState): MoneyChip[] {
  const deltas: Record<ChipKind, number> = {
    cash: cents(after.cash - before.cash),
    stock: cents(after.inventoryValue - before.inventoryValue),
    gear: cents(after.equipmentValue - before.equipmentValue),
    profit: cents(projectDay(after).nopat - projectDay(before).nopat),
    line: cents(getDailyHurdleCharge(after) - getDailyHurdleCharge(before)),
  };
  const balancesMoved = deltas.cash !== 0 || deltas.stock !== 0 || deltas.gear !== 0;

  return ORDER.filter((kind) => {
    if (kind === 'profit') return balancesMoved || deltas.profit !== 0;
    return deltas[kind] !== 0;
  }).map((kind) => ({ kind, delta: deltas[kind] }));
}
