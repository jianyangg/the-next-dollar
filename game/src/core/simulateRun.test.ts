import { describe, expect, it } from 'vitest';
import { adEveryDay, average, lazy, openEverything, sharp } from './simPolicies';
import { formatSimResult, type SimPolicy, type SimResult, simulateRun } from './simulateRun';
import { type Tuning, TUNING } from './tuning';

/**
 * THE BALANCE TEST: is the game as hard as it is meant to be?
 *
 * Each scripted player (core/simPolicies.ts) plays whole 30-day runs through the real
 * rules, and must finish in its band against Grandma's bank ($30 growing 15% a day,
 * about $1,986 on day 30). "0.4x" means the player ended with 40% of what Grandma has.
 *
 *   lazy             0.25x to 0.5x   one stand, never grows: must clearly lose
 *   average          0.9x  to 1.2x   five stands, pays asking price: roughly ties
 *   sharp            2x    to 3x     buys only what pays back: clearly wins
 *   open-everything  at least 15% below sharp: buying blindly must cost something
 *   ad-every-day     below Grandma: advertising everywhere, every day, is not a strategy
 *
 * If a change to core/tuning.ts (or to a rule) moves a player out of its band, this
 * test fails and prints the table, so the tuning is measured instead of guessed.
 */

const SEEDS = [1, 2, 3, 4, 5];

/** Mean result over several seeds, so one lucky run of customers cannot pass the test. */
function meanRatio(policy: SimPolicy, t: Tuning, seeds = SEEDS): { ratio: number; runs: SimResult[] } {
  const runs = seeds.map((seed) => simulateRun(policy, t, seed));
  return { ratio: runs.reduce((sum, r) => sum + r.ratio, 0) / runs.length, runs };
}

describe('balance: who beats Grandma (simulateRun)', () => {
  const results = {
    lazy: meanRatio(lazy, TUNING),
    average: meanRatio(average, TUNING),
    sharp: meanRatio(sharp, TUNING),
    openEverything: meanRatio(openEverything, TUNING),
    adEveryDay: meanRatio(adEveryDay, TUNING),
  };
  // Printed on every run: the table IS the tuning report.
  console.info(
    ['', `Balance at ${(TUNING.hurdleRate * 100).toFixed(0)}% a day (seed ${SEEDS[0]} shown; bands use the mean of ${SEEDS.length} seeds):`]
      .concat(Object.values(results).map((r) => `${formatSimResult(r.runs[0])} | mean ${r.ratio.toFixed(2)}x`))
      .join('\n')
  );

  it("Grandma's bank grows 15% a day", () => {
    expect(TUNING.hurdleRate).toBe(0.15);
    expect(results.lazy.runs[0].grandma).toBeCloseTo(1986.35, 1);
  });

  it('is deterministic: the same policy, tuning and seed give the same run', () => {
    expect(simulateRun(sharp, TUNING, 7)).toEqual(simulateRun(sharp, TUNING, 7));
  });

  it('lazy (one stand, by hand) loses clearly: 0.25x to 0.5x', () => {
    expect(results.lazy.ratio).toBeGreaterThanOrEqual(0.25);
    expect(results.lazy.ratio).toBeLessThanOrEqual(0.5);
  });

  it('average (five stands, pays the asking price) roughly ties: 0.9x to 1.2x', () => {
    expect(results.average.ratio).toBeGreaterThanOrEqual(0.9);
    expect(results.average.ratio).toBeLessThanOrEqual(1.2);
  });

  it('sharp (buys only what pays back) wins clearly: 2x to 3x', () => {
    expect(results.sharp.ratio).toBeGreaterThanOrEqual(2);
    expect(results.sharp.ratio).toBeLessThanOrEqual(3);
  });

  it('opening everything blindly ends at least 15% below sharp', () => {
    expect(results.openEverything.ratio).toBeLessThanOrEqual(results.sharp.ratio * 0.85);
  });

  it('advertising in every district every day still ends below Grandma', () => {
    expect(results.adEveryDay.ratio).toBeLessThan(1);
    // It really did advertise (the control is not silently doing nothing).
    expect(results.adEveryDay.runs[0].log.some((line) => line.includes('advertise'))).toBe(true);
  });

  it('the order lazy < average < sharp survives a 10% change to any one number', () => {
    const knobs: (keyof Tuning)[] = [
      'hurdleRate',
      'workerDailyWage',
      'crateCost',
      'stallKitCost',
      'workerCupsPerDay',
      'pourMsAlone',
      'crowdShareTwoStands',
      'crowdShareThreeStands',
      'permitScale',
      'rentScale',
      'walkerScale',
    ];
    // Two seeds per variant keep this many runs quick; the ordering gaps are far wider than seed noise.
    const seeds = [1, 2];
    for (const knob of knobs) {
      for (const factor of [0.9, 1.1]) {
        const t: Tuning = { ...TUNING, [knob]: TUNING[knob] * factor };
        const l = meanRatio(lazy, t, seeds).ratio;
        const a = meanRatio(average, t, seeds).ratio;
        const s = meanRatio(sharp, t, seeds).ratio;
        expect(l, `${knob} x${factor}: lazy ${l.toFixed(2)} < average ${a.toFixed(2)}`).toBeLessThan(a);
        expect(a, `${knob} x${factor}: average ${a.toFixed(2)} < sharp ${s.toFixed(2)}`).toBeLessThan(s);
      }
    }
  }, 60_000);
});
