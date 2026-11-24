import { NeighborhoodId } from './neighborhoods';

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
  workers: number;
  managers: number;
  // Fixed sidewalk plots per district
  plots: Record<NeighborhoodId, PlotStatus>;
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
  ownedStands: number;
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
    workers: 0,
    managers: 0,
    plots: {
      'central-park': 'empty',
      columbia: 'empty',
      broadway: 'empty',
      market: 'empty',
      'west-village': 'empty',
      fidi: 'empty',
      'fifth-ave': 'empty',
    },
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
    ownedStands: 0,
  };
}

export function getDailyWages(s: SliceState): number {
  return s.workers * WORKER_DAILY_WAGE + s.managers * MANAGER_DAILY_WAGE;
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

export function getInvestedCapital(s: SliceState): number {
  return s.inventoryValue + s.equipmentValue;
}

export function getDayNopat(s: SliceState): number {
  return s.dayRevenue - s.dayCogs - s.dayRentPaid;
}

export function getDailyHurdleCharge(s: SliceState): number {
  return +(getInvestedCapital(s) * HURDLE_RATE).toFixed(2);
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
