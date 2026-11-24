import { useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { type MotionValue, useReducedMotion, useSpring, useTransform } from 'motion/react';
import * as m from 'motion/react-m';
import { useShallow } from 'zustand/react/shallow';
import { sweeten as sweetenRules, stir as stirRules, squeeze as squeezeRules } from '../core/minigames';
import type { BrewPhase, BrewTwists, LemonadeBrewState, LemonKind, StirQuadrant } from '../core/minigames';
import type { SweetenPhase } from '../core/minigames/sweeten';
import { type GameState, useGameStore } from '../state/gameStore';
import { Key } from './kit/Money';
import { LegacyBrewSign } from './LegacyBrewSign';
import { useStoreMotionValue, useStorePercent } from './useStoreMotionValue';
import './styles/brew.css';

/**
 * The lemonade brew, drawn as three little scenes on one sign:
 *   1 SQUEEZE  a lemon on a juicer, a pressure gauge with the juicy zone, juice in a glass
 *   2 SWEETEN  a sugar bag over the pitcher and a taste meter with faces
 *   3 STIR     a pitcher seen from above, a circling spoon, and a rhythm strip
 * Every rule lives in core/minigames (squeeze.ts, sweeten.ts, stir.ts, lemonadeBrew.ts);
 * this file only DRAWS the state the store holds and forwards input to store actions.
 *
 * PERFORMANCE: the store replaces `brewGame` about 60 times a second while brewing.
 * As in the old gauges, values are split in two:
 *   DISCRETE (which step, which lemon, sugar phase, next stir quadrant): change a few
 *     times per brew. Read with `useShallow`, so React re-renders only on those changes.
 *   CONTINUOUS (pressure, juice, sweetness, spoon angle, dissolve...): read through
 *     `useStoreMotionValue`, which writes straight into element styles via Motion.
 *     These never re-render React.
 *
 * INPUT
 *   Hold (squeeze, sweeten): Space via the input router (state/loops.ts) or the mouse /
 *     a finger held down on the scene; both end up in the store's `setSpaceHeld`.
 *   Stir: W/A/S/D via the input router, or circling the pointer over the pitcher: each
 *     time the pointer crosses into a new quadrant we send that quadrant as a stir key,
 *     so keys and mouse feed the exact same rule (stir.ts `turn`).
 *
 * REDUCED MOTION: the spoon snaps instead of springing, and the decorative falling
 * seeds / sugar / juice streams stop animating (brew.css). Gauges still move, because
 * they ARE the game state, not decoration.
 */

// ---------------------------------------------------------------------------------------
// Selectors. Module level so their identity is stable (useStoreMotionValue needs that).

const brewOf = (s: GameState): LemonadeBrewState | null =>
  s.brewGame?.kind === 'lemonade-brew' ? s.brewGame : null;

const selPressure = (s: GameState): number => brewOf(s)?.squeeze.pressure ?? 0;
/**
 * The juicy zone the RULE checks this frame (squeeze.ts `juicyZone`). Read continuously
 * because under the tough-rind twist it climbs as the lemon empties; the gauge must
 * show exactly where juice runs now, not where it started.
 */
const selZoneLow = (s: GameState): number => {
  const b = brewOf(s);
  return b ? squeezeRules.juicyZone(b.squeeze).low : 0;
};
const selZoneHigh = (s: GameState): number => {
  const b = brewOf(s);
  return b ? squeezeRules.juicyZone(b.squeeze).high : 0;
};
/** Juice in the glass vs. a full batch of plump lemons (so dry batches visibly fill less). */
const selJuiceLevel = (s: GameState): number => {
  const b = brewOf(s);
  return b ? Math.min(1, b.squeeze.juice / Math.max(1, b.squeeze.lemons.length)) : 0;
};
const selFlowing = (s: GameState): number => (brewOf(s)?.squeeze.flowing ? 1 : 0);
const selSeeds = (s: GameState): number => (brewOf(s)?.squeeze.aboveZone ? 1 : 0);
const selSweetness = (s: GameState): number => brewOf(s)?.sweeten.sweetness ?? 0;
/** Fraction of the fix offer still left (1 = just offered, 0 = expired). */
const selOfferLeft = (s: GameState): number => {
  const b = brewOf(s);
  return b?.sweeten.phase === 'offer' ? Math.max(0, 1 - b.sweeten.timer / sweetenRules.FIX_OFFER_SEC) : 0;
};
const selDissolve = (s: GameState): number => brewOf(s)?.stir.dissolve ?? 0;
const selRhythm = (s: GameState): number => brewOf(s)?.stir.rhythm ?? 0;

/**
 * Spoon angle in degrees, clockwise from 12 o'clock. It only ever moves one way (each
 * quarter turn adds 90 x direction: +90 clockwise, -90 under the "counter" twist), so a
 * spring between values always animates the short way round, in the stirring direction.
 */
const selSpoonAngle = (s: GameState): number => {
  const st = brewOf(s)?.stir;
  if (!st || st.at === null) return 0;
  const now = stirRules.STIR_ORDER.indexOf(st.at);
  const start = (((now - st.quarters * st.direction) % 4) + 4) % 4;
  return (start + st.quarters * st.direction) * 90;
};

/**
 * Tempo of the last quarter turn as a 0..1 position on the rhythm strip, measured in
 * quarter turns per second (so "faster" is further right). TEMPO_MAX_RATE is the right
 * edge of the strip.
 */
const TEMPO_MAX_RATE = 12;
const tempoPos = (intervalSec: number): number => Math.min(1, 1 / Math.max(1e-3, intervalSec) / TEMPO_MAX_RATE);
const selTempo = (s: GameState): number => {
  const i = brewOf(s)?.stir.lastInterval;
  return i == null ? 0.5 : tempoPos(i);
};
/** Where the "steady" window sits on the strip; derived from the rule constants. */
const STEADY_FROM = tempoPos(stirRules.SLOW_QUARTER_SEC);
const STEADY_TO = tempoPos(stirRules.FAST_QUARTER_SEC);

/** The slow-changing parts, compared field by field by useShallow. */
interface BrewView {
  phase: BrewPhase;
  worker: boolean;
  lemons: readonly LemonKind[];
  lemonIndex: number;
  sugarPhase: SweetenPhase;
  fixUsed: boolean;
  target: number;
  band: number;
  nextQuadrant: StirQuadrant | null;
  twists: BrewTwists;
}

const selView = (s: GameState): BrewView | null => {
  const b = brewOf(s);
  if (!b) return null;
  return {
    phase: b.phase,
    worker: b.workerSqueezes,
    lemons: b.squeeze.lemons,
    lemonIndex: b.squeeze.index,
    sugarPhase: b.sweeten.phase,
    fixUsed: b.sweeten.fixUsed,
    target: b.sweeten.target,
    band: b.sweeten.band,
    nextQuadrant: stirRules.nextQuadrant(b.stir),
    twists: b.twists,
  };
};

const pct = (x: number): string => `${x * 100}%`;

// ---------------------------------------------------------------------------------------
// Shared bits

const STEPS: ReadonlyArray<{ phase: BrewPhase; label: string }> = [
  { phase: 'squeeze', label: 'Squeeze' },
  { phase: 'sweeten', label: 'Sweeten' },
  { phase: 'stir', label: 'Stir' },
];

/** "1 Squeeze  2 Sweeten  3 Stir", the current one lit, finished ones dimmed. */
function StepPips({ phase, worker }: { phase: BrewPhase; worker: boolean }) {
  const at = STEPS.findIndex((st) => st.phase === phase);
  return (
    <ol className="brew-steps" aria-label="Brew steps">
      {STEPS.map((st, i) => {
        const state = phase === 'done' || i < at ? 'is-done' : i === at ? 'is-now' : 'is-todo';
        return (
          <li key={st.phase} className={`brew-step ${state}`} aria-current={i === at ? 'step' : undefined}>
            <span className="brew-step-num">{i + 1}</span>
            {i === 0 && worker ? 'Worker' : st.label}
          </li>
        );
      })}
    </ol>
  );
}

type Mood = 'sour' | 'happy' | 'sick';

/** A pixel face drawn in SVG (no emoji). Colours come from brew.css classes. */
function Face({ mood }: { mood: Mood }) {
  // Mouths: frown (sour), smile (happy), wavy line (too sweet).
  const mouth = mood === 'happy' ? 'M8 19 L11 22 L21 22 L24 19' : mood === 'sour' ? 'M9 23 L12 20 L20 20 L23 23' : 'M8 21 L12 19 L16 21 L20 19 L24 21';
  return (
    <svg className={`brew-face is-${mood}`} viewBox="0 0 32 32" aria-hidden="true">
      <rect x="2" y="2" width="28" height="28" rx="6" className="brew-face-skin" />
      <rect x="9" y="10" width="4" height="4" className="brew-face-ink" />
      <rect x="19" y="10" width="4" height="4" className="brew-face-ink" />
      <path d={mouth} className="brew-face-line" />
    </svg>
  );
}

/** Hold the pointer on the scene = hold Space. Capturing keeps the release even off-scene. */
function useHoldHandlers(enabled: boolean) {
  const setSpaceHeld = useGameStore((s) => s.actions.setSpaceHeld);
  if (!enabled) return {};
  return {
    onPointerDown: (e: ReactPointerEvent<HTMLElement>) => {
      e.currentTarget.setPointerCapture(e.pointerId);
      setSpaceHeld(true);
    },
    onPointerUp: () => setSpaceHeld(false),
    onPointerCancel: () => setSpaceHeld(false),
    onLostPointerCapture: () => setSpaceHeld(false),
  };
}

// ---------------------------------------------------------------------------------------
// 1. SQUEEZE

function Lemon({ kind, className = '', squash }: { kind: LemonKind; className?: string; squash?: MotionValue<number> }) {
  return (
    <m.div className={`brew-lemon is-${kind} ${className}`} style={squash ? { scaleY: squash } : undefined}>
      {kind === 'seedy' && (
        <>
          <i className="brew-lemon-seed" />
          <i className="brew-lemon-seed" />
          <i className="brew-lemon-seed" />
        </>
      )}
      {kind === 'dry' && <i className="brew-lemon-crack" />}
    </m.div>
  );
}

const LEMON_WORD: Record<LemonKind, string> = { plump: 'Plump', dry: 'Dry', seedy: 'Seedy' };

function SqueezeScene({ view }: { view: BrewView }) {
  const kind = view.lemons[Math.min(view.lemonIndex, view.lemons.length - 1)] ?? 'plump';
  const pressure = useStoreMotionValue(selPressure);
  const zoneLow = useStoreMotionValue(selZoneLow);
  const zoneHigh = useStoreMotionValue(selZoneHigh);
  const zoneBottom = useTransform(zoneLow, pct);
  const zoneHeight = useTransform(() => pct(zoneHigh.get() - zoneLow.get()));
  const seedsBottom = useTransform(zoneHigh, pct);
  // The lemon half flattens as you press (never below 65% of its height).
  const squash = useTransform(pressure, (p) => 1 - 0.35 * p);
  const needle = useTransform(pressure, pct);
  const juice = useStorePercent(selJuiceLevel);
  const flowing = useStoreMotionValue(selFlowing);
  const seeds = useStoreMotionValue(selSeeds);

  return (
    <div className="brew-scene is-squeeze" aria-label={`Squeeze the ${LEMON_WORD[kind]} lemon`}>
      <div className="brew-juicer">
        <Lemon kind={kind} className="is-on" squash={squash} />
        <div className="brew-reamer" />
        <m.div className="brew-seeds" style={{ opacity: seeds }} aria-hidden="true">
          <i />
          <i />
          <i />
        </m.div>
        <div className="brew-dish" />
        <m.div className="brew-stream" style={{ opacity: flowing }} aria-hidden="true" />
        <span className="brew-tag">{LEMON_WORD[kind]}</span>
      </div>

      {/* Pressure: vertical gauge, juicy zone in green, seeds zone above it in red. */}
      <div className="brew-vgauge" aria-label="Pressure">
        <m.div className="brew-vgauge-seeds" style={{ bottom: seedsBottom }} />
        <m.div className="brew-vgauge-zone" style={{ bottom: zoneBottom, height: zoneHeight }} />
        <m.div className="brew-vgauge-needle" style={{ bottom: needle }} />
      </div>

      <div className="brew-col">
        <div className="brew-glass" aria-label="Juice">
          <m.div className="brew-glass-fill" style={{ height: juice }} />
        </div>
        <div className="brew-queue" aria-label="Lemons">
          {view.lemons.map((k, i) => (
            <Lemon
              key={i}
              kind={k}
              className={`is-mini ${i < view.lemonIndex ? 'is-used' : i === view.lemonIndex ? 'is-now' : ''}`}
            />
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------
// 2. SWEETEN

function SweetenScene({ view }: { view: BrewView }) {
  const sweetness = useStorePercent(selSweetness);
  const offerLeft = useStorePercent(selOfferLeft, 'whole');
  // Honey is still running during its drip, so it is drawn pouring until it stops.
  const pouring = view.sugarPhase === 'pour' || view.sugarPhase === 'drip';
  const honey = view.twists.sweeten === 'honey';
  const lo = Math.max(0, view.target - view.band);
  const hi = Math.min(1, view.target + view.band);

  return (
    <div className="brew-scene is-sweeten" aria-label="Sweeten to taste">
      <div className="brew-pour">
        <div className={`brew-bag ${pouring ? 'is-pouring' : ''} ${honey ? 'is-honey' : ''}`} />
        <div className={`brew-sugar ${pouring ? 'is-pouring' : ''} ${honey ? 'is-honey' : ''}`} aria-hidden="true">
          <i />
          <i />
          <i />
        </div>
        <div className="brew-pitcher">
          <div className="brew-pitcher-fill" />
        </div>
      </div>

      <div className="brew-taste" aria-label="Taste">
        <div className="brew-taste-faces">
          <span style={{ left: '0%' }}>
            <Face mood="sour" />
          </span>
          <span style={{ left: pct(view.target) }}>
            <Face mood="happy" />
          </span>
          <span style={{ left: '100%' }}>
            <Face mood="sick" />
          </span>
        </div>
        <div className="brew-taste-bar">
          <div className="brew-taste-band" style={{ left: pct(lo), width: pct(hi - lo) }} />
          <m.div className="brew-taste-mark" style={{ left: sweetness }} />
        </div>
        {view.sugarPhase === 'offer' && (
          <div className="brew-offer" role="status">
            <span className="brew-offer-word">Too sweet</span>
            <div className="pt-track brew-offer-track">
              <m.i style={{ width: offerLeft }} />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------
// 3. STIR

/** Where each quadrant's key label sits around the pitcher. */
const QUADRANT_CLASS: Record<StirQuadrant, string> = { W: 'is-top', D: 'is-right', S: 'is-bottom', A: 'is-left' };
/** How many sugar grains are drawn in the pitcher (pure decoration; they fade with dissolve). */
const GRAINS = 9;

function StirScene({ view }: { view: BrewView }) {
  const stirKey = useGameStore((s) => s.actions.stirKey);
  const reduced = useReducedMotion();
  const angle = useStoreMotionValue(selSpoonAngle);
  // A spring makes the spoon glide between quarter turns. Reduced motion: no spring,
  // the spoon jumps straight to the true angle.
  const springy = useSpring(angle, { stiffness: 260, damping: 26 });
  const rotate = reduced ? angle : springy;
  const dissolve = useStoreMotionValue(selDissolve);
  const grains = useTransform(dissolve, (d) => 1 - d);
  const rhythm = useStorePercent(selRhythm, 'whole');
  const tempo = useStorePercent(selTempo);
  const lastQuadrant = useRef<StirQuadrant | null>(null);

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    const q = stirRules.quadrantAt(e.clientX - (r.left + r.width / 2), e.clientY - (r.top + r.height / 2), r.width * 0.12);
    // Send a quadrant only when the pointer ENTERS it; the rule ignores anything that
    // is not the next clockwise quadrant, so jitter on a boundary does no harm.
    if (q && q !== lastQuadrant.current) {
      lastQuadrant.current = q;
      stirKey(q);
    }
  };

  return (
    <div className="brew-scene is-stir" aria-label="Stir in steady circles">
      <div className="brew-bowl" onPointerMove={onPointerMove}>
        <m.div className="brew-grains" style={{ opacity: grains }} aria-hidden="true">
          {Array.from({ length: GRAINS }, (_, i) => (
            <i key={i} style={{ rotate: `${i * 40}deg` }} />
          ))}
        </m.div>
        <m.div className="brew-spoon" style={{ rotate }} aria-hidden="true">
          <i />
        </m.div>
        {(Object.keys(QUADRANT_CLASS) as StirQuadrant[]).map((q) => (
          <span
            key={q}
            className={`brew-quad ${QUADRANT_CLASS[q]} ${view.nextQuadrant === q ? 'is-next' : ''}`}
            aria-hidden="true"
          >
            <Key k={q} />
          </span>
        ))}
      </div>

      <div className="brew-rhythm" aria-label="Rhythm">
        <div className="brew-tempo">
          <div className="brew-tempo-steady" style={{ left: pct(STEADY_FROM), width: pct(STEADY_TO - STEADY_FROM) }} />
          <m.div className="brew-tempo-mark" style={{ left: tempo }} />
        </div>
        <div className="brew-tempo-words" aria-hidden="true">
          <span>Slow</span>
          <span>Steady</span>
          <span>Fast</span>
        </div>
        <div className="pt-track brew-steady-track" aria-label="Steadiness">
          <m.i style={{ width: rhythm }} />
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------
// The sign

/** Big number in the corner: lemon count while squeezing, % dissolved while stirring. */
function CornerNumber({ view }: { view: BrewView }) {
  const dissolve = useStoreMotionValue(selDissolve);
  const text = useTransform(dissolve, (d) => `${Math.round(d * 100)}%`);
  if (view.phase === 'squeeze') return <>{`${Math.min(view.lemonIndex + 1, view.lemons.length)}/${view.lemons.length}`}</>;
  if (view.phase === 'stir') return <m.span>{text}</m.span>;
  return null;
}

/** The one-line action under the scene: a Key bullet and a verb or two. */
function ActionLine({ view }: { view: BrewView }) {
  if (view.phase === 'squeeze') {
    return (
      <>
        <Key k="Space" />
        Hold in the green
      </>
    );
  }
  if (view.phase === 'sweeten') {
    if (view.sugarPhase === 'offer') {
      return (
        <>
          <Key k="Space" />
          Water + lemon
        </>
      );
    }
    if (view.sugarPhase === 'drip') return <>Still dripping...</>;
    if (view.sugarPhase === 'reveal' || view.sugarPhase === 'done') return <>Tasting...</>;
    return (
      <>
        <Key k="Space" />
        {view.twists.sweeten === 'honey' ? 'Pour, stop before the smile' : 'Pour, stop at the smile'}
      </>
    );
  }
  return <>{view.twists.stir === 'counter' ? 'Circle W A S D' : 'Circle W D S A'}</>;
}

/**
 * One line naming the current step's twist (lemonadeBrew.ts BrewTwists), so a change in
 * the rules is always announced before the player meets it. Plain steps show nothing.
 */
const TWIST_WORDS = {
  'tough-rind': 'Tough rind: the green climbs as it empties',
  honey: 'Honey: it keeps dripping after you let go',
  counter: 'This batch stirs the other way',
} as const;

export function twistLine(view: Pick<BrewView, 'phase' | 'worker' | 'twists'>): string | null {
  if (view.phase === 'squeeze' && !view.worker && view.twists.squeeze === 'tough-rind') return TWIST_WORDS['tough-rind'];
  if (view.phase === 'sweeten' && view.twists.sweeten === 'honey') return TWIST_WORDS.honey;
  if (view.phase === 'stir' && view.twists.stir === 'counter') return TWIST_WORDS.counter;
  return null;
}

function LemonadeBrewSign() {
  const view = useGameStore(useShallow(selView));
  const holdable = view?.phase === 'squeeze' || view?.phase === 'sweeten';
  const hold = useHoldHandlers(holdable);
  if (!view) return null;
  const twist = twistLine(view);

  return (
    <div className="pt-sign stand-gauge brew-sign" role="group" aria-label="Brew">
      <div className="stand-gauge-head">
        <StepPips phase={view.phase} worker={view.worker} />
        <span className="stand-gauge-num">
          <CornerNumber view={view} />
        </span>
      </div>
      <div className={`brew-stage ${holdable ? 'is-holdable' : ''}`} {...hold}>
        {view.phase === 'squeeze' && <SqueezeScene view={view} />}
        {view.phase === 'sweeten' && <SweetenScene view={view} />}
        {(view.phase === 'stir' || view.phase === 'done') && <StirScene view={view} />}
      </div>
      {twist && (
        <div className="brew-twist" role="status">
          {twist}
        </div>
      )}
      <div className="brew-action">
        <ActionLine view={view} />
      </div>
    </div>
  );
}

/**
 * Mounted by StandWorkbench. Renders nothing until a brew starts (the menu's Brew
 * item, or [F]). Until the store switches to the lemonade brew, it may still start
 * one of the four legacy challenges, which LegacyBrewSign draws.
 */
export function BrewStep() {
  const kind = useGameStore((s) => s.brewGame?.kind ?? null);
  if (kind === null) return null;
  return kind === 'lemonade-brew' ? <LemonadeBrewSign /> : <LegacyBrewSign />;
}
