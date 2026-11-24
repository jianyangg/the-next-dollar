import { getRunSeed } from '../core/runRandom';
import { getNeighborhood } from '../core/neighborhoods';
import { getInvestedCapital } from '../core/sliceModel';
import { useGameStore } from '../state/gameStore';
import { getIcons } from './assets';
import { fmtSignedMoney } from './format';
import { ValueTrajectoryStrip } from './ValueTrajectoryStrip';

/**
 * 8:00 PM closing bell: the end-of-day scorecard. The gate subscribes only to the
 * scorecard record (non-null while the modal shows); the body mounts when it exists.
 */
export function EndOfDayModal() {
  const hasRecord = useGameStore((s) => s.eodRecord !== null);
  return hasRecord ? <EndOfDayBody /> : null;
}

function EndOfDayBody() {
  const actions = useGameStore((s) => s.actions);
  const eodRecord = useGameStore((s) => s.eodRecord);
  const maxDays = useGameStore((s) => s.economy.maxDays);
  const investedCap = useGameStore((s) => getInvestedCapital(s.economy));
  const neighborhoodId = useGameStore((s) => s.neighborhoodId);

  const icons = getIcons();
  const neighborhood = getNeighborhood(neighborhoodId);

  // The gate only mounts us when a record exists, but the type system cannot see that.
  if (!eodRecord) return null;

  return (
    <div className="modal-backdrop">
      <div className="modal-shell is-wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <img src={icons.sun} alt="" className="px-icon-lg" />
            <div>
              <div className="modal-kicker">
                8:00 PM Closing Bell · {neighborhood.name} · Day {eodRecord.day} of {maxDays}
              </div>
              <div className="modal-title">Day {eodRecord.day} End-of-Day Scorecard</div>
            </div>
          </div>
          <span className={`eod-grade-badge grade-${eodRecord.grade.toLowerCase()} game-num`}>
            Grade {eodRecord.grade}
          </span>
        </div>

        <div className="modal-body">
          {/* Run seed: lets a playtester report this exact run (replay with ?seed=N). */}
          <div style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'right' }}>
            Run seed {getRunSeed()}
          </div>
          {/* Hero Score & ROIC vs 5% Hurdle */}
          <div className="eod-hero-grid">
            <div className="eod-hero-metric">
              <div className="eod-hero-label">Today&apos;s Value Created (EVA)</div>
              <div className={`eod-hero-val game-num ${eodRecord.valueCreated >= 0 ? 'val-pos' : 'val-neg'}`}>
                {fmtSignedMoney(eodRecord.valueCreated)}
              </div>
            </div>
            <div className="eod-hero-metric">
              <div className="eod-hero-label">Daily ROIC vs. 5% Hurdle</div>
              <div className={`eod-hero-val game-num ${eodRecord.roicPct >= 5 ? 'val-pos' : 'val-amber'}`}>
                {eodRecord.roicPct.toFixed(1)}%
              </div>
            </div>
            <div className="eod-hero-metric">
              <div className="eod-hero-label">Cumulative 30-Day Value</div>
              <div className={`eod-hero-val game-num ${eodRecord.cumulativeValue >= 0 ? 'val-pos' : 'val-neg'}`}>
                {fmtSignedMoney(eodRecord.cumulativeValue)}
              </div>
            </div>
          </div>

          {/* Clean 3-Line Value Bridge */}
          <div className="vendor-card">
            <div className="panel-section-label" style={{ marginBottom: 2 }}>
              <span>Daily Value Bridge ({eodRecord.cupsSold} Cups Sold)</span>
              <span className="game-num">Invested Capital: ${investedCap.toFixed(2)}</span>
            </div>
            <div className="impact-list">
              <div className="impact-line">
                <span>
                  Revenue (${eodRecord.revenue.toFixed(2)}) − COGS (${eodRecord.cogs.toFixed(2)}) − Rent &amp;
                  Wages (${eodRecord.rentAndWages.toFixed(2)})
                </span>
                <span className="game-num">NOPAT {fmtSignedMoney(eodRecord.nopat)}</span>
              </div>
              <div className="impact-line">
                <span>Minus 5% Capital Hurdle Charge</span>
                <span className="game-num val-amber">-${eodRecord.hurdleCharge.toFixed(2)}</span>
              </div>
              <div className="impact-line" style={{ fontWeight: 800, color: 'var(--text-light)' }}>
                <span>Net Value Created (EVA)</span>
                <span className={`game-num ${eodRecord.valueCreated >= 0 ? 'val-pos' : 'val-neg'}`}>
                  {fmtSignedMoney(eodRecord.valueCreated)}
                </span>
              </div>
            </div>
          </div>

          {/* 30-Day Value Trajectory Strip */}
          <div>
            <div className="panel-section-label">
              <span>30-Day Value Created Trajectory</span>
              <span className="game-num">{fmtSignedMoney(eodRecord.cumulativeValue)} Total EVA</span>
            </div>
            <ValueTrajectoryStrip />
          </div>

          <button
            type="button"
            className="gbtn gbtn-gold"
            style={{ padding: '10px 18px', fontSize: 14, alignSelf: 'flex-end' }}
            onClick={actions.startNextDay}
          >
            <span>
              {eodRecord.day >= maxDays ? 'Continue Playing →' : `Start Day ${eodRecord.day + 1} (8:00 AM) →`}
            </span>
          </button>
        </div>
      </div>
    </div>
  );
}
