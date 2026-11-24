// One entry point so the UI can drive any minigame with a single loop:
//   state = initGame(kind, rand)
//   each frame: ({state, outcome} = stepGame(state, dt, inputs))
//   on lock/click: pressGame(state, inputs);  on stir key: pressStirKey(...)
// The `kind` field on each state makes the union discriminated.
//
// 'lemonade-brew' (squeeze -> sweeten -> stir, see lemonadeBrew.ts) is in the union
// too, but it is NOT created by `initGame`: it needs a config (difficulty, target
// sweetness, worker) that the four arcade challenges do not, so the store calls
// `lemonadeBrew.init(rand, config)` directly. Once it is running, the same
// stepGame / pressGame / pressStirKey calls drive it:
//   - stepGame reads `spaceHeld` as the hold level (press/release are its edges);
//   - pressGame is a no-op for it (the hold level already carries the press);
//   - pressStirKey forwards W/A/S/D as spoon quadrants.
import type { BrewKind, StirKey } from '../brewing';
import * as tripleSqueeze from './tripleSqueeze';
import * as keepInTube from './keepInTube';
import * as rapidStir from './rapidStir';
import * as movingBullseye from './movingBullseye';
import * as lemonadeBrew from './lemonadeBrew';
import * as squeeze from './squeeze';
import * as sweeten from './sweeten';
import * as stir from './stir';
import type { StepResult, UpgradeInputs } from './types';

export { tripleSqueeze, keepInTube, rapidStir, movingBullseye, lemonadeBrew, squeeze, sweeten, stir };
export type { BrewCue, BrewQuality, StepResult, UpgradeInputs } from './types';
export type { BrewPhase, LemonadeBrewConfig, LemonadeBrewState } from './lemonadeBrew';
export type { LemonKind } from './squeeze';
export type { StirQuadrant } from './stir';
export type { TripleSqueezeState } from './tripleSqueeze';
export type { KeepInTubeState, TubeInputs } from './keepInTube';
export type { RapidStirState } from './rapidStir';
export type { MovingBullseyeState } from './movingBullseye';

export type BrewGameState =
  | tripleSqueeze.TripleSqueezeState
  | keepInTube.KeepInTubeState
  | rapidStir.RapidStirState
  | movingBullseye.MovingBullseyeState
  | lemonadeBrew.LemonadeBrewState;

export interface GameInputs extends UpgradeInputs {
  spaceHeld: boolean;
}

export function initGame(kind: BrewKind, rand: () => number): BrewGameState {
  switch (kind) {
    case 'triple-squeeze':
      return tripleSqueeze.init(rand);
    case 'keep-in-tube':
      return keepInTube.init(rand);
    case 'rapid-stir':
      return rapidStir.init(rand);
    case 'moving-bullseye':
      return movingBullseye.init(rand);
  }
}

export function stepGame(state: BrewGameState, dt: number, inputs: GameInputs): StepResult<BrewGameState> {
  switch (state.kind) {
    case 'triple-squeeze':
      return tripleSqueeze.step(state, dt);
    case 'keep-in-tube':
      return keepInTube.step(state, dt, inputs);
    case 'rapid-stir':
      return rapidStir.step(state, dt);
    case 'moving-bullseye':
      return movingBullseye.step(state, dt);
    case 'lemonade-brew':
      return lemonadeBrew.step(state, dt, { held: inputs.spaceHeld });
  }
}

/** The generic "lock" button / click, dispatched per game. */
export function pressGame(state: BrewGameState, inputs: UpgradeInputs): StepResult<BrewGameState> {
  switch (state.kind) {
    case 'triple-squeeze':
      return tripleSqueeze.press(state, inputs);
    case 'keep-in-tube':
      return keepInTube.press(state);
    case 'rapid-stir':
      return rapidStir.pressLock(state);
    case 'moving-bullseye':
      return movingBullseye.press(state, inputs);
    case 'lemonade-brew':
      return { state };
  }
}

/**
 * A W/A/S/D/SPACE key press. Rapid-stir checks it against its sequence; the lemonade
 * brew treats W/A/S/D as the spoon entering that quadrant (SPACE is not a quadrant).
 * Every other game ignores it (state unchanged).
 */
export function pressStirKey(state: BrewGameState, key: StirKey): StepResult<BrewGameState> {
  if (state.kind === 'rapid-stir') return rapidStir.pressKey(state, key);
  if (state.kind === 'lemonade-brew' && key !== 'SPACE') return lemonadeBrew.stirTurn(state, key);
  return { state };
}
