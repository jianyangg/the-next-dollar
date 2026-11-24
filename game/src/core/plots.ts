import { getNeighborhood, NEIGHBORHOODS, type NeighborhoodId } from './neighborhoods';
import type { PlotStatus } from './sliceModel';

/**
 * PLOTS: the places a stand can stand. Each business district has 2-3 sidewalk plots
 * (it used to have exactly one), plus, in Central Park only, the seller's stand that
 * the player can buy through the deal.
 *
 * Why plots differ: a plot is a trade-off between RENT and FOOT TRAFFIC. The corner
 * pays the district's rent and gets its normal crowd; the side street costs 70% of that
 * rent for 60% of the crowd; the plaza costs 140% for 140%. The district sets the scale
 * (a Fifth Ave corner sees about twice the walkers of a Central Park corner and costs
 * ten times the rent; its shoppers pay $5 a cup where park walkers pay $3).
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

/**
 * How a side street and a plaza compare with their district's corner: the share of the
 * corner's rent they cost and the share of its walkers they see. A side street is the
 * cheap, quiet option; a plaza the dear, busy one.
 */
const SIDE_RENT_SHARE = 0.7;
const SIDE_WALKER_SHARE = 0.6;
const PLAZA_RENT_SHARE = 1.4;
const PLAZA_WALKER_SHARE = 1.4;

/**
 * Where each kind of plot sits on the street. The street has two sidewalks, one on each
 * side of the east-west cross street (z 2.9..7.5): the FAR one (z < 2.9) and the NEAR one
 * (z > 7.5, toward the camera). Stands are spread over both so neither looks empty:
 *   - corner: the original stand spot, far sidewalk, right of the avenue.
 *   - side:   near sidewalk, left of the avenue (x -6.8). Its stand box (x -8.2..-5.6)
 *             leaves the west crosswalk landing (x -5.1..-3.3) open, and its customer
 *             line runs left (to x ~-9.4), staying on screen.
 *   - plaza:  near sidewalk, right of the avenue (x 7.6). Its box (x 6.2..8.8) clears the
 *             east crosswalk landing (x 3.3..5.1); its line runs left, toward the crossing.
 * Near-side stands sit at z 10.2: the counter faces the street (world/collision.ts
 * standFacing), so the customer line forms between it and the walker lane (z 7.75..8.2),
 * at z 8.35..9.15. Both near spots are inside the player's walk area (its maxZ was raised
 * to 11.4 for them) and within about 1.5 units of the camera's centre when the player
 * stands at them (the camera follows at 0.78 x the player's x).
 * The Central Park seller's stand keeps its own far-sidewalk spot (see districtPlots).
 */
const SPOT_XZ: Record<Exclude<PlotKind, 'seller'>, { x: number; z: number }> = {
  corner: { x: 5.6, z: -1.6 },
  side: { x: -6.8, z: 10.2 },
  plaza: { x: 7.6, z: 10.2 },
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
  const { dailyRent: rent, cornerWalkersPerDay: cornerWalkers } = getNeighborhood(district);
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
    spot('side', 'Side', Math.max(1, Math.round(rent * SIDE_RENT_SHARE)), cornerWalkers * SIDE_WALKER_SHARE),
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
    plots.push(spot('plaza', 'Plaza', Math.round(rent * PLAZA_RENT_SHARE), cornerWalkers * PLAZA_WALKER_SHARE));
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
