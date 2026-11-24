import type { BrewTier } from '../brewing';

// Every minigame function returns the new state plus, optionally, a final
// tier (set when the game just ended). `shake` is a UI hint (rapid-stir only).
export interface StepResult<S> {
  state: S;
  outcome?: BrewTier;
  shake?: boolean;
}

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
