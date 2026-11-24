import { getNeighborhood, NEIGHBORHOODS, type NeighborhoodId } from './neighborhoods';
import type { PlotStatus } from './sliceModel';

/**
 * PLOTS: the places a stand can stand. Each business district has 2-3 sidewalk plots
 * (it used to have exactly one), plus, in Central Park only, the seller's stand that
 * the player can buy through the deal.
 *
 * Why plots differ: a plot is a trade-off between RENT and FOOT TRAFFIC. The corner
 * pays the district's rent and gets its normal crowd; the side street is $1 cheaper
 * but quieter; the plaza costs $2 more and is busier. The district sets the scale (a
 * Fifth Ave corner sees twice the walkers of a Central Park corner, and costs more).
 *
 * `walkersPerDay` is used for STAFFED stands the player is not running in person
 * (core/awaySales.ts): how many passers-by reach that stand in a full day and decide
 * whether to buy at the current price. The stand the player runs live gets real
 * walkers from the 3D scene instead, and the scene scales how often they come by the
 * same number (see `trafficMultiplier`), so a busy plot is busy either way.
 *
 * Positions are world coordinates on the walkable street (x left/right, z toward the
 * camera), shared by the 3D scene and its collision boxes: one source of truth.
 */

export type PlotId = string;
export type PlotKind = 'corner' | 'side' | 'plaza' | 'seller';

export interface PlotSpot {
  id: PlotId;
  district: NeighborhoodId;
  kind: PlotKind;
  /** One-word name shown on signs and in the lease window. */
  label: string;
  /** Rent per day once leased (for the seller's stand: before the lease step-up). */
  dailyRent: number;
  /** Passers-by who reach this stand in a full day (see the module comment). */
  walkersPerDay: number;
  x: number;
  z: number;
}

/** Corner walkers per day = BASE + PER_RENT_DOLLAR x district rent (rent buys crowd). */
const CORNER_BASE_WALKERS = 6;
const CORNER_WALKERS_PER_RENT_DOLLAR = 2;

/** Where each kind of plot sits on the street (the corner is the original stand spot). */
const SPOT_XZ: Record<Exclude<PlotKind, 'seller'>, { x: number; z: number }> = {
  corner: { x: 5.6, z: -1.6 },
  side: { x: -10.2, z: -1.6 },
  // The plaza uses the spot where the "FOR SALE" stand stood in every district; the
  // seller now lives in Central Park only, where the deal is.
  plaza: { x: -5.8, z: -1.6 },
};

/** The Central Park seller's stand: its own spot, rent and crowd come from its books. */
export const SELLER_PLOT_ID: PlotId = 'central-park/seller';
/**
 * Its published books show about $16 a day of sales at $3 a cup, i.e. about 5.3 cups;
 * at Central Park's 78% buy chance for $3 that is about 7 walkers a day.
 */
const SELLER_WALKERS_PER_DAY = 7;
/** Off-book fact: rent is $3 now and rises to $5 when the lease renews in 4 days. */
export const SELLER_RENT_BEFORE = 3;
export const SELLER_RENT_AFTER = 5;
export const SELLER_RENT_STEP_DAYS = 4;

function districtPlots(district: NeighborhoodId): PlotSpot[] {
  const rent = getNeighborhood(district).dailyRent;
  const cornerWalkers = CORNER_BASE_WALKERS + CORNER_WALKERS_PER_RENT_DOLLAR * rent;
  const spot = (kind: Exclude<PlotKind, 'seller'>, label: string, dailyRent: number, walkers: number): PlotSpot => ({
    id: `${district}/${kind}`,
    district,
    kind,
    label,
    dailyRent,
    walkersPerDay: Math.round(walkers),
    ...SPOT_XZ[kind],
  });
  const plots = [
    spot('corner', 'Corner', rent, cornerWalkers),
    spot('side', 'Side', Math.max(1, rent - 1), cornerWalkers * 0.6),
  ];
  if (district === 'central-park') {
    plots.push({
      id: SELLER_PLOT_ID,
      district,
      kind: 'seller',
      label: 'Seller',
      dailyRent: SELLER_RENT_BEFORE,
      walkersPerDay: SELLER_WALKERS_PER_DAY,
      x: -5.8,
      z: -1.6,
    });
  } else {
    plots.push(spot('plaza', 'Plaza', rent + 2, cornerWalkers * 1.4));
  }
  return plots;
}

/** Every plot in the city, in a fixed order (districts in map order, then corner/side/plaza). */
export const PLOTS: readonly PlotSpot[] = NEIGHBORHOODS.filter((n) => n.id !== 'market').flatMap((n) =>
  districtPlots(n.id)
);

const BY_ID = new Map(PLOTS.map((p) => [p.id, p]));

export function getPlot(id: PlotId): PlotSpot {
  const plot = BY_ID.get(id);
  if (!plot) throw new Error(`Unknown plot ${id}`);
  return plot;
}

/** The plots of one district (the market has none). */
export function plotsIn(district: NeighborhoodId): PlotSpot[] {
  return PLOTS.filter((p) => p.district === district);
}

/** Plots the player can lease (the seller's stand is only ever bought through the deal). */
export const isLeasable = (p: PlotSpot): boolean => p.kind !== 'seller';

/**
 * How busy a plot is compared with the Central Park corner (the stand the game was
 * tuned on). The live scene divides its customer arrival gap by this.
 */
export function trafficMultiplier(id: PlotId): number {
  const reference = getPlot('central-park/corner').walkersPerDay;
  return getPlot(id).walkersPerDay / reference;
}

/**
 * A plot as the 3D scene and the UI need to draw it: where it is plus what the player
 * has done with it (empty / leased / built) and whether a worker staffs it.
 */
export interface PlotView extends PlotSpot {
  status: PlotStatus;
  staffed: boolean;
}
