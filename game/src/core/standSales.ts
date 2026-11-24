import { type ClockSpeed, DAY_SECONDS } from './clock';
import { getConversionProb } from './demand';
import { awarenessWalkerFactor } from './marketing';
import { getNeighborhood } from './neighborhoods';
import { getPlot, isLeasable, type PlotId, plotsIn } from './plots';
import type { SliceState } from './sliceModel';
import { type Tuning, TUNING } from './tuning';

/**
 * STAND SALES: the ONE answer to "how many cups can this stand sell in a day?".
 *
 * WHY THIS FILE EXISTS
 *   The game used to answer that question in two places that disagreed. A stand with a
 *   hired worker sold `walkersPerDay x buy chance` cups (core/awaySales.ts). The stand the
 *   player ran in person got customers from a timer inside the 3D scene (a new buyer
 *   every 2.6 to 4.8 seconds), which worked out to about four times as many. So hiring a
 *   worker and walking away CUT a stand's sales by three quarters: the opposite of what
 *   hiring should feel like.
 *
 *   Now both read the same two numbers:
 *     demand   = buyers per day = walkers per day x the chance a walker buys at this price
 *     capacity = how many cups whoever is at the counter can serve in a day
 *   and a stand sells the smaller of the two.
 *
 * WHO READS WHAT
 *   - core/awaySales.ts (staffed stands): `staffedCupsPerDay`.
 *   - The 3D scene's customer spawner: `liveWalkerGapSeconds` (how long until the next
 *     passer-by decides whether to buy), then rolls `getConversionProb` once per walker.
 *   - The store's pour timer: `pourDurationMs`.
 *   - The balance simulation (core/simulateRun.ts): `liveCupsPerDay`.
 *
 * Everything here is pure: same inputs, same output, no clock, no randomness.
 */

/**
 * How many stands share a crowd with `plotId`: the stands the player has BUILT on leased
 * plots in its district (never less than 1, so a plot being considered counts as the
 * first).
 *
 * A stand BOUGHT from a seller is left out, and is itself never shared (it returns 1):
 * it was already on the street with its own regulars before the player owned it, so
 * buying it adds a stand without splitting anyone's crowd. That is what a purchase
 * offers that a new build cannot.
 */
export function ownStandsInDistrict(plots: SliceState['plots'], plotId: PlotId): number {
  if (!isLeasable(getPlot(plotId))) return 1;
  const built = plotsIn(getPlot(plotId).district).filter((p) => isLeasable(p) && plots[p.id] === 'built').length;
  return Math.max(1, built);
}

/**
 * The share of its own walkers a stand keeps when the player runs `standsInDistrict`
 * stands in the same district: 100% alone, less with two, less again with three.
 * This is the game's "diminishing returns": the second dollar put into a district earns
 * less than the first, so growing means finding NEW places, not stacking one.
 */
export function crowdShare(standsInDistrict: number, t: Tuning = TUNING): number {
  if (standsInDistrict >= 3) return t.crowdShareThreeStands;
  if (standsInDistrict === 2) return t.crowdShareTwoStands;
  return 1;
}

/**
 * Everything about the player's situation that changes a plot's crowd. It is a required
 * argument of every formula below (not an optional one), so no caller can silently
 * leave out the player's other stands or their marketing.
 *   standsInDistrict  stands the player runs in this plot's district (ownStandsInDistrict)
 *   awareness         this district's marketing awareness, 0..1 (core/marketing.ts)
 */
export interface PlotCrowd {
  standsInDistrict: number;
  awareness: number;
}

/**
 * A plot on its own, with no marketing. For a plot the player is only looking at (the
 * lease window's preview) and for tests; a stand the player owns uses `crowdAt`.
 */
export const LONE_PLOT: PlotCrowd = { standsInDistrict: 1, awareness: 0 };

/** The crowd at `plotId` given the player's current stands and marketing. */
export function crowdAt(s: Pick<SliceState, 'plots' | 'awareness'>, plotId: PlotId): PlotCrowd {
  return {
    standsInDistrict: ownStandsInDistrict(s.plots, plotId),
    awareness: s.awareness[getPlot(plotId).district],
  };
}

/**
 * Passers-by who reach this stand in a full day: the plot's own walkers, cut by the
 * share the player's other stands in the district take (crowdShare), raised by the
 * district's marketing awareness (core/marketing.ts awarenessWalkerFactor).
 */
export function walkersPerDay(plotId: PlotId, crowd: PlotCrowd, t: Tuning = TUNING): number {
  return (
    getPlot(plotId).walkersPerDay *
    t.walkerScale *
    crowdShare(crowd.standsInDistrict, t) *
    awarenessWalkerFactor(crowd.awareness, t)
  );
}

/**
 * DEMAND: how many of those walkers want a cup at `price` (expected value, so it can be
 * fractional: 18.7 buyers a day means 18 on most days and 19 on some).
 */
export function buyersPerDay(plotId: PlotId, price: number, crowd: PlotCrowd, t: Tuning = TUNING): number {
  const sensitivity = getNeighborhood(getPlot(plotId).district).priceSensitivity;
  return walkersPerDay(plotId, crowd, t) * getConversionProb(price, sensitivity);
}

/**
 * Cups a stand with a hired worker sells in a full day while the player is elsewhere:
 * its demand, but never more than one worker can pour (`workerCupsPerDay`). A busy
 * plot therefore leaves sales on the table with a single worker.
 */
export function staffedCupsPerDay(plotId: PlotId, price: number, crowd: PlotCrowd, t: Tuning = TUNING): number {
  return Math.min(buyersPerDay(plotId, price, crowd, t), t.workerCupsPerDay);
}

// ---------------------------------------------------------------------------
// The player's own hands
// ---------------------------------------------------------------------------

/**
 * How long the brew step takes per batch and how many cups a batch gives. The four brew
 * mini-games time out after 2.6 to 4 seconds (core/minigames) and the player needs about
 * a second to start one, so 4.5 s is a typical batch; a "good" batch is 4 cups
 * (core/brewing.ts BREW_BATCH_SIZE). ASSUMED typical values, used only to estimate how
 * many cups a person can make; the mini-games themselves are unchanged.
 */
export const TYPICAL_BREW_SECONDS_PER_BATCH = 4.5;
export const TYPICAL_CUPS_PER_BATCH = 4;
/**
 * Seconds between finishing one cup and starting the next (the next customer steps up,
 * the player presses again). ASSUMED; a person cannot chain pours with zero gap.
 */
export const TYPICAL_HANDOFF_SECONDS = 1;

/**
 * How long the player must hold to pour one cup at a stand.
 *
 * Alone, the hold is long: one pair of hands is the bottleneck, customers pile up and
 * some walk off, which is the game's push to hire. With a worker at that stand the hold
 * is short (the worker has the cup and ice ready), so the slow pour stops mattering as
 * soon as the player hires, and is never a 30-day chore.
 */
export function pourDurationMs(workersHere: number, t: Tuning = TUNING): number {
  return workersHere > 0 ? t.pourMsWithWorker : t.pourMsAlone;
}

/**
 * CAPACITY of the player: cups one person can brew and pour in a full day if they never
 * leave the counter. Each cup costs its pour, its share of a brew, and a short handoff.
 */
export function handCupsPerDay(workersHere: number, t: Tuning = TUNING): number {
  const secondsPerCup =
    pourDurationMs(workersHere, t) / 1000 +
    TYPICAL_BREW_SECONDS_PER_BATCH / TYPICAL_CUPS_PER_BATCH +
    TYPICAL_HANDOFF_SECONDS;
  return DAY_SECONDS[1] / secondsPerCup;
}

/** Buyers who come to the stand the player is running in person, per full day. */
export function liveBuyersPerDay(plotId: PlotId, price: number, crowd: PlotCrowd, t: Tuning = TUNING): number {
  return buyersPerDay(plotId, price, crowd, t) * t.liveDemandScale;
}

/**
 * Cups the stand the player runs in person sells in a full day: its demand or what the
 * player's hands can make, whichever is smaller. `focus` (0..1) is the share of the day
 * the player actually spends pouring (the rest goes on brewing breaks already counted in
 * `handCupsPerDay`, shopping, walking); the simulation's bots differ in it.
 */
export function liveCupsPerDay(
  plotId: PlotId,
  price: number,
  opts: { workersHere: number; focus: number; crowd: PlotCrowd },
  t: Tuning = TUNING
): number {
  const focus = Math.max(0, Math.min(1, opts.focus));
  const buyers = liveBuyersPerDay(plotId, price, opts.crowd, t);
  return Math.min(buyers * focus, handCupsPerDay(opts.workersHere, t) * focus);
}

/** Passers-by per full day who reach the stand the player runs in person. */
export function liveWalkersPerDay(plotId: PlotId, crowd: PlotCrowd, t: Tuning = TUNING): number {
  return walkersPerDay(plotId, crowd, t) * t.liveDemandScale;
}

/**
 * FOR THE 3D SCENE'S CUSTOMER SPAWNER: REAL seconds until the next buy-or-pass decision
 * at the live stand becomes owed (core/liveCrowd.ts explains how walkers settle them).
 * A day lasts DAY_SECONDS[speed] real seconds, so over a day that is `walkersPerDay`
 * decisions at either clock speed, and the live stand sees the same `buyersPerDay` on
 * average as a staffed stand would.
 *
 * `roll` is one gameplay random draw in [0, 1); it spreads the gap from 0.6x to 1.4x of
 * the average so arrivals do not tick like a metronome (the mean is exactly the average).
 */
export function walkerGapSeconds(walkersPerDayHere: number, speed: ClockSpeed, roll: number): number {
  // A stand with no walkers has no gap to wait for; callers must not ask (liveCrowd.ts
  // tickGate checks first). Throwing beats quietly pretending there is one walker.
  if (!(walkersPerDayHere > 0)) throw new Error(`walkerGapSeconds: no walkers (${walkersPerDayHere})`);
  return (DAY_SECONDS[speed] / walkersPerDayHere) * (0.6 + 0.8 * roll);
}
