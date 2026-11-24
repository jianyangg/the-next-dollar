/**
 * TUNING: every number that decides how hard the game is, in one object.
 *
 * WHY ONE OBJECT (instead of constants scattered over the rule files)
 *   1. The rules in src/core take the tuning as an optional last argument that defaults
 *      to `TUNING`. The game never passes it, so the game always plays with the values
 *      below. The balance simulation (core/simulateRun.ts) DOES pass it, with one value
 *      nudged by 10%, to check that the game's difficulty does not hinge on a single
 *      lucky number. This is "dependency injection": a function is handed its settings
 *      instead of reaching for a global, so a test can hand it different ones.
 *   2. Changing the balance is one edit in one file, and the simulation test
 *      (core/simulateRun.test.ts) says at once whether the targets still hold.
 *
 * The older named constants (HURDLE_RATE, WORKER_DAILY_WAGE, LEMON_CRATE_COST, ...) are
 * still exported from their original files for the UI; they are now read from here, so
 * there is one source of truth.
 *
 * This file imports nothing, so any core file can import it without an import cycle.
 */
export interface Tuning {
  /**
   * Grandma's bank: what a dollar earns there in one day. It is both the speed of the
   * benchmark the player races (startingCash x (1 + rate)^day) and the rate of today's
   * line (rate x the player's own money at the opening bell).
   */
  hurdleRate: number;
  /** What Grandma lends on day 1. */
  startingCash: number;

  // --- wages (paid in cash at every closing bell) ---
  workerDailyWage: number;
  managerDailyWage: number;

  // --- supplies and gear ---
  /** One crate of lemons costs `crateCost` and makes `crateCups` cups. */
  crateCost: number;
  crateCups: number;
  stallKitCost: number;
  pitcherCost: number;
  /** What a stall kit (built or still in the bag) fetches if sold. */
  stallKitResale: number;
  /** What a used pitcher fetches if sold. */
  pitcherResale: number;

  // --- serving ---
  /** Cups one hired worker can serve in a full day at their stand. */
  workerCupsPerDay: number;
  /** Milliseconds the player must hold to pour one cup when alone at the counter. */
  pourMsAlone: number;
  /** The same hold when a hired worker is at that stand (the worker preps the cups). */
  pourMsWithWorker: number;

  // --- sharing a district's crowd ---
  /**
   * A district has only so many thirsty walkers. When the player runs TWO stands in one
   * district each gets this share of its own walkers (0.8 = 80%); with THREE, the next
   * value. So a second stand in a district adds less than the first did, and a third can
   * cost more in rent and wages than the few extra cups it sells.
   */
  crowdShareTwoStands: number;
  crowdShareThreeStands: number;

  // --- knobs the game leaves at 1; the simulation's sensitivity test moves them ---
  /** Multiplies every district's permit fee (core/neighborhoods.ts permitFee). */
  permitScale: number;
  /** Multiplies every plot's rent. */
  rentScale: number;
  /** Multiplies every plot's walkers per day. */
  walkerScale: number;
  /**
   * Multiplies the buyers at the stand the player runs in person. 1 = the same demand as
   * a staffed stand (the design: one sales formula). The simulation sets it above 1 only
   * to reproduce the old 3D scene, which sent about 4x more buyers to the live stand.
   */
  liveDemandScale: number;
}

export const TUNING: Tuning = {
  hurdleRate: 0.15,
  startingCash: 30,
  workerDailyWage: 10,
  managerDailyWage: 20,
  crateCost: 5,
  crateCups: 5,
  stallKitCost: 12,
  pitcherCost: 10,
  stallKitResale: 8.4,
  pitcherResale: 7,
  workerCupsPerDay: 20,
  pourMsAlone: 2000,
  pourMsWithWorker: 600,
  crowdShareTwoStands: 0.8,
  crowdShareThreeStands: 0.6,
  permitScale: 1,
  rentScale: 1,
  walkerScale: 1,
  liveDemandScale: 1,
};

/** What one cup of lemonade costs to make: the crate price spread over its cups. */
export function cupCost(t: Tuning = TUNING): number {
  return t.crateCost / t.crateCups;
}
