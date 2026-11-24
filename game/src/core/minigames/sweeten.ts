// Step 2 of the lemonade brew: SWEETEN TO TASTE.
//
// THE IDEA
// Hold to pour sugar, let go when the taste meter reaches the face the customers
// want. The pour rate never changes; the challenge is judging WHEN to stop.
//
//   - `target` (0..1) is how sweet this crowd likes it. The store will set it from the
//     district and the weather; this file only receives the number.
//   - `band` is how far from the target still counts as "right". Harder difficulty
//     makes the band narrower (pickier customers), never the pour faster.
//
// THE ONE CORRECTION
// Over-pour past the band and you get ONE chance to fix it: press again within
// FIX_OFFER_SEC to "add water and lemon". That dilutes the sweetness (multiplies it
// by FIX_DILUTE) and you pour again from there. Watering the batch down costs some
// yield (FIX_YIELD_COST), which lemonadeBrew.ts applies. Under-pouring has no fix: you
// stopped early, and that is the taste you get.
//
// PHASES (a small state machine; each arrow is one event)
//   ready --press--> pour --release--> reveal --(REVEAL_SEC)--> done
//                                  \-> offer (over the band, fix unused)
//   offer --press--> ready (diluted, fix used)     offer --(FIX_OFFER_SEC)--> done
//
// Press/release are edge events: lemonadeBrew.ts turns the held/not-held level into
// them. That is why a Space hold carried over from the squeeze step does not start a
// pour by itself: no new press happened.
import { clamp01, MAX_PHYSICS_DT } from './types';

/** Sweetness gained per second of pouring (empty to fully sweet in 2 s). */
export const SUGAR_POUR_PER_SEC = 0.5;
/** "Add water + lemon" keeps this share of the sweetness. */
export const FIX_DILUTE = 0.6;
/** Share of the batch's yield lost when the fix is used (lemonadeBrew applies it). */
export const FIX_YIELD_COST = 0.1;
/** How long the fix stays on offer after an over-pour. */
export const FIX_OFFER_SEC = 1.6;
/** Pause that shows the final taste before moving on to stirring. */
export const REVEAL_SEC = 0.5;

export type SweetenPhase = 'ready' | 'pour' | 'offer' | 'reveal' | 'done';

export interface SweetenState {
  target: number;
  /** Half-width of the "tastes right" band around `target`. */
  band: number;
  sweetness: number;
  phase: SweetenPhase;
  fixUsed: boolean;
  /** Seconds spent in the current timed phase (offer or reveal). */
  timer: number;
}

export function init(target: number, band: number): SweetenState {
  return { target: clamp01(target), band, sweetness: 0, phase: 'ready', fixUsed: false, timer: 0 };
}

/** Over the band, i.e. too sweet for this crowd. */
export function isOverSweet(state: SweetenState): boolean {
  return state.sweetness > state.target + state.band;
}

export function press(state: SweetenState): { state: SweetenState; fixed: boolean } {
  if (state.phase === 'ready') return { state: { ...state, phase: 'pour' }, fixed: false };
  if (state.phase === 'offer') {
    // Water and lemon go in: the drink is less sweet, and the player pours again.
    return {
      state: { ...state, phase: 'ready', sweetness: state.sweetness * FIX_DILUTE, fixUsed: true, timer: 0 },
      fixed: true,
    };
  }
  return { state, fixed: false };
}

export function release(state: SweetenState): { state: SweetenState; overshoot: boolean } {
  if (state.phase !== 'pour') return { state, overshoot: false };
  // Too sweet and the fix is still available -> offer it. Otherwise lock the taste in.
  if (isOverSweet(state) && !state.fixUsed) {
    return { state: { ...state, phase: 'offer', timer: 0 }, overshoot: true };
  }
  return { state: { ...state, phase: 'reveal', timer: 0 }, overshoot: false };
}

export function step(state: SweetenState, dt: number): SweetenState {
  const physDt = Math.min(MAX_PHYSICS_DT, Math.max(0, dt));
  switch (state.phase) {
    case 'pour':
      return { ...state, sweetness: clamp01(state.sweetness + SUGAR_POUR_PER_SEC * physDt) };
    case 'offer': {
      const timer = state.timer + physDt;
      // Offer expired: the player chose to keep it too sweet.
      return timer >= FIX_OFFER_SEC ? { ...state, phase: 'done', timer } : { ...state, timer };
    }
    case 'reveal': {
      const timer = state.timer + physDt;
      return timer >= REVEAL_SEC ? { ...state, phase: 'done', timer } : { ...state, timer };
    }
    default:
      return state;
  }
}

export function tasteError(state: SweetenState): number {
  return Math.abs(state.sweetness - state.target);
}

/**
 * Maps a difficulty (0..1) to the taste band half-width: 0.12 when easy, 0.05 when
 * picky. The pour speed is a separate constant and is not touched.
 */
export function bandForDifficulty(difficulty: number): number {
  return 0.12 - 0.07 * clamp01(difficulty);
}
