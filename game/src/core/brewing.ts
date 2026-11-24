// Brewing rules extracted from App.tsx.
//
// Approach: the React component used to mix game rules (widths, batch sizes,
// which challenge to play) with UI side effects (sounds, toasts). Here we keep
// only the rules, as pure functions: same inputs always give the same output,
// nothing is mutated, and randomness is passed in as `rand` (a function that
// returns a number in [0, 1), the `Random` type in rng.ts) so tests can script it.

export type BrewKind = 'triple-squeeze' | 'keep-in-tube' | 'rapid-stir' | 'moving-bullseye';
export type BrewTier = 'perfect' | 'good' | 'sour';
export type StirKey = 'W' | 'A' | 'S' | 'D' | 'SPACE';

export const BREW_CHALLENGE_KINDS: readonly BrewKind[] = [
  'triple-squeeze',
  'keep-in-tube',
  'rapid-stir',
  'moving-bullseye',
];

/** Cups added to the brewed pool for each tier (before clamping to stock). */
export const BREW_BATCH_SIZE: Record<BrewTier, number> = { perfect: 6, good: 4, sour: 2 };

export interface SweetSpotInputs {
  pitchers: number;
  workers: number;
}

export interface SweetSpots {
  /** Half-width of the "perfect" zone around a target (bullseye game). */
  perfectHalf: number;
  /** Half-width of the "good" zone (bullseye game). */
  goodHalf: number;
  /** Full width of the moving tube (keep-in-tube game). */
  tubeWidth: number;
  /** Half-width of each hit window (triple-squeeze game). */
  tripleTargetHalf: number;
}

// Each width grows with pitchers beyond the first and with hired workers, up to a cap.
export function sweetSpots({ pitchers, workers }: SweetSpotInputs): SweetSpots {
  const extraPitchers = Math.max(0, pitchers - 1);
  return {
    perfectHalf: Math.min(0.16, 0.055 + extraPitchers * 0.018 + workers * 0.022),
    goodHalf: Math.min(0.32, 0.17 + extraPitchers * 0.025 + workers * 0.03),
    tubeWidth: Math.min(0.42, 0.25 + extraPitchers * 0.03 + workers * 0.035),
    tripleTargetHalf: Math.min(0.11, 0.068 + extraPitchers * 0.012 + workers * 0.015),
  };
}

/** Pick uniformly among the 4 kinds, excluding the one played last. */
export function pickChallenge(last: BrewKind | null | undefined, rand: () => number): BrewKind {
  const pool = BREW_CHALLENGE_KINDS.filter((k) => k !== last);
  return pool[Math.floor(rand() * pool.length)] ?? 'triple-squeeze';
}

/**
 * Add a finished brew's batch to the brewed pool, never exceeding stock.
 * `added` is the real increase (0 when already full).
 * Note: App's toast text uses `added || batch`, so a full pool still displays
 * the batch size; that display quirk stays in the UI layer.
 */
export function applyBrewOutcome(
  tier: BrewTier,
  brewedCups: number,
  cupsInStock: number
): { brewedCups: number; added: number } {
  const batch = BREW_BATCH_SIZE[tier];
  const next = Math.min(cupsInStock, brewedCups + batch);
  return { brewedCups: next, added: Math.max(0, next - brewedCups) };
}
