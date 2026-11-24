import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buildRevealSchedule, finalStage, milestones, type RevealStage, stageAt } from './eodReveal';

/**
 * Drives the receipt reveal with one timeout per milestone from the pure schedule.
 *  - `instant` (reduced motion): everything is visible from the first render, no timers.
 *  - `skip()`: cancel the timers and jump to the end (E/Enter during the reveal).
 */
export function useReveal(rowCount: number, instant: boolean) {
  const schedule = useMemo(() => buildRevealSchedule(rowCount), [rowCount]);
  const [stage, setStage] = useState<RevealStage>(() => (instant ? finalStage(schedule) : stageAt(schedule, 0)));
  // After a skip the count-up must jump rather than animate, so the component remounts it.
  const [skipped, setSkipped] = useState(false);
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);

  useEffect(() => {
    if (instant) return;
    timers.current = milestones(schedule).map((t) =>
      // Never move backwards: if the player skipped, `done` is already true and we keep it.
      setTimeout(() => setStage((prev) => (prev.stamped ? prev : stageAt(schedule, t))), t)
    );
    return () => timers.current.forEach(clearTimeout);
  }, [schedule, instant]);

  const skip = useCallback(() => {
    timers.current.forEach(clearTimeout);
    setSkipped(true);
    setStage(finalStage(schedule));
  }, [schedule]);

  return { stage, done: stage.stamped, skipped, skip };
}
