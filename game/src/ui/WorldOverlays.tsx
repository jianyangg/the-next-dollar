import React, { useRef } from 'react';
import { useGameStore } from '../state/gameStore';
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

/** Escalating sale pop-numbers and perfect-brew bursts above the player's stand. */
export function SalePopLayer() {
  const salePops = useGameStore((s) => s.salePops);
  return (
    <>
      {salePops.map((pop, idx) => {
        const fontSize = pop.isPerfect ? 18 : Math.min(24, 15 + (pop.combo - 1) * 2);
        const popClass = pop.isPerfect
          ? 'sale-pop is-perfect game-num'
          : pop.combo >= 4
          ? 'sale-pop is-fire game-num'
          : pop.combo >= 2
          ? 'sale-pop is-hot game-num'
          : 'sale-pop game-num';
        return (
          <AnchoredDiv
            key={pop.id}
            select={selectOwnStand}
            offset={{ x: 0, y: -76 - idx * 24 }}
            className={popClass}
            style={{ fontSize }}
          >
            {pop.text}
          </AnchoredDiv>
        );
      })}
    </>
  );
}

/** In-world floating accounting toasts, stacked above whichever stand they belong to. */
export function ToastLayer() {
  const toasts = useGameStore((s) => s.toasts);
  return (
    <>
      {toasts.map((t, idx) => (
        <AnchoredDiv
          key={t.id}
          select={t.anchor === 'own-stand' ? selectOwnStand : selectSellerStand}
          offset={{ x: 0, y: -46 - idx * 30 }}
          className={`ledger-toast ${t.tone} game-num`}
        >
          <span>{t.text}</span>
        </AnchoredDiv>
      ))}
    </>
  );
}
