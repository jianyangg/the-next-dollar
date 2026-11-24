import { useEffect } from 'react';
import { useAnimate, useTransform } from 'motion/react';
import * as m from 'motion/react-m';
import { useShallow } from 'zustand/react/shallow';
import { type StirKey, sweetSpots } from '../core/brewing';
import type { BrewGameState } from '../core/minigames';
import { type GameState, useGameStore } from '../state/gameStore';
import { Key } from './kit/Money';
import { useStoreMotionValue, useStorePercent } from './useStoreMotionValue';
import './styles/stand.css';

/**
 * The brew mini-games: four rotating arcade challenges shown as ONE big gauge on a
 * black sign, with one Key bullet for the action and big display-font numbers.
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
    <div className="stand-bar" aria-label="Triple Squeeze timing gauge">
      {targets.map((tCenter, idx) => (
        <div
          key={idx}
          className={idx === step ? 'stand-zone-perfect' : 'stand-zone-good'}
          style={{
            left: `${tCenter * 100}%`,
            width: `${tHalf * 200}%`,
            opacity: idx < step ? 0.25 : 1,
          }}
        />
      ))}
      <m.div className="stand-needle" style={{ left: needleLeft }} />
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
    <div className="stand-bar" aria-label="Keep in Tube pressure gauge">
      <m.div className="stand-zone-perfect" style={{ left: tubeLeft, width: `${tubeWidth * 100}%` }} />
      <m.div className="stand-drop" style={{ left: dropLeft }} />
    </div>
  );
}

/** Rapid Stir: the fuse burns down while you press the highlighted keys in order. */
function StirFuse() {
  const fuseWidth = useStorePercent(selectFuse, 'whole');
  return (
    <div className="pt-track">
      <m.i style={{ width: fuseWidth }} />
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
    <div className="stand-bar" aria-label="Counter-Moving Bullseye gauge">
      <m.div className="stand-zone-good" style={{ left: bullseyeLeft, width: `${goodHalf * 200}%` }} />
      <m.div className="stand-zone-perfect" style={{ left: bullseyeLeft, width: `${perfectHalf * 200}%` }} />
      <m.div className="stand-needle" style={{ left: needleLeft }} />
    </div>
  );
}

/** "42%": a live motion value, so the number updates without a React render. */
function TubePercent() {
  const fill = useStoreMotionValue(selectTubeFill);
  const text = useTransform(fill, (v) => `${Math.round(v * 100)}%`);
  return <m.span>{text}</m.span>;
}

/** Plain-word name of the running challenge (a few words, no sentences). */
function gameName(kind: BrewDiscrete['kind']): string {
  switch (kind) {
    case 'triple-squeeze':
      return 'Squeeze';
    case 'keep-in-tube':
      return 'Hold it';
    case 'rapid-stir':
      return 'Stir';
    default:
      return 'Bullseye';
  }
}

/** The big number in the sign's corner: progress for the challenge, if it has any. */
function GaugeNumber({ game }: { game: BrewDiscrete }) {
  switch (game.kind) {
    case 'triple-squeeze':
      return <>{game.hits}/3</>;
    case 'keep-in-tube':
      return <TubePercent />;
    case 'rapid-stir':
      return <>{game.index}/{game.seq.length}</>;
    default:
      return null;
  }
}

/** One verb for the action button. */
function gameVerb(kind: BrewDiscrete['kind']): string {
  switch (kind) {
    case 'keep-in-tube':
      return 'Thrust';
    case 'triple-squeeze':
    default:
      return 'Squeeze';
  }
}

/** The moving gauge for whichever challenge is running. */
function BrewGauge({ game }: { game: BrewDiscrete }) {
  switch (game.kind) {
    case 'triple-squeeze':
      return <TripleSqueezeGauge targets={game.targets} step={game.step} />;
    case 'keep-in-tube':
      return <TubeGauge />;
    case 'rapid-stir':
      return <StirFuse />;
    default:
      return <BullseyeGauge />;
  }
}

/** Rapid stir keys as big Key bullets, in order: done = dim, now = big, later = grey. */
function StirKeys({ seq, index }: { seq: readonly StirKey[]; index: number }) {
  const stirShake = useGameStore((s) => s.stirShake);
  const [scope, animate] = useAnimate<HTMLSpanElement>();

  // The store raises `stirShake` for 180 ms after a wrong key. The store decides WHEN (and
  // that it was a mistake); this effect only plays the wobble when the flag turns on.
  useEffect(() => {
    if (!stirShake || !scope.current) return;
    const controls = animate(scope.current, { x: [0, -4, 4, 0] }, { duration: 0.18, ease: 'easeInOut' });
    return () => controls.stop();
  }, [stirShake, animate, scope]);

  return (
    <span ref={scope} className="stand-keys">
      {seq.map((k, idx) => (
        <span
          key={idx}
          className={`pt-key ${idx < index ? 'is-done' : idx === index ? 'is-active' : 'is-todo'}`}
          aria-hidden="true"
        >
          {k === 'SPACE' ? 'Space' : k}
        </span>
      ))}
    </span>
  );
}

/**
 * The brew sign. Renders nothing until a challenge starts (the menu's Brew item, or [F],
 * starts it in the store). React re-renders only when a challenge starts/ends or a step/key
 * lands, NOT per frame: `useShallow` compares the discrete fields one by one, and the
 * moving parts above are motion values (see the note at the top).
 */
export function BrewStep() {
  const actions = useGameStore((s) => s.actions);
  const game = useGameStore(useShallow(selectDiscrete));
  if (!game) return null;

  return (
    <div className="pt-sign stand-gauge" role="group" aria-label="Brew">
      <div className="stand-gauge-head">
        <span className="stand-gauge-name">{gameName(game.kind)}</span>
        <span className="stand-gauge-num">
          <GaugeNumber game={game} />
        </span>
      </div>
      <BrewGauge game={game} />
      <button
        type="button"
        className="stand-act"
        onPointerDown={() => {
          if (game.kind === 'keep-in-tube') actions.setSpaceHeld(true);
        }}
        onPointerUp={() => actions.setSpaceHeld(false)}
        onPointerLeave={() => actions.setSpaceHeld(false)}
        onClick={actions.lockBrewGame}
      >
        {game.kind === 'rapid-stir' ? (
          <StirKeys seq={game.seq} index={game.index} />
        ) : (
          <>
            <Key k="Space" />
            {gameVerb(game.kind)}
          </>
        )}
      </button>
    </div>
  );
}
