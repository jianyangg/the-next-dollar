// One entry point so the UI can drive any minigame with a single loop:
//   state = initGame(kind, rand)
//   each frame: ({state, outcome} = stepGame(state, dt, inputs))
//   on lock/click: pressGame(state, inputs);  on stir key: pressStirKey(...)
// The `kind` field on each state makes the union discriminated.
import type { BrewKind, StirKey } from '../brewing';
import * as tripleSqueeze from './tripleSqueeze';
import * as keepInTube from './keepInTube';
import * as rapidStir from './rapidStir';
import * as movingBullseye from './movingBullseye';
import type { StepResult, UpgradeInputs } from './types';

export { tripleSqueeze, keepInTube, rapidStir, movingBullseye };
export type { StepResult, UpgradeInputs } from './types';
export type { TripleSqueezeState } from './tripleSqueeze';
export type { KeepInTubeState, TubeInputs } from './keepInTube';
export type { RapidStirState } from './rapidStir';
export type { MovingBullseyeState } from './movingBullseye';

export type BrewGameState =
  | tripleSqueeze.TripleSqueezeState
  | keepInTube.KeepInTubeState
  | rapidStir.RapidStirState
  | movingBullseye.MovingBullseyeState;

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
  }
}

/** A W/A/S/D/SPACE key press; ignored (state unchanged) outside rapid-stir. */
export function pressStirKey(state: BrewGameState, key: StirKey): StepResult<BrewGameState> {
  return state.kind === 'rapid-stir' ? rapidStir.pressKey(state, key) : { state };
}
