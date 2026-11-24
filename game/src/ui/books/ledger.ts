import { NEIGHBORHOODS, type NeighborhoodId } from '../../core/neighborhoods';
import { awarenessPct } from '../stand/awareness';

/**
 * Pure helpers for the Books drawer.
 */

export type BooksTab = 'income' | 'balance' | 'value' | 'reviews';

export const BOOKS_TABS: { id: BooksTab; label: string }[] = [
  { id: 'income', label: 'Income' },
  { id: 'balance', label: 'Balance' },
  { id: 'value', label: 'Value' },
  { id: 'reviews', label: 'Reviews' },
];

export interface MeterShape {
  /** Both bars share one scale so their lengths can be compared by eye. */
  profitPct: number;
  linePct: number;
  clears: boolean;
}

/**
 * Profit vs Grandma's daily rate, on one shared scale. The scale leaves room for the line to sit
 * well inside the bar track (at least 2.5x the charge, at least $4 wide) so tiny days do
 * not look huge. Percentages are honest proportions (no clamping to look nicer).
 */
export function meterShape(dailyHurdle: number, projectedNopat: number): MeterShape {
  const scaleMax = Math.max(dailyHurdle * 2.5, Math.max(projectedNopat, 0) * 1.15, 4);
  const pct = (v: number) => Math.min(100, Math.max(0, (v / scaleMax) * 100));
  return {
    profitPct: pct(Math.max(projectedNopat, 0)),
    linePct: pct(dailyHurdle),
    clears: projectedNopat >= dailyHurdle,
  };
}

export interface AwarenessLine {
  id: NeighborhoodId;
  name: string;
  /** 0..100, as the Advertise panel shows it. */
  pct: number;
}

/**
 * The districts to list under "Built, not counted in your worth", in map order.
 *
 * Why "shows as at least 1" and not "> 0": awareness fades by a fixed share each night
 * (x0.75), so it never reaches exactly 0. Every district ever advertised would stay in
 * the list forever as a row reading "0". A district is listed while its awareness still
 * prints as 1 or more, the same rounding the Advertise panel uses.
 */
export function awarenessLines(awareness: Readonly<Record<NeighborhoodId, number>>): AwarenessLine[] {
  return NEIGHBORHOODS.map((n) => ({ id: n.id, name: n.name, pct: awarenessPct(awareness[n.id]) })).filter(
    (line) => line.pct >= 1
  );
}
