import { CENTRAL_PARK_DEAL } from '../core/deal';
import { getNeighborhood } from '../core/neighborhoods';
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
import { AnchoredButton } from './WorldOverlays';

const SELLER_ASK = CENTRAL_PARK_DEAL.askingPrice;

/** True when no panel, picker, scorecard or stand view is covering the world. */
export const selectNoOverlayOpen = (s: GameData): boolean =>
  !s.activeModal && !s.founderModalOpen && !s.mapOpen && !s.workingAtStand && !s.eodRecord;

/**
 * The floating [E] prompts above the stands and the three Union Square market sign
 * pills. Each is an `AnchoredButton`, so its screen position is written straight to the
 * DOM every frame; React only decides which ones EXIST (a few times per minute).
 */
export function WorldPrompts() {
  const actions = useGameStore((s) => s.actions);
  const noOverlayOpen = useGameStore(selectNoOverlayOpen);
  const neighborhoodId = useGameStore((s) => s.neighborhoodId);
  const pricePerCup = useGameStore((s) => s.economy.pricePerCup);
  const stallKits = useGameStore((s) => s.economy.stallKits);
  const currentPlotStatus = useGameStore(selectCurrentPlotStatus);
  const nearby = useNearbyTarget();

  const icons = getIcons();
  const neighborhood = getNeighborhood(neighborhoodId);

  return (
    <>
      {/* In-World Floating [E] Interaction Prompts */}
      {nearby === 'own-stand' && noOverlayOpen && (
        <AnchoredButton
          type="button"
          className="world-prompt"
          onClick={actions.enterStand}
          select={selectOwnStand}
          offset={{ x: 0, y: -12 }}
        >
          <span className="keycap">E</span>
          <span>Work Behind Counter (${pricePerCup}/cup)</span>
        </AnchoredButton>
      )}

      {nearby === 'seller-stand' && noOverlayOpen && (
        <AnchoredButton
          type="button"
          className="world-prompt seller"
          onClick={() => actions.openModal('seller-stand')}
          select={selectSellerStand}
          offset={{ x: 0, y: -12 }}
        >
          <span className="keycap">E</span>
          <span>Inspect Seller Stand · Ask ${SELLER_ASK}</span>
        </AnchoredButton>
      )}

      {nearby === 'plot-lease' && noOverlayOpen && (
        <AnchoredButton
          type="button"
          className="world-prompt"
          onClick={() => actions.openModal('plot-lease')}
          select={selectOwnStand}
          offset={{ x: 0, y: -12 }}
        >
          <span className="keycap">E</span>
          <span>
            {currentPlotStatus === 'leased'
              ? stallKits >= 1
                ? 'Build Stand Here (1 Kit)'
                : 'Leased Plot · Needs Stall Kit ($12)'
              : `Sign Lease ($${neighborhood.dailyRent}/day)`}
          </span>
        </AnchoredButton>
      )}

      {/* Always-Visible Floating Overhead Sign Pills for All 3 Union Square Market Stalls */}
      {neighborhoodId === 'market' && noOverlayOpen && (
        <>
          <AnchoredButton
            type="button"
            className={`market-sign-pill ${nearby === 'market-stalls' ? 'is-nearby' : ''}`}
            onClick={() => actions.openModal('market-stalls', { click: true })}
            select={selectMarketStalls}
            offset={{ x: 0, y: -10 }}
          >
            {nearby === 'market-stalls' && <span className="keycap">E</span>}
            <img src={icons.market} alt="" className="px-icon-sm" />
            <span>Stall Kits · $12</span>
          </AnchoredButton>

          <AnchoredButton
            type="button"
            className={`market-sign-pill ${nearby === 'market-pitchers' ? 'is-nearby' : ''}`}
            onClick={() => actions.openModal('market-pitchers', { click: true })}
            select={selectMarketPitchers}
            offset={{ x: 0, y: -10 }}
          >
            {nearby === 'market-pitchers' && <span className="keycap">E</span>}
            <img src={icons.pitcher} alt="" className="px-icon-sm" />
            <span>Glass Pitchers · $10</span>
          </AnchoredButton>

          <AnchoredButton
            type="button"
            className={`market-sign-pill ${nearby === 'market-lemons' ? 'is-nearby' : ''}`}
            onClick={() => actions.openModal('market-lemons', { click: true })}
            select={selectMarketLemons}
            offset={{ x: 0, y: -10 }}
          >
            {nearby === 'market-lemons' && <span className="keycap">E</span>}
            <img src={icons.lemon} alt="" className="px-icon-sm" />
            <span>Fresh Lemons · $5</span>
          </AnchoredButton>
        </>
      )}
    </>
  );
}
