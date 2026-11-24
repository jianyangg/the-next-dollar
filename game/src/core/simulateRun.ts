import { stepAwaySales } from './awaySales';
import { closeDay, startNextDay } from './dayEnd';
import { CENTRAL_PARK_DEAL, type Deal, resolveSealedBid } from './deal';
import { getPlot, isLeasable, type PlotId, PLOTS, SELLER_PLOT_ID, SELLER_RENT_AFTER } from './plots';
import * as Purchases from './purchases';
import { createRunStreams } from './rng';
import { applySale } from './sales';
import { countOwnedStands, createInitialState, getWorth, grandmaWorth, type SliceState } from './sliceModel';
import { buyersPerDay, liveCupsPerDay, ownStandsInDistrict, staffedCupsPerDay } from './standSales';
import { cupCost, type Tuning, TUNING } from './tuning';

/**
 * SIMULATE A WHOLE RUN: play all 30 days with a scripted player ("policy") and report
 * how the player's money compares with Grandma's bank at the end.
 *
 * WHY THIS EXISTS
 *   "Is the game too easy?" used to be answered by playing it and guessing. This answers
 *   it with a number. Three scripted players (core/simPolicies.ts) stand for a careless,
 *   a typical and a careful human. The test (core/simulateRun.test.ts) asserts where each
 *   must finish against Grandma. Change a wage or a rent and the test says at once
 *   whether the game is still as hard as intended.
 *
 * WHAT IS REAL AND WHAT IS A MODEL
 *   REAL: every change to the player's money goes through the same pure rules the game
 *   uses: `buyLemons`, `buyStallKit`, `buyPitcher`, `signLease`, `buildStand`,
 *   `hireWorker`, `resolveSealedBid`, `applySale`, `stepAwaySales`, `closeDay`,
 *   `startNextDay`. If a rule changes, the simulation changes with it.
 *   MODEL: the one thing the rules cannot supply is the human at the counter (how many
 *   cups they manage to pour). That comes from `liveCupsPerDay` in core/standSales.ts:
 *   the stand's demand or the player's hand speed, whichever is smaller, times the share
 *   of the day the policy spends pouring (`focus`).
 *
 * HOW A DAY RUNS
 *   1. Morning: the policy decides (open a stand, hire, bid, set the price).
 *   2. The day is cut into `SLICES_PER_DAY` equal slices. In each slice the player may
 *      restock lemons, pours at their own stand for part of the slice, and every staffed
 *      stand sells through `stepAwaySales`. Slices let cash earned in the morning buy
 *      lemons for the afternoon, as it does in the real game.
 *   3. The bell: `closeDay` books rent, wages and the line; then `startNextDay`.
 *
 * Pure and deterministic: the same policy, tuning and seed always give the same result.
 */

export const SLICES_PER_DAY = 12;
/** Share of a whole day one trip to the Supply Market costs the player at the counter. ASSUMED. */
export const RESTOCK_TRIP_DAY_SHARE = 0.04;
/** On day 1 the player also has to shop and build, so less of the day is left to pour. ASSUMED. */
export const DAY_ONE_COUNTER_SHARE = 0.75;
/** The first stand of every run: the tutorial's Central Park corner. */
export const FIRST_PLOT: PlotId = 'central-park/corner';
/** Patience left when a simulated player serves a cup (a prompt, 5-star serve). */
const SIM_SERVE_PATIENCE = 0.9;

/** What a policy can see and do each morning. Every action runs a real rule. */
export interface SimMorning {
  readonly state: SliceState;
  readonly day: number;
  /** Days still to be played, counting today. */
  readonly daysLeft: number;
  readonly tuning: Tuning;
  readonly deal: Deal;
  /**
   * Lease `plotId`, buy a kit, build, and (if `staffed`) hire a worker there, all or
   * nothing. Refused when a rule refuses or when it would leave less than `keepCash`.
   */
  openStand(plotId: PlotId, opts: { staffed: boolean; keepCash: number }): boolean;
  hireWorker(plotId: PlotId): boolean;
  /** One sealed bid for the seller's stand; true when the stand was won. */
  bid(amount: number, keepCash: number): boolean;
  setPrice(price: number): void;
  /** Expected daily profit of the chain at `price` if every stand the player owns had a worker. */
  chainProfitPerDay(price: number): number;
  /** Cash needed to open a stand on an empty plot. */
  openCost(plotId: PlotId): number;
  /**
   * How much MORE the whole chain would earn per day with a staffed stand on `plotId`
   * than without it. Not the same as that stand's own profit: a second stand in a
   * district takes walkers from the first (core/standSales.ts crowdShare), so the gain
   * to the chain can be small or negative even when the new stand looks busy.
   */
  marginalProfitPerDay(plotId: PlotId): number;
}

export interface SimPolicy {
  name: string;
  /** Share of each day (0..1) the player spends pouring at their own counter. */
  focus: number;
  /**
   * 'ahead': buys enough lemons for the rest of the day whenever cash allows.
   * 'when-empty': buys one crate only after running out (and loses sales meanwhile).
   */
  restock: 'ahead' | 'when-empty';
  /** Which of their stands the player works at: the first one, or the one with most buyers. */
  counter: 'first' | 'busiest';
  morning(m: SimMorning): void;
}

export interface SimDay {
  day: number;
  /** The player's worth at the bell (core/sliceModel.ts getWorth). */
  you: number;
  grandma: number;
  cupsSold: number;
  /** Revenue minus lemons, rent and wages (the DayRecord's nopat). */
  profit: number;
  /** What `profit` had to beat for the day to count as won (the DayRecord). */
  lineBeaten: boolean;
  stands: number;
  workers: number;
}

export interface SimResult {
  policy: string;
  seed: number;
  days: SimDay[];
  you: number;
  grandma: number;
  /** you / grandma on the last day: above 1 means the player beat Grandma's bank. */
  ratio: number;
  daysLineBeaten: number;
  /** First day from which the player stays behind Grandma to the end, or null. */
  behindForGoodFromDay: number | null;
  stands: number;
  workers: number;
  /** What the policy did and when ("d4 open columbia/corner"), for reading a run. */
  log: string[];
}

/** Daily rent of a plot for planning (the seller's stand at its stepped-up rent). */
function plannedRent(plotId: PlotId, t: Tuning): number {
  const base = plotId === SELLER_PLOT_ID ? SELLER_RENT_AFTER : getPlot(plotId).dailyRent;
  return base * t.rentScale;
}

export function simulateRun(policy: SimPolicy, tuning: Tuning = TUNING, seed = 1): SimResult {
  const t = tuning;
  const rand = createRunStreams(seed).gameplay;
  const deal = CENTRAL_PARK_DEAL;
  let state: SliceState = { ...createInitialState(), cash: t.startingCash, openingWorth: t.startingCash };
  let nextReviewId = 1;
  const log: string[] = [];

  /** Run one real purchase rule; keep the result only if the rule accepted it. */
  const apply = (rule: (s: SliceState) => Purchases.PurchaseResult): boolean => {
    const r = rule(state);
    if (r.ok) state = r.state;
    return r.ok;
  };

  const openCost = (plotId: PlotId): number => t.stallKitCost + Purchases.leaseFee(plotId, t);

  /**
   * Expected daily profit of the chain if every stand in `plots` had a worker: cups x
   * margin, minus rent and wage, with each district's crowd shared between its stands.
   */
  const chainProfitPerDay = (plots: SliceState['plots'], price = state.pricePerCup): number => {
    let total = 0;
    for (const p of PLOTS) {
      if (plots[p.id] !== 'built') continue;
      const cups = staffedCupsPerDay(p.id, price, t, ownStandsInDistrict(plots, p.id));
      total += cups * (price - cupCost(t)) - plannedRent(p.id, t) - t.workerDailyWage;
    }
    return total;
  };
  const marginalProfitPerDay = (plotId: PlotId): number =>
    chainProfitPerDay({ ...state.plots, [plotId]: 'built' }) - chainProfitPerDay(state.plots);

  const morningApi = (day: number): SimMorning => ({
    get state() {
      return state;
    },
    day,
    daysLeft: state.maxDays - day + 1,
    tuning: t,
    deal,
    openCost,
    marginalProfitPerDay,
    chainProfitPerDay: (price) => chainProfitPerDay(state.plots, price),
    openStand(plotId, { staffed, keepCash }) {
      if (state.plots[plotId] !== 'empty' || !isLeasable(getPlot(plotId))) return false;
      if (state.cash - openCost(plotId) < keepCash) return false;
      const before = state; // all-or-nothing: restore on any refusal
      const ok =
        apply((s) => Purchases.signLease(s, plotId, t)) &&
        apply((s) => Purchases.buyStallKit(s, t)) &&
        apply((s) => Purchases.buildStand(s, plotId)) &&
        (!staffed || apply((s) => Purchases.hireWorker(s, plotId)));
      if (!ok) state = before;
      else log.push(`d${day} open ${plotId}`);
      return ok;
    },
    hireWorker: (plotId) => apply((s) => Purchases.hireWorker(s, plotId)),
    bid(amount, keepCash) {
      if (state.dealStatus !== 'open' || state.cash - amount < keepCash) return false;
      const r = resolveSealedBid(state, deal, amount);
      if (r.kind === 'won' || r.kind === 'rejected') state = r.state;
      log.push(`d${day} bid $${amount}: ${r.kind}`);
      return r.kind === 'won';
    },
    setPrice(price) {
      log.push(`d${day} price $${price}`);
      state = { ...state, pricePerCup: price };
    },
  });

  // Day 1 starts the way the tutorial does: lease the corner, kit, pitcher, build.
  apply((s) => Purchases.signLease(s, FIRST_PLOT, t));
  apply((s) => Purchases.buyStallKit(s, t));
  apply((s) => Purchases.buyPitcher(s, t));
  apply((s) => Purchases.buildStand(s, FIRST_PLOT));

  const days: SimDay[] = [];
  let liveCarry = 0; // fraction of a cup owed to the live stand from earlier slices
  for (let day = 1; day <= state.maxDays; day++) {
    policy.morning(morningApi(day));

    const built = PLOTS.filter((p) => state.plots[p.id] === 'built').map((p) => p.id);
    const price = state.pricePerCup;
    const livePlot =
      policy.counter === 'busiest'
        ? [...built].sort((a, b) => buyersPerDay(b, price, t) - buyersPerDay(a, price, t))[0]
        : built.includes(FIRST_PLOT)
          ? FIRST_PLOT
          : built[0];
    const workersHere = livePlot && state.staffedPlots.includes(livePlot) ? 1 : 0;
    const focus = policy.focus * (day === 1 ? DAY_ONE_COUNTER_SHARE : 1);
    /** Cups per full day at the live counter if the player never left it. */
    const shareOf = (id: PlotId): number => ownStandsInDistrict(state.plots, id);
    const liveRate = livePlot
      ? liveCupsPerDay(livePlot, price, { workersHere, focus: 1, standsInDistrict: shareOf(livePlot) }, t)
      : 0;
    /** Cups the whole chain expects to sell in a full day (for deciding how many lemons to buy). */
    const expectedCups =
      liveRate * focus +
      state.staffedPlots
        .filter((id) => state.plots[id] === 'built')
        .reduce((sum, id) => sum + staffedCupsPerDay(id, price, t, shareOf(id)) * (id === livePlot ? 1 - focus : 1), 0);

    let awayCarry: Record<PlotId, number> = {};
    liveCarry = 0;
    const slice = 1 / SLICES_PER_DAY;
    for (let i = 0; i < SLICES_PER_DAY; i++) {
      // --- restock (a trip takes the player off the counter for a moment) ---
      let trips = 0;
      if (policy.restock === 'ahead') {
        const need = expectedCups * (1 - i * slice);
        while (state.cupsInStock < need && apply((s) => Purchases.buyLemons(s, t))) trips = 1;
      } else if (state.cupsInStock === 0 && apply((s) => Purchases.buyLemons(s, t))) {
        trips = 1;
      }
      const present = Math.max(0, slice * focus - trips * RESTOCK_TRIP_DAY_SHARE);
      const absent = slice - present;

      // --- the player pours at their own counter ---
      if (livePlot && present > 0) {
        // Buyers do not arrive evenly: +-20% per slice, averaging to the expected number.
        liveCarry += liveRate * present * (0.8 + 0.4 * rand());
        while (liveCarry >= 1 && state.cupsInStock > 0) {
          state = applySale(state, SIM_SERVE_PATIENCE, nextReviewId++, t);
          liveCarry -= 1;
        }
        if (state.cupsInStock === 0) liveCarry = 0; // no lemons: those buyers walked on
      }

      // --- staffed stands sell: while the player pours (their own stand excluded), then
      //     while the player is away (every staffed stand, their own included) ---
      for (const [livePlotId, dayFraction] of [
        [livePlot ?? null, present],
        [null, absent],
      ] as const) {
        const r = stepAwaySales({ state, livePlotId, reservedCups: 0, dayFraction, carry: awayCarry, nextReviewId, tuning: t });
        state = r.state;
        awayCarry = r.carry;
        nextReviewId = r.nextReviewId;
      }
    }

    const closed = closeDay(state, t);
    if (!closed) break;
    const you = getWorth(closed.state, t);
    days.push({
      day,
      you,
      grandma: grandmaWorth(day, t),
      cupsSold: closed.record.cupsSold,
      profit: closed.record.nopat,
      lineBeaten: closed.record.valueCreated >= 0,
      stands: countOwnedStands(closed.state),
      workers: closed.state.staffedPlots.length,
    });
    state = startNextDay(closed.state, t);
  }

  const last = days[days.length - 1];
  // Walk back from the end while the player is behind: the first day of that final stretch.
  let behindFrom: number | null = null;
  for (let i = days.length - 1; i >= 0 && days[i].you < days[i].grandma; i--) behindFrom = days[i].day;
  return {
    policy: policy.name,
    seed,
    days,
    you: last.you,
    grandma: last.grandma,
    ratio: +(last.you / last.grandma).toFixed(3),
    daysLineBeaten: days.filter((d) => d.lineBeaten).length,
    behindForGoodFromDay: behindFrom,
    stands: last.stands,
    workers: last.workers,
    log,
  };
}

/** One line per policy, for the test log and for reports. */
export function formatSimResult(r: SimResult): string {
  return (
    `${r.policy.padEnd(16)} You $${r.you.toFixed(0).padStart(6)}  Grandma $${r.grandma.toFixed(0)}  ` +
    `= ${r.ratio.toFixed(2)}x | line beaten ${String(r.daysLineBeaten).padStart(2)}/${r.days.length} days | ` +
    `behind for good from day ${r.behindForGoodFromDay ?? '-'} | stands ${r.stands}, workers ${r.workers}`
  );
}
