import { getPlot, isLeasable, type PlotId, PLOTS, SELLER_PLOT_ID } from './plots';
import { countOwnedStands } from './sliceModel';
import type { SimMorning, SimPolicy } from './simulateRun';
import { crowdAt, liveCupsPerDay, staffedCupsPerDay } from './standSales';
import { cupCost } from './tuning';

/**
 * THE SCRIPTED PLAYERS the balance simulation plays the game with (core/simulateRun.ts).
 *
 * Each one stands for a kind of human, so that "is the game too easy?" becomes "where
 * does each kind of player finish against Grandma's bank?":
 *
 *   lazy            keeps the one stand they started with and pours by hand all run.
 *                   Should LOSE to Grandma: a business that never grows adds the same
 *                   profit every day, while her money compounds.
 *   average         opens a new stand with a worker whenever they can afford the next
 *                   cheapest one, stops at five, pays the asking price for the seller's
 *                   stand. Should roughly TIE.
 *   sharp           only spends when the stand pays for itself in the days that are left,
 *                   picks the best payback first, bids just over the seller's minimum.
 *                   Should clearly BEAT her.
 *   openEverything  a control, not a person: opens and staffs every plot as fast as cash
 *                   allows and pays the asking price. If this does as well as `sharp`,
 *                   the game has no real choices in it, only "buy more".
 *
 * The policies only use what a player can see (prices, rents, walkers a day), with one
 * exception: `sharp` reads the seller's hidden minimum to place its bid. That stands
 * for a player who asked the right questions; the simulation cannot hold a conversation.
 */

const emptyLeasable = (m: SimMorning): PlotId[] =>
  PLOTS.filter((p) => isLeasable(p) && m.state.plots[p.id] === 'empty').map((p) => p.id);

/** Cash lost for good when a stand is opened: what was paid minus what the kit resells for. */
const sunkToOpen = (m: SimMorning, plotId: PlotId): number => m.openCost(plotId) - m.tuning.stallKitResale;

export const lazy: SimPolicy = {
  name: 'lazy',
  focus: 0.55,
  restock: 'when-empty',
  counter: 'first',
  morning: () => {},
};

/** Stands the average player stops at. */
const AVERAGE_MAX_STANDS = 5;
/** Cash the average player keeps back for lemons. */
const AVERAGE_KEEP_CASH = 15;

export const average: SimPolicy = {
  name: 'average',
  focus: 0.7,
  restock: 'ahead',
  counter: 'first',
  morning(m) {
    setBestPrice(m);
    // Settles in for three days, then makes at most one move a day.
    if (m.day < 4 || countOwnedStands(m.state) >= AVERAGE_MAX_STANDS) return;
    // The seller's stand is right there in the first district: bought at the asking
    // price as soon as the cash is there, then staffed.
    if (m.state.dealStatus === 'open' && m.bid(m.deal.askingPrice, AVERAGE_KEEP_CASH)) {
      m.hireWorker(SELLER_PLOT_ID);
      return;
    }
    // Otherwise the corner of the cheapest district they have no stand in yet: a typical
    // player explores the map one district at a time and takes the first plot on offer.
    const home = new Set(PLOTS.filter((p) => m.state.plots[p.id] === 'built').map((p) => p.district));
    const next = emptyLeasable(m)
      .filter((id) => getPlot(id).kind === 'corner' && !home.has(getPlot(id).district))
      .sort((a, b) => m.openCost(a) - m.openCost(b))[0];
    if (next) m.openStand(next, { staffed: true, keepCash: AVERAGE_KEEP_CASH });
  },
};

const rentOf = (plotId: PlotId): number => getPlot(plotId).dailyRent;

/** The prices the game offers. */
const PRICES = [2, 3, 4, 5];

/**
 * Set the one price the whole chain sells at (the game has a single price) to the one
 * the chain, as it stands this morning, earns most at. Both `average` and `sharp` do
 * this: the price menu shows how many of 10 walkers buy at each price, so finding the
 * best price is something a typical player manages by trying.
 */
function setBestPrice(m: SimMorning): void {
  const best = PRICES.reduce((b, p) => (m.chainProfitPerDay(p) > m.chainProfitPerDay(b) ? p : b));
  if (best !== m.state.pricePerCup) m.setPrice(best);
}

/** Cash the careful players keep back for lemons. */
const SHARP_KEEP_CASH = 8;
/** How far over the seller's minimum the sharp player bids (a safety margin). */
const SHARP_BID_OVER_MINIMUM = 1.05;

export const sharp: SimPolicy = {
  name: 'sharp',
  focus: 0.85,
  restock: 'ahead',
  counter: 'busiest',
  morning(m) {
    const t = m.tuning;
    setBestPrice(m);
    const price = m.state.pricePerCup;

    // A helper at the player's own counter: worth it when the extra cups they make
    // possible (a faster pour, plus sales while the player is away) cover the wage.
    for (const p of PLOTS) {
      if (m.state.plots[p.id] !== 'built' || m.state.staffedPlots.includes(p.id)) continue;
      const crowd = crowdAt(m.state, p.id);
      const alone = liveCupsPerDay(p.id, price, { workersHere: 0, focus: sharp.focus, crowd }, t);
      const helped =
        liveCupsPerDay(p.id, price, { workersHere: 1, focus: sharp.focus, crowd }, t) +
        staffedCupsPerDay(p.id, price, crowd, t) * (1 - sharp.focus);
      if ((helped - alone) * (price - cupCost(t)) > t.workerDailyWage) m.hireWorker(p.id);
    }

    // Spend only on what pays for itself in the days left, best payback per dollar first.
    for (let guard = 0; guard < 20; guard++) {
      type Option = { value: number; cost: number; act: () => boolean };
      const options: Option[] = emptyLeasable(m).map((plotId) => ({
        value: m.marginalProfitPerDay(plotId) * m.daysLeft - sunkToOpen(m, plotId),
        cost: m.openCost(plotId),
        act: () => m.openStand(plotId, { staffed: true, keepCash: SHARP_KEEP_CASH }),
      }));
      if (m.state.dealStatus === 'open') {
        const bid = Math.ceil(m.deal.reservationPrice * SHARP_BID_OVER_MINIMUM);
        options.push({
          value: m.marginalProfitPerDay(SELLER_PLOT_ID) * m.daysLeft - (bid - t.stallKitResale),
          cost: bid,
          act: () => m.bid(bid, SHARP_KEEP_CASH) && m.hireWorker(SELLER_PLOT_ID),
        });
      }
      const best = options
        .filter((o) => o.value > 0 && m.state.cash - o.cost >= SHARP_KEEP_CASH)
        .sort((a, b) => b.value / b.cost - a.value / a.cost)[0];
      if (!best || !best.act()) break;
    }
  },
};

export const openEverything: SimPolicy = {
  name: 'open-everything',
  focus: 0.85,
  restock: 'ahead',
  counter: 'busiest',
  morning(m) {
    // Staff the stand the player already has, then every plot in the city, cheapest first.
    for (const p of PLOTS) if (m.state.plots[p.id] === 'built') m.hireWorker(p.id);
    if (m.state.dealStatus === 'open' && m.bid(m.deal.askingPrice, SHARP_KEEP_CASH)) m.hireWorker(SELLER_PLOT_ID);
    for (const plotId of emptyLeasable(m).sort((a, b) => m.openCost(a) - m.openCost(b) || rentOf(a) - rentOf(b))) {
      if (!m.openStand(plotId, { staffed: true, keepCash: SHARP_KEEP_CASH })) break;
    }
  },
};

/**
 * A control for marketing: plays like `average`, and every morning also buys a campaign
 * in every district where it owns a stand, whatever it costs. Advertising without asking
 * whether the extra walkers can be served or are worth it must not beat Grandma
 * (simulateRun.test.ts). If it did, marketing would be a button, not a decision.
 */
export const adEveryDay: SimPolicy = {
  name: 'ad-every-day',
  focus: average.focus,
  restock: average.restock,
  counter: average.counter,
  morning(m) {
    average.morning(m);
    const districts = new Set(PLOTS.filter((p) => m.state.plots[p.id] === 'built').map((p) => p.district));
    for (const d of districts) m.advertise(d, AVERAGE_KEEP_CASH);
  },
};

export const SIM_POLICIES = { lazy, average, sharp, openEverything, adEveryDay } as const;
