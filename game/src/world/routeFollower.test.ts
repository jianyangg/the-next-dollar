import { describe, expect, it } from 'vitest';
import type { Box } from './collision';
import {
  ARRIVE_DISTANCE,
  STUCK_SECONDS,
  followRoute,
  replaceWaypoints,
  routeGoal,
  startRoute,
  type RouteState,
} from './routeFollower';

const DT = 1 / 60;
const wall: Box = { id: 'wall', minX: 1, maxX: 2, minZ: -1, maxZ: 1 };

/** Run followRoute until the status stops being 'following' (or a frame cap). */
function run(state: RouteState, colliders: Box[], maxFrames = 2000): RouteState {
  let s = state;
  for (let i = 0; i < maxFrames && s.status === 'following'; i++) s = followRoute(s, DT, colliders);
  return s;
}

describe('followRoute', () => {
  it('walks through each waypoint in order and stops at the last', () => {
    const wps = [
      { x: 2, z: 0 },
      { x: 2, z: 3 },
      { x: -1, z: 3 },
    ];
    let s = startRoute({ x: 0, z: 0 }, wps);
    const visited = new Set<number>();
    for (let i = 0; i < 2000 && s.status === 'following'; i++) {
      s = followRoute(s, DT, []);
      visited.add(s.index);
    }
    expect(s.status).toBe('arrived');
    expect([...visited]).toEqual(expect.arrayContaining([0, 1, 2]));
    const last = wps[2];
    expect(Math.hypot(s.pos.x - last.x, s.pos.z - last.z)).toBeLessThanOrEqual(ARRIVE_DISTANCE);
  });

  it('moves at about PLAYER_SPEED and reports moved/dir', () => {
    const s = followRoute(startRoute({ x: 0, z: 0 }, [{ x: 5, z: 0 }]), 0.1, []);
    expect(s.moved).toBe(true);
    expect(s.pos.x).toBeCloseTo(0.46, 5);
    expect(s.dir).toEqual({ x: 1, z: 0 });
  });

  it('does not mutate the input state', () => {
    const s0 = startRoute({ x: 0, z: 0 }, [{ x: 5, z: 0 }]);
    followRoute(s0, 0.1, []);
    expect(s0.pos).toEqual({ x: 0, z: 0 });
  });

  it('an empty route is already arrived', () => {
    expect(startRoute({ x: 0, z: 0 }, []).status).toBe('arrived');
  });

  it('slides along a wall instead of stopping', () => {
    // Target is diagonal past the wall face; sliding keeps the z progress.
    const s = followRoute(startRoute({ x: 0.99, z: 0 }, [{ x: 3, z: 3 }]), DT, [wall]);
    expect(s.moved).toBe(true);
    expect(s.pos.z).toBeGreaterThan(0);
  });

  it('requests a re-plan after STUCK_SECONDS of refused steps, then fails if still stuck', () => {
    // Waypoint straight through the wall: every step is refused.
    let s = startRoute({ x: 0.99, z: 0 }, [{ x: 3, z: 0 }]);
    const frames = Math.ceil(STUCK_SECONDS / DT) + 2;
    for (let i = 0; i < frames && s.status === 'following'; i++) s = followRoute(s, DT, [wall]);
    expect(s.status).toBe('needs-repath');
    expect(s.moved).toBe(false);
    expect(routeGoal(s)).toEqual({ x: 3, z: 0 });

    s = replaceWaypoints(s, [{ x: 3, z: 0 }]);
    expect(s.status).toBe('following');
    expect(s.repathUsed).toBe(true);
    for (let i = 0; i < frames && s.status === 'following'; i++) s = followRoute(s, DT, [wall]);
    expect(s.status).toBe('failed');
  });

  it('a successful step resets the stuck timer', () => {
    let s = startRoute({ x: 0.99, z: 0 }, [{ x: 3, z: 0 }]);
    s = followRoute(s, 0.1, [wall]);
    expect(s.stuckTime).toBeCloseTo(0.1, 5);
    s = followRoute({ ...s, pos: { x: 0, z: 0 } }, DT, [wall]);
    expect(s.stuckTime).toBe(0);
  });

  it('cancel (key input) ends the route immediately without moving', () => {
    const s0 = startRoute({ x: 0, z: 0 }, [{ x: 5, z: 0 }]);
    const s = followRoute(s0, DT, [], true);
    expect(s.status).toBe('cancelled');
    expect(s.moved).toBe(false);
    expect(s.pos).toEqual({ x: 0, z: 0 });
  });

  it('follows corner waypoints around a wall', () => {
    const s = run(
      startRoute({ x: 0, z: 0 }, [
        { x: 1.5, z: 1.5 },
        { x: 3, z: 0 },
      ]),
      [wall]
    );
    expect(s.status).toBe('arrived');
  });
});
