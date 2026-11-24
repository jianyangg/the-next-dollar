import type { Transition } from 'motion/react';

/**
 * Shared Motion presets for the UI.
 *
 * RULE: Motion only animates how things LOOK (opacity, position, scale). It never decides
 * a game outcome; every rule still lives in `state/` and `core/`. Keeping the numbers in
 * one file means every modal enters/leaves with the same "feel".
 */

/** "Ease-out quint": fast start, long gentle landing. Good for things arriving on screen. */
export const EASE_OUT: [number, number, number, number] = [0.22, 1, 0.36, 1];
/** "Ease-in": slow start, quick finish. Good for things leaving, so they get out of the way. */
export const EASE_IN: [number, number, number, number] = [0.4, 0, 1, 1];

/** Dimmed backdrop behind a modal: simple fade, a touch faster out than in. */
export const backdropMotion = {
  initial: { opacity: 0 },
  animate: { opacity: 1, transition: { duration: 0.14, ease: EASE_OUT } as Transition },
  // pointerEvents:'none' stops a second click landing on a modal that is already leaving.
  exit: { opacity: 0, pointerEvents: 'none' as const, transition: { duration: 0.12, ease: EASE_IN } as Transition },
};

/** The modal card: rises 8px and scales up 2% on the way in, reverses on the way out. */
export const modalShellMotion = {
  initial: { opacity: 0, y: 8, scale: 0.98 },
  animate: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.18, ease: EASE_OUT } as Transition },
  exit: { opacity: 0, y: 6, scale: 0.98, transition: { duration: 0.12, ease: EASE_IN } as Transition },
};

/** The books drawer slides in from the right edge (it is docked to the right). */
export const drawerMotion = {
  initial: { opacity: 0, x: 24 },
  animate: { opacity: 1, x: 0, transition: { duration: 0.2, ease: EASE_OUT } as Transition },
  exit: { opacity: 0, x: 24, pointerEvents: 'none' as const, transition: { duration: 0.14, ease: EASE_IN } as Transition },
};
