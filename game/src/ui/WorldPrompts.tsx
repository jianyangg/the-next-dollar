import { useRef } from 'react';
import { useStore } from 'zustand';
import { CENTRAL_PARK_DEAL } from '../core/deal';
import {
  anchorStore,
  selectMarketLemons,
  selectMarketPitchers,
  selectMarketStalls,
  selectOwnStand,
  selectSellerStand,
  useAnchorEffect,
  useNearbyTarget,
} from '../state/anchorStore';
import { type GameData, selectCurrentPlotStatus, useGameStore } from '../state/gameStore';
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
 * Signs: your stand or its plot ("Stand" / "Lease" / "Build"), the seller ("Seller"),
 * the Union Square stalls (Kits / Pitchers / Lemons), and the subway entrance (every
 * neighborhood has one).
 *
 * Each is an `AnchoredButton`, so its screen position is written straight to the DOM
 * every frame; React only decides which ones EXIST (a few times per minute).
 */
export function WorldPrompts() {
  const actions = useGameStore((s) => s.actions);
  const noOverlayOpen = useGameStore(selectNoOverlayOpen);
  const neighborhoodId = useGameStore((s) => s.neighborhoodId);
  const currentPlotStatus = useGameStore(selectCurrentPlotStatus);
  const nearby = useNearbyTarget();

  const icons = getIcons();
  // A built plot shows the stand; otherwise it is the plot: an empty one is leased first, a leased one built on.
  const plotIsBuilt = currentPlotStatus === 'built';
  const plotVerb = currentPlotStatus === 'leased' ? 'Build' : 'Lease';
  const ownTarget = plotIsBuilt ? 'own-stand' : 'plot-lease';
  const ownNearby = nearby === ownTarget;

  return (
    <>
      {noOverlayOpen && neighborhoodId !== 'market' && (
        <>
          {/* Your stand (once built) or its plot. The word is the same near or far for a
              plot ("Lease" / "Build" is the whole point of it); a built stand says "Stand"
              from afar and "Open" up close. */}
          <AnchoredButton
            type="button"
            className={`pt-sign world-sign ${ownNearby ? 'is-nearby' : 'is-idle'}`}
            disabled={!ownNearby}
            onClick={plotIsBuilt ? actions.enterStand : () => actions.openModal('plot-lease')}
            select={selectOwnStand}
            offset={{ x: 0, y: -12 }}
          >
            {ownNearby && <Key k="E" />}
            <span className="pt-disp world-sign-word">{plotIsBuilt ? (ownNearby ? 'Open' : 'Stand') : plotVerb}</span>
          </AnchoredButton>

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
