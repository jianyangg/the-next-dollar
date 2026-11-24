import { cents } from './money';
import { appendCustomerReview, SliceState } from './sliceModel';

/**
 * One cup sold to the customer at the front of the queue.
 *
 * Cash and revenue rise by the cup price; the cup's cost leaves inventory and is
 * booked as cost of goods sold (COGS). The customer's remaining patience becomes a
 * star review. Both the player's manual serve and the hired manager's auto-serve
 * call this, so the two can never drift apart (they were copy-pasted before).
 */
export const LEMONADE_UNIT_COST = 0.5;

export function applySale(prev: SliceState, patienceRatio: number, reviewId: number): SliceState {
  if (prev.cupsInStock <= 0) return prev;
  const { reviews, ratingAvg } = appendCustomerReview(prev, patienceRatio, reviewId);
  return {
    ...prev,
    cash: cents(prev.cash + prev.pricePerCup),
    cupsInStock: prev.cupsInStock - 1,
    inventoryValue: Math.max(0, cents(prev.inventoryValue - LEMONADE_UNIT_COST)),
    dayCupsSold: prev.dayCupsSold + 1,
    dayRevenue: cents(prev.dayRevenue + prev.pricePerCup),
    dayCogs: cents(prev.dayCogs + LEMONADE_UNIT_COST),
    totalRevenue: cents(prev.totalRevenue + prev.pricePerCup),
    totalCogs: cents(prev.totalCogs + LEMONADE_UNIT_COST),
    reviews,
    ratingAvg,
  };
}

/** A customer ran out of patience and left: a 1-star review, no sale. */
export function applyWalkout(prev: SliceState, reviewId: number): SliceState {
  const { reviews, ratingAvg } = appendCustomerReview(prev, 0, reviewId);
  return { ...prev, reviews, ratingAvg };
}

/** Label for the floating "+$3!!" pop; more exclamation marks as the combo grows. */
export function salePopLabel(price: number, combo: number): string {
  if (combo >= 4) return `+$${price}!!! 🔥 x${combo}`;
  if (combo >= 2) return `+$${price}!! x${combo}`;
  return `+$${price}!`;
}
