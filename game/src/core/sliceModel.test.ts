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

  it('charges no hurdle with no invested capital', () => {
    expect(getDailyHurdleCharge(createInitialState())).toBe(0);
  });

  it('grades return on invested capital at the documented cut-offs', () => {
    expect(computeDayGrade(20)).toBe('S');
    expect(computeDayGrade(10)).toBe('A');
    expect(computeDayGrade(5)).toBe('B');
    expect(computeDayGrade(0)).toBe('C');
    expect(computeDayGrade(-1)).toBe('D');
  });
});
