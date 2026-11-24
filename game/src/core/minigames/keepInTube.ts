// Keep-in-tube: a tube drifts left/right; hold space to push the "drop"
// right (it sinks left otherwise). Staying inside the tube fills a meter.
//
// Timing quirk preserved from the original: the tube position and the timeout
// use the RAW elapsed time, but the drop/fill physics use dt capped at 0.05 s
// so a lag spike cannot teleport the drop.
import { sweetSpots } from '../brewing';
import type { StepResult, UpgradeInputs } from './types';

export const TUBE_TIMEOUT_SEC = 4.0;
export const TUBE_MAX_PHYSICS_DT = 0.05;

export interface KeepInTubeState {
  kind: 'keep-in-tube';
  center: number;
  drop: number;
  fill: number;
  elapsed: number;
  phase: number;
}

export interface TubeInputs extends UpgradeInputs {
  spaceHeld: boolean;
}

export function init(rand: () => number): KeepInTubeState {
  return { kind: 'keep-in-tube', center: 0.5, drop: 0.5, fill: 0.32, elapsed: 0, phase: rand() * Math.PI * 2 };
}

export function step(state: KeepInTubeState, dt: number, inputs: TubeInputs): StepResult<KeepInTubeState> {
  const physDt = Math.min(TUBE_MAX_PHYSICS_DT, dt);
  const elapsed = state.elapsed + dt;
  const width = sweetSpots(inputs).tubeWidth;

  const center = Math.max(
    width / 2,
    Math.min(1 - width / 2, 0.5 + 0.31 * Math.sin(elapsed * 2.15 + state.phase) + 0.11 * Math.cos(elapsed * 3.8))
  );
  const accel = inputs.spaceHeld ? 1.15 : -0.68;
  const drop = Math.max(0.03, Math.min(0.97, state.drop + accel * physDt));
  const inside = Math.abs(drop - center) <= width / 2;
  const fill = Math.max(0, Math.min(1, state.fill + (inside ? 0.52 : -0.22) * physDt));

  const next: KeepInTubeState = { ...state, elapsed, center, drop, fill };
  if (fill >= 1) return { state: next, outcome: 'perfect' };
  if (elapsed >= TUBE_TIMEOUT_SEC) return { state: next, outcome: fill >= 0.65 ? 'good' : 'sour' };
  return { state: next };
}

// A click/tap nudges the drop right.
export function press(state: KeepInTubeState): StepResult<KeepInTubeState> {
  return { state: { ...state, drop: Math.min(0.97, state.drop + 0.14) } };
}
