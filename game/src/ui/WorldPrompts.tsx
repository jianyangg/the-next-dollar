import { useMemo, useRef } from 'react';
import { useStore } from 'zustand';
import { CENTRAL_PARK_DEAL } from '../core/deal';
import type { PlotView } from '../core/plots';
import {
  anchorStore,
  selectMarketLemons,
  selectMarketPitchers,
  selectMarketStalls,
  selectSellerStand,
  useAnchorEffect,
  useNearbyPlotId,
  useNearbyTarget,
  usePlotAnchorKnown,
} from '../state/anchorStore';
import {
  type GameData,
  selectDistrictPlots,
  selectDistrictPlotsKey,
  selectSellerPresent,
  useGameStore,
} from '../state/gameStore';
import type { NearbyTarget } from '../world/CentralParkScene';
import { plotsOnStreet, sellerStandShown } from '../world/collision';
import { getIcons } from './assets';
import { Key } from './kit/Money';
import { AnchoredButton } from './WorldOverlays';
import './styles/world.css';

const SELLER_ASK = CENTRAL_PARK_DEAL.askingPrice;

/** True when no panel, picker, scorecard or stand view is covering the world. */
export const selectNoOverlayOpen = (s: GameData): boolean =>
  !s.activeModal && !s.founderModalOpen && !s.mapOpen && !s.workingAtStand && !s.eodRecord;

/**
 * Every destination in the world carries a small floating sign, ALL the time:
 *   - far away it is quiet: no [E] key bullet, a little transparent, and it does not
 *     bob or take clicks (so you can still click the street underneath it to walk);
 *   - when you stand next to it, it gets the [E] key, full colour and the gentle bob.
 * This answers "where can I go?" at a glance without any extra text: each sign is the
 * [E] bullet plus ONE word. The windows that open show the prices and rules. The one
 * exception is the seller's asking price, an engine number, which rides along as a
 * paper tag when you are close.
 *
 * Signs: one per plot of the current district (see `plotSignWord`), the seller (only in
 * Central Park while the seller is still in business), the Union Square stalls (Kits /
 * Pitchers / Lemons), and the subway entrance (every neighborhood has one).
 *
 * Each sign's screen position is written straight to the DOM every frame; React only
 * decides which ones EXIST (a few times per minute).
 */
export function WorldPrompts() {
  const actions = useGameStore((s) => s.actions);
  const noOverlayOpen = useGameStore(selectNoOverlayOpen);
  const neighborhoodId = useGameStore((s) => s.neighborhoodId);
  const sellerPresent = useGameStore(selectSellerPresent);
  // The plot list is a new array on every read, so we subscribe to its key (a string that
  // changes only when a plot's status / staffing / rent changes) and rebuild the list then.
  const plotsKey = useGameStore(selectDistrictPlotsKey);
  const plots = useMemo(
    () => plotsOnStreet(selectDistrictPlots(useGameStore.getState()), sellerPresent),
    // `plotsKey` is the change signal for the list read inside; it is the dependency on purpose.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [plotsKey, sellerPresent]
  );
  const nearby = useNearbyTarget();
  const nearbyPlotId = useNearbyPlotId();
  const sellerShown = sellerStandShown(neighborhoodId, sellerPresent);

  const icons = getIcons();

  return (
    <>
      {noOverlayOpen && neighborhoodId !== 'market' && (
        <>
          {plots.map((plot) => {
            const target = plotTarget(plot);
            const near = nearby === target && nearbyPlotId === plot.id;
            return <PlotSign key={plot.id} plot={plot} near={near} onUse={() => actions.interact(target, plot.id)} />;
          })}

          {sellerShown && (
            <AnchoredButton
              type="button"
              className={`pt-sign world-sign ${nearby === 'seller-stand' ? 'is-nearby' : 'is-idle'}`}
              disabled={nearby !== 'seller-stand'}
              onClick={() => actions.openModal('seller-stand')}
              select={selectSellerStand}
              offset={{ x: 0, y: -12 }}
            >
              {nearby === 'seller-stand' && <Key k="E" />}
              <span className="pt-disp world-sign-word">{nearby === 'seller-stand' ? 'Talk' : 'Seller'}</span>
              {/* Paper tag: the asking price is a real engine number. */}
              {nearby === 'seller-stand' && <span className="pt-paper world-ask pt-num">${SELLER_ASK}</span>}
            </AnchoredButton>
          )}
        </>
      )}

      {/* The three Union Square stalls are always signposted; the key shows when close. */}
      {neighborhoodId === 'market' && noOverlayOpen && (
        <>
          {MARKET_SIGNS.map((sign) => (
            <AnchoredButton
              key={sign.target}
              type="button"
              className={`pt-sign world-sign ${nearby === sign.target ? 'is-nearby' : 'is-idle'}`}
              onClick={() => actions.openModal(sign.target, { click: true })}
              select={sign.select}
              offset={{ x: 0, y: -10 }}
            >
              {nearby === sign.target && <Key k="E" />}
              <img src={icons[sign.icon]} alt="" className="world-sign-icon" />
              <span className="pt-disp world-sign-word">{nearby === sign.target ? 'Shop' : sign.noun}</span>
            </AnchoredButton>
          ))}
        </>
      )}

      {noOverlayOpen && <SubwaySign near={nearby === 'subway'} onOpen={() => actions.toggleMap({ click: true })} />}
    </>
  );
}

/** What pressing E at a plot does: open a built stand, or lease / build on the plot. */
export function plotTarget(plot: Pick<PlotView, 'status'>): Exclude<NearbyTarget, null> {
  return plot.status === 'built' ? 'own-stand' : 'plot-lease';
}

/**
 * The one word on a plot's sign.
 *   - empty:  its name from afar ("Corner" / "Side" / "Plaza", so the player can tell the
 *             plots apart), "Lease" up close (what E will do);
 *   - leased: "Build" near or far (building is the whole point of a leased plot);
 *   - built:  "Stand" from afar, "Open" up close.
 */
export function plotSignWord(plot: Pick<PlotView, 'status' | 'label'>, near: boolean): string {
  if (plot.status === 'built') return near ? 'Open' : 'Stand';
  if (plot.status === 'leased') return 'Build';
  return near ? 'Lease' : plot.label;
}

/**
 * One plot's sign, glued to `anchors.plots[plot.id]`. Like the subway sign, it is drawn
 * only once the scene has published a real position for this plot; we never invent one.
 */
function PlotSign({ plot, near, onUse }: { plot: PlotView; near: boolean; onUse: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  const hasPosition = usePlotAnchorKnown(plot.id);

  // Re-runs when the position first becomes known (the button only exists from then on).
  useAnchorEffect(
    (anchors) => {
      const el = ref.current;
      const p = anchors.plots[plot.id];
      if (!el || !p) return;
      el.style.left = `${p.x}px`;
      el.style.top = `${p.y - 12}px`;
    },
    [hasPosition, plot.id]
  );

  if (!hasPosition) return null;
  return (
    <button
      ref={ref}
      type="button"
      className={`pt-sign world-sign ${near ? 'is-nearby' : 'is-idle'}`}
      disabled={!near}
      onClick={onUse}
      data-plot={plot.id}
    >
      {near && <Key k="E" />}
      <span className="pt-disp world-sign-word">{plotSignWord(plot, near)}</span>
    </button>
  );
}

/**
 * The subway entrance sign. Same look as the others, but it follows `anchors.subway`,
 * which only the live 3D scene publishes. Until a real position arrives (before the
 * scene starts, or in tests) nothing is drawn: we never invent a position.
 */
function SubwaySign({ near, onOpen }: { near: boolean; onOpen: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  const hasPosition = useStore(anchorStore, (a) => a.subway !== undefined);

  // The button only exists once a position is known, and this effect re-runs when it does.
  useAnchorEffect(
    (anchors) => {
      const el = ref.current;
      const p = anchors.subway;
      if (!el || !p) return;
      el.style.left = `${p.x}px`;
      el.style.top = `${p.y - 12}px`;
    },
    [hasPosition]
  );

  if (!hasPosition) return null;
  return (
    <button
      ref={ref}
      type="button"
      className={`pt-sign world-sign ${near ? 'is-nearby' : 'is-idle'}`}
      disabled={!near}
      onClick={onOpen}
    >
      {near && <Key k="E" />}
      <span className="pt-disp world-sign-word">Subway</span>
    </button>
  );
}

/** The three market stalls: which store target each opens, its anchor, icon and short noun. */
const MARKET_SIGNS = [
  { target: 'market-stalls', select: selectMarketStalls, icon: 'market', noun: 'Kits' },
  { target: 'market-pitchers', select: selectMarketPitchers, icon: 'pitcher', noun: 'Pitchers' },
  { target: 'market-lemons', select: selectMarketLemons, icon: 'lemon', noun: 'Lemons' },
] as const;
