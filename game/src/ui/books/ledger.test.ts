import { describe, expect, it } from 'vitest';
import { noAwareness } from '../../core/marketing';
import { awarenessLines, BOOKS_TABS, meterShape } from './ledger';

describe('awarenessLines', () => {
  it('lists districts that still print as 1 or more, as 0..100, in map order', () => {
    const a = { ...noAwareness(), broadway: 0.75, 'central-park': 0.5, 'west-village': 0.004 };
    const lines = awarenessLines(a);
    expect(lines.map((l) => [l.id, l.pct])).toEqual(
      expect.arrayContaining([
        ['central-park', 50],
        ['broadway', 75],
      ])
    );
    expect(lines).toHaveLength(2); // 0.004 prints as 0, so it is not listed
  });

  it('is empty when nothing was ever advertised', () => {
    expect(awarenessLines(noAwareness())).toEqual([]);
  });
});

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
