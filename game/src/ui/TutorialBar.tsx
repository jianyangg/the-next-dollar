import { useMemo } from 'react';
import { type GameData, useGameStore } from '../state/gameStore';
import { Key } from './kit/Money';
import './styles/world.css';

/**
 * The first-stall guided tutorial (steps 1 to 5), shown as ONE goal plate.
 *
 * Which step to show is a pure function of the game data, so `selectTutorialStepNum`
 * boils the whole store down to one small number (or null when the tutorial is off).
 * Components subscribing to it re-render only when the player advances a step, not on
 * every cash change.
 */
export const selectTutorialStepNum = (s: GameData): number | null => {
  if (!s.tutorialActive) return null;
  const { plots, stallKits, ownedStands, pitchers, cupsInStock } = s.economy;
  const hasLeasedOrBuilt = Object.values(plots).some((p) => p !== 'empty');
  const hasSupplies = (stallKits >= 1 || ownedStands >= 1) && pitchers >= 1 && cupsInStock >= 1;
  if (!hasLeasedOrBuilt) return 1;
  if (!hasSupplies && s.neighborhoodId !== 'market') return 2;
  if (!hasSupplies) return 3;
  if (ownedStands === 0) return 4;
  return 5;
};

/** One piece of a goal: an optional key bullet followed by a few words. */
export interface GoalPart {
  /** Key to show in a bullet (e.g. "E"); omit for plain words. */
  key?: string;
  /** Orange navigation bullet (M map, B books) instead of the blue action bullet. */
  nav?: boolean;
  words: string;
}

export interface TutorialStep {
  num: number;
  /** The whole goal, at most six words, as bullets + words. */
  goal: GoalPart[];
}

/** The goal for each step. Same five steps, same order, same triggers as before. */
const GOALS: Record<number, GoalPart[]> = {
  1: [{ key: 'E', words: 'Lease the gold plot' }],
  2: [{ key: 'M', nav: true, words: 'Ride to Union Sq' }],
  3: [{ words: 'Buy kit, pitcher, lemons' }],
  4: [{ key: 'E', words: 'Build your stand' }],
  5: [
    { key: 'F', words: 'Brew' },
    { key: 'Space', words: 'Serve' },
  ],
};

/** The current tutorial step, or null when the tutorial is over. */
export function useTutorialStep(): TutorialStep | null {
  const num = useGameStore(selectTutorialStepNum);
  // useMemo keeps the object identity stable between renders with the same step.
  return useMemo(() => (num === null ? null : { num, goal: GOALS[num] }), [num]);
}

/** Top-centre, non-blocking goal plate. Hidden while a full-screen layer or modal is open. */
export function TutorialBar() {
  const actions = useGameStore((s) => s.actions);
  const step = useTutorialStep();
  const blocked = useGameStore((s) => s.founderModalOpen || s.mapOpen || s.activeModal !== null || s.eodRecord !== null);

  if (!step || blocked) return null;
  return (
    <div className="pt-sign world-goal" role="status" aria-live="polite">
      {step.goal.map((part) => (
        <span key={part.words} className="world-goal-part">
          {part.key && <Key k={part.key} nav={part.nav} />}
          <span className="pt-disp world-goal-words">{part.words}</span>
        </span>
      ))}
      <button type="button" className="world-goal-skip" onClick={actions.skipTutorial}>
        Skip
      </button>
    </div>
  );
}
