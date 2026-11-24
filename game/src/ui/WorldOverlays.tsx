import React, { useRef } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import type { LedgerToast } from '../core/sliceModel';
import { type SalePop, useGameStore } from '../state/gameStore';
import { EASE_IN, EASE_OUT } from './motionPresets';
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
 * pills, ledger toasts, sale pop-ups and customer patience bars.
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

/** Green / yellow / red by remaining patience (same thresholds as before). */
function patienceColor(ratio: number): string {
  return ratio > 0.55 ? '#5fd16d' : ratio > 0.28 ? '#ffe066' : '#ff6b6b';
}

/**
 * One customer's patience bar. Its position AND its fill (width + colour) change every
 * frame, so both are written to the DOM directly; only the "Next" tag is React-rendered
 * (it appears when this customer reaches the front of the line).
 */
function PatienceBar({ id, isFront }: { id: number; isFront: boolean }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const fillRef = useRef<HTMLDivElement>(null);

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
    <div ref={rootRef} className="patience-anchor">
      {isFront && <span className="patience-next-tag">Next</span>}
      <div className="patience-track">
        <div ref={fillRef} className="patience-fill" />
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
 *   outer `.world-float`  <- `useAnchorPoint` writes `left`/`top` on it every frame, and CSS
 *                            centres it with a fixed `translate(-50%, -100%)`. Motion never
 *                            touches this element.
 *   inner `motion.div`    <- Motion animates ONLY `opacity` and the `transform` (y, scale).
 *
 * Because the two elements own different CSS properties, they can never fight over the same
 * one. Stacking order (the n-th toast sits n * 30px higher) is a Motion `y` value, so when
 * the oldest toast leaves, everything above it slides down smoothly instead of jumping.
 */

/** Spring used when a stacked item moves to a new slot. Settles in ~250ms with no wobble. */
const STACK_SPRING = { type: 'spring', stiffness: 420, damping: 34, mass: 0.8 } as const;

const TOAST_STACK_PX = 30;
const POP_STACK_PX = 24;

function ToastItem({ toast, index }: { toast: LedgerToast; index: number }) {
  const y = -index * TOAST_STACK_PX;
  return (
    <AnchoredDiv
      select={toast.anchor === 'own-stand' ? selectOwnStand : selectSellerStand}
      offset={{ x: 0, y: -46 }}
      className="world-float is-toast"
    >
      <motion.div
        className={`ledger-toast ${toast.tone} game-num`}
        initial={{ opacity: 0, y: y + 12 }}
        animate={{
          opacity: 1,
          y,
          transition: { opacity: { duration: 0.18, ease: EASE_OUT }, y: STACK_SPRING },
        }}
        exit={{ opacity: 0, y: y - 18, transition: { duration: 0.28, ease: EASE_IN } }}
      >
        <span>{toast.text}</span>
      </motion.div>
    </AnchoredDiv>
  );
}

/** In-world floating accounting toasts, stacked above whichever stand they belong to. */
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

function SalePopItem({ pop, index }: { pop: SalePop; index: number }) {
  const fontSize = pop.isPerfect ? 18 : Math.min(24, 15 + (pop.combo - 1) * 2);
  const popClass = pop.isPerfect
    ? 'sale-pop is-perfect game-num'
    : pop.combo >= 4
    ? 'sale-pop is-fire game-num'
    : pop.combo >= 2
    ? 'sale-pop is-hot game-num'
    : 'sale-pop game-num';
  // "Punch": the number overshoots to this scale, then settles at 1. A bigger combo (or a
  // perfect brew) punches harder, so the player feels the streak growing.
  const punch = pop.isPerfect ? 1.3 : 1.1 + Math.min(pop.combo, 6) * 0.035;
  const y = -index * POP_STACK_PX;
  return (
    <AnchoredDiv select={selectOwnStand} offset={{ x: 0, y: -76 }} className="world-float is-pop">
      <motion.div
        className={popClass}
        style={{ fontSize }}
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
        {pop.text}
      </motion.div>
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
