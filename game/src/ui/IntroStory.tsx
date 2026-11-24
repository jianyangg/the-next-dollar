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
 * THE OPENING STORY: eight big cards that give the run a reason before any shopping.
 *
 * The arc (each beat sets up a mechanic, so the story IS the tutorial's "why"):
 *   1-2  Setting and a person: Grandma and her savings, meant for the family's money head.
 *   3    The stake: the savings (the engine's starting cash) are yours to grow. "Not a gift. A test."
 *   4-5  The alternative, i.e. the OPPORTUNITY COST made concrete: Grandma is a sharp
 *        investor. Left with her, the money grows at the game's rate every day, and it
 *        COMPOUNDS: each day's gain earns too, so her pile grows faster and faster.
 *        Owner decision (2026-11-24): say "she invests it and it compounds", not "a
 *        bank pays $X a day", which read as a fixed daily amount. So the stand only wins
 *        if it grows faster than her money would have. That bar, plus rent and wages,
 *        is THE LINE.
 *   6    The tools: lemons and pitchers at the market, plots on every block, where a
 *        busy spot costs more (the plot trade-off).
 *   7    The temptation: stands for sale across the city, whose books look great. Sets up
 *        every deal's lesson (the books leave things out; ask). Owner (2026-11-24): not one
 *        named seller, since sellers are everywhere.
 *   8    The clock and the stakes, in Grandma's terms, not as a contest against her
 *        (owner, 2026-11-24): make sure she never regrets lending you the money.
 *
 * Design rules it follows:
 *   - Big type, one headline and at most one short line under it per card, so it reads
 *     like a game, not a manual.
 *   - Every number and name comes from the engine or the deal data (starting cash, the
 *     5% rate, the number of days, the seller's name), so the story can never disagree
 *     with the books.
 *   - Nothing the game does not do: the can is a stake, not a loan (no interest is ever
 *     paid in cash; the 5% only lowers the score), and nothing happens to the player on
 *     day 30 except the verdict.
 *   - Shown once per browser (state/introSeen.ts); "Replay intro" on the founder
 *     screen brings it back. E / Enter / Space / click = next, Q / Backspace / Left =
 *     back one card, Esc = skip.
 */
export function IntroStory() {
  const open = useGameStore((s) => s.introOpen);
  return <AnimatePresence>{open && <IntroBody key="intro" />}</AnimatePresence>;
}

function IntroBody() {
  const finishIntro = useGameStore((s) => s.actions.finishIntro);
  const cash = useGameStore((s) => s.economy.cash);
  const maxDays = useGameStore((s) => s.economy.maxDays);
  const [card, setCard] = useState(0);

  const icons = getIcons();
  const sprites = getStandingSprites();
  const ratePct = `${Math.round(HURDLE_RATE * 100)}%`;
  // What the stake grows to if Grandma keeps it: compound growth, value = cash x (1 + r)^days.
  // Computed from the engine's own rate and stake, so the story can never drift from the rules.
  const grown = (days: number): string => Math.round(cash * (1 + HURDLE_RATE) ** days).toLocaleString('en-US');

  const cards = [
    <>
      <img src={icons.sun} alt="" className="intro-icon is-big" aria-hidden="true" />
      <h2 className="pt-disp intro-line">Summer in New York.</h2>
      <p className="pt-disp intro-sub">The whole city is thirsty.</p>
    </>,
    <>
      <img src={icons.coin} alt="" className="intro-icon is-big" aria-hidden="true" />
      <h2 className="pt-disp intro-line">Grandma has some savings.</h2>
      <p className="pt-disp intro-sub">"For whoever in this family has a head for money."</p>
    </>,
    <>
      <div className="intro-figures" aria-hidden="true">
        {FOUNDER_CATALOG.map((f) => (
          <img key={f.id} src={sprites[f.id]} alt="" className="intro-figure" />
        ))}
      </div>
      <h2 className="pt-disp intro-line">This summer, it's yours to grow.</h2>
      <PaperChip label="CASH" value={`$${cash.toFixed(2)}`} />
      <p className="pt-disp intro-sub">Not a gift. A test.</p>
    </>,
    <>
      <h2 className="pt-disp intro-line">Or she invests it herself, at {ratePct} a day.</h2>
      <p className="pt-disp intro-sub">
        And it compounds: ${cash} becomes ${grown(10)} in 10 days, ${grown(maxDays)} by day {maxDays}. Grow faster.
      </p>
    </>,
    <>
      <div className="intro-line-bar pt-line-fill" aria-hidden="true">
        <img src={icons.coin} alt="" className="intro-icon" />
        <img src={icons.pitcher} alt="" className="intro-icon" />
        <img src={icons.lemon} alt="" className="intro-icon" />
      </div>
      <h2 className="pt-disp intro-line">That's the line.</h2>
      <p className="pt-disp intro-sub">
        Rent + wages + any ads + what her money would have earned that day. Earn less, and it was better off with Grandma.
      </p>
    </>,
    <>
      <div className="intro-icon-row" aria-hidden="true">
        <img src={icons.lemon} alt="" className="intro-icon" />
        <img src={icons.pitcher} alt="" className="intro-icon" />
        <img src={icons.map} alt="" className="intro-icon" />
      </div>
      <h2 className="pt-disp intro-line">Lemons. Pitchers. A spot on the sidewalk.</h2>
      <p className="pt-disp intro-sub">Busy corners cost more. Pick yours.</p>
    </>,
    <>
      <img src={icons.book} alt="" className="intro-icon is-big" aria-hidden="true" />
      <h2 className="pt-disp intro-line">Stands come up for sale all over the city.</h2>
      <p className="pt-disp intro-sub">Their books always look great. Books never tell the whole story.</p>
    </>,
    <>
      <img src={icons.sun} alt="" className="intro-icon is-big" aria-hidden="true" />
      <h2 className="pt-disp intro-line">{maxDays} days of summer.</h2>
      <p className="pt-disp intro-sub">Make sure Grandma never regrets lending it to you.</p>
    </>,
  ];
  const CARD_COUNT = cards.length;

  const next = (): void => {
    if (card + 1 >= CARD_COUNT) finishIntro();
    else setCard(card + 1);
  };
  /** One card back (nothing before the first card). */
  const back = (): void => setCard((c) => Math.max(0, c - 1));

  // A blocking layer: the world must not walk while the story is up. Escape passes
  // through (the default for blocking layers) so the global handler skips the story
  // via handleEscape.
  useInputLayer(
    (e) => {
      if (e.key === 'e' || e.key === 'E' || e.key === 'Enter' || e.code === 'Space') {
        e.preventDefault();
        if (!e.repeat) next(); // a held key must not race through every card
        return true;
      }
      if (e.key === 'q' || e.key === 'Q' || e.key === 'Backspace' || e.key === 'ArrowLeft') {
        e.preventDefault();
        if (!e.repeat) back();
        return true;
      }
      return false;
    },
    { blocking: true, priority: INPUT_PRIORITY.modal }
  );


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
          {card > 0 && (
            <button
              type="button"
              className="intro-skip intro-back"
              onClick={(e) => {
                e.stopPropagation(); // the backdrop click would otherwise advance
                back();
              }}
            >
              <Key k="Q" nav /> Back
            </button>
          )}
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
