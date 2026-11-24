import { cents } from '../core/money';
import { ringOpeningBell } from '../core/dayEnd';
import { plotsIn } from '../core/plots';
import * as Purchases from '../core/purchases';
import { getRunSeed } from '../core/runRandom';
import { countOwnedStands, STALL_KIT_COST, type SliceState } from '../core/sliceModel';
import { selectClockPaused, useGameStore } from '../state/gameStore';

/**
 * Developer "cheats": shortcuts that put the game into a state a tester wants to look at
 * without playing for ten minutes first. The DevPanel buttons call these functions; each
 * one is also unit-tested against the real store.
 *
 * DESIGN RULES
 *   1. Never invent state by hand when a real rule exists. Buying goes through the pure
 *      rules in core/purchases.ts, so a pitcher always adds exactly $10 of equipment,
 *      a crate always adds $5 of inventory and 10 cups, and so on. The cheat only
 *      "pays" first by adding the price to cash, then lets the real rule take it back.
 *      Net effect: the item appears, cash is unchanged, and the books stay internally
 *      consistent (the same numbers a real purchase would have produced).
 *   2. A cheat that cannot run returns `{ ok: false, reason }` instead of silently doing
 *      something else (no fallback behaviour). Bad input (day 99) is the caller's bug
 *      and throws.
 *   3. Every cheat logs one line, `console.info('[dev]', name, details)`, so a bug seen
 *      in dev mode can be traced back to the cheat that set the scene.
 *
 * WHY NOT NEW STORE ACTIONS? The store is owned elsewhere. These helpers use only
 * `useGameStore.setState` and the existing `actions`, so no store file changes.
 */

export type DevResult = { ok: true } | { ok: false; reason: string };

const OK: DevResult = { ok: true };
const refuse = (name: string, reason: string): DevResult => {
  console.info('[dev]', name, { refused: reason });
  return { ok: false, reason };
};

const store = () => useGameStore.getState();

/**
 * Replace the economy with `next` (the store's own `commitEconomy` is private, so this
 * mirrors the one thing it does that matters here: cups already brewed can never exceed
 * the cups in stock).
 */
function commitEconomy(name: string, next: SliceState): void {
  const brewedCups = Math.min(store().brewedCups, next.cupsInStock);
  useGameStore.setState({ economy: next, brewedCups }, false, `dev:${name}`);
}

/**
 * Give the player exactly `price` more cash, then run a real purchase rule that spends
 * it. If the rule refuses even with enough cash that is a programming error, so throw.
 */
function fundedPurchase(s: SliceState, price: number, rule: (s: SliceState) => Purchases.PurchaseResult): SliceState {
  const result = rule({ ...s, cash: cents(s.cash + price) });
  if (!result.ok) throw new Error(`[dev] purchase refused despite funding: ${result.reason}`);
  return result.state;
}

// ---------------------------------------------------------------------------
// Money and stock
// ---------------------------------------------------------------------------

export const DEV_CASH_BONUS = 100;

/** Cash +$100. Cash alone changes; no other account moves. */
export function addCash(): DevResult {
  const s = store().economy;
  commitEconomy('addCash', { ...s, cash: cents(s.cash + DEV_CASH_BONUS) });
  console.info('[dev]', 'addCash', { amount: DEV_CASH_BONUS, cash: store().economy.cash });
  return OK;
}

/** Cash = $0, to test the "cannot afford" paths. */
export function zeroCash(): DevResult {
  const s = store().economy;
  commitEconomy('zeroCash', { ...s, cash: 0 });
  console.info('[dev]', 'zeroCash', { was: s.cash });
  return OK;
}

/** +10 cups of lemons: one real crate ($5 -> inventoryValue +$5, cupsInStock +10 = $0.50/cup). */
export function addLemons(): DevResult {
  const s = store().economy;
  const next = fundedPurchase(s, Purchases.LEMON_CRATE_COST, Purchases.buyLemons);
  commitEconomy('addLemons', next);
  console.info('[dev]', 'addLemons', { cups: Purchases.LEMON_CRATE_CUPS, cupsInStock: next.cupsInStock, inventoryValue: next.inventoryValue });
  return OK;
}

/** +1 pitcher via the real rule (equipmentValue +$10). */
export function addPitcher(): DevResult {
  const s = store().economy;
  const next = fundedPurchase(s, Purchases.PITCHER_COST, Purchases.buyPitcher);
  commitEconomy('addPitcher', next);
  console.info('[dev]', 'addPitcher', { pitchers: next.pitchers, equipmentValue: next.equipmentValue });
  return OK;
}

/** +1 stall kit via the real rule (equipmentValue +$12). */
export function addStallKit(): DevResult {
  const s = store().economy;
  const next = fundedPurchase(s, STALL_KIT_COST, Purchases.buyStallKit);
  commitEconomy('addStallKit', next);
  console.info('[dev]', 'addStallKit', { stallKits: next.stallKits, equipmentValue: next.equipmentValue });
  return OK;
}

// ---------------------------------------------------------------------------
// Time
// ---------------------------------------------------------------------------

/**
 * Skip to 8 PM by setting the clock to the end of the day and running the store's own
 * `closeDay` action, i.e. exactly what happens when the clock runs out. The scorecard
 * opens and the books are closed by core/dayEnd.ts. Refused when the career is over or
 * the scorecard is already showing (closing twice would book the day twice).
 */
export function skipToEvening(): DevResult {
  const { economy, eodRecord } = store();
  if (economy.day > economy.maxDays) return refuse('skipToEvening', 'career-over');
  if (eodRecord !== null) return refuse('skipToEvening', 'day-already-closed');
  useGameStore.setState({ timeProgress: 1 }, false, 'dev:skipToEvening');
  store().actions.closeDay();
  console.info('[dev]', 'skipToEvening', { day: economy.day });
  return OK;
}

/**
 * Jump to the morning of day `day` (1..maxDays). Only the day counter and the per-day
 * accumulators (cups sold today, revenue today...) are reset, so today's income
 * statement starts clean, and the opening bell rings (core/dayEnd.ts `ringOpeningBell`)
 * so the new day's line is charged on what the player has now. Career totals and history are left alone: they are what the
 * player earned so far, we only moved the calendar.
 */
export function jumpToDay(day: number): DevResult {
  const s = store().economy;
  if (!Number.isInteger(day) || day < 1 || day > s.maxDays) {
    throw new RangeError(`[dev] jumpToDay: day must be a whole number 1..${s.maxDays}, got ${day}`);
  }
  const next: SliceState = ringOpeningBell({ ...s, day, dayCupsSold: 0, dayRevenue: 0, dayCogs: 0, dayRentPaid: 0 });
  useGameStore.setState({ timeProgress: 0, eodRecord: null }, false, 'dev:jumpToDay');
  commitEconomy('jumpToDay', next);
  console.info('[dev]', 'jumpToDay', { from: s.day, to: day });
  return OK;
}

/**
 * CLOCK SPEED
 * The store only knows 1x and 2x, and the clock loop (state/loops.ts) calls
 * `getState().actions.tickClock(dt)` on every beat, looking the action up fresh each time.
 * We use that: swap `tickClock` for a wrapper.
 *   - 'x10'    : the wrapper calls the real tickClock 10 times per beat. Not one call with
 *                10x the time, because the real action caps each call's time (so a hidden
 *                browser tab cannot skip the day). After each call it stops if the day
 *                closed, otherwise the 8 PM bell would ring ten times.
 *   - 'paused' : the wrapper does nothing, so the clock freezes.
 *   - 'normal' : the real action is put back.
 */
export type DevClockMode = 'normal' | 'x10' | 'paused';

const X10_CALLS_PER_BEAT = 10;
let realTickClock: ((dt: number) => void) | null = null;
let clockMode: DevClockMode = 'normal';

export function getDevClockMode(): DevClockMode {
  return clockMode;
}

export function setDevClockMode(mode: DevClockMode): DevResult {
  const actions = store().actions;
  // Remember the genuine action the first time we wrap it, never a wrapper of ours.
  realTickClock ??= actions.tickClock;
  const real = realTickClock;

  let tickClock: (dt: number) => void;
  if (mode === 'normal') {
    tickClock = real;
  } else if (mode === 'paused') {
    tickClock = () => {};
  } else {
    tickClock = (dt) => {
      for (let i = 0; i < X10_CALLS_PER_BEAT; i++) {
        real(dt);
        if (selectClockPaused(store())) break; // the day closed (or a panel opened)
      }
    };
  }
  useGameStore.setState({ actions: { ...actions, tickClock } }, false, 'dev:setClockMode');
  clockMode = mode;
  console.info('[dev]', 'setClockMode', { mode });
  return OK;
}

/** Tests only: put the real clock action back and forget the mode. */
export function resetDevClockForTests(): void {
  if (realTickClock) useGameStore.setState({ actions: { ...store().actions, tickClock: realTickClock } }, false, 'dev:resetClock');
  realTickClock = null;
  clockMode = 'normal';
}

// ---------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------

/** Finish the tutorial using the store's own action. */
export function skipTutorial(): DevResult {
  store().actions.skipTutorial();
  console.info('[dev]', 'skipTutorial', {});
  return OK;
}

/**
 * Make the seller deal "unplayed" again by resetting the store fields that remember it:
 * `economy.dealStatus` back to 'open', `economy.dealBidPrice` cleared, the render view
 * `deal` cleared, and the seller window closed.
 *
 * The deal's state machine lives in a private store variable, so the store's own
 * `resetDealForDev` action stops it; the next visit to the seller builds a fresh one.
 *
 * LIMITATION: the seller SERVER remembers a closed deal for this run (a permanent close
 * marker keyed by run id). After a won/rejected/walked-away deal, use "Restart, same
 * seed" instead, which starts a new run id.
 */
export function resetSellerDeal(): DevResult {
  const s = store().economy;
  commitEconomy('resetSellerDeal', { ...s, dealStatus: 'open', dealBidPrice: null });
  if (store().activeModal === 'seller-stand') useGameStore.setState({ activeModal: null }, false, 'dev:closeSeller');
  store().actions.resetDealForDev();
  console.info('[dev]', 'resetSellerDeal', { was: s.dealStatus });
  return OK;
}

/**
 * Build a stand on the plot the player stands on, using the real rules in order:
 * lease (if empty) -> stall kit (paid for, only if none in stock) -> build.
 * Refused in the market (no plots) and when a stand is already there.
 */
export function buildStandHere(): DevResult {
  const district = store().neighborhoodId;
  // The district's corner plot (the market has none): the one a new player builds first.
  const plotId = plotsIn(district).find((p) => p.kind === 'corner')?.id;
  if (!plotId) return refuse('buildStandHere', 'no-plot-here');
  let s = store().economy;
  if (s.plots[plotId] === 'built') return refuse('buildStandHere', 'already-built');

  if (s.plots[plotId] === 'empty') {
    const leased = Purchases.signLease(s, plotId);
    if (!leased.ok) return refuse('buildStandHere', leased.reason);
    s = leased.state;
  }
  if (s.stallKits < 1) s = fundedPurchase(s, STALL_KIT_COST, Purchases.buyStallKit);
  const built = Purchases.buildStand(s, plotId);
  if (!built.ok) return refuse('buildStandHere', built.reason);
  commitEconomy('buildStandHere', built.state);
  console.info('[dev]', 'buildStandHere', { plotId, ownedStands: countOwnedStands(built.state) });
  return OK;
}

// ---------------------------------------------------------------------------
// Seed
// ---------------------------------------------------------------------------

/** The seed of this page load's run (throws if main.tsx never initialised it). */
export function currentSeed(): number {
  return getRunSeed();
}

/** URL that replays this run: `?seed=<n>&dev`, same page path. Pure, so it is testable. */
export function restartUrl(seed: number, pathname: string): string {
  return `${pathname}?seed=${seed}&dev`;
}

/** Reload the page with the same seed (everything else, including store state, resets). */
export function restartWithSameSeed(): void {
  const url = restartUrl(getRunSeed(), window.location.pathname);
  console.info('[dev]', 'restartWithSameSeed', { url });
  window.location.assign(url);
}
