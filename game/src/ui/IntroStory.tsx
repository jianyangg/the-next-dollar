import { AnimatePresence } from 'motion/react';
import * as m from 'motion/react-m';
import { useState } from 'react';
import { HURDLE_RATE } from '../core/sliceModel';
import { useGameStore } from '../state/gameStore';
import { INPUT_PRIORITY } from '../state/input';
import { FOUNDER_CATALOG } from '../world/pixelArt';
import { getIcons, getStandingSprites } from './assets';
import { Key } from './kit/Money';
import { useInputLayer } from './kit/useInputLayer';
import { backdropMotion, modalShellMotion } from './motionPresets';
import { PaperChip } from './shop/ShopWindow';
import './styles/intro.css';

/**
 * THE OPENING STORY: four big cards that put the player in the world before any
 * shopping starts (where you are, where the money comes from, what the score is).
 *
 * Design rules it follows:
 *   - One short line per card, very large, so it reads like a game, not a manual.
 *   - Every number comes from the engine (starting cash, the 5% rate, the number of
 *     days), so the story can never disagree with the books.
 *   - The $30 is a STAKE from family, not a loan: the game never charges interest in
 *     cash. The 5% is an opportunity cost on EVERY dollar (idle cash too) that only
 *     lowers the score, which is what card 3 says ("every dollar must earn 5% a day").
 *   - Shown once per browser (state/introSeen.ts); "Replay intro" on the founder
 *     screen brings it back. E / Enter / Space / click = next, Esc = skip.
 */
export function IntroStory() {
  const open = useGameStore((s) => s.introOpen);
  return <AnimatePresence>{open && <IntroBody key="intro" />}</AnimatePresence>;
}

const CARD_COUNT = 4;

function IntroBody() {
  const finishIntro = useGameStore((s) => s.actions.finishIntro);
  const cash = useGameStore((s) => s.economy.cash);
  const maxDays = useGameStore((s) => s.economy.maxDays);
  const [card, setCard] = useState(0);

  const next = (): void => {
    if (card + 1 >= CARD_COUNT) finishIntro();
    else setCard(card + 1);
  };

  // A blocking layer: the world must not walk while the story is up. Escape passes
  // through (the default for blocking layers) so the global handler skips the story
  // via handleEscape.
  useInputLayer(
    (e) => {
      if (e.key === 'e' || e.key === 'E' || e.key === 'Enter' || e.code === 'Space') {
        e.preventDefault();
        if (!e.repeat) next(); // a held key must not race through all four cards
        return true;
      }
      return false;
    },
    { blocking: true, priority: INPUT_PRIORITY.modal }
  );

  const icons = getIcons();
  const sprites = getStandingSprites();
  const ratePct = `${Math.round(HURDLE_RATE * 100)}%`;

  const cards = [
    <>
      <h2 className="pt-disp intro-line">Summer in New York.</h2>
      <p className="pt-disp intro-sub">Everyone's thirsty.</p>
    </>,
    <>
      <div className="intro-figures" aria-hidden="true">
        {FOUNDER_CATALOG.map((f) => (
          <img key={f.id} src={sprites[f.id]} alt="" className="intro-figure" />
        ))}
      </div>
      <h2 className="pt-disp intro-line">Your family stakes you ${cash.toFixed(0)}.</h2>
      <PaperChip label="CASH" value={`$${cash.toFixed(2)}`} />
    </>,
    <>
      <div className="intro-line-bar pt-line-fill" aria-hidden="true">
        <img src={icons.lemon} alt="" className="intro-icon" />
        <img src={icons.pitcher} alt="" className="intro-icon" />
        <img src={icons.market} alt="" className="intro-icon" />
      </div>
      <h2 className="pt-disp intro-line">Every dollar must earn {ratePct} a day.</h2>
    </>,
    <>
      <img src={icons.sun} alt="" className="intro-icon is-big" aria-hidden="true" />
      <h2 className="pt-disp intro-line">
        {maxDays} days. Beat the line.
      </h2>
    </>,
  ];

  return (
    <m.div className="pt-scrim intro-scrim" onClick={next} {...backdropMotion}>
      <m.div className="pt-sign intro-card" role="dialog" aria-label="Story" {...modalShellMotion}>
        <AnimatePresence mode="wait">
          <m.div key={card} className="intro-body" aria-live="polite" {...modalShellMotion}>
            {cards[card]}
          </m.div>
        </AnimatePresence>

        <footer className="intro-foot">
          <span className="intro-dots" aria-label={`Card ${card + 1} of ${CARD_COUNT}`}>
            {Array.from({ length: CARD_COUNT }, (_, i) => (
              <i key={i} className={i === card ? 'is-on' : ''} />
            ))}
          </span>
          <span className="intro-key">
            <Key k="E" /> {card + 1 >= CARD_COUNT ? 'Start' : 'Next'}
          </span>
          <button
            type="button"
            className="intro-skip"
            onClick={(e) => {
              e.stopPropagation(); // the backdrop click would otherwise also advance
              finishIntro();
            }}
          >
            <Key k="Esc" nav /> Skip
          </button>
        </footer>
      </m.div>
    </m.div>
  );
}
