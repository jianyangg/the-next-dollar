import { cents } from './money';
import { appendCustomerReview, SliceState } from './sliceModel';
import { cupCost, type Tuning, TUNING } from './tuning';

/**
 * One cup sold to the customer at the front of the queue.
 *
 * Cash and revenue rise by the cup price; the cup's cost leaves inventory and is
 * booked as cost of goods sold (COGS). The customer's remaining patience becomes a
 * star review. Both the player's manual serve and the hired manager's auto-serve
 * call this, so the two can never drift apart (they were copy-pasted before).
 */
export const LEMONADE_UNIT_COST = cupCost();

export function applySale(
  prev: SliceState,
  patienceRatio: number,
  reviewId: number,
  t: Tuning = TUNING
): SliceState {
  if (prev.cupsInStock <= 0) return prev;
  const unitCost = cupCost(t);
  const { reviews, ratingAvg } = appendCustomerReview(prev, patienceRatio, reviewId);
  return {
    ...prev,
    cash: cents(prev.cash + prev.pricePerCup),
    cupsInStock: prev.cupsInStock - 1,
    inventoryValue: Math.max(0, cents(prev.inventoryValue - unitCost)),
    dayCupsSold: prev.dayCupsSold + 1,
    dayRevenue: cents(prev.dayRevenue + prev.pricePerCup),
    dayCogs: cents(prev.dayCogs + unitCost),
    totalRevenue: cents(prev.totalRevenue + prev.pricePerCup),
    totalCogs: cents(prev.totalCogs + unitCost),
    reviews,
    ratingAvg,
  };
}

/** A customer ran out of patience and left: a 1-star review, no sale. */
export function applyWalkout(prev: SliceState, reviewId: number): SliceState {
  const { reviews, ratingAvg } = appendCustomerReview(prev, 0, reviewId);
  return { ...prev, reviews, ratingAvg };
}

/**
 * Label for the floating sale pop: the cash in, plus the combo count once it reaches 2.
 * The UI shows the excitement with size and colour (bigger, line-yellow combos), so the
 * text stays plain: no exclamation marks or emoji.
 */
export function salePopLabel(price: number, combo: number): string {
  return combo >= 2 ? `+$${price} x${combo}` : `+$${price}`;
}
