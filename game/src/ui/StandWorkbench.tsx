import { motion, useTransform } from 'motion/react';
import { getDailyWages, MANAGER_DAILY_WAGE, WORKER_DAILY_WAGE } from '../core/sliceModel';
import { getNeighborhood } from '../core/neighborhoods';
import { useQueueLength } from '../state/anchorStore';
import { type GameState, useGameStore } from '../state/gameStore';
import { BrewStep } from './BrewMinigame';
import { getIcons } from './assets';
import { CashHero } from './CashHero';
import { getConversionProb } from './format';
import { EASE_OUT } from './motionPresets';
import { usePulse } from './usePulse';
import { useStoreMotionValue } from './useStoreMotionValue';

/**
 * The bottom bar shown while the player is standing BEHIND their counter:
 * cash, then Step 1 Brew (BrewMinigame.tsx), Step 2 Serve, Step 3 Price, Staff, and
 * the exit buttons. Each step is its own component with its own narrow subscriptions.
 */

/**
 * "x3 STREAK" badge. Every time the combo count goes up, the badge plays a short
 * Motion "pop" (scale 0.8 -> 1.12 -> 1 over 0.26 s) on the SAME element, instead of the old
 * `key={`combo-${combo}`}` trick that destroyed and rebuilt the element to restart a CSS animation.
 */
function ComboBadge({ combo }: { combo: number }) {
  const scope = usePulse<HTMLSpanElement>(
    combo,
    { scale: [0.8, 1.12, 1] },
    { duration: 0.26, times: [0, 0.6, 1], ease: EASE_OUT },
    true
  );
  return (
    <span ref={scope} className="wb-combo-badge game-num">
      🔥 x{combo} STREAK
    </span>
  );
}

/** Selector: pour progress as a percent (0 when idle). Module level = stable identity. */
const selectServePct = (s: GameState): number => (s.serveProgress === null ? 0 : s.serveProgress * 100);
/** Selector: is a cup being poured right now? A boolean, so it flips only twice per pour. */
const selectPouring = (s: GameState): boolean => s.serveProgress !== null;

/**
 * Step 2: pour a cup for the customer at the front of the line.
 *
 * `serveProgress` runs 0 -> 1 on every frame of the 450 ms pour. The bar is driven through a
 * motion value (see `useStoreMotionValue`), so those frames never re-render this component;
 * React only re-renders when a pour starts or ends (`pouring` flips) or the combo/queue changes.
 */
export function ServeStep() {
  const actions = useGameStore((s) => s.actions);
  const combo = useGameStore((s) => s.combo);
  const brewedCups = useGameStore((s) => s.brewedCups);
  const pouring = useGameStore(selectPouring);
  const queueLength = useQueueLength();
  const pourWidth = useTransform(useStoreMotionValue(selectServePct), (pct) => `${Math.round(pct)}%`);

  return (
    <div className="workbench-step" style={{ minWidth: 212 }}>
      <div className="wb-step-head">
        <span className="wb-step-badge">Step 2 · Serve</span>
        {combo >= 2 ? <ComboBadge combo={combo} /> : <span className="wb-step-meta game-num">Queue: {queueLength}/4</span>}
      </div>
      <div className="wb-timer-track">
        <motion.div className="wb-timer-fill" style={{ width: pourWidth }} />
      </div>
      <button
        type="button"
        className="gbtn gbtn-green"
        onClick={actions.startServeFrontCustomer}
        disabled={brewedCups < 1 || queueLength === 0 || pouring}
        style={{ padding: '6px 10px', fontSize: 12 }}
      >
        <span>{pouring ? 'Pouring...' : queueLength === 0 ? 'Waiting for Line' : 'Serve Next Customer'}</span>
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
