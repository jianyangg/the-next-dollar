import { useMemo } from 'react';
import { getNeighborhood } from '../core/neighborhoods';
import { type GameData, useGameStore } from '../state/gameStore';

/**
 * The first-stall guided tutorial (steps 1/5 .. 5/5).
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

export interface TutorialStep {
  num: number;
  title: string;
  text: string;
}

/** The current tutorial step (title + instruction text), or null when the tutorial is over. */
export function useTutorialStep(): TutorialStep | null {
  const num = useGameStore(selectTutorialStepNum);
  const lastBusinessNeighborhood = useGameStore((s) => s.lastBusinessNeighborhood);
  return useMemo(() => {
    if (num === null) return null;
    switch (num) {
      case 1:
        return {
          num,
          title: 'Lease a corner',
          text: 'Walk to the gold FOR LEASE plot and press [E] to sign your first lease ($2/day).',
        };
      case 2:
        return {
          num,
          title: 'Visit Market',
          text: 'Press [M] (NY Map) and take the subway to Union Square Supply Market.',
        };
      case 3:
        return {
          num,
          title: 'Buy Supplies',
          text: 'Buy a Stall Kit ($12), Pitcher ($10), and Lemons ($5) from the 3 Market stalls.',
        };
      case 4:
        return {
          num,
          title: 'Build Stand',
          text: `Head back to ${getNeighborhood(lastBusinessNeighborhood).shortName} ([M]), walk to your green LEASED plot, and press [E] to place your stand!`,
        };
      default:
        return {
          num,
          title: 'Brew & Serve',
          text: 'Press [E] behind your counter, hit [F] / Brew (nail the gold sweet spot!), and press [Space] to serve your first customer!',
        };
    }
  }, [num, lastBusinessNeighborhood]);
}

/** Top-center, non-blocking banner. Hidden while a full-screen layer or modal is open. */
export function TutorialBar() {
  const actions = useGameStore((s) => s.actions);
  const step = useTutorialStep();
  const blocked = useGameStore((s) => s.founderModalOpen || s.mapOpen || s.activeModal !== null || s.eodRecord !== null);

  if (!step || blocked) return null;
  return (
    <div className="tutorial-banner" role="status" aria-live="polite">
      <span className="tutorial-step-count game-num">{step.num}/5</span>
      <div className="tutorial-copy">
        <strong>{step.title}:</strong> {step.text}
      </div>
      <button type="button" className="tutorial-skip-btn" onClick={actions.skipTutorial}>
        Skip Tutorial
      </button>
    </div>
  );
}
