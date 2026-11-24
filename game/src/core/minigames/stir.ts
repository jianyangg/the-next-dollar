// Step 3 of the lemonade brew: STIR.
//
// THE IDEA
// Circle the spoon round the pitcher: W (top) -> D (right) -> S (bottom) -> A (left),
// clockwise, with the keys or by circling the mouse. Each correct quarter turn
// dissolves some sugar. What matters is a STEADY rhythm:
//
//   - Each quarter's dissolve depends on how close its duration is to the previous
//     quarter's (steadiness). Even turns dissolve fully; jerky turns dissolve less.
//   - Quarters faster than FAST_QUARTER_SEC splash lemonade over the rim (slop), which
//     costs yield. Going faster never pays.
//   - Quarters slower than SLOW_QUARTER_SEC let the grains settle: that quarter
//     dissolves nothing, and grains left at the end make the drink gritty.
//
// The tempo window and every rate are constants, the same at every difficulty.
//
// WHERE THE TIME COMES FROM
// Key presses arrive between frames, so this module keeps its own clock (`clock`),
// advanced by `step(state, dt)`. A quarter turn is timestamped with that clock, which
// keeps everything deterministic in tests: step a fixed dt, then turn.
import { clamp01, MAX_PHYSICS_DT } from './types';

export type StirQuadrant = 'W' | 'D' | 'S' | 'A';

/** Clockwise on screen: top, right, bottom, left. */
export const STIR_ORDER: readonly StirQuadrant[] = ['W', 'D', 'S', 'A'];

/** A quarter quicker than this splashes (0.48 s per full circle). */
export const FAST_QUARTER_SEC = 0.12;
/** A quarter slower than this lets the grains settle (2 s per full circle). */
export const SLOW_QUARTER_SEC = 0.5;
/** Dissolve from one perfectly steady quarter: 10 steady quarters = fully dissolved. */
export const DISSOLVE_PER_QUARTER = 0.1;
/** Share of the pitcher lost per splashing quarter. */
export const SLOP_PER_FAST_QUARTER = 0.06;
/** Slop never takes more than half the batch. */
export const MAX_SLOP = 0.5;
/**
 * Stirring stops this long after the FIRST quarter turn even if grains remain.
 * The clock does not run before the first turn, so nobody is rushed to start.
 * A steady stir at a relaxed 0.3 s per quarter finishes in about 3 s.
 */
export const STIR_MAX_SEC = 5;

export interface StirState {
  /** Seconds since the first quarter turn (0 until then). */
  clock: number;
  /** Quadrant the spoon is in now, or null before the first turn. */
  at: StirQuadrant | null;
  /** Number of quarter turns made (drives the spoon angle in the UI). */
  quarters: number;
  /** Clock time of the last quarter turn. */
  lastTurnAt: number;
  /** Duration of the last quarter turn, or null when fewer than two turns so far. */
  lastInterval: number | null;
  dissolve: number;
  slop: number;
  /** Smoothed steadiness, 0..1, for the rhythm indicator. */
  rhythm: number;
  done: boolean;
}

export function init(): StirState {
  return {
    clock: 0,
    at: null,
    quarters: 0,
    lastTurnAt: 0,
    lastInterval: null,
    dissolve: 0,
    slop: 0,
    rhythm: 0,
    done: false,
  };
}

/** The quadrant that counts as the next clockwise quarter turn. */
export function nextQuadrant(state: StirState): StirQuadrant | null {
  if (state.at === null) return null; // any quadrant can start the stir
  return STIR_ORDER[(STIR_ORDER.indexOf(state.at) + 1) % STIR_ORDER.length] ?? 'W';
}

export function step(state: StirState, dt: number): StirState {
  if (state.done || state.at === null) return state; // clock waits for the first turn
  const clock = state.clock + Math.min(MAX_PHYSICS_DT, Math.max(0, dt));
  return { ...state, clock, done: clock >= STIR_MAX_SEC };
}

/**
 * How even this quarter was compared with the one before: 1 = identical durations,
 * 0 = one took twice as long as (or no time compared with) the other.
 */
export function steadiness(interval: number, previous: number | null): number {
  if (previous === null || previous <= 0) return 1;
  return clamp01(1 - Math.abs(interval - previous) / previous);
}

export type TurnOutcome = 'start' | 'turn' | 'slop' | 'settled' | 'ignored';

/**
 * The spoon entered `quadrant`. Only the next clockwise quadrant counts; anything else
 * (a reversal, the mouse jittering on a boundary, a skipped quarter) is ignored
 * without penalty, so a wobbly hand on the mouse is never punished for noise.
 */
export function turn(state: StirState, quadrant: StirQuadrant): { state: StirState; outcome: TurnOutcome } {
  if (state.done) return { state, outcome: 'ignored' };
  if (state.at === null) {
    return { state: { ...state, at: quadrant, lastTurnAt: state.clock }, outcome: 'start' };
  }
  if (quadrant !== nextQuadrant(state)) return { state, outcome: 'ignored' };

  const interval = state.clock - state.lastTurnAt;
  const steady = steadiness(interval, state.lastInterval);
  // Exponential moving average: the indicator follows the last few quarters, not one.
  const rhythm = state.quarters === 0 ? steady : 0.7 * state.rhythm + 0.3 * steady;

  let gain = 0;
  let slop = state.slop;
  let outcome: TurnOutcome = 'turn';
  if (interval > SLOW_QUARTER_SEC) {
    outcome = 'settled'; // too slow: grains sank, nothing dissolves this quarter
  } else {
    // A steady quarter dissolves the full amount; an uneven one at least 40% of it.
    gain = DISSOLVE_PER_QUARTER * (0.4 + 0.6 * steady);
    if (interval < FAST_QUARTER_SEC) {
      slop = Math.min(MAX_SLOP, slop + SLOP_PER_FAST_QUARTER);
      outcome = 'slop';
    }
  }

  const dissolve = clamp01(state.dissolve + gain);
  return {
    state: {
      ...state,
      at: quadrant,
      quarters: state.quarters + 1,
      lastTurnAt: state.clock,
      lastInterval: interval,
      dissolve,
      slop,
      rhythm,
      done: dissolve >= 1 - 1e-9,
    },
    outcome,
  };
}

/**
 * Which quadrant a pointer is in, relative to the pitcher's centre, in SCREEN
 * coordinates (y grows downward). The square is cut along its diagonals, so "top" is
 * the wedge where the pointer is further up than it is left or right.
 * Returns null inside `deadZone` pixels of the centre, where the angle is just noise.
 */
export function quadrantAt(dx: number, dy: number, deadZone = 0): StirQuadrant | null {
  if (Math.hypot(dx, dy) < deadZone) return null;
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'D' : 'A';
  return dy < 0 ? 'W' : 'S';
}
