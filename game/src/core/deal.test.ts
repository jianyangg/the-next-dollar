import { describe, expect, it } from 'vitest';
import { breakEvenDailyProfit } from './deal';
import { TUNING } from './tuning';

/**
 * The seller screen's "must earn" figure. Expected values are worked by hand at the
 * shipped tuning (15% a day, built stand resells for $8.40), so a change to the formula
 * or to either constant shows up here as a number, not a silent shift on screen.
 */
describe('breakEvenDailyProfit', () => {
  it('uses the shipped rate and resale (the hand-worked numbers below assume them)', () => {
    expect(TUNING.hurdleRate).toBe(0.15);
    expect(TUNING.stallKitResale).toBe(8.4);
  });

  it('one day left: repay the bid plus a day of Grandma growth, minus the resale', () => {
    // 57 * 1.15 - 8.40 = 57.15: everything must come back by tonight.
    expect(breakEvenDailyProfit(57, 1)).toBe(57.15);
  });

  it('two days left: the level payment over two days', () => {
    // netCost = 57 - 8.4 / 1.15^2 = 50.6484; payment = netCost * 0.15 / (1 - 1/1.3225) = 31.15
    expect(breakEvenDailyProfit(57, 2)).toBe(31.15);
  });

  it('a whole summer left: close to Grandma rate on the bid', () => {
    expect(breakEvenDailyProfit(57, 30)).toBe(8.66);
    expect(breakEvenDailyProfit(57, 30)).toBeGreaterThan(57 * 0.15);
  });

  it('costs more the later you buy', () => {
    const byDaysLeft = [30, 20, 10, 5, 2, 1].map((n) => breakEvenDailyProfit(40, n));
    for (let i = 1; i < byDaysLeft.length; i++) expect(byDaysLeft[i]).toBeGreaterThan(byDaysLeft[i - 1]);
  });

  it('a bid at or below the resale value needs no profit at all', () => {
    expect(breakEvenDailyProfit(5, 1)).toBe(0);
  });
});
