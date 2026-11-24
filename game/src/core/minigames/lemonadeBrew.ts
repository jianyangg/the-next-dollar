// The lemonade brew: SQUEEZE -> SWEETEN -> STIR, composed into one game.
//
// HOW THE PIECES FIT
// Each step is its own small pure state machine (squeeze.ts, sweeten.ts, stir.ts).
// This file owns only the glue:
//   1. which step is running (`phase`);
//   2. turning the "is Space / the mouse held?" LEVEL into press/release EDGES;
//   3. moving to the next step when one finishes;
//   4. combining the three steps' numbers into one BrewQuality and a BrewTier.
//
// HOW A CALLER DRIVES IT (the store's frame loop does exactly this)
//   let s = init(rand, { difficulty, targetSweetness, workerSqueezes });
//   every frame:      ({ state: s, outcome, quality, cues } = step(s, dt, { held }))
//   on W/A/S/D or a mouse quarter-circle:  ({ state: s, ... } = stirTurn(s, 'D'))
//   when `outcome` is set the brew is over: feed `outcome` (a BrewTier) to the existing
//   economy, and `quality` to the reworked one.
//
// WHERE DIFFICULTY GOES (and where it does not)
// `difficulty` (0..1) changes only CONTENT: the lemon mix, how many lemons, how
// narrow the taste band is. Every rate (pressure, juice flow, sugar pour, stir tempo
// window) is a module constant shared by all difficulties; tests check that a script
// of inputs produces the same motion at difficulty 0 and 1.
import type { BrewTier } from '../brewing';
import * as squeeze from './squeeze';
import * as stir from './stir';
import * as sweeten from './sweeten';
import { type BrewCue, type BrewQuality, clamp01, type StepResult } from './types';

export type BrewPhase = 'squeeze' | 'sweeten' | 'stir' | 'done';

/**
 * This brew's twists: one small change per step, drawn at random so no two brews feel
 * the same. They vary the SKILL each step asks for, never the speed of anything:
 *   squeeze  'juicer'      park the needle in the green
 *            'tough-rind'  the green climbs as the lemon empties: follow it up
 *   sweeten  'sugar'       stop when the meter reaches the smile
 *            'honey'       it keeps dripping after you let go: stop early
 *   stir     'clockwise'   W D S A
 *            'counter'     W A S D
 */
export interface BrewTwists {
  squeeze: 'juicer' | 'tough-rind';
  sweeten: sweeten.Sweetener;
  stir: 'clockwise' | 'counter';
}

/** The plain brew: what day 1 teaches, before any twist appears. */
export const PLAIN_TWISTS: BrewTwists = { squeeze: 'juicer', sweeten: 'sugar', stir: 'clockwise' };

/** Chance that each step gets its twist (independently) once twists are allowed. */
export const TWIST_CHANCE = 0.5;

/**
 * Draw the twists. Always exactly three draws, even when twists are off, so turning
 * them on or off never shifts the random sequence that follows.
 */
export function drawTwists(rand: () => number, allowed: boolean): BrewTwists {
  const [a, b, c] = [rand(), rand(), rand()];
  if (!allowed) return PLAIN_TWISTS;
  return {
    squeeze: a < TWIST_CHANCE ? 'tough-rind' : 'juicer',
    sweeten: b < TWIST_CHANCE ? 'honey' : 'sugar',
    stir: c < TWIST_CHANCE ? 'counter' : 'clockwise',
  };
}

export interface LemonadeBrewConfig {
  /** 0 = gentle (plump lemons, 2 per batch, forgiving taste), 1 = hard. */
  difficulty: number;
  /** How sweet this crowd wants it, 0..1. Set by the store from district + weather. */
  targetSweetness: number;
  /** A hired worker squeezes for you: the squeeze step is skipped at an average result. */
  workerSqueezes: boolean;
  /**
   * Twists may appear (the store turns them on after day 1, so the first brews teach
   * the plain recipe). Ignored when `twists` is given.
   */
  allowTwists: boolean;
  /** Force these twists instead of drawing them (tests, replays of a reported bug). */
  twists?: BrewTwists;
}

export interface LemonadeBrewState {
  kind: 'lemonade-brew';
  phase: BrewPhase;
  /** Last seen hold level; a change between frames is a press or a release. */
  held: boolean;
  workerSqueezes: boolean;
  /** This brew's twists (fixed at init; the UI names the current step's one). */
  twists: BrewTwists;
  squeeze: squeeze.SqueezeState;
  /** Set once squeezing is over (by the player or the worker). */
  squeezed: squeeze.SqueezeResult | null;
  sweeten: sweeten.SweetenState;
  stir: stir.StirState;
  /** Set on the frame the brew finishes. */
  quality: BrewQuality | null;
}

export interface BrewInputs {
  /** Space or the mouse button is down right now. */
  held: boolean;
}

/**
 * Score weights. They add up to 1, so the score is a 0..1 number.
 *   efficiency 30%: did you get the juice out (and keep it in the pitcher)?
 *   clean      25%: no seeds or pith (1 - bitterness)
 *   taste      30%: sweetness within the band
 *   dissolve   15%: no grit
 */
export const SCORE_WEIGHTS = { efficiency: 0.3, clean: 0.25, taste: 0.3, dissolve: 0.15 } as const;
/** Score at or above which the brew is 'perfect' / 'good'; below 'good' it is 'sour'. */
export const TIER_THRESHOLDS = { perfect: 0.85, good: 0.6 } as const;

export function init(rand: () => number, config: LemonadeBrewConfig): LemonadeBrewState {
  // Lemons are drawn even when a worker squeezes: the kinds decide how much juice the
  // batch holds, and the same seed must give the same lemons either way.
  const lemons = squeeze.drawLemons(rand, config.difficulty);
  // Drawn AFTER the lemons, so the same seed still gives the same lemons as before twists.
  const drawn = drawTwists(rand, config.allowTwists);
  const twists = config.twists ?? drawn;
  const band = sweeten.bandForDifficulty(config.difficulty);
  const sq = squeeze.init(lemons, { toughRind: twists.squeeze === 'tough-rind' });
  return {
    kind: 'lemonade-brew',
    phase: config.workerSqueezes ? 'sweeten' : 'squeeze',
    held: false,
    workerSqueezes: config.workerSqueezes,
    twists,
    squeeze: config.workerSqueezes ? { ...sq, index: lemons.length, done: true } : sq,
    squeezed: config.workerSqueezes ? squeeze.workerResult(lemons) : null,
    sweeten: sweeten.init(config.targetSweetness, band, twists.sweeten),
    stir: stir.init(twists.stir === 'counter' ? -1 : 1),
    quality: null,
  };
}

/** Taste as a 0..1 score: 1 on target, 0.5 at the band's edge, 0 at twice the band. */
export function tasteScore(tasteError: number, band: number): number {
  return band > 0 ? clamp01(1 - tasteError / (2 * band)) : tasteError === 0 ? 1 : 0;
}

export function tierForScore(score: number): BrewTier {
  if (score >= TIER_THRESHOLDS.perfect) return 'perfect';
  if (score >= TIER_THRESHOLDS.good) return 'good';
  return 'sour';
}

/**
 * Combine the three steps into the final numbers. Exported (and pure) so tests and a
 * future "brew report" screen can compute it from any parts.
 */
export function scoreBrew(parts: {
  squeezed: squeeze.SqueezeResult;
  tasteError: number;
  band: number;
  fixUsed: boolean;
  dissolve: number;
  slop: number;
}): BrewQuality {
  // Juice that stayed in the pitcher: spills and the watering-down fix both remove some.
  const kept = (1 - parts.slop) * (parts.fixUsed ? 1 - sweeten.FIX_YIELD_COST : 1);
  const efficiency = clamp01(parts.squeezed.efficiency * kept);
  const score =
    SCORE_WEIGHTS.efficiency * efficiency +
    SCORE_WEIGHTS.clean * (1 - parts.squeezed.bitterness) +
    SCORE_WEIGHTS.taste * tasteScore(parts.tasteError, parts.band) +
    SCORE_WEIGHTS.dissolve * parts.dissolve;
  return {
    yield: clamp01(parts.squeezed.yield * kept),
    efficiency,
    bitterness: parts.squeezed.bitterness,
    tasteError: parts.tasteError,
    dissolve: parts.dissolve,
    slop: parts.slop,
    fixUsed: parts.fixUsed,
    score,
    tier: tierForScore(score),
  };
}

type Result = StepResult<LemonadeBrewState>;

/** The squeeze numbers for this brew: the worker's standard job, or the player's. */
export function squeezeOutcome(state: LemonadeBrewState): squeeze.SqueezeResult {
  return state.workerSqueezes ? squeeze.workerResult(state.squeeze.lemons) : squeeze.result(state.squeeze);
}

function finish(state: LemonadeBrewState, cues: BrewCue[]): Result {
  const quality = scoreBrew({
    // Recomputed from the source of truth (the squeeze state, or the worker rule)
    // rather than trusting the cached `squeezed` field.
    squeezed: squeezeOutcome(state),
    tasteError: sweeten.tasteError(state.sweeten),
    band: state.sweeten.band,
    fixUsed: state.sweeten.fixUsed,
    dissolve: state.stir.dissolve,
    slop: state.stir.slop,
  });
  return {
    state: { ...state, phase: 'done', quality },
    outcome: quality.tier,
    quality,
    cues: [...cues, 'brew-done'],
  };
}

/** Space / mouse went DOWN. Only the sweeten step reacts to the edge itself. */
export function press(state: LemonadeBrewState): Result {
  if (state.held) return { state, cues: [] };
  const held = { ...state, held: true };
  if (state.phase !== 'sweeten') return { state: held, cues: [] };
  const r = sweeten.press(state.sweeten);
  return { state: { ...held, sweeten: r.state }, cues: r.fixed ? ['fix'] : [] };
}

/** Space / mouse went UP. */
export function release(state: LemonadeBrewState): Result {
  if (!state.held) return { state, cues: [] };
  const released = { ...state, held: false };
  if (state.phase !== 'sweeten') return { state: released, cues: [] };
  const r = sweeten.release(state.sweeten);
  return { state: { ...released, sweeten: r.state }, cues: r.overshoot ? ['overshoot'] : [] };
}

export function step(state: LemonadeBrewState, dt: number, inputs: BrewInputs): Result {
  if (state.phase === 'done') return { state, cues: [] };

  // Edges first, so a press that happens on this frame already pours this frame.
  const edge = inputs.held === state.held ? { state, cues: [] } : inputs.held ? press(state) : release(state);
  const s = edge.state;
  const cues: BrewCue[] = [...(edge.cues ?? [])];

  switch (s.phase) {
    case 'squeeze': {
      const r = squeeze.step(s.squeeze, dt, s.held);
      cues.push(...r.cues);
      if (!r.state.done) return { state: { ...s, squeeze: r.state }, cues };
      cues.push('step-done');
      return {
        state: { ...s, squeeze: r.state, squeezed: squeeze.result(r.state), phase: 'sweeten' },
        cues,
      };
    }
    case 'sweeten': {
      const next = sweeten.step(s.sweeten, dt);
      // Honey: the drip just ended over the band, so the fix is now on offer.
      if (sweeten.dripEnded(s.sweeten, next) && next.phase === 'offer') cues.push('overshoot');
      if (next.phase !== 'done') return { state: { ...s, sweeten: next }, cues };
      cues.push('step-done');
      return { state: { ...s, sweeten: next, phase: 'stir' }, cues };
    }
    case 'stir': {
      const next = stir.step(s.stir, dt);
      const moved = { ...s, stir: next };
      // The stir clock ran out with grains left: the brew ends gritty.
      return next.done ? finish(moved, cues) : { state: moved, cues };
    }
    default:
      return { state: s, cues };
  }
}

/** The spoon entered a quadrant (a W/A/S/D key, or the mouse crossing into it). */
export function stirTurn(state: LemonadeBrewState, quadrant: stir.StirQuadrant): Result {
  if (state.phase !== 'stir') return { state, cues: [] };
  const r = stir.turn(state.stir, quadrant);
  const cues: BrewCue[] = r.outcome === 'slop' ? ['slop'] : r.outcome === 'turn' ? ['stir'] : [];
  const moved = { ...state, stir: r.state };
  return r.state.done ? finish(moved, cues) : { state: moved, cues };
}
