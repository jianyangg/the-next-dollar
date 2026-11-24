import { cents } from './money';
import { getDailyPlotRent } from './rent';
import {
  computeDayGrade,
  DayRecord,
  getDailyHurdleCharge,
  getDailyWages,
  getInvestedCapital,
  SliceState,
} from './sliceModel';

/**
 * Closing the books at the 8:00 PM bell.
 *
 * Economic-value accounting in one place:
 *   NOPAT          = revenue − cost of goods sold − (rent + wages)
 *   hurdle charge  = 5% of invested capital (inventory + equipment)
 *   value created  = NOPAT − hurdle charge   (positive means the money beat its 5% cost)
 *   ROIC           = NOPAT / invested capital (floored at $1 so day 1 doesn't divide by 0)
 *
 * Only rent and wages leave the cash box; the hurdle charge is an opportunity cost
 * that lowers value created but is not paid to anyone. (Moved unchanged from App.tsx.)
 */
export function closeDay(cur: SliceState): { state: SliceState; record: DayRecord } | null {
  if (cur.day > cur.maxDays) return null;

  const rentAndWages = cents(getDailyPlotRent(cur) + getDailyWages(cur));
  const hurdleCharge = getDailyHurdleCharge(cur);
  const nopat = cents(cur.dayRevenue - cur.dayCogs - rentAndWages);
  const valueCreated = cents(nopat - hurdleCharge);
  const cumulativeValue = cents(cur.totalValueCreated + valueCreated);
  const invested = getInvestedCapital(cur);
  const roicPct = +((nopat / Math.max(1, invested)) * 100).toFixed(1);

  const record: DayRecord = {
    day: cur.day,
    cupsSold: cur.dayCupsSold,
    revenue: cur.dayRevenue,
    cogs: cur.dayCogs,
    rentAndWages,
    nopat,
    hurdleCharge,
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
