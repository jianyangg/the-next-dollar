import { type ClockSpeed, DAY_SECONDS } from './clock';
import { walkerGapSeconds } from './standSales';

/**
 * THE LIVE STREET: how the 3D scene turns "this stand gets N passers-by a day" (the one
 * sales formula, core/standSales.ts walkersPerDay) into walkers you can SEE, and makes
 * sure the stand really gets N buy-or-pass decisions a day.
 *
 * WHY THIS EXISTS
 *   The scene used to have a fixed 7 walkers per sidewalk walking at a fixed speed. A
 *   decision needs a walker in front of the stand, and 7 walkers only pass a stand about
 *   40 times a day. So a busy plot, a marketing campaign or the 2x clock (which halves
 *   the real length of a day but did not speed the walkers up) could not deliver the
 *   customers the formula promised. Three rules fix it:
 *
 *   1. OWED DECISIONS. A timer (walkerGapSeconds) adds one "owed" decision on average
 *      every DAY_SECONDS / walkersPerDay real seconds. Any walker who reaches the stand
 *      and has not decided yet settles one owed decision. A gap with nobody in reach is
 *      therefore not lost: the next walker settles it. Owed decisions are capped
 *      (MAX_OWED) so a long empty stretch cannot release a burst all at once.
 *   2. THE STREET RUNS ON THE GAME CLOCK. At 2x a day is half as many real seconds, so
 *      walkers stroll, step into line and lose patience twice as fast (strollSpeedFactor):
 *      the same street, fast-forwarded. The manager speeds up the same way. While the
 *      player is at the counter the game runs at 1x (core/clock.ts effectiveClockSpeed),
 *      so a game day sells the same cups at either speed.
 *   3. ENOUGH WALKERS. A walker on the stand's sidewalk passes it once per crossing of
 *      the street. The crowd per sidewalk is sized so passes outnumber the decisions
 *      needed by CROWD_MARGIN (walkersPerLane). A busier plot or a campaign therefore
 *      also LOOKS busier: the picture matches the number.
 *
 * Paused clock (a window open): the timer stops, so no decisions are owed while the
 * day is not running. Walkers keep strolling; it is only scenery.
 *
 * Pure: the scene calls these with its own frame time and random draws.
 */

/** Walkers enter at -STREET_EDGE or +STREET_EDGE and leave past the other edge. */
export const STREET_EDGE = 17.5;
/** Stroll speed range at 1x, world units per real second. */
export const STROLL_SPEED_MIN = 1.4;
export const STROLL_SPEED_MAX = 1.95;
/** Passes offered per decision needed. Above 1 so clumps and line-ups do not starve the stand. */
export const CROWD_MARGIN = 1.6;
/** Never fewer walkers per sidewalk than the street was designed with. */
export const MIN_WALKERS_PER_LANE = 7;
/** A cap so a data mistake cannot spawn hundreds of sprites. The busiest plot at full awareness needs 34. */
export const MAX_WALKERS_PER_LANE = 36;
/** At most this many decisions can wait for a walker. */
export const MAX_OWED = 3;

/** Walkers move with the game clock: 2x clock, 2x stroll speed. */
export function strollSpeedFactor(speed: ClockSpeed): number {
  return speed;
}

/**
 * How many walkers one sidewalk needs so the live stand on it is passed CROWD_MARGIN
 * times as often as `walkersPerDay` decisions require. A walker passes the stand once
 * per crossing (2 x STREET_EDGE long); the clock speed cancels out because both the
 * day and the crossing shrink by the same factor.
 */
export function walkersPerLane(walkersPerDay: number): number {
  const meanSpeed = (STROLL_SPEED_MIN + STROLL_SPEED_MAX) / 2;
  const crossingSec = (2 * STREET_EDGE) / meanSpeed; // at 1x
  const decisionsPerSec = walkersPerDay / DAY_SECONDS[1];
  const needed = Math.ceil(CROWD_MARGIN * decisionsPerSec * crossingSec);
  return Math.min(MAX_WALKERS_PER_LANE, Math.max(MIN_WALKERS_PER_LANE, needed));
}

/** The owed-decision timer. */
export interface DecisionGate {
  /** Decisions waiting for a walker to reach the stand. */
  owed: number;
  /**
   * GAME seconds (1x seconds) until the next decision becomes owed. Counted in game
   * time, not real time, so a wait drawn while the counter holds the game at 1x is not
   * stretched when 2x resumes: every wait is the same share of the day.
   */
  untilNext: number;
}

export function newGate(): DecisionGate {
  return { owed: 0, untilNext: 0 };
}

/**
 * Advance the gate by `dt` real seconds at clock `speed` (that is dt x speed game
 * seconds). Only while the day clock runs and the stand
 * has a crowd (`walkersPerDay` > 0); otherwise nothing is owed. `rand` is the gameplay
 * stream (one draw per decision added).
 */
export function tickGate(
  gate: DecisionGate,
  dt: number,
  running: boolean,
  walkersPerDay: number,
  speed: ClockSpeed,
  rand: () => number
): DecisionGate {
  if (!running || walkersPerDay <= 0) return gate;
  let { owed, untilNext } = gate;
  untilNext -= dt * speed;
  while (untilNext <= 0) {
    owed = Math.min(MAX_OWED, owed + 1);
    untilNext += walkerGapSeconds(walkersPerDay, 1, rand());
  }
  return { owed, untilNext };
}

/** A walker reached the stand: settle one owed decision, or null when none is owed. */
export function takeDecision(gate: DecisionGate): DecisionGate | null {
  return gate.owed > 0 ? { ...gate, owed: gate.owed - 1 } : null;
}
