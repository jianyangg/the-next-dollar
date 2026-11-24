import { CENTRAL_PARK_DEAL } from '../core/deal';
import {
  selectMarketLemons,
  selectMarketPitchers,
  selectMarketStalls,
  selectOwnStand,
  selectSellerStand,
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
 * The floating prompts above the stands and the three Union Square market signs.
 * Each is a small sign plate: an [E] key bullet plus ONE verb ("Open", "Lease", "Build",
 * "Talk", "Shop"). Prices and rules are not repeated here; the window that opens shows
 * them. The one exception is the seller's asking price, an engine number, which rides
 * along as a paper tag.
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
  // A leased plot is built on; an empty one is leased first.
  const plotVerb = currentPlotStatus === 'leased' ? 'Build' : 'Lease';

  return (
    <>
      {nearby === 'own-stand' && noOverlayOpen && (
        <AnchoredButton
          type="button"
          className="pt-sign world-sign"
          onClick={actions.enterStand}
          select={selectOwnStand}
          offset={{ x: 0, y: -12 }}
        >
          <Key k="E" />
          <span className="pt-disp world-sign-word">Open</span>
        </AnchoredButton>
      )}

      {nearby === 'seller-stand' && noOverlayOpen && (
        <AnchoredButton
          type="button"
          className="pt-sign world-sign"
          onClick={() => actions.openModal('seller-stand')}
          select={selectSellerStand}
          offset={{ x: 0, y: -12 }}
        >
          <Key k="E" />
          <span className="pt-disp world-sign-word">Talk</span>
          {/* Paper tag: the asking price is a real engine number. */}
          <span className="pt-paper world-ask pt-num">${SELLER_ASK}</span>
        </AnchoredButton>
      )}

      {nearby === 'plot-lease' && noOverlayOpen && (
        <AnchoredButton
          type="button"
          className="pt-sign world-sign"
          onClick={() => actions.openModal('plot-lease')}
          select={selectOwnStand}
          offset={{ x: 0, y: -12 }}
        >
          <Key k="E" />
          <span className="pt-disp world-sign-word">{plotVerb}</span>
        </AnchoredButton>
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
    </>
  );
}

/** The three market stalls: which store target each opens, its anchor, icon and short noun. */
const MARKET_SIGNS = [
  { target: 'market-stalls', select: selectMarketStalls, icon: 'market', noun: 'Kits' },
  { target: 'market-pitchers', select: selectMarketPitchers, icon: 'pitcher', noun: 'Pitchers' },
  { target: 'market-lemons', select: selectMarketLemons, icon: 'lemon', noun: 'Lemons' },
] as const;
