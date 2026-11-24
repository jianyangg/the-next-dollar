// Moving bullseye: both a needle and a bullseye move; press to lock and the
// distance between them decides the tier. Timeout check is BEFORE updates.
import { sweetSpots } from '../brewing';
import { pingPong, type StepResult, type UpgradeInputs } from './types';

export const BULLSEYE_TIMEOUT_SEC = 3.0;
export const BULLSEYE_NEEDLE_SPEED = 1.95;

export interface MovingBullseyeState {
  kind: 'moving-bullseye';
  needle: number;
  bullseye: number;
  elapsed: number;
  phase: number;
}

export function init(rand: () => number): MovingBullseyeState {
  return { kind: 'moving-bullseye', needle: 0, bullseye: 0.78, elapsed: 0, phase: rand() * Math.PI };
}

export function step(state: MovingBullseyeState, dt: number): StepResult<MovingBullseyeState> {
  const elapsed = state.elapsed + dt;
  if (elapsed >= BULLSEYE_TIMEOUT_SEC) return { state: { ...state, elapsed }, outcome: 'sour' };
  return {
    state: {
      ...state,
      elapsed,
      needle: pingPong(elapsed * BULLSEYE_NEEDLE_SPEED),
      bullseye: 0.5 + 0.3 * Math.cos(elapsed * 2.4 + state.phase),
    },
  };
}

export function press(state: MovingBullseyeState, upgrades: UpgradeInputs): StepResult<MovingBullseyeState> {
  const { perfectHalf, goodHalf } = sweetSpots(upgrades);
  const dist = Math.abs(state.needle - state.bullseye);
  return { state, outcome: dist <= perfectHalf ? 'perfect' : dist <= goodHalf ? 'good' : 'sour' };
}
