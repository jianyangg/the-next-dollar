import { describe, expect, it } from 'vitest';
import { BOOKS_TABS, meterShape } from './ledger';

describe('meterShape', () => {
  it('has the four tabs in order', () => {
    expect(BOOKS_TABS.map((t) => t.label)).toEqual(['Income', 'Balance', 'Value', 'Reviews']);
  });

  it('uses one shared scale and reports whether profit clears the line', () => {
    const s = meterShape(2, 5); // scale = max(5, 5.75, 4) = 5.75
    expect(s.clears).toBe(true);
    expect(s.linePct).toBeCloseTo((2 / 5.75) * 100, 5);
    expect(s.profitPct).toBeCloseTo((5 / 5.75) * 100, 5);
  });

  it('draws no profit bar for a loss and flags it below the line', () => {
    const s = meterShape(1, -3);
    expect(s.profitPct).toBe(0);
    expect(s.clears).toBe(false);
  });
});
