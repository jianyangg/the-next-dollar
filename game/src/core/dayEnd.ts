import { cents } from './money';
import { getDailyPlotRent } from './rent';
import {
  computeDayGrade,
  DayRecord,
  getDailyHurdleCharge,
  getDailyWages,
  getMoneyInBusiness,
  SliceState,
} from './sliceModel';

/**
 * TODAY VS THE LINE: what the day would score if the bell rang right now.
 *
 * The player's opponent each day is "the line": everything today must cover before
 * any value is created = rent + wages (paid in cash) + the 5% charge on ALL the money in
 * the business, idle cash included (an opportunity cost, never paid). `earned` is the gross profit from cups sold so far.
 * Value created today = earned - line. Positive = the day beats the line.
 *
 * This is the ONE formula for that number. The live HUD meter, the Books tab and the
 * closing bell (closeDay below) all call it, so what the player watches during the day
 * is exactly what the receipt will say at the bell.
 */
export interface DayProjection {
  /** Revenue minus cost of the cups sold so far today. */
  earned: number;
  rentAndWages: number;
  /** 5% of all money in the business (cash + stock + gear) right now. */
  hurdleCharge: number;
  /** rentAndWages + hurdleCharge: what `earned` has to beat. */
  line: number;
  /** earned - rent - wages (NOPAT). */
  nopat: number;
  /** earned - line. */
  valueCreated: number;
}

export function projectDay(s: SliceState): DayProjection {
  const earned = cents(s.dayRevenue - s.dayCogs);
  const rentAndWages = cents(getDailyPlotRent(s) + getDailyWages(s));
  const hurdleCharge = getDailyHurdleCharge(s);
  const line = cents(rentAndWages + hurdleCharge);
  return {
    earned,
    rentAndWages,
    hurdleCharge,
    line,
    nopat: cents(earned - rentAndWages),
    valueCreated: cents(earned - line),
  };
}

/** Did a closed day beat the line? (Zero counts as beating it: the money earned its 5%.) */
export const beatTheLine = (r: Pick<DayRecord, 'valueCreated'>): boolean => r.valueCreated >= 0;

/**
 * Closing the books at the closing bell.
 *
 * Economic-value accounting in one place:
 *   NOPAT          = revenue − cost of goods sold − (rent + wages)
 *   hurdle charge  = 5% of all money in the business (cash + inventory + equipment)
 *   value created  = NOPAT − hurdle charge   (positive means the money beat its 5% cost)
 *   return         = NOPAT / money in the business (floored at $1 so it never divides by 0),
 *                    so "return >= 5%" and "value created >= 0" are the same test.
 *
 * Only rent and wages leave the cash box; the hurdle charge is an opportunity cost
 * that lowers value created but is not paid to anyone. (Moved unchanged from App.tsx.)
 */
export function closeDay(cur: SliceState): { state: SliceState; record: DayRecord } | null {
  if (cur.day > cur.maxDays) return null;

  const { rentAndWages, hurdleCharge, nopat, valueCreated } = projectDay(cur);
  const cumulativeValue = cents(cur.totalValueCreated + valueCreated);
  // Read BEFORE rent and wages leave the cash box: this is the base the 5% was charged on.
  const chargedOn = getMoneyInBusiness(cur);
  const roicPct = +((nopat / Math.max(1, chargedOn)) * 100).toFixed(1);

  const record: DayRecord = {
    day: cur.day,
    cupsSold: cur.dayCupsSold,
    revenue: cur.dayRevenue,
    cogs: cur.dayCogs,
    rentAndWages,
    nopat,
    hurdleCharge,
    chargedOn,
    valueCreated,
    cumulativeValue,
    roicPct,
    grade: computeDayGrade(roicPct),
  };

  const state: SliceState = {
    ...cur,
    cash: cents(cur.cash - rentAndWages),
    dayCupsSold: 0,
    dayRevenue: 0,
    dayCogs: 0,
    dayRentPaid: 0,
    totalRent: cents(cur.totalRent + rentAndWages),
    totalValueCreated: cumulativeValue,
    lastDayCapitalCharge: hurdleCharge,
    dayHistory: [...cur.dayHistory, record],
  };
  return { state, record };
}

/** Advance to the next morning. The day counter never passes the career length. */
export function startNextDay(s: SliceState): SliceState {
  return { ...s, day: Math.min(s.maxDays, s.day + 1) };
}
