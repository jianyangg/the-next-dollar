import { getNeighborhood } from '../core/neighborhoods';
import { useNearbyTarget } from '../state/anchorStore';
import { useGameStore } from '../state/gameStore';
import { Key } from './kit/Money';
import { StockTag } from './stand/StockTag';
import { useTutorialStep } from './TutorialBar';
import './styles/stand.css';

/**
 * Shown while walking (NOT behind the counter): the paper stock tag, plus a small sign
 * for the two things that have no place in the world: "Back to <district>" in the
 * market, and the always-available keys (Walk, Map) when nothing is nearby.
 *
 * The "[E] verb" for a nearby plot, stand, shop or seller lives ONLY on that object's
 * world sign (WorldPrompts.tsx). Owner request (2026-11-24): showing it on the sign AND
 * here was a duplicate prompt. The sign wins because a district has 2-3 plots and the
 * sign sits on the one E acts on; a dock button can't say which.
 */
export function ActionDock() {
  const actions = useGameStore((s) => s.actions);
  const neighborhoodId = useGameStore((s) => s.neighborhoodId);
  const lastBusinessNeighborhood = useGameStore((s) => s.lastBusinessNeighborhood);
  const nearby = useNearbyTarget();
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

      {(backToBusiness || showKeysHint) && (
        <div className="pt-sign dock-plate">
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
