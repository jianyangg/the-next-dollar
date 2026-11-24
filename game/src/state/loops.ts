import { selectClockPaused, selectManagerIntervalMs, useGameStore } from './gameStore';

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
 * [Esc] closes the top-most panel or steps out of the stand.
 *
 * Registered ONCE: the handler reads the current state with `getState()` on every key
 * press instead of being rebuilt (and re-registered) whenever a panel opens.
 */
export function handleGameKeyDown(e: KeyboardEvent): void {
  const { actions, ...s } = useGameStore.getState();
  const target = e.target as HTMLElement | null;
  const isTyping =
    target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable;

  if (e.key === 'Escape') {
    actions.handleEscape();
    return;
  }

  if (isTyping || e.metaKey || e.ctrlKey || e.altKey) return;

  const k = e.key.toLowerCase();
  const brewGameActive = s.brewGame !== null;
  if (brewGameActive && s.brewGame?.kind === 'rapid-stir' && s.workingAtStand) {
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
        return;
      }
    }
    if (e.code === 'Space') {
      e.preventDefault();
      actions.stirKey('SPACE');
      return;
    }
  }

  const nothingOverlaying = !s.activeModal && !s.mapOpen && !s.founderModalOpen && !s.eodRecord;
  if (k === 'b') {
    e.preventDefault();
    actions.toggleBooks();
  } else if (k === 'm') {
    e.preventDefault();
    actions.toggleMap();
  } else if (k === 'f' && s.workingAtStand && nothingOverlaying) {
    e.preventDefault();
    if (!brewGameActive) actions.startBrewGame();
  } else if (e.code === 'Space' && s.workingAtStand && nothingOverlaying) {
    e.preventDefault();
    actions.setSpaceHeld(true);
    if (brewGameActive) {
      if (s.brewGame?.kind !== 'keep-in-tube') actions.lockBrewGame();
    } else {
      actions.startServeFrontCustomer();
    }
  }
}

export function handleGameKeyUp(e: KeyboardEvent): void {
  if (e.code === 'Space') useGameStore.getState().actions.setSpaceHeld(false);
}

function startKeyboard(): () => void {
  window.addEventListener('keydown', handleGameKeyDown);
  window.addEventListener('keyup', handleGameKeyUp);
  return () => {
    window.removeEventListener('keydown', handleGameKeyDown);
    window.removeEventListener('keyup', handleGameKeyUp);
  };
}

/** Start every loop and listener; the returned function stops them all. */
export function startGameLoops(): () => void {
  const stops = [startClock(), startManager(), startKeyboard()];
  return () => stops.forEach((stop) => stop());
}
