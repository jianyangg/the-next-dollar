import React, { useRef } from 'react';
import { AnimatePresence } from 'motion/react';
import * as m from 'motion/react-m';
import type { WorldNote } from '../state/gameStore';
import { type SalePop, useGameStore } from '../state/gameStore';
import { EASE_IN, EASE_OUT } from './motionPresets';
import { MoneyChipStrip } from './kit/Money';
import './styles/world.css';
import {
  type Point,
  type PointSelector,
  selectOwnStand,
  selectSellerStand,
  useAnchorEffect,
  useAnchorPoint,
  useQueueIds,
} from '../state/anchorStore';

/**
 * Floating labels that follow things in the 3D world: the [E] prompts, market sign
 * signs, money notes, sale pop-ups and customer patience bars.
 *
 * The pattern for every one of them:
 *   - React renders the element when it should EXIST (a toast appears, a customer joins
 *     the line). That happens a few times a second at most.
 *   - Where the element IS (its `left`/`top`, a patience bar's width) changes every
 *     frame, so it is written straight onto the DOM node by `useAnchorPoint`
 *     / `useAnchorEffect`, bypassing React. No component here re-renders per frame.
 */

interface AnchoredCommon {
  /** Which projected world point to follow. Use a module-level selector from anchorStore. */
  select: PointSelector;
  /** Pixel offset from that point (negative y = above it). */
  offset?: Point;
}

type AnchoredDivProps = AnchoredCommon & Omit<React.HTMLAttributes<HTMLDivElement>, 'ref'>;
type AnchoredButtonProps = AnchoredCommon & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'ref'>;

/** A `<div>` pinned to a world point. */
export function AnchoredDiv({ select, offset, ...rest }: AnchoredDivProps) {
  const ref = useRef<HTMLDivElement>(null);
  useAnchorPoint(select, ref, offset);
  return <div ref={ref} {...rest} />;
}

/** A `<button>` pinned to a world point. */
export function AnchoredButton({ select, offset, ...rest }: AnchoredButtonProps) {
  const ref = useRef<HTMLButtonElement>(null);
  useAnchorPoint(select, ref, offset);
  return <button ref={ref} {...rest} />;
}

/**
 * Gain-colour to cost-colour by remaining patience: plenty left reads green, nearly gone
 * reads red. Token names (not hex) so the palette stays in tokens.css. The thresholds are
 * unchanged from the old bar.
 */
function patienceColor(ratio: number): string {
  return ratio > 0.55 ? 'var(--gain-sign)' : ratio > 0.28 ? 'var(--warn-sign)' : 'var(--cost-sign)';
}

/**
 * One customer's patience bar. Its position AND its fill (width + colour) change every
 * frame, so both are written to the DOM directly; only the "Next" tag is React-rendered
 * (it appears when this customer reaches the front of the line).
 */
function PatienceBar({ id, isFront }: { id: number; isFront: boolean }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const fillRef = useRef<HTMLElement>(null);

  useAnchorEffect(
    (anchors) => {
      const customer = anchors.queue.find((c) => c.id === id);
      const root = rootRef.current;
      const fill = fillRef.current;
      if (!customer || !root || !fill) return;
      root.style.left = `${customer.x}px`;
      root.style.top = `${customer.y - 6}px`;
      fill.style.width = `${Math.max(0, Math.min(100, Math.round(customer.patienceRatio * 100)))}%`;
      fill.style.background = patienceColor(customer.patienceRatio);
    },
    [id]
  );

  return (
    <div ref={rootRef} className="world-patience">
      {isFront && <span className="pt-sign world-next pt-disp">Next</span>}
      {/* pt-track from the kit: square, outlined; its <i> child is the fill. */}
      <div className="pt-track world-patience-track">
        <i ref={fillRef} />
      </div>
    </div>
  );
}

/** The whole line of patience bars. Re-renders only when someone joins or leaves. */
export function PatienceBars() {
  const ids = useQueueIds();
  return (
    <>
      {ids.map((id, index) => (
        <PatienceBar key={id} id={id} isFront={index === 0} />
      ))}
    </>
  );
}

/**
 * HOW THE FLOATING TOASTS / POPS SPLIT THE WORK (two nested elements)
 *
 *   outer `.world-anchor` <- `useAnchorPoint` writes `left`/`top` on it every frame, and CSS
 *                            centres it with a fixed `translate(-50%, -100%)`. Motion never
 *                            touches this element.
 *   inner `m.div`    <- Motion animates ONLY `opacity` and the `transform` (y, scale).
 *
 * Because the two elements own different CSS properties, they can never fight over the same
 * one. Stacking order (the n-th note sits one slot higher) is a Motion `y` value, so when
 * the oldest toast leaves, everything above it slides down smoothly instead of jumping.
 */

/** Spring used when a stacked item moves to a new slot. Settles in ~250ms with no wobble. */
const STACK_SPRING = { type: 'spring', stiffness: 420, damping: 34, mass: 0.8 } as const;

const TOAST_STACK_PX = 44;
const POP_STACK_PX = 40;
/** Mirrors --dur-chip in tokens.css (1800ms): how long a note stays in the world. */
const DUR_CHIP_S = 1.8;
/** How far a note floats up while it fades. */
const NOTE_RISE_PX = 24;

/**
 * One note: outlined text in the tone colour, then the money chips under it.
 *
 * Three nested layers, each owning different properties so they never fight:
 *   anchor   (AnchoredDiv)  left/top, written per frame by useAnchorPoint
 *   stack    (m.div)        y only: the slot in the pile, spring-animated
 *   rise     (m.div)        opacity + y: the 24px float-up and fade over --dur-chip
 */
function ToastItem({ toast, index }: { toast: WorldNote; index: number }) {
  const y = -index * TOAST_STACK_PX;
  return (
    <AnchoredDiv
      select={toast.anchor === 'own-stand' ? selectOwnStand : selectSellerStand}
      offset={{ x: 0, y: -46 }}
      className="world-anchor is-note"
    >
      <m.div
        initial={{ y: y + 12 }}
        animate={{ y, transition: STACK_SPRING }}
        exit={{ opacity: 0, transition: { duration: 0.15, ease: EASE_IN } }}
      >
        <m.div
          className={`world-note is-${toast.tone}`}
          initial={{ opacity: 0, y: 0 }}
          animate={{
            // Quick fade in, hold, then fade out by the end of --dur-chip.
            opacity: [0, 1, 1, 0],
            y: -NOTE_RISE_PX,
            transition: {
              opacity: { duration: DUR_CHIP_S, times: [0, 0.08, 0.7, 1], ease: 'linear' },
              y: { duration: DUR_CHIP_S, ease: EASE_OUT },
            },
          }}
        >
          {toast.text && <span className="pt-outlined world-note-text">{toast.text}</span>}
          <MoneyChipStrip chips={toast.chips} />
        </m.div>
      </m.div>
    </AnchoredDiv>
  );
}

/** In-world floating notes, stacked above whichever stand they belong to. */
export function ToastLayer() {
  const toasts = useGameStore((s) => s.toasts);
  return (
    <AnimatePresence>
      {toasts.map((t, idx) => (
        <ToastItem key={t.id} toast={t} index={idx} />
      ))}
    </AnimatePresence>
  );
}

/**
 * `salePopLabel` (core/sales.ts) builds "+$3" or "+$3 x4". We show the money big and the
 * combo count ("x4") separately and smaller, so the streak reads at a glance.
 */
function splitPopText(text: string): { main: string; combo: string | null } {
  const comboMatch = text.match(/\s(x\d+)$/);
  const main = comboMatch ? text.slice(0, comboMatch.index) : text;
  return { main, combo: comboMatch ? comboMatch[1] : null };
}

function SalePopItem({ pop, index }: { pop: SalePop; index: number }) {
  const { main, combo } = splitPopText(pop.text);
  const tier = pop.isPerfect ? 'is-perfect' : pop.combo >= 4 ? 'is-fire' : pop.combo >= 2 ? 'is-hot' : '';
  // "Punch": the number overshoots to this scale, then settles at 1. A bigger combo (or a
  // perfect brew) punches harder, so the player feels the streak growing.
  const punch = pop.isPerfect ? 1.3 : 1.1 + Math.min(pop.combo, 6) * 0.035;
  const y = -index * POP_STACK_PX;
  return (
    <AnchoredDiv select={selectOwnStand} offset={{ x: 0, y: -76 }} className="world-anchor is-pop">
      <m.div
        className={`pt-outlined world-pop ${tier}`}
        initial={{ opacity: 0, scale: 0.55, y: y + 14 }}
        animate={{
          opacity: 1,
          scale: [0.55, punch, 1],
          y: y - 30,
          transition: {
            opacity: { duration: 0.14 },
            scale: { duration: 0.34, times: [0, 0.5, 1], ease: EASE_OUT },
            // Slow drift upward for the whole life of the pop; stack shifts reuse the same spring.
            y: { type: 'spring', stiffness: 60, damping: 18 },
          },
        }}
        exit={{ opacity: 0, scale: 0.95, y: y - 62, transition: { duration: 0.3, ease: EASE_IN } }}
      >
        <span>{main}</span>
        {combo && <span className="world-pop-combo">{combo}</span>}
      </m.div>
    </AnchoredDiv>
  );
}

/** Escalating sale pop-numbers and perfect-brew bursts above the player's stand. */
export function SalePopLayer() {
  const salePops = useGameStore((s) => s.salePops);
  return (
    <AnimatePresence>
      {salePops.map((pop, idx) => (
        <SalePopItem key={pop.id} pop={pop} index={idx} />
      ))}
    </AnimatePresence>
  );
}
