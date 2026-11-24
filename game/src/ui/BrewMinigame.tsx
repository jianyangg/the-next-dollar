import { useEffect } from 'react';
import { useAnimate, useTransform } from 'motion/react';
import * as m from 'motion/react-m';
import { useShallow } from 'zustand/react/shallow';
import { type StirKey, sweetSpots } from '../core/brewing';
import type { BrewGameState } from '../core/minigames';
import { type GameState, useGameStore } from '../state/gameStore';
import { getIcons } from './assets';
import { useStoreMotionValue, useStorePercent } from './useStoreMotionValue';

/**
 * Step 1 of the stall workbench: the four rotating arcade brew challenges.
 *
 * PERFORMANCE NOTE: the store replaces `brewGame` ~60 times a second while a challenge
 * runs (needle, lemon drop, tube centre, fuse...). Re-rendering React that often is waste,
 * so this file splits the game state in two:
 *
 *   DISCRETE values (which challenge, step/hit count, stir index + key sequence): change a
 *   few times per challenge. Read with normal selectors -> React re-renders on those only.
 *
 *   CONTINUOUS values (needle, bullseye, drop, tube centre, fuse, fill): change every frame.
 *   Read through `useStorePercent` / `useStoreMotionValue`, which subscribe to the store
 *   OUTSIDE React and write the number straight into the element's style via Motion. These
 *   never trigger a React render.
 *
 * The store still runs every rule (hit detection, scoring, timeouts); Motion only draws.
 */

// --- continuous selectors (module level so their identity is stable) -----------------
// Each returns 0 when that field does not exist for the running challenge.
const selectNeedle = (s: GameState): number => {
  const g = s.brewGame;
  return g && (g.kind === 'triple-squeeze' || g.kind === 'moving-bullseye') ? g.needle : 0;
};
const selectBullseye = (s: GameState): number => (s.brewGame?.kind === 'moving-bullseye' ? s.brewGame.bullseye : 0);
const selectTubeCenter = (s: GameState): number => (s.brewGame?.kind === 'keep-in-tube' ? s.brewGame.center : 0);
const selectTubeDrop = (s: GameState): number => (s.brewGame?.kind === 'keep-in-tube' ? s.brewGame.drop : 0);
const selectTubeFill = (s: GameState): number => (s.brewGame?.kind === 'keep-in-tube' ? s.brewGame.fill : 0);
const selectFuse = (s: GameState): number => (s.brewGame?.kind === 'rapid-stir' ? s.brewGame.fuse : 0);

/** The slow-changing parts of the running challenge (null when no challenge is running). */
interface BrewDiscrete {
  kind: BrewGameState['kind'];
  /** Triple squeeze: which of the three squeezes is next (0-2), how many landed, and the zones. */
  step: number;
  hits: number;
  targets: readonly number[];
  /** Rapid stir: the key sequence and how many keys are done. */
  seq: readonly StirKey[];
  index: number;
}

const NONE: readonly never[] = [];

const selectDiscrete = (s: GameState): BrewDiscrete | null => {
  const g = s.brewGame;
  if (!g) return null;
  return {
    kind: g.kind,
    step: g.kind === 'triple-squeeze' ? g.step : 0,
    hits: g.kind === 'triple-squeeze' ? g.hits : 0,
    targets: g.kind === 'triple-squeeze' ? g.targets : NONE,
    seq: g.kind === 'rapid-stir' ? g.seq : NONE,
    index: g.kind === 'rapid-stir' ? g.index : 0,
  };
};

/** Triple Squeeze: three target zones, one needle sweeping across. */
function TripleSqueezeGauge({ targets, step }: { targets: readonly number[]; step: number }) {
  const pitchers = useGameStore((s) => s.economy.pitchers);
  const workers = useGameStore((s) => s.economy.workers);
  const tHalf = Math.min(0.11, 0.068 + Math.max(0, pitchers - 1) * 0.012 + workers * 0.015);
  const needleLeft = useStorePercent(selectNeedle);
  return (
    <div className="wb-skill-gauge" aria-label="Triple Squeeze timing gauge">
      {targets.map((tCenter, idx) => (
        <div
          key={idx}
          className={idx === step ? 'wb-skill-perfect' : 'wb-skill-good'}
          style={{
            left: `${tCenter * 100}%`,
            width: `${tHalf * 200}%`,
            opacity: idx < step ? 0.25 : 1,
          }}
        />
      ))}
      <m.div className="wb-skill-needle" style={{ left: needleLeft }} />
    </div>
  );
}

/** Keep in Tube: a drifting tube and a lemon drop you must keep inside it. */
function TubeGauge() {
  const pitchers = useGameStore((s) => s.economy.pitchers);
  const workers = useGameStore((s) => s.economy.workers);
  const { tubeWidth } = sweetSpots({ pitchers, workers });
  const tubeLeft = useStorePercent(selectTubeCenter);
  const dropLeft = useStorePercent(selectTubeDrop);
  return (
    <div className="wb-skill-gauge" aria-label="Keep in Tube pressure gauge">
      <m.div className="wb-skill-perfect" style={{ left: tubeLeft, width: `${tubeWidth * 100}%` }} />
      <m.div className="wb-tube-drop" style={{ left: dropLeft }} title="Lemon Drop" />
    </div>
  );
}

/** Rapid Stir: press the highlighted keys before the fuse burns out. */
function StirGauge({ seq, index }: { seq: readonly StirKey[]; index: number }) {
  const fuseWidth = useStorePercent(selectFuse, 'whole');
  const stirShake = useGameStore((s) => s.stirShake);
  const [scope, animate] = useAnimate<HTMLDivElement>();

  // The store raises `stirShake` for 180 ms after a wrong key. The store decides WHEN (and
  // that it was a mistake); this effect only plays the wobble when the flag turns on.
  useEffect(() => {
    if (!stirShake || !scope.current) return;
    const controls = animate(scope.current, { x: [0, -4, 4, 0] }, { duration: 0.18, ease: 'easeInOut' });
    return () => controls.stop();
  }, [stirShake, animate, scope]);

  return (
    <div ref={scope} className="wb-stir-wrap">
      <div className="wb-stir-keys game-num">
        {seq.map((k, idx) => (
          <span key={idx} className={`wb-stir-key ${idx < index ? 'is-done' : idx === index ? 'is-active' : ''}`}>
            {k === 'SPACE' ? '␣' : k}
          </span>
        ))}
      </div>
      <div className="wb-timer-track">
        <m.div className="wb-timer-fill is-brew" style={{ width: fuseWidth }} />
      </div>
    </div>
  );
}

/** Counter-Moving Bullseye: the target slides while you time the needle. */
function BullseyeGauge() {
  const pitchers = useGameStore((s) => s.economy.pitchers);
  const workers = useGameStore((s) => s.economy.workers);
  // Sweet-spot widths widen with pitchers and hired workers (core/brewing.ts)
  const { perfectHalf, goodHalf } = sweetSpots({ pitchers, workers });
  const bullseyeLeft = useStorePercent(selectBullseye);
  const needleLeft = useStorePercent(selectNeedle);
  return (
    <div className="wb-skill-gauge" aria-label="Counter-Moving Bullseye gauge">
      <m.div className="wb-skill-good" style={{ left: bullseyeLeft, width: `${goodHalf * 200}%` }} />
      <m.div className="wb-skill-perfect" style={{ left: bullseyeLeft, width: `${perfectHalf * 200}%` }} />
      <m.div className="wb-skill-needle" style={{ left: needleLeft }} />
    </div>
  );
}

/** The moving gauge for whichever challenge is running. */
function BrewGauge({ game }: { game: BrewDiscrete }) {
  switch (game.kind) {
    case 'triple-squeeze':
      return <TripleSqueezeGauge targets={game.targets} step={game.step} />;
    case 'keep-in-tube':
      return <TubeGauge />;
    case 'rapid-stir':
      return <StirGauge seq={game.seq} index={game.index} />;
    default:
      return <BullseyeGauge />;
  }
}

/** "KEEP IN TUBE! 42%": the percentage is a live motion value, so it updates without a render. */
function TubeBadge() {
  const fill = useStoreMotionValue(selectTubeFill);
  const text = useTransform(fill, (v) => `${Math.round(v * 100)}%`);
  return (
    <>
      KEEP IN TUBE! <m.span>{text}</m.span>
    </>
  );
}

/** Header badge: the challenge name plus its progress. */
function BrewBadge({ game }: { game: BrewDiscrete | null }) {
  if (!game) return <>Step 1 · Brew</>;
  switch (game.kind) {
    case 'triple-squeeze':
      return <>TRIPLE SQUEEZE ({game.hits}/3)</>;
    case 'keep-in-tube':
      return <TubeBadge />;
    case 'rapid-stir':
      return <>RAPID STIR! ({game.index}/5)</>;
    default:
      return <>MOVING BULLSEYE!</>;
  }
}

/** Label on the big gold action button while a challenge is running. */
function brewButtonLabel(game: BrewDiscrete): string {
  switch (game.kind) {
    case 'keep-in-tube':
      return 'HOLD / TAP THRUST!';
    case 'rapid-stir':
      return `STIR [${game.seq[game.index] ?? 'SPACE'}]`;
    case 'triple-squeeze':
      return `SQUEEZE (${game.step + 1}/3)!`;
    default:
      return 'SQUEEZE!';
  }
}

export function BrewStep() {
  const actions = useGameStore((s) => s.actions);
  // Discrete parts only: React re-renders when the challenge starts/ends or a step/key
  // lands, NOT per frame (see the note at the top). `useShallow` compares field by field.
  const brewGame = useGameStore(useShallow(selectDiscrete));
  const brewedCups = useGameStore((s) => s.brewedCups);
  const cupsInStock = useGameStore((s) => s.economy.cupsInStock);
  const pitchers = useGameStore((s) => s.economy.pitchers);
  const icons = getIcons();

  const brewPct = cupsInStock > 0 ? Math.min(100, Math.round((brewedCups / cupsInStock) * 100)) : 0;

  return (
    <div className="workbench-step" style={{ minWidth: 232 }}>
      <div className="wb-step-head">
        <span className="wb-step-badge">
          <BrewBadge game={brewGame} />
        </span>
        <span className="wb-step-meta game-num">
          {brewedCups}/{cupsInStock} ready
        </span>
      </div>

      {brewGame ? (
        <BrewGauge game={brewGame} />
      ) : (
        <div className="wb-brew-track">
          <div className="wb-brew-fill" style={{ width: `${brewPct}%` }} />
        </div>
      )}

      {brewGame ? (
        <button
          type="button"
          className="gbtn gbtn-gold"
          onPointerDown={() => {
            if (brewGame.kind === 'keep-in-tube') {
              actions.setSpaceHeld(true);
            }
          }}
          onPointerUp={() => actions.setSpaceHeld(false)}
          onPointerLeave={() => actions.setSpaceHeld(false)}
          onClick={actions.lockBrewGame}
          style={{ padding: '6px 10px', fontSize: 12 }}
        >
          <span>{brewButtonLabel(brewGame)}</span>
          <span className="keycap">
            {brewGame.kind === 'rapid-stir' ? brewGame.seq[brewGame.index] ?? 'Space' : 'Space'}
          </span>
        </button>
      ) : (
        <button
          type="button"
          className="gbtn gbtn-gold"
          onClick={actions.startBrewGame}
          disabled={cupsInStock <= 0 || brewedCups >= cupsInStock}
          style={{ padding: '6px 10px', fontSize: 12 }}
        >
          <img src={icons.lemon} alt="" className="px-icon-sm" />
          <span>{pitchers < 1 ? 'Need Pitcher!' : cupsInStock <= 0 ? 'Out of Lemons!' : 'Brew Pitcher'}</span>
          <span className="keycap">F</span>
        </button>
      )}
    </div>
  );
}
