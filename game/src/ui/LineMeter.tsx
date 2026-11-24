import { countOwnedStands } from '../core/sliceModel';
import { useAnimate } from 'motion/react';
import { useEffect, useRef } from 'react';
import { projectDay } from '../core/dayEnd';
import { useGameStore } from '../state/gameStore';
import { fmtSignedMoney } from './format';

/**
 * TODAY VS THE LINE, live in the HUD: the day's one goal, always on screen.
 *
 *   [=====earned=====|////line////|          ]   +$4.20
 *
 * - The fill is what today has earned so far (cups sold: revenue minus lemons).
 * - The hazard-striped marker is THE LINE: rent + wages + today's marketing + Grandma's
 *   15% on the money the day started with (core/dayEnd.ts projectDay).
 * - The number is today's value created so far = earned - line. Red while below the
 *   line, green once past it. It is exactly what the receipt will say if the bell rang
 *   now (core/dayEnd.ts `projectDay` is the single formula for both).
 *
 * The bar's scale is max(2 x line, earned x 1.1): the marker starts in the middle, so
 * the player sees the gap to close; once far past it, the marker slides left, showing
 * how far the day has run beyond it.
 *
 * Re-renders: subscribes to three plain numbers, so it redraws on a sale or a purchase,
 * never per frame.
 */
export function LineMeter() {
  const earned = useGameStore((s) => projectDay(s.economy).earned);
  const line = useGameStore((s) => projectDay(s.economy).line);
  const hasStand = useGameStore((s) => countOwnedStands(s.economy) >= 1);
  const value = +(earned - line).toFixed(2);
  const beating = value >= 0;

  // A short pop when the day crosses the line (the store plays the sound and the note).
  const [scope, animate] = useAnimate<HTMLDivElement>();
  const wasBeating = useRef(beating);
  useEffect(() => {
    if (beating && !wasBeating.current && scope.current) {
      void animate(scope.current, { scale: [1, 1.12, 1] }, { duration: 0.32, times: [0, 0.4, 1] });
    }
    wasBeating.current = beating;
  }, [beating, animate, scope]);

  // Before the first stand there is no line to beat yet: the tutorial goal leads instead.
  if (!hasStand) return null;

  const scale = Math.max(line * 2, earned * 1.1, 1);
  const fillPct = Math.min(100, (Math.max(0, earned) / scale) * 100);
  const linePct = Math.min(100, (line / scale) * 100);

  return (
    <div
      ref={scope}
      className="hud-line"
      role="meter"
      aria-label={`Today versus the line: ${fmtSignedMoney(value)}`}
      aria-valuemin={0}
      aria-valuemax={scale}
      aria-valuenow={earned}
    >
      <span className="hud-line-label">Today</span>
      <div className="hud-line-track">
        <div className={`hud-line-fill ${beating ? 'is-gain' : 'is-cost'}`} style={{ width: `${fillPct}%` }} />
        <div className="hud-line-mark pt-line-fill" style={{ left: `${linePct}%` }} />
      </div>
      <span className={`pt-num hud-line-num ${beating ? 'pt-gain-sign' : 'pt-cost-sign'}`}>{fmtSignedMoney(value)}</span>
    </div>
  );
}
