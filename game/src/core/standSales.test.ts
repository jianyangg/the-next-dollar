import { describe, expect, it } from 'vitest';
import { awayCupsPerDay } from './awaySales';
import { createInitialState } from './sliceModel';
import {
  buyersPerDay,
  crowdShare,
  handCupsPerDay,
  liveCupsPerDay,
  liveWalkerGapSeconds,
  ownStandsInDistrict,
  pourDurationMs,
  staffedCupsPerDay,
  walkersPerDay,
} from './standSales';

const CP = 'central-park/corner';
const CP_SIDE = 'central-park/side';

describe('one sales formula for every stand (core/standSales.ts)', () => {
  it('demand = walkers x buy chance, the same number for a staffed stand and the live stand', () => {
    // Central Park corner: 36 walkers; 78% buy at $3 -> 28.08 buyers a day.
    expect(walkersPerDay(CP)).toBe(36);
    expect(buyersPerDay(CP, 3)).toBeCloseTo(28.08);
    // The staffed stand reads it (capped by its one worker)...
    expect(awayCupsPerDay(CP, 3)).toBe(Math.min(buyersPerDay(CP, 3), 20));
    expect(staffedCupsPerDay(CP_SIDE, 3)).toBeCloseTo(buyersPerDay(CP_SIDE, 3));
    // ...and the live stand reads it (capped by the player's hands instead).
    expect(liveCupsPerDay(CP_SIDE, 3, { workersHere: 0, focus: 1 })).toBeCloseTo(buyersPerDay(CP_SIDE, 3));
  });

  it('alone, the pour is a 2 s hold; with a worker at the stand it drops to 0.6 s', () => {
    expect(pourDurationMs(0)).toBe(2000);
    expect(pourDurationMs(1)).toBe(600);
  });

  it("the player's hands are the limit when alone at a busy stand, and stop being it with a worker", () => {
    // Alone: 2 s pour + 1.125 s share of a brew + 1 s handoff = 4.125 s a cup -> 29 cups in 120 s.
    expect(handCupsPerDay(0)).toBeCloseTo(29.09, 1);
    // With a worker: 0.6 + 1.125 + 1 = 2.725 s a cup -> 44 cups.
    expect(handCupsPerDay(1)).toBeCloseTo(44.04, 1);
    // At $2 nearly everyone buys (34 buyers): alone the player cannot keep up...
    expect(buyersPerDay(CP, 2)).toBeGreaterThan(handCupsPerDay(0));
    expect(liveCupsPerDay(CP, 2, { workersHere: 0, focus: 1 })).toBeCloseTo(handCupsPerDay(0));
    // ...with a worker beside them every buyer is served.
    expect(liveCupsPerDay(CP, 2, { workersHere: 1, focus: 1 })).toBeCloseTo(buyersPerDay(CP, 2));
  });

  it('a player who spends half the day at the counter sells half as much', () => {
    const all = liveCupsPerDay(CP, 3, { workersHere: 0, focus: 1 });
    expect(liveCupsPerDay(CP, 3, { workersHere: 0, focus: 0.5 })).toBeCloseTo(all / 2);
  });

  it('counts the stands built on leased plots in a district; a bought stand is never shared', () => {
    const s = createInitialState();
    expect(ownStandsInDistrict(s.plots, CP)).toBe(1); // a plot being considered counts as the first
    const two = { ...s.plots, [CP]: 'built' as const, [CP_SIDE]: 'built' as const };
    expect(ownStandsInDistrict(two, CP)).toBe(2);
    expect(ownStandsInDistrict({ ...two, 'central-park/seller': 'built' as const }, CP)).toBe(2);
    expect(ownStandsInDistrict({ ...two, 'central-park/seller': 'built' as const }, 'central-park/seller')).toBe(1);
    expect([1, 2, 3].map((n) => crowdShare(n))).toEqual([1, 0.8, 0.6]);
    expect(buyersPerDay(CP, 3, undefined, 2)).toBeCloseTo(28.08 * 0.8);
  });

  it('gives the scene a walker gap that averages one day divided by the walkers', () => {
    // 36 walkers in a 120 s day -> one every 3.33 s on average; the roll spreads it 0.6x..1.4x.
    expect(liveWalkerGapSeconds(CP, 0.5)).toBeCloseTo(120 / 36);
    expect(liveWalkerGapSeconds(CP, 0)).toBeCloseTo((120 / 36) * 0.6);
    expect(liveWalkerGapSeconds(CP, 1)).toBeCloseTo((120 / 36) * 1.4);
    // Two stands in the district: fewer walkers each, so a longer gap.
    expect(liveWalkerGapSeconds(CP, 0.5, 2)).toBeCloseTo(120 / (36 * 0.8));
  });
});
