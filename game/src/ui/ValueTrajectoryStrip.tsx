import { useMemo } from 'react';
import { useGameStore } from '../state/gameStore';
import { fmtSignedMoney } from './format';
import './styles/books.css';

/**
 * One thin bar per game day on PAPER: height = how much value that day created, green
 * (gain) when positive and red (cost) when negative. The current day wears an ink outline.
 * Shared by the Books drawer and the end-of-day receipt.
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
    <div className="books-traj" role="img" aria-label={`Value created per day, days 1 to ${maxDays}`}>
      <div className="books-traj-bars">
        {Array.from({ length: maxDays }, (_, i) => {
          const dayNum = i + 1;
          const rec = dayHistory.find((r) => r.day === dayNum);
          const now = dayNum === today ? 'is-now' : '';
          if (!rec) {
            return (
              <div key={dayNum} className={`books-traj-slot ${now}`} title={`Day ${dayNum}`}>
                <div className="books-traj-bar is-empty" />
              </div>
            );
          }
          // At least 14% tall so a tiny day is still a visible stub.
          const hPct = Math.max(14, Math.min(100, Math.round((Math.abs(rec.valueCreated) / trajectoryScaleMax) * 100)));
          const isPos = rec.valueCreated >= 0;
          return (
            <div
              key={dayNum}
              className={`books-traj-slot ${now}`}
              title={`Day ${dayNum}: ${fmtSignedMoney(rec.valueCreated)} value created (Grade ${rec.grade})`}
            >
              <div className={`books-traj-bar ${isPos ? 'is-gain' : 'is-cost'}`} style={{ height: `${hPct}%` }} />
            </div>
          );
        })}
      </div>
      <div className="books-traj-foot pt-num">
        <span>Day 1</span>
        <span>
          {dayHistory.length} / {maxDays} closed
        </span>
        <span>Day {maxDays}</span>
      </div>
    </div>
  );
}
