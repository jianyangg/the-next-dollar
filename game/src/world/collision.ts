/**
 * collision.ts - pure collision data and movement rules for the walkable street.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * Today the "is this step blocked?" logic is written inline inside
 * CentralParkScene.animate() (lines 3022-3038 of CentralParkScene.ts). That makes
 * it impossible to unit test and impossible to share with a path-finder. This
 * module extracts the data (axis-aligned boxes) and the rules (isBlocked,
 * moveWithSliding) into pure functions over plain {x, z} objects, so they run in
 * Node tests with no three.js and no WebGL.
 *
 * COORDINATE SYSTEM
 * -----------------
 * The player walks on the ground plane: x is left/right, z is toward the camera
 * (larger z = closer to the viewer). Height (y) never matters for collision, so
 * everything here is 2D in (x, z).
 *
 * AXIS-ALIGNED BOXES (AABBs)
 * --------------------------
 * Every obstacle is a rectangle whose sides line up with the x and z axes. A
 * point-in-box test is four comparisons, which is why games use AABBs for simple
 * collision. The comparisons are STRICT (<), exactly like the current game:
 * standing precisely on a box edge counts as NOT blocked.
 *
 * WHY "SLIDING"?
 * --------------
 * Today, if a diagonal step is blocked the whole step is cancelled, so the player
 * "sticks" to a stand the moment they touch it even when they are pushing mostly
 * along it. Sliding retries the step one axis at a time so the part of the motion
 * that runs parallel to the wall survives. This is the standard "collide and
 * slide" technique used in most 2D/3D action games.
 */
import type { NeighborhoodId } from '../core/neighborhoods';
import { getPlot, SELLER_PLOT_ID, type PlotView } from '../core/plots';

export interface Vec2 {
  x: number;
  z: number;
}

export interface Box {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  id: string;
}

export interface Bounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
}

/**
 * The area the player may stand in. Clicks (handlePointerDown -> findPath) and
 * per-frame movement (moveWithSliding) both clamp to it, and the nav grid covers it.
 *
 * The street has TWO sidewalks separated by the east-west cross street (z 2.9..7.5):
 *   - the FAR sidewalk (z < 2.9, away from the camera), and
 *   - the NEAR sidewalk (z > 7.5, toward the camera).
 * maxZ used to be 8.2, which left only 0.7 units of near sidewalk: no room for a stand.
 * At 11.4 the near sidewalk holds, from the curb outward: the walker lane (z 7.75..8.2),
 * a stand's customer line (down to z ~8.35), the stand itself (z 9.7..10.7, see
 * SPOT_XZ in core/plots.ts) and a strip behind it wide enough for the
 * player to walk around (the player's 0.3 radius margin leaves z ~11.0..11.4 open).
 */
export const WALK_BOUNDS: Bounds = Object.freeze({
  minX: -12.5,
  maxX: 12.5,
  minZ: -2.68,
  maxZ: 11.4,
});

/** Player walk speed in world units per second (CentralParkScene.ts:3018). */
export const PLAYER_SPEED = 4.6;

// ---------------------------------------------------------------------------
// Anchor positions. CentralParkScene derives its THREE.Vector3 copies from these,
// so the visible stalls and their collision boxes cannot drift apart. Stand PLOT
// positions are not here: they live in core/plots.ts (PLOTS), the one place that
// says where every plot in the city is.
// ---------------------------------------------------------------------------
export const MARKET_STALLS_POS: Vec2 = { x: -4.3, z: -1.3 };
export const MARKET_PITCHERS_POS: Vec2 = { x: 0.0, z: -1.3 };
export const MARKET_LEMONS_POS: Vec2 = { x: 4.3, z: -1.3 };

/** Where the seller's "FOR SALE" stand stands: the seller plot from core/plots.ts. */
export function sellerStandPos(): Vec2 {
  const { x, z } = getPlot(SELLER_PLOT_ID);
  return { x, z };
}

/**
 * Is the seller's "FOR SALE" stand (and its broker) physically on THIS street?
 *
 * Two conditions, both required:
 *   1. `sellerPresent` (from the store): the deal has not been won yet. Once it is won the
 *      seller plot becomes the player's own built stand instead.
 *   2. The player is in the seller plot's district (Central Park). The store's flag is a
 *      fact about the CITY ("the seller is still in business"), not about the street the
 *      player is looking at, so it stays true while the player is in FiDi; without this
 *      check the FOR SALE stand would appear in every district, which was a real bug.
 * Pure, so the scene, the collision boxes and the UI signs all share one rule.
 */
export function sellerStandShown(neighborhood: NeighborhoodId, sellerPresent: boolean): boolean {
  return sellerPresent && getPlot(SELLER_PLOT_ID).district === neighborhood;
}

/**
 * Which of a district's plots are drawn ON THE STREET as a plot (an empty pad, a leased
 * pad or the player's built stand), as opposed to not at all.
 *
 * Ordinary plots (corner / side / plaza) always are. The seller's plot is special: while
 * the seller is still there it is drawn as the seller's FOR SALE stand (a different thing,
 * with its own sign and target), and it can never be leased (core/plots.ts isLeasable),
 * so it only becomes "one of the player's plots" once the deal is won and it is built.
 */
export function plotsOnStreet<T extends Pick<PlotView, 'kind' | 'status'>>(
  plots: readonly T[],
  sellerPresent: boolean
): T[] {
  return plots.filter((p) => p.kind !== 'seller' || (!sellerPresent && p.status === 'built'));
}

/**
 * Neighborhoods where cars drive: ROAD_NEIGHBORHOODS (CentralParkScene.ts:164),
 * which also drives taxiGroup.visible (:431). Other neighborhoods are
 * pedestrian-only, so there is no road worth routing around.
 */
const TRAFFIC_NEIGHBORHOODS: ReadonlySet<NeighborhoodId> = new Set<NeighborhoodId>([
  'central-park',
  'broadway',
  'fidi',
  'fifth-ave',
]);

export function hasTraffic(neighborhood: NeighborhoodId): boolean {
  return TRAFFIC_NEIGHBORHOODS.has(neighborhood);
}

/**
 * Road geometry (addAvenueAndCrosswalks, CentralParkScene.ts:785):
 *  - avenue box is 5.6 wide centred on x = 0 (:801-802)     -> |x| < 2.8
 *  - cross street is 4.6 deep centred on z = 5.2 (:807,:810) -> z in (2.9, 7.5)
 */
export const AVENUE_HALF_WIDTH = 2.8;
export const CROSS_STREET_Z_MIN = 2.9;
export const CROSS_STREET_Z_MAX = 7.5;

/** True if the point is on the avenue or the cross street (callers decide if the neighborhood has traffic). */
export function isOnRoad(p: Vec2): boolean {
  return Math.abs(p.x) < AVENUE_HALF_WIDTH || (p.z > CROSS_STREET_Z_MIN && p.z < CROSS_STREET_Z_MAX);
}

// ---------------------------------------------------------------------------
// Two sidewalks, crosswalks and walker lanes
// ---------------------------------------------------------------------------

/** Which side of the cross street a point is on: 'far' (z < its middle) or 'near'. */
export type Sidewalk = 'far' | 'near';
const CROSS_STREET_MID_Z = (CROSS_STREET_Z_MIN + CROSS_STREET_Z_MAX) / 2;

export function sidewalkOf(z: number): Sidewalk {
  return z < CROSS_STREET_MID_Z ? 'far' : 'near';
}

/**
 * Which way a stand's counter faces, as a sign on the z axis:
 *   +1  the front (where customers line up) faces +z, i.e. the camera. Far-sidewalk
 *       stands: the walkers' lane runs in front of them, between stand and street.
 *   -1  the front faces -z, i.e. the street. Near-sidewalk stands are turned around so
 *       they still face the street and the walkers' lane on their own sidewalk.
 * Everything placed "in front of" or "behind" a counter (queue spots, the vendor's spot,
 * the collision nudge, the model's rotation) multiplies its z offset by this.
 */
export type StandFacing = 1 | -1;

export function standFacing(pos: Pick<Vec2, 'z'>): StandFacing {
  return sidewalkOf(pos.z) === 'far' ? 1 : -1;
}

/**
 * Where strolling pedestrians walk: a band of z per sidewalk, each walker keeps one lane
 * for life (a new random z inside the band on every respawn). The far band is the one the
 * game was tuned with; the near band sits just past the near curb (z 7.5), in front of
 * near-side stands' customer lines and on the near avenue crosswalk (z 7.7..9.5).
 */
export const WALKER_LANES: Readonly<Record<Sidewalk, { minZ: number; maxZ: number }>> = Object.freeze({
  far: Object.freeze({ minZ: 0.4, maxZ: 1.85 }),
  near: Object.freeze({ minZ: 7.75, maxZ: 8.2 }),
});

/**
 * Painted zebra crossings (CentralParkScene.addAvenueAndCrosswalks draws its stripes
 * from these numbers, and the path-finder treats the same areas as safe to cross):
 *   - two across the avenue (north-south road, |x| < 2.8), centred on z = AVENUE_CROSSWALK_Z,
 *     each AVENUE_CROSSWALK_HALF_DEPTH deep on either side of its centre;
 *   - two across the cross street (east-west road), centred on x = +-CROSS_CROSSWALK_X,
 *     CROSS_CROSSWALK_HALF_WIDTH wide on either side.
 */
export const AVENUE_CROSSWALKS: readonly { z: number; halfDepth: number }[] = Object.freeze([
  { z: 1.3, halfDepth: 1.0 }, // far side of the intersection
  { z: 8.6, halfDepth: 0.9 }, // near side of the intersection
]);
export const CROSS_CROSSWALK_X = 4.2;
export const CROSS_CROSSWALK_HALF_WIDTH = 0.9;

/** True on a painted crosswalk (only meaningful on a road; see isOnRoad). */
export function isOnCrosswalk(p: Vec2): boolean {
  const onAvenueCrossing =
    Math.abs(p.x) < AVENUE_HALF_WIDTH && AVENUE_CROSSWALKS.some((c) => Math.abs(p.z - c.z) < c.halfDepth);
  const onCrossStreetCrossing =
    p.z > CROSS_STREET_Z_MIN &&
    p.z < CROSS_STREET_Z_MAX &&
    Math.abs(Math.abs(p.x) - CROSS_CROSSWALK_X) < CROSS_CROSSWALK_HALF_WIDTH;
  return onAvenueCrossing || onCrossStreetCrossing;
}

// ---------------------------------------------------------------------------
// Box construction
// ---------------------------------------------------------------------------

/** Build a box from a centre and half-extents. */
function boxAt(id: string, cx: number, cz: number, halfX: number, halfZ: number): Box {
  return { id, minX: cx - halfX, maxX: cx + halfX, minZ: cz - halfZ, maxZ: cz + halfZ };
}

export interface ColliderOptions {
  neighborhood: NeighborhoodId;
  /**
   * Where the player's BUILT stands are on this street (one entry per built plot, taken
   * from core/plots.ts). Empty and leased plots are only paint on the ground, so they
   * never block; only a built stand has a counter you can bump into.
   */
  builtPlots: readonly Vec2[];
  /**
   * The seller's FOR SALE stand is still in business (store: selectSellerPresent). It is
   * only solid in the seller plot's own district; see `sellerStandShown`.
   */
  sellerPresent: boolean;
  /**
   * Also treat street furniture (lamps, hydrant, bins, sign pole, subway
   * entrance) as solid. Whether these should block is an open product decision
   * (today the player walks straight through them), so this defaults to false.
   */
  includeProps?: boolean;
}

/**
 * Footprint of a stand counter, relative to the stand's position. The counter mesh is
 * 2.04 wide; the own stand's box is nudged +0.1 in x (the lemon crates sit on its right)
 * and the seller's -0.1 (its crates sit on the left), matching where the props really are.
 * A near-sidewalk stand is the same model turned around (standFacing = -1), so its crates,
 * and therefore the nudge, end up on the other side: the nudge is multiplied by the facing.
 */
const OWN_STAND_BOX = { dx: 0.1, halfX: 1.3, halfZ: 0.5 } as const;
const SELLER_STAND_BOX = { dx: -0.1, halfX: 1.35, halfZ: 0.54 } as const;

/** The solid box of the player's built stand standing at `pos`. Exported for tests. */
export function ownStandBox(pos: Vec2, id = 'own-stand'): Box {
  const dx = OWN_STAND_BOX.dx * standFacing(pos);
  return boxAt(id, pos.x + dx, pos.z, OWN_STAND_BOX.halfX, OWN_STAND_BOX.halfZ);
}

/**
 * Stand / stall boxes:
 *  - market: three stalls, each |dx| < 1.25 and |dz| < 0.5 around its position.
 *  - elsewhere: one box per BUILT plot (|dx| < 1.3 around plot.x + 0.1, |dz| < 0.5), plus
 *    the seller stand (|dx| < 1.35 around its x - 0.1, |dz| < 0.54) only while it is
 *    shown on this street.
 * Built-stand ids are 'own-stand-0', 'own-stand-1', ... in the order given.
 */
function standColliders(opts: ColliderOptions): Box[] {
  if (opts.neighborhood === 'market') {
    return [
      boxAt('market-stalls', MARKET_STALLS_POS.x, MARKET_STALLS_POS.z, 1.25, 0.5),
      boxAt('market-pitchers', MARKET_PITCHERS_POS.x, MARKET_PITCHERS_POS.z, 1.25, 0.5),
      boxAt('market-lemons', MARKET_LEMONS_POS.x, MARKET_LEMONS_POS.z, 1.25, 0.5),
    ];
  }
  const boxes: Box[] = opts.builtPlots.map((p, i) => ownStandBox(p, `own-stand-${i}`));
  if (sellerStandShown(opts.neighborhood, opts.sellerPresent)) {
    const seller = sellerStandPos();
    boxes.push(
      boxAt('seller-stand', seller.x + SELLER_STAND_BOX.dx * standFacing(seller), seller.z, SELLER_STAND_BOX.halfX, SELLER_STAND_BOX.halfZ)
    );
  }
  return boxes;
}

/**
 * Street furniture footprints. The meshes are round cylinders; we only have
 * boxes, so each half-size is the mesh's base radius rounded up a little.
 */
const LAMP_HALF = 0.2; // lamp base radius 0.16 (CentralParkScene.ts:886)
const BIN_HALF = 0.25; // trash can top radius 0.24 (CentralParkScene.ts:2036)
const HYDRANT_HALF = 0.18; // hydrant base radius 0.16 (CentralParkScene.ts:1079)
const SIGN_POLE_HALF = 0.1; // sign pole radius 0.048 (CentralParkScene.ts:743), padded

function lamps(coords: Array<[number, number]>): Box[] {
  return coords.map(([x, z], i) => boxAt(`lamp-${i}`, x, z, LAMP_HALF, LAMP_HALF));
}

/** The four-lamp layout used by central-park, broadway, fidi and fifth-ave. */
const STANDARD_LAMPS: Array<[number, number]> = [
  [-3.3, 2.3],
  [3.3, 2.3],
  [3.3, -2.6],
  [-3.3, -2.6],
];

function propColliders(neighborhood: NeighborhoodId): Box[] {
  // The shared corner sign is added to the scene itself (buildSharedCornerSign,
  // called at :276), not to a neighborhood group, so it exists everywhere.
  // Its pole sits at (3.45, 1.75) (:740).
  const boxes: Box[] = [boxAt('corner-sign-pole', 3.45, 1.75, SIGN_POLE_HALF, SIGN_POLE_HALF)];

  switch (neighborhood) {
    case 'central-park':
      // Lamps :1069-1074; trash cans :1075 (7.25, -2.8) and :1076 (-3.45, 1.75); hydrant :1082 (3.38, 0.55).
      // The 7.25,-2.8 bin is centred just outside the walk bounds (z < -2.68) but its box pokes in.
      boxes.push(
        ...lamps(STANDARD_LAMPS),
        boxAt('trash-0', 7.25, -2.8, BIN_HALF, BIN_HALF),
        boxAt('trash-1', -3.45, 1.75, BIN_HALF, BIN_HALF),
        boxAt('hydrant', 3.38, 0.55, HYDRANT_HALF, HYDRANT_HALF)
      );
      break;
    case 'market':
      // buildUnionSquareMarketLayout (:1090) never calls addStreetlamps: no extra props.
      break;
    case 'columbia':
      // Quad lamps, lampCoords at :1429-1434 (z = -2.9 is outside the walk bounds; kept for fidelity).
      boxes.push(
        ...lamps([
          [-4.2, -2.9],
          [4.2, -2.9],
          [-4.2, 2.2],
          [4.2, 2.2],
        ])
      );
      break;
    case 'broadway':
      boxes.push(...lamps(STANDARD_LAMPS)); // :1552-1557
      break;
    case 'west-village':
      // Only two lamps here, :1691-1694.
      boxes.push(
        ...lamps([
          [-3.5, 2.3],
          [3.5, 2.3],
        ])
      );
      break;
    case 'fidi':
      // Subway entrance group at (9.4, -2.5) (:1817); stair pit 2.2 x 1.3 (:1820). Lamps :1845-1850.
      boxes.push(boxAt('subway-entrance', 9.4, -2.5, 1.1, 0.65), ...lamps(STANDARD_LAMPS));
      break;
    case 'fifth-ave':
      boxes.push(...lamps(STANDARD_LAMPS)); // :1975-1983
      break;
  }
  return boxes;
}

/**
 * All obstacles for a neighborhood. Pure: same inputs give the same boxes.
 * Callers should cache the result and recompute only when the neighborhood, the
 * set of built plots or the seller's presence changes.
 */
export function getColliders(opts: ColliderOptions): Box[] {
  const boxes = standColliders(opts);
  if (opts.includeProps === true) {
    boxes.push(...propColliders(opts.neighborhood));
  }
  return boxes;
}

// ---------------------------------------------------------------------------
// Queries and movement
// ---------------------------------------------------------------------------

/** True when `pos` is strictly inside any box (same strict `<` semantics as today). */
export function isBlocked(pos: Vec2, colliders: readonly Box[]): boolean {
  for (const b of colliders) {
    if (pos.x > b.minX && pos.x < b.maxX && pos.z > b.minZ && pos.z < b.maxZ) return true;
  }
  return false;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/**
 * Move `pos` by `delta`, sliding along obstacles instead of sticking to them.
 *
 * Algorithm (axis-separated "collide and slide"):
 *  1. Clamp the full target to the walk bounds (identical to today's clamp).
 *  2. If the full move is clear, take it.
 *  3. Otherwise try moving on x only (keeping z), then on z only (keeping x).
 *     Pushing diagonally into a wall keeps the component that runs along it.
 *  4. If nothing works the position is unchanged and `moved` is false, so the
 *     caller can stop the walk animation and footsteps (no moon-walking in place).
 *
 * Trade-off: axis-separated sliding is exact for axis-aligned boxes (all of ours)
 * and costs at most three box tests. For rotated or round obstacles you would
 * project the delta onto the surface normal instead.
 *
 * Known limitation (same as today): a player who is already inside a box (e.g. a
 * plot just became 'built' under their feet) cannot move at all, because every
 * candidate step is also inside the box.
 */
export function moveWithSliding(
  pos: Vec2,
  delta: Vec2,
  colliders: readonly Box[],
  bounds: Bounds = WALK_BOUNDS
): { pos: Vec2; moved: boolean } {
  const nextX = clamp(pos.x + delta.x, bounds.minX, bounds.maxX);
  const nextZ = clamp(pos.z + delta.z, bounds.minZ, bounds.maxZ);

  const candidates: Vec2[] = [
    { x: nextX, z: nextZ },
    { x: nextX, z: pos.z },
    { x: pos.x, z: nextZ },
  ];
  for (const c of candidates) {
    if (c.x === pos.x && c.z === pos.z) continue; // not actually a move
    if (!isBlocked(c, colliders)) return { pos: c, moved: true };
  }
  return { pos: { x: pos.x, z: pos.z }, moved: false };
}
