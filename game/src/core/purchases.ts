import { cents } from './money';
import { getNeighborhood } from './neighborhoods';
import { getPlot, isLeasable, type PlotId } from './plots';
import { SliceState } from './sliceModel';
import { type Tuning, TUNING } from './tuning';

/**
 * Every buy, sell and hire the player can make, as pure "state in → result out" rules.
 *
 * Each rule returns either `{ ok: true, state }` or `{ ok: false, reason }`. The UI
 * turns a refusal into a toast and a buzz sound; the rule itself never touches the UI.
 *
 * Why this shape: in App.tsx the "can I afford it?" check read a copy of the state
 * captured when the button rendered, while the update used the latest state. Two
 * fast clicks could both pass the check and overspend. Here the check and the update
 * read the SAME state object, so that race cannot happen.
 *
 * Every dollar amount below is unchanged from App.tsx.
 */
export type PurchaseResult =
  | { ok: true; state: SliceState }
  | { ok: false; reason: PurchaseRefusal };

export type PurchaseRefusal =
  | 'insufficient-cash'
  | 'no-pitchers'
  | 'no-built-stand'
  | 'plot-not-leasable'
  | 'plot-not-empty'
  | 'plot-not-leased'
  | 'no-stall-kit'
  | 'already-staffed'
  | 'not-staffed';

// Read from core/tuning.ts (the one place balance numbers live); exported for the UI.
export const LEMON_CRATE_COST = TUNING.crateCost;
export const LEMON_CRATE_CUPS = TUNING.crateCups;
export const PITCHER_COST = TUNING.pitcherCost;
export const USED_PITCHER_RESALE = TUNING.pitcherResale;
export const STAND_DIVEST_PROCEEDS = TUNING.stallKitResale;

const refuse = (reason: PurchaseRefusal): PurchaseResult => ({ ok: false, reason });

/** $5 for a crate: cash turns into inventory (no profit or loss yet). */
export function buyLemons(s: SliceState, t: Tuning = TUNING): PurchaseResult {
  if (s.cash < t.crateCost) return refuse('insufficient-cash');
  return {
    ok: true,
    state: {
      ...s,
      cash: cents(s.cash - t.crateCost),
      inventoryValue: cents(s.inventoryValue + t.crateCost),
      cupsInStock: s.cupsInStock + t.crateCups,
    },
  };
}

/** $12 stall kit: cash turns into equipment. */
export function buyStallKit(s: SliceState, t: Tuning = TUNING): PurchaseResult {
  if (s.cash < t.stallKitCost) return refuse('insufficient-cash');
  return {
    ok: true,
    state: {
      ...s,
      cash: cents(s.cash - t.stallKitCost),
      equipmentValue: cents(s.equipmentValue + t.stallKitCost),
      stallKits: s.stallKits + 1,
    },
  };
}

/** $10 pitcher: cash turns into equipment; more pitchers widen the brew sweet spot. */
export function buyPitcher(s: SliceState, t: Tuning = TUNING): PurchaseResult {
  if (s.cash < t.pitcherCost) return refuse('insufficient-cash');
  return {
    ok: true,
    state: {
      ...s,
      cash: cents(s.cash - t.pitcherCost),
      equipmentValue: cents(s.equipmentValue + t.pitcherCost),
      pitchers: s.pitchers + 1,
    },
  };
}

/** Sell a $10 pitcher for $7: the $3 shortfall is booked as a loss (COGS). */
export function sellUsedPitcher(s: SliceState): PurchaseResult {
  if (s.pitchers < 1) return refuse('no-pitchers');
  const loss = PITCHER_COST - USED_PITCHER_RESALE;
  return {
    ok: true,
    state: {
      ...s,
      cash: cents(s.cash + USED_PITCHER_RESALE),
      equipmentValue: Math.max(0, cents(s.equipmentValue - PITCHER_COST)),
      pitchers: Math.max(0, s.pitchers - 1),
      dayCogs: cents(s.dayCogs + loss),
      totalCogs: cents(s.totalCogs + loss),
    },
  };
}

/**
 * Sell the stand on a plot for $8.40: the $3.60 shortfall on the $12 kit is a loss.
 * The plot goes back to empty (lease ended) and its worker, if any, is let go.
 */
export function divestStand(s: SliceState, plotId: PlotId): PurchaseResult {
  if (s.plots[plotId] !== 'built') return refuse('no-built-stand');
  const loss = cents(TUNING.stallKitCost - STAND_DIVEST_PROCEEDS);
  return {
    ok: true,
    state: {
      ...s,
      cash: cents(s.cash + STAND_DIVEST_PROCEEDS),
      equipmentValue: Math.max(0, cents(s.equipmentValue - TUNING.stallKitCost)),
      plots: { ...s.plots, [plotId]: 'empty' },
      staffedPlots: s.staffedPlots.filter((id) => id !== plotId),
      dayCogs: cents(s.dayCogs + loss),
      totalCogs: cents(s.totalCogs + loss),
    },
  };
}

/**
 * The one-off city permit due when a lease is signed on `plotId`: its district's
 * `permitFee` (core/neighborhoods.ts). $0 in Central Park, up to $150 on Fifth Avenue.
 */
export function leaseFee(plotId: PlotId, t: Tuning = TUNING): number {
  return cents(getNeighborhood(getPlot(plotId).district).permitFee * t.permitScale);
}

/**
 * Lease an empty plot. Rent starts at the next day close. The seller's stand is not for lease.
 *
 * Signing also pays the district's permit (`leaseFee`). On the books the permit is
 * equipment (cash turns into something the business owns, so today's profit does not
 * move), but it has NO resale value, so the player's worth (core/sliceModel.ts
 * `getWorth`) drops by the whole fee at once. That drop is the point: an expensive
 * district is a bet that has to be won back cup by cup.
 */
export function signLease(s: SliceState, plotId: PlotId, t: Tuning = TUNING): PurchaseResult {
  if (!isLeasable(getPlot(plotId))) return refuse('plot-not-leasable');
  if (s.plots[plotId] !== 'empty') return refuse('plot-not-empty');
  const fee = leaseFee(plotId, t);
  if (s.cash < fee) return refuse('insufficient-cash');
  return {
    ok: true,
    state: {
      ...s,
      cash: cents(s.cash - fee),
      equipmentValue: cents(s.equipmentValue + fee),
      plots: { ...s.plots, [plotId]: 'leased' },
    },
  };
}

/** Use one stall kit to build on a leased plot. */
export function buildStand(s: SliceState, plotId: PlotId): PurchaseResult {
  if (s.plots[plotId] !== 'leased') return refuse('plot-not-leased');
  if (s.stallKits < 1) return refuse('no-stall-kit');
  return {
    ok: true,
    state: { ...s, stallKits: s.stallKits - 1, plots: { ...s.plots, [plotId]: 'built' } },
  };
}

/**
 * Put a worker on a built stand ($10/day, charged at day close; hiring itself is free).
 * One worker per stand. A staffed stand sells on its own while the player is elsewhere.
 */
export function hireWorker(s: SliceState, plotId: PlotId): PurchaseResult {
  if (s.plots[plotId] !== 'built') return refuse('no-built-stand');
  if (s.staffedPlots.includes(plotId)) return refuse('already-staffed');
  return { ok: true, state: { ...s, staffedPlots: [...s.staffedPlots, plotId] } };
}

/** Let a stand's worker go (no more wage from tonight; the stand stops selling on its own). */
export function letWorkerGo(s: SliceState, plotId: PlotId): PurchaseResult {
  if (!s.staffedPlots.includes(plotId)) return refuse('not-staffed');
  return { ok: true, state: { ...s, staffedPlots: s.staffedPlots.filter((id) => id !== plotId) } };
}

export function hireManager(s: SliceState): SliceState {
  return { ...s, managers: s.managers + 1 };
}
