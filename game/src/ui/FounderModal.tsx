import { AnimatePresence } from 'motion/react';
import * as m from 'motion/react-m';
import { getNeighborhood } from '../core/neighborhoods';
import { useGameStore } from '../state/gameStore';
import { FOUNDER_CATALOG, type FounderSpecies } from '../world/pixelArt';
import { getStandingSprites } from './assets';
import { CursorMenu, type CursorMenuItem } from './kit/CursorMenu';
import { Key } from './kit/Money';
import { PaperChip } from './shop/ShopWindow';
import { backdropMotion, modalShellMotion } from './motionPresets';
import './styles/founder.css';

/**
 * Two-word trait shown under each founder (the old tagline paragraphs are gone).
 * Typed as a Record over every founder id, so adding a founder without a trait is a
 * compile error instead of a blank label at runtime.
 */
const TRAIT: Record<FounderSpecies, string> = {
  squirrel: 'Park Hustler',
  shiba: 'Block Strategist',
  panda: 'Campus Founder',
  penguin: 'Uptown Operator',
  bunny: 'Street Analyst',
};

/**
 * Character-select screen. On a new run it follows the opening story (IntroStory), so
 * it waits until the story is closed; "Replay intro" brings the story back over it.
 */
export function FounderModal() {
  const open = useGameStore((s) => s.founderModalOpen && !s.introOpen && s.travel === null);
  // AnimatePresence keeps the body mounted until its exit animation has played.
  return <AnimatePresence>{open && <FounderModalBody key="founder" />}</AnimatePresence>;
}

function FounderModalBody() {
  const actions = useGameStore((s) => s.actions);
  const founderSpecies = useGameStore((s) => s.founderSpecies);
  const neighborhoodId = useGameStore((s) => s.neighborhoodId);
  const cash = useGameStore((s) => s.economy.cash);
  // Before the first run there is nothing to go back to, so no "Close" is offered
  // (the store also refuses closeFounderModal until then).
  const runStarted = useGameStore((s) => s.runStarted);
  const sprites = getStandingSprites();
  const neighborhood = getNeighborhood(neighborhoodId);

  // Confirming a founder (E, Enter or a click) picks them AND starts the run: in a
  // character-select screen "choose" and "go" are one action. The store still gets both
  // calls, so the hero in the scene is swapped before the window closes.
  const items: CursorMenuItem[] = FOUNDER_CATALOG.map((founder) => ({
    id: founder.id,
    label: (
      <span className="fpick-card">
        <span className="fpick-figure">
          <img src={sprites[founder.id]} alt={founder.name} className="fpick-sprite" />
        </span>
        <span className="pt-disp fpick-name">{founder.name}</span>
        <span className="fpick-trait">{TRAIT[founder.id]}</span>
        {founder.id === founderSpecies && <span className="fpick-current">Playing</span>}
      </span>
    ),
    onSelect: () => {
      actions.pickFounder(founder.id);
      actions.startFromFounderModal();
    },
  }));

  return (
    <m.div className="pt-scrim fpick-scrim" onClick={actions.closeFounderModal} {...backdropMotion}>
      <m.div
        className="pt-sign fpick-window"
        role="dialog"
        aria-label="Choose your founder"
        onClick={(e) => e.stopPropagation()}
        {...modalShellMotion}
      >
        <header className="pt-titlebar fpick-head">
          <h2 className="pt-disp fpick-title">Who are you?</h2>
          <div className="fpick-stats">
            <PaperChip label="CASH" value={`$${cash.toFixed(2)}`} />
            <PaperChip label="START" value={neighborhood.shortName} />
          </div>
        </header>

        <CursorMenu items={items} label="Founders" orientation="row" blocking className="fpick-menu" initialId={founderSpecies} />

        <footer className="fpick-keys">
          <span className="fpick-key">
            <Key k="E" /> Play
          </span>
          {runStarted && (
            <span className="fpick-key">
              <Key k="Esc" nav /> Close
            </span>
          )}
          <button type="button" className="pt-btn fpick-replay" onClick={actions.replayIntro}>
            Replay intro
          </button>
        </footer>
      </m.div>
    </m.div>
  );
}
