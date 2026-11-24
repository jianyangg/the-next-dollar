import type { BrewTier } from '../brewing';

// Every minigame function returns the new state plus, optionally, a final
// tier (set when the game just ended). `shake` is a UI hint (rapid-stir only).
//
// The three-step lemonade brew (lemonadeBrew.ts) also fills two extra fields:
//   - `quality`: the raw numbers behind the tier, set on the same step as `outcome`;
//   - `cues`: short event names from THIS step ("seeds started falling", "lemon done"),
//     so the store can play a sound without diffing old and new state itself.
// The four older games never set them, so existing callers are unaffected.
export interface StepResult<S> {
  state: S;
  outcome?: BrewTier;
  shake?: boolean;
  quality?: BrewQuality;
  cues?: readonly BrewCue[];
}

/**
 * The finished lemonade brew, as numbers the economy can use directly.
 * Every 0..1 value is "higher is more of that thing" (so higher bitterness is worse).
 */
export interface BrewQuality {
  /**
   * Juice in the pitcher compared with a perfect batch of PLUMP lemons, after spills
   * and the "add water + lemon" fix. 1 = as much as the best possible batch. Dry
   * lemons hold less juice, so a perfectly squeezed dry batch still scores below 1:
   * this is the number to turn into "cups per lemon".
   */
  yield: number;
  /** How much of the juice the lemons in THIS batch actually held was captured (skill, not luck). */
  efficiency: number;
  /** Seeds and pith pressed in by squeezing too hard. 0 = clean, 1 = very bitter. */
  bitterness: number;
  /** |sweetness poured - sweetness wanted|, on the same 0..1 scale as targetSweetness. */
  tasteError: number;
  /** Share of sugar grains stirred in. 1 = fully dissolved, less = gritty. */
  dissolve: number;
  /** Share of the pitcher sloshed out by stirring too fast (already taken off `yield`). */
  slop: number;
  /** True when the player used the one "add water + lemon" correction. */
  fixUsed: boolean;
  /** Weighted 0..1 summary of everything above; it is what picks `tier`. */
  score: number;
  /** The same three tiers the old challenges produce, so today's economy keeps working. */
  tier: BrewTier;
}

/** Event names the lemonade brew reports on the frame they happen (for sounds / juice). */
export type BrewCue =
  | 'seeds' // pressure just went over the juicy zone
  | 'lemon-done' // one lemon is spent, the next one is on the juicer
  | 'step-done' // squeeze -> sweeten or sweeten -> stir
  | 'overshoot' // released the sugar above the taste band; the fix is on offer
  | 'fix' // "add water + lemon" was used
  | 'stir' // one clean quarter turn
  | 'slop' // a quarter turn so fast it splashed
  | 'brew-done';

// Player upgrades that widen the sweet spots. Passed every step because the
// original recomputed them from live state each frame/press.
export interface UpgradeInputs {
  pitchers: number;
  workers: number;
}

// Ping-pong: maps a steadily growing phase onto 0 -> 1 -> 0 -> 1 ...
export function pingPong(phase: number): number {
  const cycle = phase % 2;
  return cycle <= 1 ? cycle : 2 - cycle;
}

/** Clamp a number into [0, 1]. */
export function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/**
 * Frame times are capped before physics runs. If the tab stalls for half a second,
 * an uncapped dt would push the pressure needle straight through the juicy zone in one
 * jump, punishing the player for their computer hiccuping. With a cap, a stall just
 * slows the game down for one frame instead.
 */
export const MAX_PHYSICS_DT = 0.05;
