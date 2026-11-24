/**
 * routeFollower.ts - pure, per-frame "walk along a list of waypoints" logic.
 *
 * WHY THIS IS A SEPARATE FILE
 * ---------------------------
 * CentralParkScene needs WebGL, which Vitest (Node) does not have. Anything we
 * want to unit test therefore lives here as plain functions over plain data:
 * the scene only calls `followRoute` once per frame and then draws the result.
 *
 * THE MODEL
 * ---------
 * A route is the list of corner points returned by findPath(). Each frame we
 * aim at the current waypoint, take one step of PLAYER_SPEED * dt using
 * moveWithSliding (so stands and props still block us), and advance to the next
 * waypoint once we are within ARRIVE_DISTANCE of it.
 *
 * STUCK HANDLING
 * --------------
 * The route was planned against the obstacles that existed at click time. If the
 * world changes afterwards (a stand is built on the route), a step can be refused
 * every frame. We measure how long we have been unable to move:
 *   - after STUCK_SECONDS of no movement the first time, ask the caller to
 *     re-plan ('needs-repath'); the caller runs findPath again and calls
 *     `replaceWaypoints`;
 *   - if we get stuck again after that re-plan, give up ('failed') so the player
 *     never "walks on the spot" forever.
 */
import { PLAYER_SPEED, WALK_BOUNDS, moveWithSliding, type Box, type Vec2 } from './collision';

/** Distance (world units) at which a waypoint counts as reached (matches the old 0.15 target check). */
export const ARRIVE_DISTANCE = 0.15;

/** How long (seconds) a step may be refused before we treat the route as blocked. */
export const STUCK_SECONDS = 0.25;

export type RouteStatus =
  | 'following' // trying to walk toward the current waypoint
  | 'arrived' // last waypoint reached; route is finished
  | 'needs-repath' // stuck for STUCK_SECONDS and no re-plan used yet: caller should call findPath
  | 'failed' // stuck again after a re-plan: caller should drop the route
  | 'cancelled'; // caller asked to cancel (e.g. a movement key was pressed)

export interface RouteState {
  /** Where the player is now. Updated each frame. */
  pos: Vec2;
  waypoints: readonly Vec2[];
  /** Index of the waypoint we are walking toward. */
  index: number;
  /** Seconds in a row that the step was refused. */
  stuckTime: number;
  /** True once the single allowed re-plan has been spent for this click. */
  repathUsed: boolean;
  /** Result of the last followRoute call. */
  status: RouteStatus;
  /** True if the last call actually changed `pos` (drives walk animation and footsteps). */
  moved: boolean;
  /** Unit direction of the attempted step (for facing), or null if no step was attempted. */
  dir: Vec2 | null;
}

/** Start a fresh route from a findPath result. An empty waypoint list is already 'arrived'. */
export function startRoute(pos: Vec2, waypoints: readonly Vec2[]): RouteState {
  return {
    pos: { x: pos.x, z: pos.z },
    waypoints,
    index: 0,
    stuckTime: 0,
    repathUsed: false,
    status: waypoints.length === 0 ? 'arrived' : 'following',
    moved: false,
    dir: null,
  };
}

/** The final destination of the route (what a re-plan should aim for). */
export function routeGoal(state: RouteState): Vec2 | null {
  return state.waypoints.length === 0 ? null : state.waypoints[state.waypoints.length - 1];
}

/** Swap in a re-planned waypoint list after 'needs-repath'. Spends the one allowed re-plan. */
export function replaceWaypoints(state: RouteState, waypoints: readonly Vec2[]): RouteState {
  return {
    ...state,
    waypoints,
    index: 0,
    stuckTime: 0,
    repathUsed: true,
    status: waypoints.length === 0 ? 'arrived' : 'following',
    moved: false,
    dir: null,
  };
}

/**
 * Advance the route by one frame. Pure: returns a new state, never mutates `state`.
 * `cancel` = true (a WASD key is held) ends the route immediately.
 */
export function followRoute(state: RouteState, dt: number, colliders: readonly Box[], cancel = false): RouteState {
  if (cancel) return { ...state, status: 'cancelled', moved: false, dir: null };

  let index = state.index;
  const pos = state.pos;

  // Skip every waypoint we are already within reach of (several can be close together).
  while (index < state.waypoints.length && distance(pos, state.waypoints[index]) <= ARRIVE_DISTANCE) {
    index++;
  }
  if (index >= state.waypoints.length) {
    return { ...state, index, status: 'arrived', moved: false, dir: null, stuckTime: 0 };
  }

  const target = state.waypoints[index];
  const dist = distance(pos, target);
  const dir = { x: (target.x - pos.x) / dist, z: (target.z - pos.z) / dist };
  // Never step past the waypoint: that would make the sprite jitter around it.
  const stepLen = Math.min(PLAYER_SPEED * dt, dist);
  const result = moveWithSliding(pos, { x: dir.x * stepLen, z: dir.z * stepLen }, colliders, WALK_BOUNDS);

  const stuckTime = result.moved ? 0 : state.stuckTime + dt;
  let status: RouteStatus = 'following';
  if (stuckTime >= STUCK_SECONDS) status = state.repathUsed ? 'failed' : 'needs-repath';

  return { ...state, pos: result.pos, index, stuckTime, status, moved: result.moved, dir };
}

function distance(a: Vec2, b: Vec2): number {
  return Math.hypot(b.x - a.x, b.z - a.z);
}
