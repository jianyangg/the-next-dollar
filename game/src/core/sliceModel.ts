import { type PlotId, PLOTS } from './plots';
import { type Tuning, TUNING } from './tuning';

export type PlotStatus = 'empty' | 'leased' | 'built';


export interface CustomerReview {
  id: number;
  stars: number;
  comment: string;
}

export type DayGrade = 'S' | 'A' | 'B' | 'C' | 'D';

export interface DayRecord {
  day: number;
  cupsSold: number;
  revenue: number;
  cogs: number;
  rentAndWages: number;
  nopat: number;
  hurdleCharge: number;
  /** YOU at that day's opening bell (cash + lemons + gear at resale): what the line's rate was charged on. */
  chargedOn: number;
  valueCreated: number;
  cumulativeValue: number;
  roicPct: number;
  grade: DayGrade;
}

export interface SliceState {
  day: number;
  maxDays: number;
  cash: number;
  /**
   * YOU at this morning's opening bell (`getWorth` when the day began). Today's line is
   * charged on this number and it does not move during the day, so the target the
   * player sees at 5 AM is the target the bell judges. Set by `startNextDay`.
   */
  openingWorth: number;
  /** YOU at each closing bell so far (index 0 = day 1), for the race against Grandma. */
  worthHistory: number[];
  inventoryValue: number;
  cupsInStock: number;
  equipmentValue: number;
  stallKits: number;
  pitchers: number;
  pricePerCup: number;
  // Staffing (daily operating wages)
  /**
   * Stands with a hired worker (one worker per stand, $10/day each). A staffed stand
   * keeps selling while the player is somewhere else (core/awaySales.ts).
   */
  staffedPlots: PlotId[];
  managers: number;
  /** Every plot in the city (core/plots.ts), keyed by plot id. */
  plots: Record<PlotId, PlotStatus>;
  /**
   * The day the player bought the seller's stand, or null. Its lease steps up from $3 to
   * $5 a day four days later (the seller's off-book fact), so rent needs this date.
   */
  sellerStandSince: number | null;
  // Daily income statement accumulators
  dayCupsSold: number;
  dayRevenue: number;
  dayCogs: number;
  dayRentPaid: number;
  // Cumulative career metrics & day-by-day history
  totalRevenue: number;
  totalCogs: number;
  totalRent: number;
  totalValueCreated: number;
  lastDayCapitalCharge: number;
  dayHistory: DayRecord[];
  // Customer satisfaction & reviews
  reviews: CustomerReview[];
  ratingAvg: number;
  // Seller deal (down the block)
  /** GDD: a deal is final for the whole career once won, rejected or walked away from. */
  dealStatus: 'open' | 'won' | 'rejected' | 'walked-away';
  dealBidPrice: number | null;
}

// These named constants are read from core/tuning.ts (the one place balance numbers live).
export const HURDLE_RATE = TUNING.hurdleRate;
export const WORKER_DAILY_WAGE = TUNING.workerDailyWage;
export const MANAGER_DAILY_WAGE = TUNING.managerDailyWage;
export const STALL_KIT_COST = TUNING.stallKitCost;

export function createInitialState(): SliceState {
  return {
    day: 1,
    maxDays: 30,
    cash: TUNING.startingCash,
    openingWorth: TUNING.startingCash,
    worthHistory: [],
    inventoryValue: 0,
    cupsInStock: 0,
    equipmentValue: 0,
    stallKits: 0,
    pitchers: 0,
    pricePerCup: 3,
    staffedPlots: [],
    managers: 0,
    plots: Object.fromEntries(PLOTS.map((p) => [p.id, 'empty' as PlotStatus])),
    sellerStandSince: null,
    dayCupsSold: 0,
    dayRevenue: 0,
    dayCogs: 0,
    dayRentPaid: 0,
    totalRevenue: 0,
    totalCogs: 0,
    totalRent: 0,
    totalValueCreated: 0,
    lastDayCapitalCharge: 0,
    dayHistory: [],
    reviews: [],
    ratingAvg: 5.0,
    dealStatus: 'open',
    dealBidPrice: null,
  };
}

export function getDailyWages(s: Pick<SliceState, 'staffedPlots' | 'managers'>, t: Tuning = TUNING): number {
  return s.staffedPlots.length * t.workerDailyWage + s.managers * t.managerDailyWage;
}

/** How many stands the player owns (built plots, including a bought seller stand). */
export function countOwnedStands(s: Pick<SliceState, 'plots'>): number {
  return Object.values(s.plots).filter((p) => p === 'built').length;
}

export function createReviewFromPatience(patienceRatio: number, id: number): CustomerReview {
  if (patienceRatio <= 0) {
    return { id, stars: 1, comment: 'Waited forever and left!' };
  }
  if (patienceRatio > 0.65) {
    return { id, stars: 5, comment: 'Super quick & icy cold!' };
  }
  if (patienceRatio >= 0.35) {
    return { id, stars: 4, comment: 'Good, short wait.' };
  }
  return { id, stars: 2, comment: 'Took way too long!' };
}

export function appendCustomerReview(
  state: SliceState,
  patienceRatio: number,
  id: number
): { reviews: CustomerReview[]; ratingAvg: number; review: CustomerReview } {
  const review = createReviewFromPatience(patienceRatio, id);
  const reviews = [...state.reviews, review];
  const totalStars = reviews.reduce((sum, r) => sum + r.stars, 0);
  const ratingAvg = +(totalStars / reviews.length).toFixed(1);
  return { reviews, ratingAvg, review };
}

/** Money tied up in stock and equipment (what the stands are built from). */
export function getInvestedCapital(s: SliceState): number {
  return s.inventoryValue + s.equipmentValue;
}

/**
 * The money today's line is charged on: YOU at this morning's opening bell
 * (`openingWorth`: cash + lemons + gear at resale value, see `getWorth`).
 *
 * Owner decision (2026-11-24): idle cash is charged too. The game is about where the
 * next dollar goes; if cash were free, the best play after a good week was to hold it
 * and the line shrank to nothing. Charging every dollar makes the line grow as the
 * player gets richer, so one stand stops being enough and the money must be put to
 * work (or knowingly held).
 *
 * Balance pass (2026-11-24, later the same day): the base is FROZEN at the opening bell
 * and counts gear at resale value. Before, it was read live (so every sale nudged the
 * target up while the player was chasing it) and counted gear at cost (so the price
 * paid for a stand could not affect the score).
 *
 * (The name is kept because the UI reads it; "money you started today with" is what it
 * now means.)
 */
export function getMoneyInBusiness(s: Pick<SliceState, 'openingWorth'>): number {
  return +s.openingWorth.toFixed(2);
}

/**
 * YOU: what the player would walk away with if they stopped right now. Cash, plus the
 * lemons on the shelf at what they cost, plus what the gear would SELL for (not what it
 * cost): each stall kit (built into a stand or still in the bag) and each pitcher at its
 * resale price (core/tuning.ts).
 *
 * WHY RESALE AND NOT COST
 *   If gear counted at cost, spending $60 on a stand would leave "You" unchanged, so the
 *   price paid would not matter: bid $42 or $60 for the seller's stand and the score was
 *   the same. Counting only what the gear would fetch means every purchase opens a hole
 *   (a $12 kit is worth $8.40 the moment it is bought; a $60 stand is worth one kit) that
 *   the stand has to earn back. That is the question a real buyer asks: does this pay for
 *   itself in the days I have left?
 *
 * This is the number raced against Grandma's bank (`grandmaWorth`).
 */
export function getWorth(
  s: Pick<SliceState, 'cash' | 'inventoryValue' | 'stallKits' | 'pitchers' | 'plots'>,
  t: Tuning = TUNING
): number {
  const kits = s.stallKits + countOwnedStands(s);
  return +(s.cash + s.inventoryValue + kits * t.stallKitResale + s.pitchers * t.pitcherResale).toFixed(2);
}

/**
 * GRANDMA'S BANK: what the starting loan would be worth after `daysClosed` closing bells
 * if it had simply been left in her bank, growing by the hurdle rate every day:
 * startingCash x (1 + rate)^days. It does not depend on anything the player does; that
 * is the point. It starts level with the player ($30 at day 0) and compounds, so a
 * business that only adds the same profit every day falls behind in the end.
 */
export function grandmaWorth(daysClosed: number, t: Tuning = TUNING): number {
  return +(t.startingCash * (1 + t.hurdleRate) ** Math.max(0, daysClosed)).toFixed(2);
}

export function getDayNopat(s: SliceState): number {
  return s.dayRevenue - s.dayCogs - s.dayRentPaid;
}

/**
 * What Grandma's bank would have paid today on the money the player started the day
 * with: the hurdle rate x `openingWorth`. Fixed for the whole day.
 */
export function getDailyHurdleCharge(s: Pick<SliceState, 'openingWorth'>, t: Tuning = TUNING): number {
  return +(getMoneyInBusiness(s) * t.hurdleRate).toFixed(2);
}

export function getTotalEquity(s: SliceState): number {
  return +(s.cash + s.inventoryValue + s.equipmentValue).toFixed(2);
}

/**
 * The day's letter grade from its return (profit as a % of the money the day started
 * with). The cut-offs are multiples of Grandma's rate, so they follow it if it is ever
 * retuned: B = matched her (the line was beaten), A = a third better, S = double.
 * At 15% a day: S 30%+, A 20%+, B 15%+, C 0%+, D a loss.
 */
export function computeDayGrade(roicPct: number, t: Tuning = TUNING): DayGrade {
  const ask = t.hurdleRate * 100;
  // Compared in hundredths of a percent so 15.0 is not lost to floating-point dust.
  const atLeast = (pct: number): boolean => Math.round(roicPct * 100) >= Math.round(pct * 100);
  if (atLeast(ask * 2)) return 'S';
  if (atLeast((ask * 4) / 3)) return 'A';
  if (atLeast(ask)) return 'B';
  if (atLeast(0)) return 'C';
  return 'D';
}
