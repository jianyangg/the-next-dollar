// Triple squeeze: a needle sweeps back and forth; press 3 times, each time
// trying to land within a small window around that step's target.
// Timeout check comes BEFORE the needle update (as in the original loop).
import type { BrewTier } from '../brewing';
import { sweetSpots } from '../brewing';
import { pingPong, type StepResult, type UpgradeInputs } from './types';

export const TRIPLE_TIMEOUT_SEC = 3.2;
export const TRIPLE_NEEDLE_SPEED = 1.38;

export interface TripleSqueezeState {
  kind: 'triple-squeeze';
  targets: [number, number, number];
  step: number;
  hits: number;
  needle: number;
  elapsed: number;
}

const tierFor = (hits: number): BrewTier => (hits >= 3 ? 'perfect' : hits === 2 ? 'good' : 'sour');

export function init(rand: () => number): TripleSqueezeState {
  // Call order matters for scripted rand: t1, t2, t3.
  const t1 = +(0.18 + rand() * 0.12).toFixed(2);
  const t2 = +(0.44 + rand() * 0.12).toFixed(2);
  const t3 = +(0.72 + rand() * 0.14).toFixed(2);
  return { kind: 'triple-squeeze', targets: [t1, t2, t3], step: 0, hits: 0, needle: 0, elapsed: 0 };
}

export function step(state: TripleSqueezeState, dt: number): StepResult<TripleSqueezeState> {
  const elapsed = state.elapsed + dt;
  if (elapsed >= TRIPLE_TIMEOUT_SEC) {
    return { state: { ...state, elapsed }, outcome: tierFor(state.hits) };
  }
  return { state: { ...state, elapsed, needle: pingPong(elapsed * TRIPLE_NEEDLE_SPEED) } };
}

export function press(state: TripleSqueezeState, upgrades: UpgradeInputs): StepResult<TripleSqueezeState> {
  const { tripleTargetHalf } = sweetSpots(upgrades);
  const target = state.targets[state.step] ?? 0.5;
  const hit = Math.abs(state.needle - target) <= tripleTargetHalf;
  const hits = state.hits + (hit ? 1 : 0);
  const nextStep = state.step + 1;
  const next = { ...state, hits, step: nextStep };
  return nextStep >= 3 ? { state: next, outcome: tierFor(hits) } : { state: next };
}
