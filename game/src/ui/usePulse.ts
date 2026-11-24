import { useEffect, useRef } from 'react';
import { type AnimationOptions, type AnimationScope, type DOMKeyframesDefinition, useAnimate } from 'motion/react';

/**
 * Play a short keyframe animation on an element every time `trigger` goes UP.
 *
 * This replaces the old trick of putting the trigger in a React `key` (React threw the
 * element away and built a new one just so a CSS animation would restart). Here the SAME
 * element stays mounted and Motion simply plays the keyframes again.
 *
 * `playOnMount`: false skips the very first run (cash already on screen when the stand
 * opens should not pulse); true plays when the element first appears (a combo badge
 * popping in for the first time should pop).
 *
 * Only an INCREASE counts, so resetting the counter to 0 for a new run does not pulse.
 */
export function usePulse<T extends Element>(
  trigger: number,
  keyframes: DOMKeyframesDefinition,
  options: AnimationOptions,
  playOnMount: boolean
): AnimationScope<T> {
  const [scope, animate] = useAnimate<T>();
  // The trigger value we last reacted to; null means "nothing seen yet, play on mount".
  const seen = useRef<number | null>(playOnMount ? null : trigger);

  // Keep the latest keyframes/options without re-running the effect when callers pass new
  // (but equal) object literals each render.
  const latest = useRef({ keyframes, options });
  latest.current = { keyframes, options };

  useEffect(() => {
    const before = seen.current;
    const shouldPlay = before === null || trigger > before;
    seen.current = trigger;
    if (!shouldPlay || !scope.current) return;
    const controls = animate(scope.current, latest.current.keyframes, latest.current.options);
    return () => {
      // Stop a half-played pulse if the trigger fires again or we unmount, so pulses never
      // stack. Restoring `seen` keeps React StrictMode's mount -> cleanup -> mount replay
      // from swallowing the first pulse.
      controls.stop();
      seen.current = before;
    };
  }, [trigger, animate, scope]);

  return scope;
}
