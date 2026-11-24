import { getDailyWages, MANAGER_DAILY_WAGE, WORKER_DAILY_WAGE } from '../core/sliceModel';
import { getNeighborhood } from '../core/neighborhoods';
import { useQueueLength } from '../state/anchorStore';
import { useGameStore } from '../state/gameStore';
import { BrewStep } from './BrewMinigame';
import { getIcons } from './assets';
import { CashHero } from './CashHero';
import { getConversionProb } from './format';

/**
 * The bottom bar shown while the player is standing BEHIND their counter:
 * cash, then Step 1 Brew (BrewMinigame.tsx), Step 2 Serve, Step 3 Price, Staff, and
 * the exit buttons. Each step is its own component with its own narrow subscriptions.
 */

/**
 * Step 2: pour a cup for the customer at the front of the line.
 * `serveProgress` runs 0 -> 1 on every frame of the 450 ms pour animation, so (like
 * BrewStep) this is one of the only components allowed to subscribe to it.
 */
function ServeStep() {
  const actions = useGameStore((s) => s.actions);
  const combo = useGameStore((s) => s.combo);
  const brewedCups = useGameStore((s) => s.brewedCups);
  const serveProgress = useGameStore((s) => s.serveProgress); // per-frame while pouring
  const queueLength = useQueueLength();

  return (
    <div className="workbench-step" style={{ minWidth: 212 }}>
      <div className="wb-step-head">
        <span className="wb-step-badge">Step 2 · Serve</span>
        {combo >= 2 ? (
          <span key={`combo-${combo}`} className="wb-combo-badge game-num">
            🔥 x{combo} STREAK
          </span>
        ) : (
          <span className="wb-step-meta game-num">Queue: {queueLength}/4</span>
        )}
      </div>
      <div className="wb-timer-track">
        <div
          className="wb-timer-fill"
          style={{ width: `${serveProgress !== null ? Math.round(serveProgress * 100) : 0}%` }}
        />
      </div>
      <button
        type="button"
        className="gbtn gbtn-green"
        onClick={actions.startServeFrontCustomer}
        disabled={brewedCups < 1 || queueLength === 0 || serveProgress !== null}
        style={{ padding: '6px 10px', fontSize: 12 }}
      >
        <span>
          {serveProgress !== null ? 'Pouring...' : queueLength === 0 ? 'Waiting for Line' : 'Serve Next Customer'}
        </span>
        <span className="keycap">Space</span>
      </button>
    </div>
  );
}

/** Step 3: pick the cup price; each button shows the chance a passer-by buys at it. */
function PriceStep() {
  const actions = useGameStore((s) => s.actions);
  const pricePerCup = useGameStore((s) => s.economy.pricePerCup);
  const neighborhoodId = useGameStore((s) => s.neighborhoodId);
  const neighborhood = getNeighborhood(neighborhoodId);

  return (
    <div className="workbench-step">
      <div className="wb-step-head">
        <span className="wb-step-badge">Step 3 · Price</span>
        <span className="wb-step-meta">{neighborhood.shortName}</span>
      </div>
      <div className="wb-price-row">
        {[2, 3, 4, 5].map((price) => {
          const pct = Math.round(getConversionProb(price, neighborhood.priceSensitivity) * 100);
          return (
            <button
              key={price}
              type="button"
              className={`wb-price-btn ${pricePerCup === price ? 'is-selected' : ''}`}
              onClick={() => actions.setPrice(price)}
            >
              <span className="wb-price-num game-num">${price}</span>
              <span className="wb-price-pct game-num">{pct}%</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Staffing: hire workers (wider sweet spot) and managers (auto brew & serve). */
function StaffStep() {
  const actions = useGameStore((s) => s.actions);
  const dailyWages = useGameStore((s) => getDailyWages(s.economy));
  const workers = useGameStore((s) => s.economy.workers);
  const managers = useGameStore((s) => s.economy.managers);

  return (
    <div className="workbench-step" style={{ minWidth: 162 }}>
      <div className="wb-step-head">
        <span className="wb-step-badge">Staff</span>
        <span className="wb-step-meta game-num">-${dailyWages}/d</span>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
        <button
          type="button"
          className="gbtn"
          onClick={actions.hireWorker}
          style={{ padding: '5px 8px', fontSize: 11 }}
          title="Widens the brew timing sweet spot (+$3/day wages)"
        >
          <span>
            Worker (${WORKER_DAILY_WAGE}/d){workers > 0 ? ` ×${workers}` : ''}
          </span>
        </button>
        <button
          type="button"
          className="gbtn gbtn-green"
          onClick={actions.hireManager}
          style={{ padding: '5px 8px', fontSize: 11 }}
          title="Auto-brews & serves queued customers (+$5/day wages)"
        >
          <span>
            Manager (${MANAGER_DAILY_WAGE}/d){managers > 0 ? ` ×${managers}` : ''}
          </span>
        </button>
      </div>
    </div>
  );
}

/** Quick exit: head to the market, step out from behind the counter, or divest the stand. */
function ExitStep() {
  const actions = useGameStore((s) => s.actions);
  const icons = getIcons();

  return (
    <div className="workbench-step" style={{ justifyContent: 'center', gap: 5 }}>
      <button
        type="button"
        className="gbtn gbtn-green"
        onClick={() => actions.selectNeighborhood('market')}
        style={{ padding: '5px 10px', fontSize: 11.5 }}
      >
        <img src={icons.market} alt="" className="px-icon-sm" />
        <span>Market →</span>
      </button>
      <div style={{ display: 'flex', gap: 5 }}>
        <button
          type="button"
          className="gbtn gbtn-slate"
          onClick={actions.exitStand}
          style={{ padding: '5px 9px', fontSize: 11, flex: 1 }}
        >
          Step Out
        </button>
        <button
          type="button"
          className="gbtn gbtn-red"
          onClick={actions.divestCurrentStand}
          style={{ padding: '5px 8px', fontSize: 11 }}
          title="Liquidate this stand at 70% salvage value (+$8.40 Cash, -$12.00 Equip, -$0.60/d Hurdle)"
        >
          Divest (+$8.40)
        </button>
      </div>
    </div>
  );
}

export function StandWorkbench() {
  return (
    <div className="workbench-bar" role="region" aria-label="Stall Workbench">
      {/* Hero Cash Counter (stays visible while serving!) */}
      <CashHero compact />
      <BrewStep />
      <ServeStep />
      <PriceStep />
      <StaffStep />
      <ExitStep />
    </div>
  );
}
