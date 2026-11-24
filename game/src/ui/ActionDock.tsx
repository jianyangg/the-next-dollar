import type { ReactNode } from 'react';
import { getNeighborhood } from '../core/neighborhoods';
import { useNearbyPlotId, useNearbyTarget } from '../state/anchorStore';
import { useGameStore } from '../state/gameStore';
import { Key } from './kit/Money';
import { StockTag } from './stand/StockTag';
import { useTutorialStep } from './TutorialBar';
import './styles/stand.css';

/**
 * Shown while walking (NOT behind the counter): a small black sign with one button per
 * thing the player is standing next to, each a Key bullet plus ONE verb ("[E] Lease"),
 * and a paper tag of stock numbers. The [E] key itself is handled by the world input
 * layer; these buttons are the mouse route to the same actions.
 */

/** One sign button: [E] + a verb. */
function ActButton({ onClick, children }: { onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" className="dock-act" onClick={onClick}>
      <Key k="E" />
      {children}
    </button>
  );
}

export function ActionDock() {
  const actions = useGameStore((s) => s.actions);
  const stallKits = useGameStore((s) => s.economy.stallKits);
  const neighborhoodId = useGameStore((s) => s.neighborhoodId);
  const lastBusinessNeighborhood = useGameStore((s) => s.lastBusinessNeighborhood);
  const nearby = useNearbyTarget();
  // Which plot the player is next to (a district has 2-3), so the verb matches THAT plot.
  const nearbyPlotId = useNearbyPlotId();
  const nearbyPlotStatus = useGameStore((s) => (nearbyPlotId ? s.economy.plots[nearbyPlotId] : undefined));
  const act = (): void => actions.interact(nearby, nearbyPlotId);
  const tutorialStep = useTutorialStep();

  const lastBusinessDistrict = getNeighborhood(lastBusinessNeighborhood);
  const backToBusiness = neighborhoodId === 'market' && !nearby;
  // Nothing to press: show the two keys that always work while walking.
  const showKeysHint = !nearby && !tutorialStep && !backToBusiness;

  return (
    <>
      <div className="dock-stock">
        <StockTag withKits withPrice />
      </div>

      {(nearby || backToBusiness || showKeysHint) && (
        <div className="pt-sign dock-plate">
          {nearby === 'plot-lease' && (
            <ActButton onClick={act}>
              {nearbyPlotStatus === 'leased' ? (stallKits >= 1 ? 'Build' : 'Buy kit') : 'Lease'}
            </ActButton>
          )}

          {nearby === 'own-stand' && <ActButton onClick={act}>Open stand</ActButton>}

          {nearby === 'seller-stand' && <ActButton onClick={act}>Talk</ActButton>}

          {(nearby === 'market-stalls' || nearby === 'market-lemons' || nearby === 'market-pitchers') && (
            <ActButton onClick={act}>Shop</ActButton>
          )}

          {backToBusiness && (
            <button
              type="button"
              className="dock-act"
              onClick={() => actions.selectNeighborhood(lastBusinessNeighborhood)}
            >
              Back to {lastBusinessDistrict.shortName}
            </button>
          )}

          {showKeysHint && (
            <>
              <span className="dock-keys">
                <Key k="WASD" nav />
                Walk
              </span>
              <span className="dock-keys">
                <Key k="M" nav />
                Map
              </span>
            </>
          )}
        </div>
      )}
    </>
  );
}
