import { DAY_SECONDS } from './clock';
import { getConversionProb } from './demand';
import { getNeighborhood } from './neighborhoods';
import { getPlot, isLeasable, type PlotId, plotsIn } from './plots';
import type { PlotStatus } from './sliceModel';
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
export function ownStandsInDistrict(plots: Readonly<Record<PlotId, PlotStatus>>, plotId: PlotId): number {
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
 * Passers-by who reach this stand in a full day. `standsInDistrict` is how many stands
 * the player runs in this plot's district (see `ownStandsInDistrict`); leave it out for
 * a plot on its own.
 */
export function walkersPerDay(plotId: PlotId, t: Tuning = TUNING, standsInDistrict = 1): number {
  return getPlot(plotId).walkersPerDay * t.walkerScale * crowdShare(standsInDistrict, t);
}

/**
 * DEMAND: how many of those walkers want a cup at `price` (expected value, so it can be
 * fractional: 18.7 buyers a day means 18 on most days and 19 on some).
 */
export function buyersPerDay(plotId: PlotId, price: number, t: Tuning = TUNING, standsInDistrict = 1): number {
  const sensitivity = getNeighborhood(getPlot(plotId).district).priceSensitivity;
  return walkersPerDay(plotId, t, standsInDistrict) * getConversionProb(price, sensitivity);
}

/**
 * Cups a stand with a hired worker sells in a full day while the player is elsewhere:
 * its demand, but never more than one worker can pour (`workerCupsPerDay`). A busy
 * plot therefore leaves sales on the table with a single worker.
 */
export function staffedCupsPerDay(plotId: PlotId, price: number, t: Tuning = TUNING, standsInDistrict = 1): number {
  return Math.min(buyersPerDay(plotId, price, t, standsInDistrict), t.workerCupsPerDay);
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
export function liveBuyersPerDay(plotId: PlotId, price: number, t: Tuning = TUNING, standsInDistrict = 1): number {
  return buyersPerDay(plotId, price, t, standsInDistrict) * t.liveDemandScale;
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
  opts: { workersHere: number; focus: number; standsInDistrict?: number },
  t: Tuning = TUNING
): number {
  const focus = Math.max(0, Math.min(1, opts.focus));
  const buyers = liveBuyersPerDay(plotId, price, t, opts.standsInDistrict ?? 1);
  return Math.min(buyers * focus, handCupsPerDay(opts.workersHere, t) * focus);
}

/**
 * FOR THE 3D SCENE'S CUSTOMER SPAWNER: seconds of DAY-CLOCK time (at 1x speed) until the
 * next passer-by reaches the live stand and decides whether to buy.
 *
 * The scene should, each time this gap runs out and a walker is in reach, make ONE
 * buy-or-pass roll against `getConversionProb(price, sensitivity)` and then start a new
 * gap whether the walker bought or passed. Over a day that is `walkersPerDay` decisions,
 * so the live stand sees exactly `buyersPerDay` buyers on average: the same number a
 * staffed stand uses.
 *
 * `roll` is one gameplay random draw in [0, 1); it spreads the gap from 0.6x to 1.4x of
 * the average so arrivals do not tick like a metronome (the mean stays exactly the
 * average). At 2x clock speed divide the result by 2, so a faster day is not a poorer one.
 */
export function liveWalkerGapSeconds(plotId: PlotId, roll: number, standsInDistrict = 1, t: Tuning = TUNING): number {
  const walkers = Math.max(1, walkersPerDay(plotId, t, standsInDistrict) * t.liveDemandScale);
  return (DAY_SECONDS[1] / walkers) * (0.6 + 0.8 * roll);
}
