import { describe, expect, it } from 'vitest';
import { computeDayGrade, createInitialState, getDailyHurdleCharge, getDailyWages } from './sliceModel';

// Smoke tests that prove the test runner is wired up. Phase 1 adds the
// characterization tests that lock in every rule moved out of App.tsx.
describe('sliceModel', () => {
  it('starts a career on day 1 with $30 cash', () => {
    const s = createInitialState();
    expect(s.day).toBe(1);
    expect(s.cash).toBe(30);
  });

  it('charges no wages with no staff', () => {
    expect(getDailyWages(createInitialState())).toBe(0);
  });

  it('charges 15% on idle cash too: the $30 the run opens with costs $4.50 a day', () => {
    expect(getDailyHurdleCharge(createInitialState())).toBe(4.5);
  });

  it('grades return on invested capital at the documented cut-offs', () => {
    // Cut-offs are multiples of Grandma's 15%: B matches her, A is a third better, S double.
    expect(computeDayGrade(30)).toBe('S');
    expect(computeDayGrade(29.9)).toBe('A');
    expect(computeDayGrade(20)).toBe('A');
    expect(computeDayGrade(15)).toBe('B');
    expect(computeDayGrade(14.9)).toBe('C');
    expect(computeDayGrade(0)).toBe('C');
    expect(computeDayGrade(-1)).toBe('D');
  });
});
