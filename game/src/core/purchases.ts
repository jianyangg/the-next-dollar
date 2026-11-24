import { cents } from './money';
import { getPlot, isLeasable, type PlotId } from './plots';
import { SliceState, STALL_KIT_COST } from './sliceModel';

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

export const LEMON_CRATE_COST = 5;
export const LEMON_CRATE_CUPS = 10;
export const PITCHER_COST = 10;
export const USED_PITCHER_RESALE = 7;
export const STAND_DIVEST_PROCEEDS = 8.4;

const refuse = (reason: PurchaseRefusal): PurchaseResult => ({ ok: false, reason });

/** $5 for a crate: cash turns into inventory (no profit or loss yet). */
export function buyLemons(s: SliceState): PurchaseResult {
  if (s.cash < LEMON_CRATE_COST) return refuse('insufficient-cash');
  return {
    ok: true,
    state: {
      ...s,
      cash: cents(s.cash - LEMON_CRATE_COST),
      inventoryValue: cents(s.inventoryValue + LEMON_CRATE_COST),
      cupsInStock: s.cupsInStock + LEMON_CRATE_CUPS,
    },
  };
}

/** $12 stall kit: cash turns into equipment. */
export function buyStallKit(s: SliceState): PurchaseResult {
  if (s.cash < STALL_KIT_COST) return refuse('insufficient-cash');
  return {
    ok: true,
    state: {
      ...s,
      cash: cents(s.cash - STALL_KIT_COST),
      equipmentValue: cents(s.equipmentValue + STALL_KIT_COST),
      stallKits: s.stallKits + 1,
    },
  };
}

/** $10 pitcher: cash turns into equipment; more pitchers widen the brew sweet spot. */
export function buyPitcher(s: SliceState): PurchaseResult {
  if (s.cash < PITCHER_COST) return refuse('insufficient-cash');
  return {
    ok: true,
    state: {
      ...s,
      cash: cents(s.cash - PITCHER_COST),
      equipmentValue: cents(s.equipmentValue + PITCHER_COST),
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
  const loss = cents(STALL_KIT_COST - STAND_DIVEST_PROCEEDS);
  return {
    ok: true,
    state: {
      ...s,
      cash: cents(s.cash + STAND_DIVEST_PROCEEDS),
      equipmentValue: Math.max(0, cents(s.equipmentValue - STALL_KIT_COST)),
      plots: { ...s.plots, [plotId]: 'empty' },
      staffedPlots: s.staffedPlots.filter((id) => id !== plotId),
      dayCogs: cents(s.dayCogs + loss),
      totalCogs: cents(s.totalCogs + loss),
    },
  };
}

/** Lease an empty plot. Rent starts at the next day close. The seller's stand is not for lease. */
export function signLease(s: SliceState, plotId: PlotId): PurchaseResult {
  if (!isLeasable(getPlot(plotId))) return refuse('plot-not-leasable');
  if (s.plots[plotId] !== 'empty') return refuse('plot-not-empty');
  return { ok: true, state: { ...s, plots: { ...s.plots, [plotId]: 'leased' } } };
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
 * Put a worker on a built stand ($3/day, charged at day close; hiring itself is free).
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
