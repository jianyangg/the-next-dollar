import { describe, expect, it } from 'vitest';
import { getPlot, plotsIn } from '../core/plots';
import { getColliders, isBlocked, isOnCrosswalk, isOnRoad, ownStandBox, type Box, type Vec2 } from './collision';
import { CELL_SIZE, GRID_COLS, GRID_ROWS, buildGrid, findPath, rawPathLength, type NavGrid } from './pathfinding';

/** Central Park with its corner stand built and the seller still in business (the original layout). */
const builtPark = () =>
  getColliders({
    neighborhood: 'central-park',
    builtPlots: [getPlot('central-park/corner')],
    sellerPresent: true,
  });

/** Walk a waypoint list from `from`, sampling densely; returns every sampled point. */
function sampleRoute(from: Vec2, waypoints: Vec2[]): Vec2[] {
  const pts: Vec2[] = [from];
  let cur = from;
  for (const w of waypoints) {
    const len = Math.hypot(w.x - cur.x, w.z - cur.z);
    const n = Math.max(1, Math.ceil(len / 0.02));
    for (let i = 1; i <= n; i++) {
      pts.push({ x: cur.x + ((w.x - cur.x) * i) / n, z: cur.z + ((w.z - cur.z) * i) / n });
    }
    cur = w;
  }
  return pts;
}

function expectPath(r: ReturnType<typeof findPath>): Vec2[] {
  if (r.kind !== 'path') throw new Error('expected a path, got unreachable');
  return r.waypoints;
}

describe('grid', () => {
  it('covers the walk bounds (both sidewalks) with 0.25 cells: 100 x 57', () => {
    expect(CELL_SIZE).toBe(0.25);
    expect(GRID_COLS).toBe(100);
    expect(GRID_ROWS).toBe(57);
  });

  it('blocks cells within the player radius of a stand but not cells well clear of it', () => {
    const grid = buildGrid(builtPark(), { hasTraffic: true });
    // Cell containing (5.7, -1.6) is the middle of the own stand.
    const idx = (x: number, z: number) => Math.floor((z + 2.68) / 0.25) * grid.cols + Math.floor((x + 12.5) / 0.25);
    expect(grid.blocked[idx(5.7, -1.6)]).toBe(1);
    expect(grid.blocked[idx(0, 1)]).toBe(0);
  });
});

describe('findPath around the own stand', () => {
  const colliders = builtPark();
  const grid = buildGrid(colliders, { hasTraffic: true });

  it('goes from in front of the stand to a point behind it, ends exactly at the target and never touches a collider', () => {
    const from = { x: 5.7, z: 0.5 };
    const to = { x: 5.7, z: -2.6 }; // behind the stand: z span is -2.1..-1.1, and the walk bound is -2.68
    const wps = expectPath(findPath(from, to, grid));
    expect(wps.length).toBeGreaterThan(1); // had to turn a corner
    expect(wps[wps.length - 1]).toEqual(to);
    for (const p of sampleRoute(from, wps)) {
      expect(isBlocked(p, colliders)).toBe(false);
    }
  });

  it('retargets a click inside the stand to the nearest open cell next to it', () => {
    const from = { x: 5.7, z: 0.5 };
    const click = { x: 5.7, z: -1.5 }; // inside the stand
    const wps = expectPath(findPath(from, click, grid));
    const end = wps[wps.length - 1];
    expect(end).not.toEqual(click);
    expect(isBlocked(end, colliders)).toBe(false);
    // Nearest open cell is within a few cells of the click (the stand is only 1.0 deep + 0.3 margin).
    expect(Math.hypot(end.x - click.x, end.z - click.z)).toBeLessThan(1.2);
    // And it's on the front side, closest to where the click was relative to the nearest face.
    const own = colliders.find((b) => b.id === 'own-stand-0')!;
    const inside = end.x > own.minX && end.x < own.maxX && end.z > own.minZ && end.z < own.maxZ;
    expect(inside).toBe(false);
  });

  it('works when the player starts inside the stand margin (e.g. spawning right behind the stand)', () => {
    const from = { x: 5.7, z: -2.22 }; // CentralParkScene.ts:398 spawn point behind the own stand
    const to = { x: 0, z: 1 };
    const wps = expectPath(findPath(from, to, grid));
    expect(wps[wps.length - 1]).toEqual(to);
  });
});

describe('findPath unreachable', () => {
  it('returns unreachable when the target is sealed inside a ring of colliders', () => {
    // Four walls forming a closed square around (0, 3).
    const ring: Box[] = [
      { id: 'n', minX: -1.5, maxX: 1.5, minZ: 1.4, maxZ: 1.6 },
      { id: 's', minX: -1.5, maxX: 1.5, minZ: 4.4, maxZ: 4.6 },
      { id: 'w', minX: -1.6, maxX: -1.4, minZ: 1.4, maxZ: 4.6 },
      { id: 'e', minX: 1.4, maxX: 1.6, minZ: 1.4, maxZ: 4.6 },
    ];
    const grid = buildGrid(ring, { hasTraffic: false });
    // Margin 0.3 on each wall leaves an open pocket in the middle (|x|<1.1, z in (2.0,4.0)).
    const result = findPath({ x: -8, z: 3 }, { x: 0, z: 3 }, grid);
    expect(result.kind).toBe('unreachable');
  });

  it('reaches the same target when the ring has a gap', () => {
    const ring: Box[] = [
      { id: 'n', minX: -1.5, maxX: 1.5, minZ: 1.4, maxZ: 1.6 },
      { id: 'w', minX: -1.6, maxX: -1.4, minZ: 1.4, maxZ: 4.6 },
      { id: 'e', minX: 1.4, maxX: 1.6, minZ: 1.4, maxZ: 4.6 },
    ];
    const grid = buildGrid(ring, { hasTraffic: false });
    expect(findPath({ x: -8, z: 3 }, { x: 0, z: 3 }, grid).kind).toBe('path');
  });
});

describe('road crossing preference', () => {
  const colliders = builtPark();
  const traffic = buildGrid(colliders, { hasTraffic: true });
  const noTraffic = buildGrid(colliders, { hasTraffic: false });

  /** Total |dz| travelled while inside the avenue strip |x| < 2.8 (movement along the road). */
  function alongAvenue(from: Vec2, wps: Vec2[]): number {
    const pts = sampleRoute(from, wps);
    let total = 0;
    for (let i = 1; i < pts.length; i++) {
      if (Math.abs(pts[i].x) < 2.8 && Math.abs(pts[i - 1].x) < 2.8) total += Math.abs(pts[i].z - pts[i - 1].z);
    }
    return total;
  }

  it('(-6, 1) to (6, 1) crosses the avenue without walking along it', () => {
    const from = { x: -6, z: 1 };
    const wps = expectPath(findPath(from, { x: 6, z: 1 }, traffic));
    expect(alongAvenue(from, wps)).toBeLessThan(1);
  });

  it('with a height difference, does the sideways drift on the sidewalk, not on the road', () => {
    const from = { x: -8, z: -0.4 };
    const to = { x: 8, z: 2.6 };
    const withCost = alongAvenue(from, expectPath(findPath(from, to, traffic)));
    const withoutCost = alongAvenue(from, expectPath(findPath(from, to, noTraffic)));
    expect(withCost).toBeLessThan(1);
    // Without road costs the diagonal straight shot drifts about 1.0 unit in z inside the 5.6-wide avenue.
    expect(withCost).toBeLessThan(withoutCost);
  });
});

describe('road costs steer long routes', () => {
  const colliders = builtPark();
  const traffic = buildGrid(colliders, { hasTraffic: true });
  const noTraffic = buildGrid(colliders, { hasTraffic: false });

  /**
   * Distance walked along the avenue (z movement, |x| < 2.8) plus along the cross street
   * (x movement, z in 2.9..7.5), excluding the intersection and the painted crosswalks
   * (drifting sideways while crossing on a zebra is how people cross; walking down the
   * open road is what we forbid).
   */
  function alongRoads(from: Vec2, wps: Vec2[]): number {
    const pts = sampleRoute(from, wps);
    let total = 0;
    for (let i = 1; i < pts.length; i++) {
      const p = pts[i];
      if (isOnCrosswalk(p)) continue;
      const onAve = Math.abs(p.x) < 2.8;
      const onCross = p.z > 2.9 && p.z < 7.5;
      if (onAve && !onCross) total += Math.abs(p.z - pts[i - 1].z);
      else if (onCross && !onAve) total += Math.abs(p.x - pts[i - 1].x);
    }
    return total;
  }

  it('from below the cross street to above it, walks the sidewalk instead of the cross street', () => {
    const from = { x: -9, z: 8 };
    const to = { x: 9, z: 1 };
    const withTraffic = alongRoads(from, expectPath(findPath(from, to, traffic)));
    const withoutTraffic = alongRoads(from, expectPath(findPath(from, to, noTraffic)));
    expect(withTraffic).toBeLessThan(withoutTraffic);
    expect(withTraffic).toBeLessThan(1.5);
  });
});

describe('crossing between the two sidewalks', () => {
  // Fifth Ave with every plot built: the corner on the far sidewalk, side and plaza on the near one.
  const colliders = getColliders({ neighborhood: 'fifth-ave', builtPlots: plotsIn('fifth-ave'), sellerPresent: false });
  const traffic = buildGrid(colliders, { hasTraffic: true });

  /** Total distance walked on road that is NOT a painted crosswalk (jaywalking). */
  function jaywalked(from: Vec2, wps: Vec2[]): number {
    const pts = sampleRoute(from, wps);
    let total = 0;
    for (let i = 1; i < pts.length; i++) {
      if (isOnRoad(pts[i]) && !isOnCrosswalk(pts[i])) total += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z);
    }
    return total;
  }

  for (const id of ['fifth-ave/side', 'fifth-ave/plaza']) {
    it(`from the far sidewalk, a click on ${id} (near side) crosses at a crosswalk`, () => {
      const plot = getPlot(id);
      // Start on the far sidewalk level with the plot; finish in front of its counter
      // (near stands face -z, so "in front" is the street side).
      const from = { x: plot.x, z: 0.8 };
      const to = { x: plot.x, z: plot.z - 1.12 };
      const wps = expectPath(findPath(from, to, traffic));
      const pts = sampleRoute(from, wps);
      // It does get across the cross street...
      expect(pts.some((p) => p.z > 2.9 && p.z < 7.5)).toBe(true);
      // ...on the zebra (a cell or so of slack where the route steps on and off it).
      expect(jaywalked(from, wps)).toBeLessThan(0.6);
      for (const p of pts) expect(isBlocked(p, colliders)).toBe(false);
    });
  }

  it('can walk all the way round every near-side stand (a path behind it exists)', () => {
    for (const id of ['fifth-ave/side', 'fifth-ave/plaza']) {
      const box = ownStandBox(getPlot(id));
      const behind = { x: (box.minX + box.maxX) / 2, z: box.maxZ + 0.5 };
      // The strip behind is open (not snapped elsewhere) and reachable from the far sidewalk.
      const wps = expectPath(findPath({ x: 0, z: 1 }, behind, traffic));
      expect(wps.at(-1)).toEqual(behind);
    }
  });
});

describe('smoothing', () => {
  it('reduces waypoint count versus the raw grid path on an open diagonal', () => {
    const grid = buildGrid([], { hasTraffic: false });
    const from = { x: -10, z: -2 };
    const to = { x: 10, z: 7 };
    const raw = rawPathLength(from, to, grid)!;
    const smoothed = expectPath(findPath(from, to, grid));
    expect(raw).toBeGreaterThan(20);
    expect(smoothed.length).toBeLessThanOrEqual(2);
    expect(smoothed.length).toBeLessThan(raw);
  });

  it('keeps corner waypoints when an obstacle is in the way', () => {
    const colliders = builtPark();
    const grid = buildGrid(colliders, { hasTraffic: false });
    const from = { x: 5.7, z: 0.5 };
    const wps = expectPath(findPath(from, { x: 5.7, z: -2.6 }, grid));
    expect(wps.length).toBeGreaterThanOrEqual(2);
    expect(wps.length).toBeLessThan(8);
  });
});

describe('performance', () => {
  it('builds the grid and finds one cross-map path in under 20 ms', () => {
    // Worst case: every FiDi plot built.
    const colliders = getColliders({
      neighborhood: 'fidi',
      builtPlots: plotsIn('fidi'),
      sellerPresent: false,
      includeProps: true,
    });
    // Warm up the JIT so we time steady state, not V8's first-run compilation.
    // One warm-up call is not enough: V8 only optimises a function after it has run
    // hot for a while, so after a single call the next path still costs ~10 ms
    // (measured the same on the old one-sidewalk grid). After a few calls it settles at
    // about 1.4 ms build + 2-3 ms path, which is the figure this budget protects.
    for (let i = 0; i < 4; i++) {
      findPath({ x: -10, z: -2 }, { x: 10, z: 7 }, buildGrid(colliders, { hasTraffic: true }));
    }

    const t0 = performance.now();
    const grid: NavGrid = buildGrid(colliders, { hasTraffic: true });
    const t1 = performance.now();
    const r = findPath({ x: -12, z: -2.4 }, { x: 12, z: 8 }, grid);
    const t2 = performance.now();

    expect(r.kind).toBe('path');
    // eslint-disable-next-line no-console
    console.log(`grid build ${(t1 - t0).toFixed(2)} ms, findPath ${(t2 - t1).toFixed(2)} ms`);
    expect(t2 - t0).toBeLessThan(20);
  });
});
