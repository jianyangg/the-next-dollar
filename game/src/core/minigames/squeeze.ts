// Step 1 of the lemonade brew: SQUEEZE.
//
// THE IDEA
// You press a lemon half onto a juicer. Holding Space (or the mouse) raises the
// pressure; letting go lets it fall. Juice only runs while the pressure sits inside
// the lemon's "juicy zone". Press harder than the zone and you crush the pith and
// seeds into the pitcher instead: no juice, and the drink turns bitter.
//
// So the skill is FEATHERING: hold until the needle reaches the zone, then tap and
// hold to keep it there. Holding non-stop overshoots; frantic tapping never builds
// enough pressure. Neither is rewarded, and nothing here ever speeds up.
//
// WHY THE LEMON KINDS EXIST
// Difficulty comes from what is on the juicer, not from a faster needle:
//   plump: wide zone, lots of juice          (forgiving)
//   dry:   narrow zone, little juice         (precise, and the batch yields less)
//   seedy: zone sits low, seeds start early  (you must stop pressing sooner)
// The pressure rise/fall speeds and the juice flow rate are the SAME constants for
// every lemon and every difficulty (tests check this).
//
// PURE STATE MACHINE
// `step(state, dt, held)` returns a NEW state and never mutates the old one, and
// randomness only enters through `init`'s `rand` argument, so the same seed always
// produces the same lemons.
import { clamp01, MAX_PHYSICS_DT, type BrewCue } from './types';

export type LemonKind = 'plump' | 'dry' | 'seedy';

export interface LemonSpec {
  /** Lowest pressure (0..1) at which juice runs. */
  zoneLow: number;
  /** Highest pressure at which juice runs; above it seeds and pith fall in. */
  zoneHigh: number;
  /** Juice the lemon holds, in "plump lemon = 1" units. */
  juice: number;
}

/** Plump is the reference lemon: one plump lemon holds 1 unit of juice. */
export const LEMON_SPECS: Readonly<Record<LemonKind, LemonSpec>> = {
  plump: { zoneLow: 0.35, zoneHigh: 0.8, juice: 1 },
  dry: { zoneLow: 0.52, zoneHigh: 0.68, juice: 0.55 },
  seedy: { zoneLow: 0.28, zoneHigh: 0.52, juice: 0.9 },
};

// --- speed constants: identical for every lemon kind and every difficulty --------
/** Pressure gained per second while held (0 -> zone in about a third of a second). */
export const PRESSURE_RISE_PER_SEC = 1.2;
/** Pressure lost per second when released (a bit faster than the rise, like a spring). */
export const PRESSURE_FALL_PER_SEC = 1.6;
/** Juice units per second while the pressure is in the zone (a plump lemon takes 0.8 s). */
export const JUICE_FLOW_PER_SEC = 1.25;
/**
 * A lemon is taken off the juicer after this many seconds of pressing, even if juice
 * is left. It is a safety stop so a player stuck above the zone does not stall the
 * brew forever, and it is long enough (about twice a good squeeze) not to rush anyone.
 * The clock starts at the first press on that lemon, so nobody is rushed to begin.
 */
export const LEMON_MAX_SEC = 2.4;
/** Bitterness added per second spent above the zone, before dividing by lemon count. */
export const BITTER_PER_SEC_ABOVE = 1;
/**
 * TWIST "tough rind": how far the juicy zone climbs as a lemon empties (0 at the first
 * drop, this much once it is spent). Like a real hand squeeze, the last juice needs a
 * harder grip, so the player has to follow the zone upward instead of parking the needle.
 * The rise/fall speeds are untouched: only WHERE the juice is changes.
 */
export const TOUGH_RIND_SHIFT = 0.15;

export interface SqueezeState {
  /** The batch, in the order they go on the juicer. */
  lemons: readonly LemonKind[];
  /** Twist: the juicy zone climbs as each lemon empties (see TOUGH_RIND_SHIFT). */
  toughRind: boolean;
  /** Which lemon is on the juicer now (== lemons.length once finished). */
  index: number;
  /** Current pressure, 0..1. */
  pressure: number;
  /** Juice taken from the CURRENT lemon. */
  lemonJuice: number;
  /** Seconds the current lemon has been pressed (stops it once LEMON_MAX_SEC passes). */
  lemonTime: number;
  /** Total juice in the pitcher so far, in plump-lemon units. */
  juice: number;
  /** Accumulated seed/pith time (see BITTER_PER_SEC_ABOVE). */
  bitterUnits: number;
  /** UI hints for this frame: juice running, seeds falling. */
  flowing: boolean;
  aboveZone: boolean;
  done: boolean;
}

export interface SqueezeResult {
  /** Juice vs. a perfect all-plump batch of the same size (see BrewQuality.yield). */
  yield: number;
  /** Juice vs. what these particular lemons held. */
  efficiency: number;
  bitterness: number;
}

/**
 * What a hired worker gets when they squeeze for you: a steady, middling job.
 * They capture 65% of the juice and let some pith in. Picked so a worker squeeze
 * plus a flawless sweeten and stir lands in "good", not "perfect" (tested): hiring
 * help saves effort, but the best lemonade still needs your own hands.
 */
export const WORKER_SQUEEZE = { efficiency: 0.65, bitterness: 0.25 } as const;

/**
 * Draw a batch. `difficulty` (0..1) shifts the mix toward dry and seedy lemons and
 * toward 3 lemons instead of 2. It never touches any speed constant above.
 *
 * Call order matters for reproducibility: one draw for the count, then one per lemon.
 */
export function drawLemons(rand: () => number, difficulty: number): LemonKind[] {
  const d = clamp01(difficulty);
  const count = rand() < 0.25 + 0.6 * d ? 3 : 2; // easy: 25% chance of 3, hard: 85%
  const plumpChance = 0.75 - 0.55 * d; // easy: 75% plump, hard: 20% plump
  const lemons: LemonKind[] = [];
  for (let i = 0; i < count; i++) {
    const r = rand();
    if (r < plumpChance) lemons.push('plump');
    else lemons.push(r < plumpChance + (1 - plumpChance) / 2 ? 'dry' : 'seedy');
  }
  return lemons;
}

export function init(lemons: readonly LemonKind[], options: { toughRind: boolean } = { toughRind: false }): SqueezeState {
  return {
    lemons,
    toughRind: options.toughRind,
    index: 0,
    pressure: 0,
    lemonJuice: 0,
    lemonTime: 0,
    juice: 0,
    bitterUnits: 0,
    flowing: false,
    aboveZone: false,
    done: lemons.length === 0,
  };
}

/** The spec of the lemon on the juicer (the last one once finished, for drawing). */
export function currentLemon(state: SqueezeState): LemonSpec {
  const kind = state.lemons[Math.min(state.index, state.lemons.length - 1)] ?? 'plump';
  return LEMON_SPECS[kind];
}

/**
 * Where juice runs RIGHT NOW on the lemon being pressed. Without the tough-rind twist
 * it is the lemon's own zone; with it, the zone is lifted by how much of this lemon is
 * already squeezed. The UI draws the green band from this same function, so what the
 * player sees is exactly what the rule checks.
 */
export function juicyZone(state: SqueezeState): { low: number; high: number } {
  const spec = currentLemon(state);
  const shift = state.toughRind ? TOUGH_RIND_SHIFT * clamp01(state.lemonJuice / spec.juice) : 0;
  return { low: spec.zoneLow + shift, high: Math.min(1, spec.zoneHigh + shift) };
}

export function step(
  state: SqueezeState,
  dt: number,
  held: boolean
): { state: SqueezeState; cues: BrewCue[] } {
  if (state.done) return { state, cues: [] };
  const cues: BrewCue[] = [];
  const physDt = Math.min(MAX_PHYSICS_DT, Math.max(0, dt));
  const spec = currentLemon(state);

  // 1. Pressure: rises while held, falls when released, always within 0..1.
  const pressure = clamp01(
    state.pressure + (held ? PRESSURE_RISE_PER_SEC : -PRESSURE_FALL_PER_SEC) * physDt
  );

  // 2. Where is the needle relative to this lemon's zone? (Checked AFTER moving it,
  //    so the frame that enters the zone already gets juice.)
  const zone = juicyZone(state);
  const inZone = pressure >= zone.low && pressure <= zone.high;
  const aboveZone = pressure > zone.high;
  if (aboveZone && !state.aboveZone) cues.push('seeds');

  // 3. Juice runs only in the zone, and a lemon cannot give more than it holds.
  const take = inZone ? Math.min(JUICE_FLOW_PER_SEC * physDt, spec.juice - state.lemonJuice) : 0;
  const lemonJuice = state.lemonJuice + take;
  const bitterUnits = state.bitterUnits + (aboveZone ? BITTER_PER_SEC_ABOVE * physDt : 0);

  // 4. The lemon's clock starts on the first press and then keeps running, even on
  //    frames where the pressure has dropped back to 0. (Checking only "pressure > 0"
  //    would let rapid tapping, which keeps hitting 0, stretch the lemon out forever.)
  const pressing = held || pressure > 0 || state.lemonTime > 0;
  const lemonTime = state.lemonTime + (pressing ? physDt : 0);

  // 5. Spent (juice gone) or timed out -> next lemon, pressure back to zero.
  //    A tiny epsilon absorbs floating-point dust (0.9999999 counts as empty).
  const spent = lemonJuice >= spec.juice - 1e-9;
  if (spent || lemonTime >= LEMON_MAX_SEC) {
    cues.push('lemon-done');
    const index = state.index + 1;
    return {
      state: {
        ...state,
        index,
        pressure: 0,
        lemonJuice: 0,
        lemonTime: 0,
        juice: state.juice + take,
        bitterUnits,
        flowing: false,
        aboveZone: false,
        done: index >= state.lemons.length,
      },
      cues,
    };
  }

  return {
    state: {
      ...state,
      pressure,
      lemonJuice,
      lemonTime,
      juice: state.juice + take,
      bitterUnits,
      flowing: take > 0,
      aboveZone,
    },
    cues,
  };
}

/** Total juice these lemons hold (the most a perfect squeeze can get). */
export function batchJuice(lemons: readonly LemonKind[]): number {
  return lemons.reduce((sum, k) => sum + LEMON_SPECS[k].juice, 0);
}

export function result(state: SqueezeState): SqueezeResult {
  const count = Math.max(1, state.lemons.length);
  const available = batchJuice(state.lemons);
  return {
    // A plump lemon holds 1 unit, so "count" is the juice of a perfect plump batch.
    yield: clamp01(state.juice / count),
    efficiency: available > 0 ? clamp01(state.juice / available) : 0,
    // Averaged per lemon so a 3-lemon batch is not judged harsher than a 2-lemon one.
    bitterness: clamp01(state.bitterUnits / count),
  };
}

/** The squeeze a hired worker does instead of the player (see WORKER_SQUEEZE). */
export function workerResult(lemons: readonly LemonKind[]): SqueezeResult {
  const count = Math.max(1, lemons.length);
  return {
    yield: clamp01((WORKER_SQUEEZE.efficiency * batchJuice(lemons)) / count),
    efficiency: WORKER_SQUEEZE.efficiency,
    bitterness: WORKER_SQUEEZE.bitterness,
  };
}
