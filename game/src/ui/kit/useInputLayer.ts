import { useIsPresent } from 'motion/react';
import { useEffect, useRef } from 'react';
import { type InputLayerOptions, pushInputLayer } from '../../state/input';

/**
 * Put an input layer on the router while `active` is true (see state/input.ts).
 *
 * The handler is read through a ref, so a component can pass a fresh arrow function
 * every render without the layer being removed and re-pushed (which would also
 * reorder it and release held keys each render).
 *
 * A component inside <AnimatePresence> stays mounted while its exit animation plays.
 * `useIsPresent()` turns false at the START of that exit, so the layer is removed the
 * moment the window starts closing, not when it finishes. Outside AnimatePresence it is
 * always true.
 */
export function useInputLayer(
  onKeyDown: (e: KeyboardEvent) => boolean,
  { active = true, blocking = false, passKeys, priority }: Omit<InputLayerOptions, 'onKeyDown'> & { active?: boolean }
): void {
  const handlerRef = useRef(onKeyDown);
  handlerRef.current = onKeyDown;
  const passKeysKey = passKeys?.join('\u0000');
  const present = useIsPresent();
  const live = active && present;

  useEffect(() => {
    if (!live) return;
    return pushInputLayer({
      onKeyDown: (e) => handlerRef.current(e),
      blocking,
      passKeys: passKeysKey === undefined ? undefined : passKeysKey.split('\u0000'),
      priority,
    });
  }, [live, blocking, passKeysKey, priority]);
}
