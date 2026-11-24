// Rapid stir: type a 5-key sequence (4 random W/A/S/D with no immediate
// repeat, then SPACE) before a fuse burns out. Wrong keys cost 0.28 s.
import type { StirKey } from '../brewing';
import type { StepResult } from './types';

export const STIR_FUSE_SEC = 2.6;
export const STIR_WRONG_KEY_PENALTY_SEC = 0.28;

export interface RapidStirState {
  kind: 'rapid-stir';
  seq: StirKey[];
  index: number;
  penalty: number;
  elapsed: number;
  /** 1 = full fuse, 0 = burnt out. */
  fuse: number;
}

export function init(rand: () => number): RapidStirState {
  const dirs: StirKey[] = ['W', 'A', 'S', 'D'];
  const seq: StirKey[] = [];
  for (let i = 0; i < 4; i++) {
    const filtered = dirs.filter((d) => d !== seq[i - 1]);
    seq.push(filtered[Math.floor(rand() * filtered.length)] ?? 'W');
  }
  seq.push('SPACE');
  return { kind: 'rapid-stir', seq, index: 0, penalty: 0, elapsed: 0, fuse: 1 };
}

export function step(state: RapidStirState, dt: number): StepResult<RapidStirState> {
  const elapsed = state.elapsed + dt;
  const fuse = Math.max(0, 1 - (elapsed + state.penalty) / STIR_FUSE_SEC);
  const next = { ...state, elapsed, fuse };
  if (fuse <= 0) return { state: next, outcome: state.index >= 3 ? 'good' : 'sour' };
  return { state: next };
}

export function pressKey(state: RapidStirState, key: StirKey): StepResult<RapidStirState> {
  if (key === state.seq[state.index]) {
    const index = state.index + 1;
    const next = { ...state, index };
    return index >= state.seq.length ? { state: next, outcome: 'perfect' } : { state: next };
  }
  return { state: { ...state, penalty: state.penalty + STIR_WRONG_KEY_PENALTY_SEC }, shake: true };
}

// The generic lock button counts as pressing whichever key is expected.
export function pressLock(state: RapidStirState): StepResult<RapidStirState> {
  return pressKey(state, state.seq[state.index] ?? 'SPACE');
}
