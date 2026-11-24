import { useEffect } from 'react';
import { type MotionValue, useMotionValue, useTransform } from 'motion/react';
import { type GameState, useGameStore } from '../state/gameStore';

/**
 * A number from the game store, exposed as a Motion "motion value".
 *
 * WHY: a normal `useGameStore(selector)` re-renders the component every time the value
 * changes. The brew needle and pour bar change 60 times a second, so that would run
 * React 60 times a second. A motion value is a tiny observable box: when you `set` it,
 * Motion writes the new number straight into the DOM style of any element bound to it,
 * and React is never told. So:
 *
 *   store (rules live here)  --subscribe-->  motion value  --Motion-->  element.style
 *
 * The store stays the single source of truth; Motion never decides anything, it just
 * mirrors a number onto the screen.
 *
 * `select` MUST have a stable identity (declare it at module level): the effect
 * re-subscribes whenever it changes.
 */
export function useStoreMotionValue(select: (s: GameState) => number): MotionValue<number> {
  // Seed with the current value so the very first paint is already correct.
  const value = useMotionValue(select(useGameStore.getState()));

  useEffect(() => {
    // Catch up with anything that changed between render and this effect running.
    value.set(select(useGameStore.getState()));
    // `subscribe(selector, listener)` (zustand subscribeWithSelector) calls us only when
    // the selected number actually changed.
    return useGameStore.subscribe(select, (next) => value.set(next));
  }, [value, select]);

  return value;
}

/**
 * Same as `useStoreMotionValue`, but for a 0..1 fraction shown as a CSS percentage
 * ("37%"), ready to drop into `style={{ left }}` or `style={{ width }}` of a `motion.*`
 * element. `roundTo` rounds to whole percent so the DOM is only touched when the visible
 * value changes (used for progress bars; the needle keeps full precision).
 */
export function useStorePercent(
  select: (s: GameState) => number,
  roundTo: 'none' | 'whole' = 'none'
): MotionValue<string> {
  const fraction = useStoreMotionValue(select);
  return useTransform(fraction, (v) => `${roundTo === 'whole' ? Math.round(v * 100) : v * 100}%`);
}
