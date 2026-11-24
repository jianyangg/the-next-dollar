import { cents } from '../../core/money';
import { HURDLE_RATE, type DayRecord } from '../../core/sliceModel';
import { fmtSignedMoney } from '../format';

/**
 * Turns the day's engine record into the printed receipt rows. Pure: no React, no store.
 *
 * NO INVENTED NUMBERS. Every amount comes from the closed-day record, except the split of
 * "rent and wages" into two lines: the record stores only their sum, so the caller passes
 * the engine's own getDailyPlotRent / getDailyWages. If those two do not add back up to the
 * record's sum (state changed since closing), we show ONE combined row instead of guessing.
 */

export type RowKind = 'sales' | 'lemons' | 'rent' | 'wages' | 'rentWages' | 'marketing' | 'profit' | 'line' | 'final';
export type Tone = 'gain' | 'cost' | 'flat';

export interface ReceiptRow {
  kind: RowKind;
  /** Plain-word label. Formal terms never appear on this screen. */
  label: string;
  /** Small dim "how it was worked out" note. */
  how?: string;
  /** Text shown, always with a sign for money moving. */
  text: string;
  tone: Tone;
  amount: number;
}

export interface ReceiptInput {
  record: DayRecord;
  dailyRent: number;
  dailyWages: number;
}

function toneOf(n: number): Tone {
  return n > 0 ? 'gain' : n < 0 ? 'cost' : 'flat';
}

/** A money amount that should read as a cost: "-$4.00", or a plain "$0.00" when nothing was spent. */
function costRow(kind: RowKind, label: string, spent: number, how?: string): ReceiptRow {
  return {
    kind,
    label,
    how,
    amount: -spent,
    text: spent === 0 ? '$0.00' : fmtSignedMoney(-spent),
    tone: spent === 0 ? 'flat' : 'cost',
  };
}

/** The receipt's label for campaign spending. Books' live Income tab uses the same word. */
export const MARKETING_LABEL = 'Marketing';

/**
 * The Marketing row, or null on a day with no campaigns.
 *
 * Why only when > 0: most days have no campaign, and a "$0.00 Marketing" line on every
 * receipt would be noise. Why it sits after rent and wages: it is a cost of the day like
 * them (core/dayEnd.ts projectDay takes it out of profit), so it belongs above Profit.
 * `spent` must be the engine's own figure (DayRecord.marketing for a closed day,
 * projectDay(...).marketing for the live one), so both screens print the same row.
 */
export function marketingRow(spent: number): ReceiptRow | null {
  return spent > 0 ? costRow('marketing', MARKETING_LABEL, spent) : null;
}

export function cupsNote(cups: number, revenue: number): string {
  if (cups <= 0) return '0 cups';
  const label = `${cups} ${cups === 1 ? 'cup' : 'cups'}`;
  // Show "× $3.00" only when one price explains the whole day (cups × price = sales to
  // the cent). On a day the price changed, an average like $3.09 would print a sum that
  // does not add up (23 × $3.09 = $71.07, not $71.00), so the note is just the count.
  const price = Math.round((revenue / cups) * 100) / 100;
  return Math.abs(price * cups - revenue) < 0.005 ? `${label} × $${price.toFixed(2)}` : label;
}

export function buildReceipt({ record, dailyRent, dailyWages }: ReceiptInput): ReceiptRow[] {
  const splitAddsUp = Math.abs(cents(dailyRent + dailyWages) - record.rentAndWages) < 0.005;
  const rows: ReceiptRow[] = [
    {
      kind: 'sales',
      label: 'Sales',
      how: cupsNote(record.cupsSold, record.revenue),
      amount: record.revenue,
      text: record.revenue === 0 ? '$0.00' : fmtSignedMoney(record.revenue),
      tone: toneOf(record.revenue),
    },
    costRow('lemons', 'Lemons used', record.cogs),
  ];
  if (splitAddsUp) {
    rows.push(costRow('rent', 'Rent', dailyRent), costRow('wages', 'Wages', dailyWages));
  } else {
    rows.push(costRow('rentWages', 'Rent + wages', record.rentAndWages));
  }
  const marketing = marketingRow(record.marketing);
  if (marketing) rows.push(marketing);
  rows.push(
    {
      kind: 'profit',
      label: 'Profit',
      amount: record.nopat,
      text: fmtSignedMoney(record.nopat),
      tone: toneOf(record.nopat),
    },
    // THE LINE row: the opportunity cost of Grandma's money. Had she kept it, it would
    // have grown by HURDLE_RATE of everything you had at the opening bell (cash, lemons,
    // gear at resale), idle cash included. The base is the one frozen at the bell, so
    // the receipt's arithmetic always multiplies out to the charge next to it.
    costRow('line', `Grandma's ${ratePct()}`, record.hurdleCharge, `${ratePct()} of $${record.chargedOn.toFixed(2)}`),
    {
      kind: 'final',
      label: 'Value created',
      amount: record.valueCreated,
      text: fmtSignedMoney(record.valueCreated),
      tone: toneOf(record.valueCreated),
    }
  );
  return rows;
}

/** The daily rate as shown to the player, e.g. "15%". Derived, never typed in by hand. */
export function ratePct(): string {
  return `${Math.round(HURDLE_RATE * 100)}%`;
}

export type ProfitSplit =
  /** Profit above zero: how much of it Grandma's share took and how much you kept. */
  | { kind: 'split'; profit: number; taken: number; kept: number; takenPct: number; shortfall: number }
  /** No profit at all: nothing to split, so say honestly how far short of the line we are. */
  | { kind: 'loss'; short: number };

export function splitProfit(record: Pick<DayRecord, 'nopat' | 'hurdleCharge' | 'valueCreated'>): ProfitSplit {
  if (record.nopat <= 0) return { kind: 'loss', short: +Math.abs(record.valueCreated).toFixed(2) };
  const taken = Math.min(record.hurdleCharge, record.nopat);
  return {
    kind: 'split',
    profit: record.nopat,
    taken,
    kept: +(record.nopat - taken).toFixed(2),
    takenPct: (taken / record.nopat) * 100,
    // > 0 when the line wanted more than the whole profit: a day that destroyed value.
    shortfall: +Math.max(0, record.hurdleCharge - record.nopat).toFixed(2),
  };
}

/** Grade stamp colour on the dark scrim: good grades green, the worst grade red, middle neutral. */

