import { describe, expect, it } from 'vitest';
import { CRATE_LEMON_SLOTS, MAX_TABLE_CUPS, tableStockView } from './tableStock';

describe('tableStockView', () => {
  it('shows nothing ready and an empty crate when the stand is out of everything', () => {
    expect(tableStockView({ readyCups: 0, lemons: 0 })).toEqual({ cups: 0, pitcher: 'empty', crateLemons: 0 });
  });

  it('draws one filled cup per ready cup, capped at the counter width', () => {
    for (const ready of [1, 2, 4, 6]) {
      expect(tableStockView({ readyCups: ready, lemons: 0 }).cups).toBe(ready);
    }
    expect(tableStockView({ readyCups: 13, lemons: 0 }).cups).toBe(MAX_TABLE_CUPS);
  });

  it('fills the pitcher in steps with the ready cups', () => {
    const fill = (readyCups: number) => tableStockView({ readyCups, lemons: 0 }).pitcher;
    expect(fill(0)).toBe('empty');
    expect(fill(1)).toBe('low');
    expect(fill(2)).toBe('low');
    expect(fill(3)).toBe('half');
    expect(fill(4)).toBe('half');
    expect(fill(5)).toBe('full');
    expect(fill(6)).toBe('full'); // a fresh perfect batch
    expect(fill(20)).toBe('full');
  });

  it('heaps the crate in steps: 0, 1-4, 5-9, 10+', () => {
    const crate = (lemons: number) => tableStockView({ readyCups: 0, lemons }).crateLemons;
    expect(crate(0)).toBe(0);
    expect(crate(1)).toBe(crate(4));
    expect(crate(5)).toBe(crate(9));
    expect(crate(10)).toBe(CRATE_LEMON_SLOTS);
    expect(crate(250)).toBe(CRATE_LEMON_SLOTS);
    // Each step shows strictly more lemons than the one below it.
    expect(crate(1)).toBeGreaterThan(0);
    expect(crate(5)).toBeGreaterThan(crate(4));
    expect(crate(10)).toBeGreaterThan(crate(9));
  });

  it('keeps the two piles independent: lemons never fill cups and cups never fill the crate', () => {
    expect(tableStockView({ readyCups: 0, lemons: 40 })).toMatchObject({ cups: 0, pitcher: 'empty' });
    expect(tableStockView({ readyCups: 6, lemons: 0 }).crateLemons).toBe(0);
  });

  it('never draws a negative or fractional count', () => {
    expect(tableStockView({ readyCups: -3, lemons: -1 })).toEqual({ cups: 0, pitcher: 'empty', crateLemons: 0 });
    expect(tableStockView({ readyCups: 2.9, lemons: 4.9 })).toMatchObject({ cups: 2, crateLemons: 2 });
  });
});
