import { useLayoutEffect, type RefObject } from 'react';
import { useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { createStore } from 'zustand/vanilla';
import type { PlotId } from '../core/plots';
import type { NearbyTarget, ProjectedAnchors } from '../world/CentralParkScene';

/**
 * Per-frame screen positions of things in the 3D world (the stand, the market signs,
 * each queued customer's head...), published by the 3D scene 60 times a second.
 *
 * WHY A SEPARATE, "VANILLA" STORE
 *   The old code did `onAnchorsUpdate: setAnchors`, so React re-rendered the whole
 *   2,900-line App component sixty times a second just to nudge a few labels by a pixel.
 *   Per-frame data needs a different path from game state:
 *     - A *vanilla* store (`createStore`) is plain JavaScript: it holds a value and a
 *       list of listeners, and has no React in it at all. Writing to it is cheap.
 *     - Components never subscribe to the whole object. They either
 *         (a) subscribe to ONE discrete value (`useNearbyTarget`), which re-renders
 *             only when that value actually changes (a few times a minute), or
 *         (b) move their own DOM element directly (`useAnchorPoint`), which skips React
 *             entirely: React is only needed when the set of elements changes, not
 *             when an element moves.
 *   Rule of thumb: React renders answer "WHAT is on screen?"; this store answers
 *   "WHERE is it right now?".
 */

const INITIAL_ANCHORS: ProjectedAnchors = {
  ownStand: { x: 640, y: 360 },
  sellerStand: { x: 320, y: 360 },
  marketAnchors: {
    stalls: { x: 360, y: 350 },
    pitchers: { x: 640, y: 350 },
    lemons: { x: 920, y: 350 },
  },
  // No plot positions until the scene publishes them: the UI draws no plot sign for a
  // plot it has no real position for (see usePlotAnchorKnown).
  plots: {},
  player: { x: 500, y: 400 },
  nearby: null,
  nearbyPlotId: null,
  queue: [],
};

export const anchorStore = createStore<ProjectedAnchors>(() => INITIAL_ANCHORS);

/**
 * Called by the scene every frame. `replace = true` swaps the whole object instead of
 * merging, which is exactly what a fresh `ProjectedAnchors` snapshot means.
 */
export function publishAnchors(anchors: ProjectedAnchors): void {
  anchorStore.setState(anchors, true);
}

/** Back to the placeholder positions (tests, and a scene that has been torn down). */
export function resetAnchorStore(): void {
  anchorStore.setState(INITIAL_ANCHORS, true);
}

// ---------------------------------------------------------------------------
// Selectors. Declared once at module level so their identity is stable, which lets
// the hooks below skip re-subscribing on every render.
// ---------------------------------------------------------------------------
export interface Point {
  x: number;
  y: number;
}
export type PointSelector = (a: ProjectedAnchors) => Point;

export const selectOwnStand: PointSelector = (a) => a.ownStand;
export const selectSellerStand: PointSelector = (a) => a.sellerStand;
export const selectMarketStalls: PointSelector = (a) => a.marketAnchors.stalls;
export const selectMarketPitchers: PointSelector = (a) => a.marketAnchors.pitchers;
export const selectMarketLemons: PointSelector = (a) => a.marketAnchors.lemons;

/**
 * Screen position of one plot's sign, or undefined while the scene has not published
 * one for it (the plot is not on the current street, or the scene has not started).
 * Not a PointSelector on purpose: callers must handle "no position yet" instead of
 * being handed a made-up point.
 */
export const selectPlotAnchor =
  (id: PlotId) =>
  (a: ProjectedAnchors): Point | undefined =>
    a.plots[id];

// ---------------------------------------------------------------------------
// React hooks
// ---------------------------------------------------------------------------

/**
 * Run `effect` with the current anchors now, and again on every anchor update, WITHOUT
 * re-rendering the component. `effect` only touches the DOM, so React never needs to know.
 * It runs in a layout effect so the first position is applied before the browser paints
 * (otherwise a new label would flash at the top-left corner for one frame).
 */
export function useAnchorEffect(effect: (anchors: ProjectedAnchors) => void, deps: readonly unknown[]): void {
  useLayoutEffect(() => {
    effect(anchorStore.getState());
    return anchorStore.subscribe(effect);
    // The caller owns `deps`; `effect` is intentionally not listed because callers pass
    // an inline closure whose identity changes every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

/**
 * Keep an element glued to a projected world point by writing `left`/`top` straight
 * onto the DOM node (no re-render per frame).
 *
 * We write `left`/`top`, not `transform`, because the overlay CSS classes already use
 * `transform` for centring (`translate(-50%, -100%)`) and for pop animations; writing
 * `transform` here would overwrite them.
 *
 * `offset` is in screen pixels (e.g. `{ x: 0, y: -46 }` floats the label 46px above
 * the point). Pass primitives through `offset` rather than a new object each render
 * only if you can; the effect re-subscribes when `offset.x`/`offset.y` change.
 */
export function useAnchorPoint(
  select: PointSelector,
  ref: RefObject<HTMLElement | null>,
  offset: Point = { x: 0, y: 0 }
): void {
  const { x: dx, y: dy } = offset;
  // Remember what we last wrote so an unchanged point costs nothing.
  useLayoutEffect(() => {
    let lastLeft = Number.NaN;
    let lastTop = Number.NaN;
    const place = (anchors: ProjectedAnchors): void => {
      const el = ref.current;
      if (!el) return;
      const p = select(anchors);
      const left = p.x + dx;
      const top = p.y + dy;
      if (left !== lastLeft) {
        el.style.left = `${left}px`;
        lastLeft = left;
      }
      if (top !== lastTop) {
        el.style.top = `${top}px`;
        lastTop = top;
      }
    };
    place(anchorStore.getState());
    return anchorStore.subscribe(place);
  }, [select, ref, dx, dy]);
}

/**
 * Which interactable the player is standing next to (or null). This is a discrete
 * value: `useStore` compares the selected value with `Object.is`, so the component
 * re-renders only when the player walks into or out of range.
 */
export function useNearbyTarget(): NearbyTarget {
  return useStore(anchorStore, (a) => a.nearby);
}

/**
 * The ids of the customers in line, front first. Positions and patience change every
 * frame but the list itself changes only when someone joins or leaves, so
 * `useShallow` (element-by-element comparison) keeps this from re-rendering on
 * every frame even though the selector builds a brand-new array each time.
 */
export function useQueueIds(): number[] {
  return useStore(
    anchorStore,
    useShallow((a) => a.queue.map((c) => c.id))
  );
}

/**
 * Which plot the player is next to (or null). Discrete like `useNearbyTarget`: re-renders
 * only when the player walks from one plot's reach into another's (or out of all).
 */
export function useNearbyPlotId(): PlotId | null {
  return useStore(anchorStore, (a) => a.nearbyPlotId);
}

/**
 * Has the scene published a position for plot `id`? A boolean, so it re-renders only
 * when the plot appears on or leaves the street, never as it moves.
 */
export function usePlotAnchorKnown(id: PlotId): boolean {
  return useStore(anchorStore, (a) => a.plots[id] !== undefined);
}

/** How many customers are waiting (a plain number, so it re-renders only on change). */
export function useQueueLength(): number {
  return useStore(anchorStore, (a) => a.queue.length);
}
