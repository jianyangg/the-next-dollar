/**
 * Handles for the timers and animation-frame loops the game store starts.
 *
 * A timer handle is not "state": it cannot be saved, nothing renders from it, and
 * putting it in the store would make every subscriber wake up for no reason. But it
 * must live SOMEWHERE shared so that (a) actions can cancel a running loop
 * (stepping out of the stand cancels the brew loop) and (b) `resetGameStore()` can
 * cancel everything, so a stale timer from a previous run can never write into a
 * fresh store. This small leaf module (it imports nothing) is that place.
 */

/** requestAnimationFrame id of the running brew mini-game loop, or null when idle. */
let brewFrame: number | null = null;
/** requestAnimationFrame id of the running 450 ms pour animation, or null when idle. */
let serveFrame: number | null = null;
/** One-shot setTimeout handles (toast/pop expiry, stir-shake) that have not fired yet. */
const pendingTimeouts = new Set<ReturnType<typeof setTimeout>>();

export const getBrewFrame = (): number | null => brewFrame;
export const setBrewFrame = (id: number | null): void => {
  brewFrame = id;
};
export const getServeFrame = (): number | null => serveFrame;
export const setServeFrame = (id: number | null): void => {
  serveFrame = id;
};

/** Cancel the brew loop if it is running. Returns true when something was cancelled. */
export function cancelBrewLoop(): boolean {
  if (brewFrame === null) return false;
  cancelAnimationFrame(brewFrame);
  brewFrame = null;
  return true;
}

/** Cancel the pour loop if it is running. Returns true when something was cancelled. */
export function cancelServeLoop(): boolean {
  if (serveFrame === null) return false;
  cancelAnimationFrame(serveFrame);
  serveFrame = null;
  return true;
}

/** setTimeout that remembers its handle so `cancelAllTimers` can clear it. */
export function scheduleTimeout(fn: () => void, ms: number): void {
  const handle = setTimeout(() => {
    pendingTimeouts.delete(handle);
    fn();
  }, ms);
  pendingTimeouts.add(handle);
}

/** Stop every loop and pending timeout (used by `resetGameStore` and tests). */
export function cancelAllTimers(): void {
  cancelBrewLoop();
  cancelServeLoop();
  for (const handle of pendingTimeouts) clearTimeout(handle);
  pendingTimeouts.clear();
}
