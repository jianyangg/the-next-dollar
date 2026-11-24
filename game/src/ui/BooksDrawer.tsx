import { AnimatePresence, motion } from 'motion/react';
import {
  getDailyHurdleCharge,
  getDailyWages,
  getDayNopat,
  getInvestedCapital,
  getTotalEquity,
  HURDLE_RATE,
} from '../core/sliceModel';
import { getDailyPlotRent } from '../core/rent';
import { getNeighborhood } from '../core/neighborhoods';
import { selectCurrentPlotStatus, useGameStore } from '../state/gameStore';
import { getIcons } from './assets';
import { fmtSignedMoney } from './format';
import { drawerMotion } from './motionPresets';
import { ValueTrajectoryStrip } from './ValueTrajectoryStrip';

/**
 * Cheap gate: subscribes ONLY to `booksOpen`. While the drawer is closed this is the
 * only thing that can wake up; the heavy body below (which reads the whole economy)
 * is not even mounted.
 */
export function BooksDrawer() {
  const booksOpen = useGameStore((s) => s.booksOpen);
  return <AnimatePresence>{booksOpen && <BooksDrawerBody key="books" />}</AnimatePresence>;
}

/** The financial statements: income statement, balance sheet, EVA hurdle meter, reviews. */
function BooksDrawerBody() {
  const actions = useGameStore((s) => s.actions);
  const state = useGameStore((s) => s.economy);
  const neighborhoodId = useGameStore((s) => s.neighborhoodId);
  const currentPlotStatus = useGameStore(selectCurrentPlotStatus);

  const icons = getIcons();
  const neighborhood = getNeighborhood(neighborhoodId);

  // Daily rent: every leased/built district plot plus any acquired seller stand (core/rent.ts)
  const estRent = getDailyPlotRent(state);
  const dailyWages = getDailyWages(state);

  // Derived financial metrics
  const investedCap = getInvestedCapital(state);
  const dailyHurdle = getDailyHurdleCharge(state);
  const liveNopat = getDayNopat(state);
  const projectedNopat = +(liveNopat - estRent - dailyWages).toFixed(2);
  const projectedEva = +(projectedNopat - dailyHurdle).toFixed(2);

  const totalAssets = +(state.cash + state.inventoryValue + state.equipmentValue).toFixed(2);
  const totalEquity = getTotalEquity(state);
  const isBalanced = Math.abs(totalAssets - totalEquity) < 0.005;

  // NOPAT vs 5% Hurdle visual meter scaling
  const meterScaleMax = Math.max(dailyHurdle * 2.5, Math.max(projectedNopat, 0) * 1.15, 4);
  const hurdleMarkerPct = Math.min(92, Math.max(10, (dailyHurdle / meterScaleMax) * 100));
  const nopatFillPct = Math.min(100, Math.max(0, (Math.max(projectedNopat, 0) / meterScaleMax) * 100));
  const clearsHurdle = projectedNopat >= dailyHurdle;

  return (
    <motion.aside className="books-drawer" aria-label="Financial Statements" {...drawerMotion}>
      <div className="drawer-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <img src={icons.book} alt="" className="px-icon" />
          <div>
            <div className="drawer-kicker">
              General Ledger · {neighborhood.shortName} · Day {state.day}
            </div>
            <div className="drawer-title">Financial Statements</div>
          </div>
        </div>
        <button type="button" className="icon-close-btn" onClick={actions.closeBooks} aria-label="Close Books">
          ✕
        </button>
      </div>

      <div className="drawer-body">
        {/* Income Statement */}
        <div className="ledger-section">
          <div className="ledger-section-head">
            <span>Income Statement</span>
            <span>Day {state.day} Live</span>
          </div>
          <div className="ledger-row">
            <span>Revenue</span>
            <span className="game-num val-pos">${state.dayRevenue.toFixed(2)}</span>
          </div>
          <div className="ledger-row">
            <span>COGS (Lemons)</span>
            <span className="game-num val-neg">-${state.dayCogs.toFixed(2)}</span>
          </div>
          <div className="ledger-row">
            <span>Live NOPAT (pre-rent)</span>
            <span className="game-num">${liveNopat.toFixed(2)}</span>
          </div>
          <div className="ledger-row">
            <span>Est. Daily Plot Rent</span>
            <span className="game-num val-neg">-${estRent.toFixed(2)}</span>
          </div>
          {dailyWages > 0 && (
            <div className="ledger-row">
              <span>
                Staff Wages ({state.workers}W · {state.managers}M)
              </span>
              <span className="game-num val-neg">-${dailyWages.toFixed(2)}</span>
            </div>
          )}
          <div className="ledger-row is-total">
            <span>Projected Day NOPAT</span>
            <span className={`game-num ${projectedNopat >= 0 ? 'val-pos' : 'val-neg'}`}>
              {fmtSignedMoney(projectedNopat)}
            </span>
          </div>
        </div>

        {/* Balance Sheet */}
        <div className="ledger-section">
          <div className="ledger-section-head">
            <span>Balance Sheet</span>
            <span>Position</span>
          </div>
          <div className="ledger-row">
            <span>Cash</span>
            <span className="game-num">${state.cash.toFixed(2)}</span>
          </div>
          <div className="ledger-row">
            <span>Inventory (Lemons)</span>
            <span className="game-num">${state.inventoryValue.toFixed(2)}</span>
          </div>
          <div className="ledger-row">
            <span>Equipment (Stands &amp; Pitchers)</span>
            <span className="game-num">${state.equipmentValue.toFixed(2)}</span>
          </div>
          <div className="ledger-row is-total">
            <span>Total Assets</span>
            <span className="game-num">${totalAssets.toFixed(2)}</span>
          </div>
          <div className="ledger-row">
            <span>Owner&apos;s Equity</span>
            <span className="game-num">${totalEquity.toFixed(2)}</span>
          </div>
          <div className="balance-check-pill game-num">
            <span>{isBalanced ? '✓' : '!'}</span>
            <span>
              {isBalanced
                ? `Balanced: Assets ($${totalAssets.toFixed(2)}) = Equity ($${totalEquity.toFixed(2)})`
                : 'Out of Balance'}
            </span>
          </div>
        </div>

        {/* Capital Allocation & NOPAT vs 5% Hurdle Meter */}
        <div className="ledger-section">
          <div className="ledger-section-head">
            <span>Capital Hurdle (EVA)</span>
            <span>{(HURDLE_RATE * 100).toFixed(0)}% / Day</span>
          </div>
          <div className="ledger-row">
            <span>Invested Operating Capital</span>
            <span className="game-num">${investedCap.toFixed(2)}</span>
          </div>
          <div className="ledger-row">
            <span>5% Daily Hurdle Charge</span>
            <span className="game-num val-amber">-${dailyHurdle.toFixed(2)}/d</span>
          </div>

          <div className="hurdle-meter-box">
            <div className="hurdle-meter-top">
              <span>NOPAT vs. 5% Hurdle</span>
              <span className={clearsHurdle ? 'val-pos' : 'val-amber'}>
                {clearsHurdle ? 'Clearing Hurdle!' : 'Below Hurdle'}
              </span>
            </div>
            <div className="hurdle-meter-track">
              <div
                className="hurdle-meter-fill"
                style={{
                  width: `${nopatFillPct}%`,
                  background: clearsHurdle
                    ? 'linear-gradient(180deg, #5fd16d, #298438)'
                    : 'linear-gradient(180deg, #f5a623, #d96b14)',
                }}
              />
              <div
                className="hurdle-meter-marker"
                style={{ left: `${hurdleMarkerPct}%` }}
                title={`5% Hurdle: $${dailyHurdle.toFixed(2)}`}
              />
            </div>
            <div className="hurdle-meter-foot game-num">
              <span>NOPAT {fmtSignedMoney(projectedNopat)}</span>
              <span>EVA {fmtSignedMoney(projectedEva)}</span>
            </div>
          </div>

          <div className="ledger-row is-total" style={{ marginTop: 9 }}>
            <span>Cumulative Value Created</span>
            <span className={`game-num ${state.totalValueCreated >= 0 ? 'val-pos' : 'val-neg'}`}>
              {fmtSignedMoney(state.totalValueCreated)}
            </span>
          </div>
          <ValueTrajectoryStrip />

          {(state.pitchers >= 1 || (currentPlotStatus === 'built' && state.ownedStands >= 1)) && (
            <div style={{ display: 'flex', gap: 6, marginTop: 10 }}>
              {state.pitchers >= 1 && (
                <button
                  type="button"
                  className="gbtn gbtn-slate"
                  style={{ flex: 1, padding: '6px 8px', fontSize: 11 }}
                  onClick={actions.sellUsedPitcher}
                  title="70% salvage value: Cash +$7, Equip -$10, lowers 5% hurdle by -$0.50/day"
                >
                  Sell Pitcher (+$7)
                </button>
              )}
              {currentPlotStatus === 'built' && state.ownedStands >= 1 && (
                <button
                  type="button"
                  className="gbtn gbtn-red"
                  style={{ flex: 1, padding: '6px 8px', fontSize: 11 }}
                  onClick={actions.divestCurrentStand}
                  title="70% salvage value: Cash +$8.40, Equip -$12, lowers 5% hurdle by -$0.60/day"
                >
                  Divest Stand (+$8.40)
                </button>
              )}
            </div>
          )}
        </div>

        {/* Latest Customer Reviews */}
        <div className="ledger-section">
          <div className="ledger-section-head">
            <span>Customer Reviews</span>
            <span className="game-num" style={{ color: 'var(--accent-gold)' }}>
              ★ {state.ratingAvg.toFixed(1)} ({state.reviews.length})
            </span>
          </div>
          {state.reviews.length === 0 ? (
            <div style={{ fontSize: 11.5, color: 'var(--text-muted)', padding: '4px 0' }}>
              No reviews yet — step behind your counter and serve queued customers!
            </div>
          ) : (
            <div className="review-list">
              {state.reviews
                .slice(-4)
                .reverse()
                .map((rev) => (
                  <div key={rev.id} className="review-item">
                    <div className="review-stars">
                      {'★'.repeat(rev.stars)}
                      {'☆'.repeat(5 - rev.stars)}
                    </div>
                    <div className="review-comment">{rev.comment}</div>
                  </div>
                ))}
            </div>
          )}
        </div>
      </div>
    </motion.aside>
  );
}
