/**
 * pathfinding.ts - click-to-walk routing around stands, built on a uniform grid + A*.
 *
 * THE PROBLEM
 * -----------
 * Today a click sets a target and the player walks in a straight line toward it.
 * If a stand is in the way, the player just stops against it. We want the player
 * to walk AROUND obstacles to reach the clicked spot.
 *
 * WHY A GRID?
 * -----------
 * A* ("A-star") finds the cheapest route through a graph of nodes. The simplest
 * graph for a flat walkable area is a uniform grid: chop the ground into square
 * cells, mark each cell open or blocked, and let neighbouring open cells be the
 * graph edges. Grids are trivial to build, trivial to debug, and our world is
 * small (see GRID_COLS x GRID_ROWS below), so A* over it takes well under a
 * millisecond. Alternatives (navigation meshes, visibility graphs) give more
 * natural paths but are far more code for a 25 x 11 unit street with a few boxes.
 *
 * HOW A* WORKS (30-second version)
 * --------------------------------
 * Keep a priority queue of cells to explore, ordered by
 *     f = (cost paid to reach the cell so far) + (optimistic guess of the cost left).
 * Repeatedly pop the lowest-f cell, push its open neighbours, and stop when the
 * goal is popped. Because the guess never overestimates, the first route found
 * is the cheapest. We use the `easystarjs` library for this part.
 *
 * WHY STRING-PULLING?
 * -------------------
 * Grid paths zig-zag in 45 degree and 90 degree steps, which looks robotic. The
 * "string-pulling" pass (a.k.a. line-of-sight smoothing) imagines pulling a taut
 * string from the start toward the goal: starting at the first point, keep
 * extending to later points as long as the straight segment stays in open cells;
 * when it would hit something, the last good point becomes a corner. The result
 * is the handful of corners a human would actually walk around.
 *
 * WHY WE INFLATE THE OBSTACLES BY A PLAYER RADIUS
 * -----------------------------------------------
 * The player is treated as a point by collision.ts, but the sprite is about 0.8
 * units wide. If the path hugged a stand's edge exactly, tiny float errors or
 * the 3D perspective would make the sprite overlap the stand, and sliding would
 * snag on the corner. Blocking every cell whose centre is within PLAYER_RADIUS of
 * a collider keeps a margin between route and wall. Because the margin is larger
 * than half a cell diagonal (0.177), any exact point inside an OPEN cell is also
 * truly outside every real collider, so using the exact clicked point as the
 * final waypoint is safe.
 */
import * as EasyStar from 'easystarjs';
import {
  AVENUE_HALF_WIDTH,
  CROSS_STREET_Z_MAX,
  CROSS_STREET_Z_MIN,
  WALK_BOUNDS,
  type Box,
  type Vec2,
} from './collision';

/** Side length of one grid cell in world units. */
export const CELL_SIZE = 0.25;

/**
 * Grid dimensions over WALK_BOUNDS: width 25 / 0.25 = 100 columns; depth
 * 10.88 / 0.25 = 43.52, rounded UP to 44 rows so the whole area is covered
 * (the last row's centre, z = 8.195, is still inside the bounds). 4,400 cells.
 */
export const GRID_COLS = Math.ceil((WALK_BOUNDS.maxX - WALK_BOUNDS.minX) / CELL_SIZE);
export const GRID_ROWS = Math.ceil((WALK_BOUNDS.maxZ - WALK_BOUNDS.minZ) / CELL_SIZE);

/**
 * Player radius used to inflate every collider (world units). The sprite is
 * 1.152 wide (PLAYER_SPRITE_H 1.44 * 0.8, CentralParkScene.ts:147-148) but much
 * of that is transparent padding; 0.3 approximates the feet footprint. Just as
 * important, 0.3 exceeds half a cell diagonal (0.177) - see the header.
 */
export const PLAYER_RADIUS = 0.3;

/**
 * Cost multiplier for walking on a road cell (1 = a normal sidewalk cell).
 * Chosen by trying 1 (no preference), 4 and 8 on five cross-map routes (see the
 * "road crossing preference" tests): 1 cuts diagonally through the intersection,
 * while 4 and 8 produced identical routes that cross each road at right angles
 * and do their sideways drift on the sidewalk. So 4 is the smallest value that
 * gets the behaviour; going higher only risks long detours (e.g. around a closed
 * crosswalk) for no visible gain. One road cell costs as much as four sidewalk cells.
 */
export const ROAD_COST = 4;

const ROAD_AVENUE = 1;
const ROAD_CROSS = 2;

const OPEN = 0;
const BLOCKED = 1;

/** Largest allowed gap between sample points when checking a straight segment. */
const SEGMENT_SAMPLE_STEP = CELL_SIZE / 2;

export interface NavGrid {
  readonly cols: number;
  readonly rows: number;
  /** blocked[row * cols + col] is 1 when that cell cannot be walked on. */
  readonly blocked: Uint8Array;
  /**
   * road[row * cols + col] is a bit set: ROAD_AVENUE (1) and/or ROAD_CROSS (2).
   * 0 means sidewalk. Used for the road-cost A* weights and the smoothing rule.
   */
  readonly road: Uint8Array;
  /** The configured A* solver (synchronous). Cached so grids are built once and queried many times. */
  readonly solver: EasyStar.js;
}

export type PathResult = { kind: 'path'; waypoints: Vec2[] } | { kind: 'unreachable' };

// ---------------------------------------------------------------------------
// Coordinate helpers
// ---------------------------------------------------------------------------

function colOf(x: number): number {
  return Math.floor((x - WALK_BOUNDS.minX) / CELL_SIZE);
}
function rowOf(z: number): number {
  return Math.floor((z - WALK_BOUNDS.minZ) / CELL_SIZE);
}
function centreOf(col: number, row: number): Vec2 {
  return {
    x: WALK_BOUNDS.minX + (col + 0.5) * CELL_SIZE,
    z: WALK_BOUNDS.minZ + (row + 0.5) * CELL_SIZE,
  };
}
function inGrid(col: number, row: number): boolean {
  return col >= 0 && col < GRID_COLS && row >= 0 && row < GRID_ROWS;
}

/** True when the cell containing p is blocked or lies outside the grid. */
function isCellBlocked(grid: NavGrid, p: Vec2): boolean {
  const col = colOf(p.x);
  const row = rowOf(p.z);
  return !inGrid(col, row) || grid.blocked[row * grid.cols + col] === BLOCKED;
}

// ---------------------------------------------------------------------------
// Grid construction
// ---------------------------------------------------------------------------

/**
 * Rasterise colliders into a grid. A cell is blocked when its centre lies inside
 * any collider grown by PLAYER_RADIUS on every side (strict `<`, like isBlocked).
 * Road cells (avenue + cross street) get extra A* cost when the neighborhood has
 * traffic. Building costs ~4,400 cells x a few boxes, which is cheap enough to
 * redo whenever the neighborhood or the plot status changes.
 */
export function buildGrid(colliders: readonly Box[], opts: { hasTraffic: boolean }): NavGrid {
  const blocked = new Uint8Array(GRID_COLS * GRID_ROWS);
  const road = new Uint8Array(GRID_COLS * GRID_ROWS);
  const tiles: number[][] = [];
  const solver = new EasyStar.js();

  for (let row = 0; row < GRID_ROWS; row++) {
    const line: number[] = new Array<number>(GRID_COLS);
    for (let col = 0; col < GRID_COLS; col++) {
      const c = centreOf(col, row);
      let isBlockedCell = false;
      for (const b of colliders) {
        if (
          c.x > b.minX - PLAYER_RADIUS &&
          c.x < b.maxX + PLAYER_RADIUS &&
          c.z > b.minZ - PLAYER_RADIUS &&
          c.z < b.maxZ + PLAYER_RADIUS
        ) {
          isBlockedCell = true;
          break;
        }
      }
      blocked[row * GRID_COLS + col] = isBlockedCell ? BLOCKED : OPEN;
      line[col] = isBlockedCell ? BLOCKED : OPEN;
    }
    tiles.push(line);
  }

  solver.setGrid(tiles);
  solver.setAcceptableTiles([OPEN]);
  // enableSync() makes findPath()+calculate() run to completion in one call
  // (no setTimeout), which the scene needs: it wants the path immediately on click.
  solver.enableSync();
  solver.enableDiagonals();
  // Diagonal steps may not squeeze between two blocked corners (default, stated for clarity).
  solver.disableCornerCutting();

  if (opts.hasTraffic) {
    for (let row = 0; row < GRID_ROWS; row++) {
      for (let col = 0; col < GRID_COLS; col++) {
        const c = centreOf(col, row);
        const onAvenue = Math.abs(c.x) < AVENUE_HALF_WIDTH;
        const onCross = c.z > CROSS_STREET_Z_MIN && c.z < CROSS_STREET_Z_MAX;
        if ((onAvenue || onCross) && blocked[row * GRID_COLS + col] === OPEN) {
          solver.setAdditionalPointCost(col, row, ROAD_COST);
          road[row * GRID_COLS + col] = (onAvenue ? ROAD_AVENUE : 0) | (onCross ? ROAD_CROSS : 0);
        }
      }
    }
  }

  return { cols: GRID_COLS, rows: GRID_ROWS, blocked, road, solver };
}

// ---------------------------------------------------------------------------
// Nearest open cell
// ---------------------------------------------------------------------------

/**
 * Nearest open cell to `p`, searching outward in square rings (a breadth-first
 * expansion by cell distance). The first open cell appears at ring r; a corner
 * of that ring can be up to sqrt(2) times farther than a cell straight across
 * on the next rings, so we keep scanning to ring ceil(r * sqrt(2)) and pick the
 * smallest true Euclidean distance (ties broken by row, then column, so results
 * are deterministic). Returns null when the whole grid is blocked.
 *
 * Known limit: "nearest" ignores connectivity, so if the closest open cell is in
 * a sealed pocket the caller gets 'unreachable' even though a farther cell on the
 * far side of a wall might be reachable.
 */
function nearestOpenCell(grid: NavGrid, p: Vec2): { col: number; row: number } | null {
  const c0 = Math.min(GRID_COLS - 1, Math.max(0, colOf(p.x)));
  const r0 = Math.min(GRID_ROWS - 1, Math.max(0, rowOf(p.z)));
  const maxRing = Math.max(GRID_COLS, GRID_ROWS);
  let best: { col: number; row: number; d2: number } | null = null;
  let stopRing = Infinity;

  for (let ring = 0; ring <= maxRing && ring <= stopRing; ring++) {
    for (let row = r0 - ring; row <= r0 + ring; row++) {
      for (let col = c0 - ring; col <= c0 + ring; col++) {
        // Only the border of the square at this ring distance.
        if (Math.max(Math.abs(col - c0), Math.abs(row - r0)) !== ring) continue;
        if (!inGrid(col, row) || grid.blocked[row * grid.cols + col] === BLOCKED) continue;
        const ctr = centreOf(col, row);
        const d2 = (ctr.x - p.x) ** 2 + (ctr.z - p.z) ** 2;
        if (
          best === null ||
          d2 < best.d2 ||
          (d2 === best.d2 && (row < best.row || (row === best.row && col < best.col)))
        ) {
          best = { col, row, d2 };
          if (stopRing === Infinity) stopRing = Math.ceil(ring * Math.SQRT2) + 1;
        }
      }
    }
  }
  return best === null ? null : { col: best.col, row: best.row };
}

// ---------------------------------------------------------------------------
// Smoothing
// ---------------------------------------------------------------------------

/**
 * Walk the straight segment a->b in small steps. Returns null if any sample lands
 * in a blocked cell. Otherwise returns "along-road distance": how far the segment
 * travels ALONG a road rather than ACROSS it. On the avenue (a north-south strip)
 * that is the z movement made while inside it; on the cross street (an east-west
 * strip) it is the x movement. Crossing squarely scores 0; strolling down the
 * middle of the avenue scores its full length.
 */
function alongRoadDistance(grid: NavGrid, a: Vec2, b: Vec2): number | null {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const steps = Math.max(1, Math.ceil(Math.hypot(dx, dz) / SEGMENT_SAMPLE_STEP));
  let along = 0;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const col = colOf(a.x + dx * t);
    const row = rowOf(a.z + dz * t);
    if (!inGrid(col, row) || grid.blocked[row * grid.cols + col] === BLOCKED) return null;
    const kind = grid.road[row * grid.cols + col];
    // Each sample owns one step of the segment. Standing in the intersection (both bits)
    // counts as 0: you may legitimately go either way there.
    if (i > 0) {
      if (kind === ROAD_AVENUE) along += Math.abs(dz) / steps;
      else if (kind === ROAD_CROSS) along += Math.abs(dx) / steps;
    }
  }
  return along;
}

/**
 * Even when no road is being walked along on purpose, allow this much along-road
 * drift in a shortcut. Needed because a diagonal shortcut across a road always has
 * a little (e.g. a 3-unit sideways change over a 25-unit trip drifts 0.7 units
 * across a 5.6-wide avenue); half a unit is below what the player notices.
 */
const MAX_FREE_ALONG_ROAD = 0.5;

/**
 * String-pulling: from the current anchor, greedily jump to the FARTHEST later
 * point that is still in clear line of sight, then repeat from there.
 *
 * ROAD-AWARE: plain line-of-sight smoothing ignores road costs, so it would
 * replace "drift sideways on the sidewalk, then cross the avenue squarely" with
 * a single diagonal cut across the road, undoing what A* worked out. So a shortcut
 * is accepted only if it walks no further ALONG a road than the raw grid path it
 * replaces (or than MAX_FREE_ALONG_ROAD, whichever is larger).
 *
 * Input includes the start; output includes the start too (callers drop it).
 */
function smooth(grid: NavGrid, points: Vec2[]): Vec2[] {
  if (points.length <= 2) return points;

  // cum[i] = along-road distance of the raw path from points[0] to points[i].
  const cum: number[] = [0];
  for (let i = 1; i < points.length; i++) {
    // A raw hop can sample as blocked only at the unsnapped real start; treat it as 0.
    cum.push(cum[i - 1] + (alongRoadDistance(grid, points[i - 1], points[i]) ?? 0));
  }

  const out: Vec2[] = [points[0]];
  let anchor = 0;
  while (anchor < points.length - 1) {
    let next = anchor + 1; // adjacent points are always fine: the raw path already links them
    for (let j = points.length - 1; j > anchor + 1; j--) {
      const along = alongRoadDistance(grid, points[anchor], points[j]);
      if (along !== null && along <= Math.max(MAX_FREE_ALONG_ROAD, cum[j] - cum[anchor])) {
        next = j;
        break;
      }
    }
    out.push(points[next]);
    anchor = next;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Public query
// ---------------------------------------------------------------------------

/**
 * Raw (unsmoothed) grid route as cell-centre points, or null if none exists.
 * Exported separately so tests can show how much smoothing helps.
 */
export function findRawGridPath(
  from: { col: number; row: number },
  to: { col: number; row: number },
  grid: NavGrid
): Vec2[] | null {
  let result: Array<{ x: number; y: number }> | null | undefined;
  grid.solver.findPath(from.col, from.row, to.col, to.row, (p) => {
    result = p;
  });
  grid.solver.calculate(); // sync mode: finishes before returning
  if (!result) return null;
  return result.map((n) => centreOf(n.x, n.y));
}

/**
 * Route from `from` to `to`, walking around obstacles.
 *
 * Returned waypoints are the points to walk to in order; they do NOT include
 * `from` itself. The last waypoint is the exact clicked point when that point's
 * cell is open, otherwise the centre of the nearest open cell.
 *
 * Edge cases:
 *  - `to` in a blocked cell (inside a stand or its player-radius margin): retarget to
 *    the nearest open cell (see nearestOpenCell).
 *  - `from` in a blocked cell (e.g. standing right behind a stand, inside the margin):
 *    A* needs an open start, so we start from the nearest open cell. The first
 *    waypoint then pulls the player out of the margin; real collision still protects them.
 *  - Points outside the walk bounds are clamped first, like handlePointerDown does.
 */
export function findPath(from: Vec2, to: Vec2, grid: NavGrid): PathResult {
  const clampedFrom: Vec2 = {
    x: Math.min(WALK_BOUNDS.maxX, Math.max(WALK_BOUNDS.minX, from.x)),
    z: Math.min(WALK_BOUNDS.maxZ, Math.max(WALK_BOUNDS.minZ, from.z)),
  };
  const target: Vec2 = {
    x: Math.min(WALK_BOUNDS.maxX, Math.max(WALK_BOUNDS.minX, to.x)),
    z: Math.min(WALK_BOUNDS.maxZ, Math.max(WALK_BOUNDS.minZ, to.z)),
  };

  const targetOpen = !isCellBlocked(grid, target);
  const endCell = targetOpen ? { col: colOf(target.x), row: rowOf(target.z) } : nearestOpenCell(grid, target);
  if (endCell === null) return { kind: 'unreachable' };
  const endPoint: Vec2 = targetOpen ? target : centreOf(endCell.col, endCell.row);

  const startOpen = !isCellBlocked(grid, clampedFrom);
  const startCell = startOpen
    ? { col: colOf(clampedFrom.x), row: rowOf(clampedFrom.z) }
    : nearestOpenCell(grid, clampedFrom);
  if (startCell === null) return { kind: 'unreachable' };

  // Same cell: nothing to route around.
  if (startCell.col === endCell.col && startCell.row === endCell.row) {
    return { kind: 'path', waypoints: [endPoint] };
  }

  const raw = findRawGridPath(startCell, endCell, grid);
  if (raw === null) return { kind: 'unreachable' };

  // Replace the cell-centre ends with the real positions so the walk starts where
  // the player is and finishes where they clicked. When the real start is inside the
  // blocked margin, keep the open cell centre as the first stop instead.
  const points = raw.slice();
  points[points.length - 1] = endPoint;
  points[0] = startOpen ? clampedFrom : points[0];
  const smoothed = smooth(grid, startOpen ? points : [clampedFrom, ...points]);

  return { kind: 'path', waypoints: smoothed.slice(1) };
}

/** Number of waypoints in the unsmoothed route between two points, for tests and tuning. */
export function rawPathLength(from: Vec2, to: Vec2, grid: NavGrid): number | null {
  const a = { col: colOf(from.x), row: rowOf(from.z) };
  const b = { col: colOf(to.x), row: rowOf(to.z) };
  const raw = findRawGridPath(a, b, grid);
  return raw === null ? null : raw.length;
}
