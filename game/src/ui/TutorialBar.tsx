import { useMemo } from 'react';
import { CLOSING_TIME_SHORT } from '../core/clock';
import { getNeighborhood } from '../core/neighborhoods';
import { missingStarterItems, STARTER_NAME } from '../core/tutorial';
import { type GameData, useGameStore } from '../state/gameStore';
import { Key } from './kit/Money';
import './styles/world.css';

/**
 * The first-stall guided tutorial (steps 1 to 6), shown as ONE goal plate.
 *
 * Which step to show is a pure function of the game data, so `selectTutorialStepNum`
 * boils the whole store down to one small number (or null when the tutorial is off).
 * Components subscribing to it re-render only when the player advances a step, not on
 * every cash change.
 */
export const selectTutorialStepNum = (s: GameData): number | null => {
  if (!s.tutorialActive) return null;
  const { plots, stallKits, ownedStands, pitchers, cupsInStock, totalRevenue } = s.economy;
  const hasLeasedOrBuilt = Object.values(plots).some((p) => p !== 'empty');
  const hasSupplies = (stallKits >= 1 || ownedStands >= 1) && pitchers >= 1 && cupsInStock >= 1;
  if (!hasLeasedOrBuilt) return 1;
  if (!hasSupplies && s.neighborhoodId !== 'market') return 2;
  if (!hasSupplies) return 3;
  if (ownedStands === 0) return 4;
  // After the first sale the last goal points at the score: beat the 5% line at closing.
  if (totalRevenue <= 0) return 5;
  return 6;
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

/** The market's name exactly as the map shows it, so the goal and the map agree. */
const MARKET_NAME = getNeighborhood('market').shortName;

/** Fixed goals. Step 3 is built from what is still missing (see `selectStep3Words`). */
const GOALS: Record<number, GoalPart[]> = {
  1: [{ key: 'E', words: 'Lease the gold plot' }],
  2: [{ key: 'M', nav: true, words: `Ride to ${MARKET_NAME}` }],
  4: [{ key: 'E', words: 'Build your stand' }],
  5: [
    { key: 'F', words: 'Brew' },
    { key: 'Space', words: 'Serve' },
  ],
  6: [{ words: `${CLOSING_TIME_SHORT}: beat the line` }],
};

/**
 * Step 3 lists only the starter items still missing ("Buy pitcher, lemons"), so the
 * goal shrinks as the player shops instead of repeating items they already own.
 * Returns a string (not an array) so the store selector result compares by value.
 */
const selectStep3Words = (s: GameData): string =>
  `Buy ${missingStarterItems(s.economy).map((m) => STARTER_NAME[m]).join(', ')}`;

/** The current tutorial step, or null when the tutorial is over. */
export function useTutorialStep(): TutorialStep | null {
  const num = useGameStore(selectTutorialStepNum);
  const step3 = useGameStore(selectStep3Words);
  // useMemo keeps the object identity stable between renders with the same step.
  return useMemo(() => {
    if (num === null) return null;
    return { num, goal: num === 3 ? [{ words: step3 }] : GOALS[num] };
  }, [num, step3]);
}

/** Top-centre, non-blocking goal plate. Hidden while a full-screen layer or modal is open. */
export function TutorialBar() {
  const actions = useGameStore((s) => s.actions);
  const step = useTutorialStep();
  const blocked = useGameStore(
    (s) => s.introOpen || s.founderModalOpen || s.travel !== null || s.mapOpen || s.activeModal !== null || s.eodRecord !== null
  );

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
