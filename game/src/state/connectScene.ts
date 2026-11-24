import { lemonCupsLeft } from '../core/brewing';
import { cosmeticRandom, gameplayRandom } from '../core/runRandom';
import { getConversionProb } from '../core/demand';
import { getNeighborhood } from '../core/neighborhoods';
import { crowdAt, liveWalkersPerDay } from '../core/standSales';
import { CentralParkScene } from '../world/CentralParkScene';
import { publishAnchors } from './anchorStore';
import {
  selectDistrictPlots,
  selectDistrictPlotsKey,
  selectLivePlotId,
  selectSellerPresent,
  selectClockPaused,
  selectEffectiveClockSpeed,
  selectStandOpen,
  useGameStore,
} from './gameStore';
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
 *   ("when the stock changes, call scene.setTableStock"). Each effect lived inside a
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
      // `plotId` names which plot for 'own-stand' / 'plot-lease' (a district has several).
      onInteract: (target, plotId) => useGameStore.getState().actions.interact(target, plotId),
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

    // ORDER MATTERS in this block. Zustand calls listeners in the order they subscribed,
    // and one store update (say, a subway ride or "enter stand at the side plot") can
    // change several of these at once. Each step relies on the one before it:
    //   1. the district (the scene drops the old street's plots),
    //   2. that district's plots (what is drawn, what blocks, what you can press E on),
    //   3. the live plot (needs 2: it must be one of this street's built plots),
    //   4. the seller,
    //   5. working at the stand (needs 3: the player sits behind the LIVE counter).
    useGameStore.subscribe((s) => s.neighborhoodId, (v) => scene.setNeighborhood(v), {
      fireImmediately: true,
    }),

    // The plot list is a fresh array on every read, so we subscribe to its KEY (a string
    // that changes only when something visible changed) and read the list itself then.
    // Re-applied on a district change even if the key happened to match.
    useGameStore.subscribe(
      (s) => [s.neighborhoodId, selectDistrictPlotsKey(s)] as const,
      () => scene.setDistrictPlots(selectDistrictPlots(useGameStore.getState())),
      { equalityFn: sameTuple, fireImmediately: true }
    ),

    // The live plot.
    useGameStore.subscribe(
      (s) => [s.neighborhoodId, selectLivePlotId(s)] as const,
      ([, id]) => scene.setLivePlot(id),
      { equalityFn: sameTuple, fireImmediately: true }
    ),

    // How many passers-by reach the live stand a day: the ONE sales formula
    // (core/standSales.ts liveWalkersPerDay: the plot's walkers, shared between the
    // player's stands in the district, lifted by marketing awareness), plus the clock
    // speed. Sent even when it is 0 (no stand of the player's here): the scene then
    // shrinks back to its quiet crowd and still strolls at the clock's speed, instead of
    // keeping the last district's crowd and speed.
    useGameStore.subscribe(
      (s) => {
        const id = selectLivePlotId(s);
        return [id === null ? 0 : liveWalkersPerDay(id, crowdAt(s.economy, id)), selectEffectiveClockSpeed(s)] as const;
      },
      ([walkers, speed]) => scene.setLiveDemand(walkers, speed),
      { equalityFn: sameTuple, fireImmediately: true }
    ),

    useGameStore.subscribe(selectSellerPresent, (v) => scene.setSellerPresent(v), { fireImmediately: true }),

    // Not fired immediately on purpose: `setWorkingAtStand(false)` steps the player out
    // in front of the counter, but a new scene should start at its own spawn point. The
    // scene starts with "not working", which matches the store.
    useGameStore.subscribe((s) => s.workingAtStand, (v) => scene.setWorkingAtStand(v)),

    useGameStore.subscribe(selectStandOpen, (open) => scene.setStandOpen(open), { fireImmediately: true }),

    // While a window pauses the day clock, no customer decisions are owed (core/liveCrowd.ts).
    useGameStore.subscribe(selectClockPaused, (paused) => scene.setClockRunning(!paused), { fireImmediately: true }),

    // Stock on the live stand's counter: the two piles the HUD stock card shows, ready
    // cups (brewed, waiting to be sold) and lemons left (not brewed yet). Pitchers owned
    // are equipment, not stock, so they are not drawn on the counter (see setTableStock).
    useGameStore.subscribe(
      (s) => [s.brewedCups, lemonCupsLeft(s.economy.cupsInStock, s.brewedCups)] as const,
      ([readyCups, lemons]) => scene.setTableStock({ readyCups, lemons }),
      { equalityFn: sameTuple, fireImmediately: true }
    ),

    useGameStore.subscribe((s) => s.timeProgress, (v) => scene.setTimeOfDay(v), {
      fireImmediately: true,
    }),

    // Price -> demand: the same chance the price menu shows (core/demand.ts).
    useGameStore.subscribe(
      (s) => getConversionProb(s.economy.pricePerCup, getNeighborhood(s.neighborhoodId).priceSensitivity),
      (chance) => scene.setBuyChance(chance),
      { fireImmediately: true }
    ),
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
