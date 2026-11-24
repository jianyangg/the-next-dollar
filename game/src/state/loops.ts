import { soundEngine } from '../audio/soundEngine';
import { selectClockPaused, selectManagerIntervalMs, selectMusicHushed, useGameStore } from './gameStore';
import { INPUT_PRIORITY, pushInputLayer, startInputRouter } from './input';

/**
 * The game's background loops, started once from App (`useEffect(() => startGameLoops(), [])`).
 *
 * Each loop is "a timer that exists only while a condition on the store is true".
 * `watchTimer` expresses that directly: it subscribes to ONE derived value (a delay in
 * milliseconds, or null for "off"), and starts, restarts or stops an interval when that
 * value changes. The loop bodies call store actions, which read the latest state with
 * `get()`, so nothing here keeps a copy of game state.
 *
 * (The brew mini-game's animation-frame loop and the 450 ms pour loop are started by the
 * `startBrewGame` / `startServeFrontCustomer` actions themselves, because they begin
 * at a moment the player chooses rather than being tied to a store condition.)
 */

/**
 * Keep `setInterval(run, delay)` alive while `selectDelay(state)` is a number.
 * `run` receives the real seconds since the previous beat.
 */
function watchTimer(selectDelay: (s: ReturnType<typeof useGameStore.getState>) => number | null, run: (dtSeconds: number) => void): () => void {
  let handle: ReturnType<typeof setInterval> | null = null;

  const apply = (delay: number | null): void => {
    if (handle !== null) clearInterval(handle);
    handle = null;
    if (delay === null) return;
    let last = performance.now();
    handle = setInterval(() => {
      const now = performance.now();
      const dt = (now - last) / 1000;
      last = now;
      run(dt);
    }, delay);
  };

  const unsubscribe = useGameStore.subscribe(selectDelay, apply, { fireImmediately: true });
  return () => {
    unsubscribe();
    if (handle !== null) clearInterval(handle);
    handle = null;
  };
}

/**
 * The real-time day clock (8:00 AM to 8:00 PM). Runs every 80 ms unless the game is
 * paused (a panel is open, day 1 has no stand yet, the career is over). Reaching 8:00 PM
 * closes the day inside `tickClock`, which opens the scorecard and pauses the clock.
 * Changing the clock speed does not change the delay, but the speed is read fresh on
 * every tick by the action.
 */
const CLOCK_TICK_MS = 80;

function startClock(): () => void {
  return watchTimer(
    (s) => (selectClockPaused(s) ? null : CLOCK_TICK_MS),
    (dt) => useGameStore.getState().actions.tickClock(dt)
  );
}

/** The hired manager: brews and serves on a steady beat while a built stand is open. */
function startManager(): () => void {
  return watchTimer(selectManagerIntervalMs, () => useGameStore.getState().actions.managerTick());
}

/**
 * Global keyboard shortcuts: [B] Books, [M] NY Map, [F] Brew, [Space] Squeeze/Serve,
 * stir keys during the rapid-stir mini-game, [Esc] closes the top-most panel or steps
 * out of the stand.
 *
 * This is one layer of the input router (state/input.ts), sitting above the scene.
 * It returns true for every key it uses, so the scene never also sees it (e.g. W
 * during rapid-stir stirs instead of walking). Typing in text fields and browser
 * shortcuts are filtered out by the router before any layer runs.
 *
 * It reads the current state with `getState()` on every press instead of being
 * rebuilt whenever a panel opens.
 */
export function handleGameKeyDown(e: KeyboardEvent): boolean {
  const { actions, ...s } = useGameStore.getState();

  if (e.key === 'Escape') {
    actions.handleEscape();
    return true;
  }

  const k = e.key.toLowerCase();
  const brewGameActive = s.brewGame !== null;
  const stirring = s.brewGame?.kind === 'rapid-stir' || s.brewGame?.kind === 'lemonade-brew';
  if (brewGameActive && stirring && s.workingAtStand) {
    const stirKeys: Array<[boolean, 'W' | 'A' | 'S' | 'D']> = [
      [k === 'w' || e.key === 'ArrowUp', 'W'],
      [k === 'a' || e.key === 'ArrowLeft', 'A'],
      [k === 's' || e.key === 'ArrowDown', 'S'],
      [k === 'd' || e.key === 'ArrowRight', 'D'],
    ];
    for (const [pressed, key] of stirKeys) {
      if (pressed) {
        e.preventDefault();
        actions.stirKey(key);
        return true;
      }
    }
    // Rapid-stir uses Space as one of its keys. The lemonade brew does not: there Space
    // is the hold (squeeze, pour sugar), handled by the Space branch below.
    if (e.code === 'Space' && s.brewGame?.kind === 'rapid-stir') {
      e.preventDefault();
      actions.stirKey('SPACE');
      return true;
    }
  }

  const nothingOverlaying =
    !s.activeModal && !s.mapOpen && !s.founderModalOpen && !s.eodRecord && !s.introOpen && !s.travel && !s.runOver;
  if (k === 'b') {
    e.preventDefault();
    actions.toggleBooks();
    return true;
  }
  if (k === 'm') {
    e.preventDefault();
    actions.toggleMap();
    return true;
  }
  if (k === 'f' && s.workingAtStand && nothingOverlaying) {
    e.preventDefault();
    if (!brewGameActive) actions.startBrewGame();
    return true;
  }
  if (e.code === 'Space' && s.workingAtStand && nothingOverlaying) {
    e.preventDefault();
    // A held key repeats key-down events. Serving is one cup per PRESS, so repeats must
    // not start the next pour on their own.
    if (e.repeat && !brewGameActive) return true;
    actions.setSpaceHeld(true);
    if (brewGameActive) {
      if (s.brewGame?.kind !== 'keep-in-tube') actions.lockBrewGame();
    } else {
      actions.startServeFrontCustomer();
    }
    return true;
  }
  return false;
}

export function handleGameKeyUp(e: KeyboardEvent): void {
  if (e.code === 'Space') useGameStore.getState().actions.setSpaceHeld(false);
}

/** Start the single window key listener and put the shortcut layer on it. */
function startKeyboard(): () => void {
  const stopRouter = startInputRouter();
  const removeLayer = pushInputLayer({
    priority: INPUT_PRIORITY.shortcuts,
    onKeyDown: handleGameKeyDown,
    onKeyUp: handleGameKeyUp,
  });
  // If the window loses focus while Space is down, the key-up goes to another app and
  // never reaches us; without this the game would think Space is held forever (and the
  // hold-to-serve chain would keep pouring). Losing focus = letting go.
  const releaseHeld = (): void => useGameStore.getState().actions.setSpaceHeld(false);
  window.addEventListener('blur', releaseHeld);
  return () => {
    window.removeEventListener('blur', releaseHeld);
    removeLayer();
    stopRouter();
  };
}

/** Start every loop and listener; the returned function stops them all. */
/**
 * Keep the music in step with the screen: hushed while play is stopped (see
 * selectMusicHushed). Driven by a store subscription rather than calls inside each
 * action, so every way into or out of those screens (closing a day, Next Day, ending
 * the run, a new run, dev tools) is covered without anyone remembering to call it.
 */
function startMusicMood(): () => void {
  return useGameStore.subscribe(selectMusicHushed, (hushed) => soundEngine.setMusicHushed(hushed), {
    fireImmediately: true,
  });
}

export function startGameLoops(): () => void {
  const stops = [startClock(), startManager(), startKeyboard(), startMusicMood()];
  return () => stops.forEach((stop) => stop());
}
