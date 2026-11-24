import { getNeighborhood } from '../core/neighborhoods';
import { useNearbyTarget } from '../state/anchorStore';
import { selectCurrentPlotStatus, useGameStore } from '../state/gameStore';
import { getIcons } from './assets';
import { CashHero } from './CashHero';
import { useTutorialStep } from './TutorialBar';

/**
 * The bottom bar shown while walking around (NOT behind the counter): cash, stock
 * counts, and a context button for whatever the player is standing next to, plus a
 * one-line hint when nothing is nearby and the tutorial is finished.
 */
export function ActionDock() {
  const actions = useGameStore((s) => s.actions);
  const cupsInStock = useGameStore((s) => s.economy.cupsInStock);
  const pricePerCup = useGameStore((s) => s.economy.pricePerCup);
  const pitchers = useGameStore((s) => s.economy.pitchers);
  const stallKits = useGameStore((s) => s.economy.stallKits);
  const neighborhoodId = useGameStore((s) => s.neighborhoodId);
  const lastBusinessNeighborhood = useGameStore((s) => s.lastBusinessNeighborhood);
  const currentPlotStatus = useGameStore(selectCurrentPlotStatus);
  const nearby = useNearbyTarget();
  const tutorialStep = useTutorialStep();

  const icons = getIcons();
  const neighborhood = getNeighborhood(neighborhoodId);
  const lastBusinessDistrict = getNeighborhood(lastBusinessNeighborhood);

  return (
    <>
      <div className="action-dock">
        {/* Hero Cash Anchor */}
        <CashHero />

        <div className={`dock-slot ${cupsInStock === 0 ? 'is-low' : ''}`} title={`Lemons in Stock (${cupsInStock} cups)`}>
          <img src={icons.lemon} alt="Lemons" className="px-icon-dock" />
          <span className="dock-val game-num">{cupsInStock}</span>
        </div>

        <div className="dock-slot" title={`Cup Price ($${pricePerCup}/cup)`}>
          <span className="dock-price-tag game-num">${pricePerCup}</span>
          <span className="dock-price-sub">/cup</span>
        </div>

        <div className="dock-slot" title={`Glass Pitchers (${pitchers})`}>
          <img src={icons.pitcher} alt="Pitchers" className="px-icon-dock" />
          <span className="dock-val game-num">{pitchers}</span>
        </div>

        {stallKits > 0 && (
          <div className="dock-slot" title={`Wooden Stall Kits (${stallKits})`}>
            <img src={icons.market} alt="Stall Kits" className="px-icon-dock" />
            <span className="dock-val game-num">{stallKits}</span>
          </div>
        )}

        {nearby === 'plot-lease' && (
          <button type="button" className="gbtn gbtn-gold" onClick={() => actions.openModal('plot-lease')}>
            <span className="keycap">E</span>
            <span>
              {currentPlotStatus === 'leased'
                ? stallKits >= 1
                  ? 'Build Stand Here'
                  : 'Get Stall Kit ($12)'
                : `Sign Lease ($${neighborhood.dailyRent}/d)`}
            </span>
          </button>
        )}

        {nearby === 'own-stand' && (
          <button type="button" className="gbtn gbtn-gold" onClick={actions.enterStand}>
            <span className="keycap">E</span>
            <span>Step Inside Stand</span>
          </button>
        )}

        {nearby === 'seller-stand' && (
          <button type="button" className="gbtn" onClick={() => actions.openModal('seller-stand')}>
            <span className="keycap">E</span>
            <span>Inspect Seller</span>
          </button>
        )}

        {nearby === 'market-stalls' && (
          <button type="button" className="gbtn gbtn-green" onClick={() => actions.openModal('market-stalls')}>
            <span className="keycap">E</span>
            <span>Buy Stall Kit ($12)</span>
          </button>
        )}

        {nearby === 'market-lemons' && (
          <button type="button" className="gbtn gbtn-green" onClick={() => actions.openModal('market-lemons')}>
            <span className="keycap">E</span>
            <span>Buy Lemons ($5)</span>
          </button>
        )}

        {nearby === 'market-pitchers' && (
          <button type="button" className="gbtn gbtn-green" onClick={() => actions.openModal('market-pitchers')}>
            <span className="keycap">E</span>
            <span>Buy Pitchers ($10)</span>
          </button>
        )}

        {neighborhoodId === 'market' && !nearby && (
          <button
            type="button"
            className="gbtn gbtn-gold"
            onClick={() => actions.selectNeighborhood(lastBusinessNeighborhood)}
          >
            <span>Back to {lastBusinessDistrict.shortName} →</span>
          </button>
        )}
      </div>

      {!nearby && !tutorialStep && (
        <div className="dock-hint">
          {neighborhoodId === 'market'
            ? 'Walk to the Lemon Stall (right) or Gear Stall (left) and press [E]'
            : 'WASD / Click to walk · Press [E] at your stand to step behind the counter · [M] Map'}
        </div>
      )}
    </>
  );
}
