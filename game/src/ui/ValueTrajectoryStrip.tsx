import { useMemo } from 'react';
import { useGameStore } from '../state/gameStore';
import { fmtSignedMoney } from './format';

/**
 * One thin bar per game day, height = how much value (EVA) that day created, green when
 * positive and red when negative. Shared by the Books drawer and the end-of-day scorecard.
 */
export function ValueTrajectoryStrip() {
  const dayHistory = useGameStore((s) => s.economy.dayHistory);
  const maxDays = useGameStore((s) => s.economy.maxDays);
  const today = useGameStore((s) => s.economy.day);

  // The tallest bar sets the scale for all of them (at least 4, so tiny days stay small).
  const trajectoryScaleMax = useMemo(() => {
    let maxAbs = 4;
    for (const r of dayHistory) {
      maxAbs = Math.max(maxAbs, Math.abs(r.valueCreated));
    }
    return maxAbs;
  }, [dayHistory]);

  return (
    <div className="trajectory-strip" aria-label="30-Day Value Trajectory">
      <div className="trajectory-bars">
        {Array.from({ length: maxDays }, (_, i) => {
          const dayNum = i + 1;
          const rec = dayHistory.find((r) => r.day === dayNum);
          if (!rec) {
            return (
              <div key={dayNum} className={`traj-slot ${dayNum === today ? 'is-today' : ''}`} title={`Day ${dayNum}`}>
                <div className="traj-bar is-empty" />
              </div>
            );
          }
          const hPct = Math.max(14, Math.min(100, Math.round((Math.abs(rec.valueCreated) / trajectoryScaleMax) * 100)));
          const isPos = rec.valueCreated >= 0;
          return (
            <div
              key={dayNum}
              className="traj-slot"
              title={`Day ${dayNum}: ${fmtSignedMoney(rec.valueCreated)} EVA (Grade ${rec.grade})`}
            >
              <div className={`traj-bar ${isPos ? 'is-pos' : 'is-neg'}`} style={{ height: `${hPct}%` }} />
            </div>
          );
        })}
      </div>
      <div className="trajectory-foot game-num">
        <span>Day 1</span>
        <span>
          {dayHistory.length} / {maxDays} Days Closed
        </span>
        <span>Day {maxDays}</span>
      </div>
    </div>
  );
}
