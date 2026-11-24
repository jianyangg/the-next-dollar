import { type PlotId, PLOTS } from './plots';

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
  /** All money in the business at the bell (cash + stock + gear): what the 5% was charged on. */
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
  inventoryValue: number;
  cupsInStock: number;
  equipmentValue: number;
  stallKits: number;
  pitchers: number;
  pricePerCup: number;
  // Staffing (daily operating wages)
  /**
   * Stands with a hired worker (one worker per stand, $3/day each). A staffed stand
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

export const HURDLE_RATE = 0.05;
export const CENTRAL_PARK_RENT = 2;
export const WORKER_DAILY_WAGE = 3;
export const MANAGER_DAILY_WAGE = 5;
export const STALL_KIT_COST = 12;

export function createInitialState(): SliceState {
  return {
    day: 1,
    maxDays: 30,
    cash: 30,
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

export function getDailyWages(s: Pick<SliceState, 'staffedPlots' | 'managers'>): number {
  return s.staffedPlots.length * WORKER_DAILY_WAGE + s.managers * MANAGER_DAILY_WAGE;
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
 * ALL the money in the business: cash + stock + equipment. This is what THE LINE
 * charges 5% a day on.
 *
 * Owner decision (2026-11-24): idle cash is charged too. The game is about where the
 * next dollar goes; if cash were free, the best play after a good week was to hold it
 * and the line shrank to nothing. Charging every dollar makes the line grow as the
 * player gets richer, so one stand stops being enough and the money must be put to
 * work (or knowingly held). This reverses GDD 5.6's "cash is not charged".
 */
export function getMoneyInBusiness(s: SliceState): number {
  return +(s.cash + s.inventoryValue + s.equipmentValue).toFixed(2);
}

export function getDayNopat(s: SliceState): number {
  return s.dayRevenue - s.dayCogs - s.dayRentPaid;
}

export function getDailyHurdleCharge(s: SliceState): number {
  return +(getMoneyInBusiness(s) * HURDLE_RATE).toFixed(2);
}

export function getTotalEquity(s: SliceState): number {
  return +(s.cash + s.inventoryValue + s.equipmentValue).toFixed(2);
}

export function computeDayGrade(roicPct: number): DayGrade {
  if (roicPct >= 20) return 'S';
  if (roicPct >= 10) return 'A';
  if (roicPct >= 5) return 'B';
  if (roicPct >= 0) return 'C';
  return 'D';
}
