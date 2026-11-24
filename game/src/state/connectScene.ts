import { cosmeticRandom, gameplayRandom } from '../core/runRandom';
import { CentralParkScene } from '../world/CentralParkScene';
import { publishAnchors } from './anchorStore';
import { selectCurrentPlotStatus, selectStandOpen, useGameStore } from './gameStore';
import { INPUT_PRIORITY, onInputLayerPushed, pushInputLayer } from './input';
import { registerScene } from './sceneBridge';

/** Compare two small arrays element by element (our selectors return fixed-size tuples). */
const sameTuple = <T extends readonly unknown[]>(a: T, b: T): boolean => a.every((v, i) => Object.is(v, b[i]));

/**
 * Build the 3D scene inside `container` and wire it to the stores. Returns a cleanup
 * function that undoes everything (React calls it when the canvas unmounts).
 *
 * WHY SUBSCRIPTIONS INSTEAD OF `useEffect`
 *   The old App pushed state into the scene with one `useEffect` per property
 *   ("when pitchers change, call scene.setPitcherCount"). Each effect lived inside a
 *   component that had to re-render to notice the change, and the scene itself was
 *   rebuilt whenever a callback's identity changed. Here the direction is reversed:
 *     - The scene is created exactly ONCE per mount (the caller's effect has an
 *       empty dependency array), so its seeded random draws happen exactly once.
 *     - `useGameStore.subscribe(selector, listener)` calls `listener` only when the
 *       selected slice of state actually changes, no matter which action changed it,
 *       and with no React render in between.
 *   The scene callbacks below are plain functions created once, and they reach the
 *   current game through `useGameStore.getState()`, so they never go stale.
 */
export function connectScene(container: HTMLElement): () => void {
  const scene = new CentralParkScene(
    container,
    {
      // Stand never auto-serves; sales happen only when the player serves manually.
      onCustomerPurchase: () => {},
      onCustomerWalkout: () => useGameStore.getState().actions.customerWalkout(),
      onTaxiHit: () => useGameStore.getState().actions.taxiHit(),
      onAnchorsUpdate: publishAnchors,
      onInteract: (target) => useGameStore.getState().actions.interact(target),
    },
    { gameplay: gameplayRandom, cosmetic: cosmeticRandom }
  );
  registerScene(scene);

  // The scene is the lowest input layer: keys reach it only if no menu or window
  // above used them. Opening any layer drops held movement keys.
  const removeWorldLayer = pushInputLayer({
    priority: INPUT_PRIORITY.world,
    onKeyDown: scene.handleKeyDown,
    onKeyUp: scene.handleKeyUp,
  });
  const stopReleasing = onInputLayerPushed(() => scene.releaseKeys());

  // Each entry pushes one slice of game state into the scene. `fireImmediately`
  // applies the current value once at connect time, so a freshly built scene
  // matches the game without waiting for the next change.
  const unsubscribers = [
    useGameStore.subscribe((s) => s.founderSpecies, (v) => scene.setPlayerSpecies(v), {
      fireImmediately: true,
    }),

    // Not fired immediately on purpose: `setWorkingAtStand(false)` teleports the
    // player to the stand's front door, but a new scene should start at its own
    // spawn point. The scene starts with "not working", which matches the store.
    useGameStore.subscribe((s) => s.workingAtStand, (v) => scene.setWorkingAtStand(v)),

    useGameStore.subscribe((s) => s.neighborhoodId, (v) => scene.setNeighborhood(v), {
      fireImmediately: true,
    }),

    // Tuple of [district, plot status]: re-applied on a district change even if
    // the status is unchanged (same behaviour as before).
    useGameStore.subscribe(
      (s) => [s.neighborhoodId, selectCurrentPlotStatus(s)] as const,
      ([, status]) => scene.setPlotState(status),
      { equalityFn: sameTuple, fireImmediately: true }
    ),

    useGameStore.subscribe(
      (s) => [s.economy.pitchers, selectStandOpen(s)] as const,
      ([pitchers, open]) => {
        scene.setPitcherCount(pitchers);
        scene.setStandOpen(open);
      },
      { equalityFn: sameTuple, fireImmediately: true }
    ),

    useGameStore.subscribe((s) => s.timeProgress, (v) => scene.setTimeOfDay(v), {
      fireImmediately: true,
    }),
  ];

  return () => {
    // Stop listening BEFORE disposing so no store update can reach a dead scene.
    unsubscribers.forEach((unsubscribe) => unsubscribe());
    removeWorldLayer();
    stopReleasing();
    registerScene(null);
    scene.dispose();
  };
}
