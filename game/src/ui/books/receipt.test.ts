import { describe, expect, it } from 'vitest';
import type { DayRecord } from '../../core/sliceModel';
import { buildReceipt, cupsNote, splitProfit } from './receipt';

const record = (over: Partial<DayRecord> = {}): DayRecord => ({
  day: 4,
  cupsSold: 8,
  revenue: 24,
  cogs: 4,
  rentAndWages: 2,
  nopat: 18,
  hurdleCharge: 1.15,
  valueCreated: 16.85,
  cumulativeValue: 41.2,
  roicPct: 78.3,
  grade: 'S',
  ...over,
});

describe('buildReceipt', () => {
  it('lists rows top to bottom in plain words, with signed amounts', () => {
    const rows = buildReceipt({ record: record(), investedCapital: 23, dailyRent: 2, dailyWages: 0 });
    expect(rows.map((r) => r.label)).toEqual([
      'Sales',
      'Lemons used',
      'Rent',
      'Wages',
      'Profit',
      'Money tied up',
      'Value created',
    ]);
    expect(rows.map((r) => r.text)).toEqual(['+$24.00', '-$4.00', '-$2.00', '$0.00', '+$18.00', '-$1.15', '+$16.85']);
    expect(rows[0].how).toBe('8 cups × $3.00');
    expect(rows[5].how).toBe('$23.00 × 5%');
  });

  it('never shows a formal term on the receipt', () => {
    const rows = buildReceipt({ record: record(), investedCapital: 23, dailyRent: 2, dailyWages: 0 });
    const text = rows.map((r) => `${r.label} ${r.how ?? ''}`).join(' ');
    expect(text).not.toMatch(/NOPAT|EVA|ROIC/);
  });

  it('shows one combined row when rent + wages do not add up to the record', () => {
    const rows = buildReceipt({ record: record({ rentAndWages: 5 }), investedCapital: 23, dailyRent: 2, dailyWages: 0 });
    expect(rows.map((r) => r.kind)).toContain('rentWages');
    expect(rows.map((r) => r.kind)).not.toContain('rent');
    expect(rows.find((r) => r.kind === 'rentWages')?.text).toBe('-$5.00');
  });

  it('colours a losing day as cost', () => {
    const rows = buildReceipt({
      record: record({ nopat: -2, valueCreated: -3, hurdleCharge: 1 }),
      investedCapital: 20,
      dailyRent: 2,
      dailyWages: 0,
    });
    expect(rows.find((r) => r.kind === 'final')?.tone).toBe('cost');
    expect(rows.find((r) => r.kind === 'profit')?.tone).toBe('cost');
  });
});

describe('cupsNote', () => {
  it('handles zero and one cup', () => {
    expect(cupsNote(0, 0)).toBe('0 cups');
    expect(cupsNote(1, 3)).toBe('1 cup × $3.00');
  });

  it('drops the price when no single price explains the day (the price changed mid-day)', () => {
    // 23 cups for $71.00: the average $3.09 would print 23 × $3.09 = $71.07.
    expect(cupsNote(23, 71)).toBe('23 cups');
  });
});

describe('splitProfit', () => {
  it('splits a profitable day into line vs kept', () => {
    const s = splitProfit(record());
    expect(s).toMatchObject({ kind: 'split', taken: 1.15, kept: 16.85, shortfall: 0 });
    if (s.kind === 'split') expect(s.takenPct).toBeCloseTo(6.39, 1);
  });

  it('reports the shortfall when the line wants more than the profit', () => {
    const s = splitProfit(record({ nopat: 1, hurdleCharge: 3, valueCreated: -2 }));
    expect(s).toMatchObject({ kind: 'split', taken: 1, kept: 0, shortfall: 2, takenPct: 100 });
  });

  it('does not draw a bar when there is no profit', () => {
    expect(splitProfit(record({ nopat: -1, hurdleCharge: 2, valueCreated: -3 }))).toEqual({ kind: 'loss', short: 3 });
  });
});
