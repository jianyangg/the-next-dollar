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
import type { PlotStatus } from './CentralParkScene';

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
 * The area the player may stand in. handlePointerDown clamps clicks to
 * x in [-12.5, 12.5], z in [-2.68, 8.2] (CentralParkScene.ts:2901-2902) and the
 * per-frame movement clamps to the same numbers (CentralParkScene.ts:3019-3020).
 */
export const WALK_BOUNDS: Bounds = Object.freeze({
  minX: -12.5,
  maxX: 12.5,
  minZ: -2.68,
  maxZ: 8.2,
});

/** Player walk speed in world units per second (CentralParkScene.ts:3018). */
export const PLAYER_SPEED = 4.6;

// ---------------------------------------------------------------------------
// Anchor positions. CentralParkScene derives its THREE.Vector3 copies from these,
// so this file is the single source of truth for where the stands are.
// ---------------------------------------------------------------------------
export const OWN_STAND_POS: Vec2 = { x: 5.6, z: -1.6 }; // CentralParkScene.ts:131
export const SELLER_STAND_POS: Vec2 = { x: -5.8, z: -1.6 }; // CentralParkScene.ts:132
export const MARKET_STALLS_POS: Vec2 = { x: -4.3, z: -1.3 }; // CentralParkScene.ts:134
export const MARKET_PITCHERS_POS: Vec2 = { x: 0.0, z: -1.3 }; // CentralParkScene.ts:135
export const MARKET_LEMONS_POS: Vec2 = { x: 4.3, z: -1.3 }; // CentralParkScene.ts:136

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
// Box construction
// ---------------------------------------------------------------------------

/** Build a box from a centre and half-extents. */
function boxAt(id: string, cx: number, cz: number, halfX: number, halfZ: number): Box {
  return { id, minX: cx - halfX, maxX: cx + halfX, minZ: cz - halfZ, maxZ: cz + halfZ };
}

export interface ColliderOptions {
  neighborhood: NeighborhoodId;
  plotStatus: PlotStatus;
  /**
   * Also treat street furniture (lamps, hydrant, bins, sign pole, subway
   * entrance) as solid. Whether these should block is an open product decision
   * (today the player walks straight through them), so this defaults to false.
   */
  includeProps?: boolean;
}

/**
 * Stand / stall boxes, exactly as the current animate() loop (CentralParkScene.ts:3022-3038):
 *  - market: three stalls, each |dx| < 1.25 and |dz| < 0.5 around its position (:3024-3025).
 *  - elsewhere: the player's own stand (only once the plot is 'built', :3032) with
 *    |dx| < 1.3 around OWN_STAND_POS.x + 0.1 and |dz| < 0.5 (:3033-3034), and the
 *    seller stand |dx| < 1.35 around SELLER_STAND_POS.x - 0.1 and |dz| < 0.54 (:3036).
 *    (Note the own stand is shifted +0.1 in x while the seller stand is shifted -0.1.)
 */
function standColliders(neighborhood: NeighborhoodId, plotStatus: PlotStatus): Box[] {
  if (neighborhood === 'market') {
    return [
      boxAt('market-stalls', MARKET_STALLS_POS.x, MARKET_STALLS_POS.z, 1.25, 0.5),
      boxAt('market-pitchers', MARKET_PITCHERS_POS.x, MARKET_PITCHERS_POS.z, 1.25, 0.5),
      boxAt('market-lemons', MARKET_LEMONS_POS.x, MARKET_LEMONS_POS.z, 1.25, 0.5),
    ];
  }
  const boxes: Box[] = [];
  if (plotStatus === 'built') {
    boxes.push(boxAt('own-stand', OWN_STAND_POS.x + 0.1, OWN_STAND_POS.z, 1.3, 0.5));
  }
  boxes.push(boxAt('seller-stand', SELLER_STAND_POS.x - 0.1, SELLER_STAND_POS.z, 1.35, 0.54));
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
 * Callers should cache the result and recompute only when the neighborhood or
 * the plot status changes.
 */
export function getColliders(opts: ColliderOptions): Box[] {
  const boxes = standColliders(opts.neighborhood, opts.plotStatus);
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
 * Known limitation (same as today): a player who is already inside a box (e.g. the
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
