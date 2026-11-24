import { fadeAllAwareness } from './marketing';
import { cents } from './money';
import { getDailyPlotRent } from './rent';
import {
  computeDayGrade,
  DayRecord,
  getDailyHurdleCharge,
  getDailyWages,
  getMoneyInBusiness,
  getWorth,
  SliceState,
} from './sliceModel';
import { type Tuning, TUNING } from './tuning';

/**
 * TODAY VS THE LINE: what the day would score if the bell rang right now.
 *
 * The player's opponent each day is "the line": what today must earn to keep pace with
 * Grandma's bank = rent + wages (paid in cash) + the hurdle rate (15%) x the money the
 * player started today with (`openingWorth`: cash, lemons and gear at resale value;
 * idle cash included). The 15% part is an opportunity cost: what the same money would
 * have made in her bank today. It is never paid to anyone.
 * `earned` is the gross profit from cups sold so far.
 * Value created today = earned - line. Positive = the day beats the line.
 *
 * The line is FROZEN at the opening bell: nothing the player does during the day moves
 * the 15% part (hiring or leasing still adds wages or rent). A player who beats the
 * line every day grows faster than 15% a day and so stays ahead of Grandma in the race
 * (core/sliceModel.ts `getWorth` vs `grandmaWorth`).
 *
 * This is the ONE formula for that number. The live HUD meter, the Books tab and the
 * closing bell (closeDay below) all call it, so what the player watches during the day
 * is exactly what the receipt will say at the bell.
 */
export interface DayProjection {
  /** Revenue minus cost of the cups sold so far today. */
  earned: number;
  rentAndWages: number;
  /** Campaigns bought today (already paid from cash): an expense of the day. */
  marketing: number;
  /** The hurdle rate x the money the player started today with (fixed all day). */
  hurdleCharge: number;
  /** rentAndWages + marketing + hurdleCharge: what `earned` has to beat. */
  line: number;
  /** earned - rent - wages - marketing (NOPAT). */
  nopat: number;
  /** earned - line. */
  valueCreated: number;
}

export function projectDay(s: SliceState, t: Tuning = TUNING): DayProjection {
  const earned = cents(s.dayRevenue - s.dayCogs);
  const rentAndWages = cents(getDailyPlotRent(s, t) + getDailyWages(s, t));
  // Marketing is a cost of today, like rent, so it sits in the line the day must beat.
  const marketing = cents(s.dayMarketing);
  const hurdleCharge = getDailyHurdleCharge(s, t);
  const line = cents(rentAndWages + marketing + hurdleCharge);
  return {
    earned,
    rentAndWages,
    marketing,
    hurdleCharge,
    line,
    nopat: cents(earned - rentAndWages - marketing),
    valueCreated: cents(earned - line),
  };
}

/** Did a closed day beat the line? (Zero counts as beating it: the money matched Grandma's bank.) */
export const beatTheLine = (r: Pick<DayRecord, 'valueCreated'>): boolean => r.valueCreated >= 0;

/**
 * Closing the books at the closing bell.
 *
 * Economic-value accounting in one place:
 *   NOPAT          = revenue − cost of goods sold − (rent + wages) − marketing
 *   hurdle charge  = hurdle rate x the money the day started with (`openingWorth`)
 *   value created  = NOPAT − hurdle charge   (positive means the money out-earned Grandma's bank)
 *   return         = NOPAT / that same money (floored at $1 so it never divides by 0),
 *                    so "return >= the hurdle rate" and "value created >= 0" are the same test.
 *
 * Only rent and wages leave the cash box; the hurdle charge is an opportunity cost
 * that lowers value created but is not paid to anyone.
 */
export function closeDay(cur: SliceState, t: Tuning = TUNING): { state: SliceState; record: DayRecord } | null {
  if (cur.day > cur.maxDays) return null;

  const { rentAndWages, marketing, hurdleCharge, nopat, valueCreated } = projectDay(cur, t);
  const cumulativeValue = cents(cur.totalValueCreated + valueCreated);
  // The base of today's line: YOU at this morning's opening bell (frozen all day).
  const chargedOn = getMoneyInBusiness(cur);
  const roicPct = +((nopat / Math.max(1, chargedOn)) * 100).toFixed(1);

  const record: DayRecord = {
    day: cur.day,
    cupsSold: cur.dayCupsSold,
    revenue: cur.dayRevenue,
    cogs: cur.dayCogs,
    rentAndWages,
    marketing,
    nopat,
    hurdleCharge,
    chargedOn,
    valueCreated,
    cumulativeValue,
    roicPct,
    grade: computeDayGrade(roicPct, t),
  };

  // Only rent and wages leave the cash box now: campaigns were paid when bought.
  const cashAfter = cents(cur.cash - rentAndWages);
  const state: SliceState = {
    ...cur,
    cash: cashAfter,
    // YOU at the bell, after rent and wages left the cash box: today's point in the race.
    worthHistory: [...cur.worthHistory, getWorth({ ...cur, cash: cashAfter }, t)],
    dayCupsSold: 0,
    dayRevenue: 0,
    dayCogs: 0,
    dayMarketing: 0,
    // Overnight every district forgets a little (core/marketing.ts fadedAwareness).
    awareness: fadeAllAwareness(cur.awareness, t),
    totalRent: cents(cur.totalRent + rentAndWages),
    totalValueCreated: cumulativeValue,
    lastDayCapitalCharge: hurdleCharge,
    dayHistory: [...cur.dayHistory, record],
  };
  return { state, record };
}

/**
 * Advance to the next morning. The day counter never passes the career length.
 *
 * This is also the OPENING BELL: the player's worth right now is written down as
 * `openingWorth`, and the new day's line is charged on that number until the next bell.
 */
export function startNextDay(s: SliceState, t: Tuning = TUNING): SliceState {
  return ringOpeningBell({ ...s, day: Math.min(s.maxDays, s.day + 1) }, t);
}

/**
 * The opening bell on its own: write down YOU (`getWorth`) as the base of today's line.
 * Every way a morning can begin goes through here (the normal next day above, and the
 * dev panel's day jump), so the line is never charged on a stale number.
 */
export function ringOpeningBell(s: SliceState, t: Tuning = TUNING): SliceState {
  return { ...s, openingWorth: getWorth(s, t) };
}
