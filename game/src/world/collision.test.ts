import { describe, expect, it } from 'vitest';
import { NEIGHBORHOODS, type NeighborhoodId } from '../core/neighborhoods';
import { getPlot, plotsIn, SELLER_PLOT_ID } from '../core/plots';
import {
  AVENUE_HALF_WIDTH,
  CROSS_CROSSWALK_HALF_WIDTH,
  CROSS_CROSSWALK_X,
  CROSS_STREET_Z_MAX,
  CROSS_STREET_Z_MIN,
  WALK_BOUNDS,
  getColliders,
  isBlocked,
  moveWithSliding,
  ownStandBox,
  plotsOnStreet,
  sellerStandPos,
  sellerStandShown,
  sidewalkOf,
  standFacing,
  type Box,
  type Vec2,
} from './collision';

const CORNER = getPlot('central-park/corner');
const SELLER = getPlot(SELLER_PLOT_ID);

// Inline copy of the original one-stand rule from CentralParkScene.animate(), so the test
// fails if the extracted, plot-aware version ever drifts from it for the old layout: the
// Central Park corner built (or not) with the seller's stand next to it.
function legacyBlocked(x: number, z: number, neighborhood: string, cornerBuilt: boolean): boolean {
  if (neighborhood === 'market') {
    for (const sx of [-4.3, 0.0, 4.3]) {
      if (Math.abs(x - sx) < 1.25 && Math.abs(z - -1.3) < 0.5) return true;
    }
    return false;
  }
  const own = cornerBuilt && Math.abs(x - (5.6 + 0.1)) < 1.3 && Math.abs(z - -1.6) < 0.5;
  const seller = Math.abs(x - (-5.8 - 0.1)) < 1.35 && Math.abs(z - -1.6) < 0.54;
  return own || seller;
}

describe('isBlocked parity with the original inline rule (Central Park, one stand + seller)', () => {
  const cases: Array<['central-park' | 'market', boolean]> = [
    ['central-park', true],
    ['central-park', false],
    ['market', true],
  ];
  for (const [neighborhood, cornerBuilt] of cases) {
    it(`${neighborhood} / corner built=${cornerBuilt}: dense sample grid matches`, () => {
      const boxes = getColliders({
        neighborhood,
        builtPlots: cornerBuilt ? [CORNER] : [],
        sellerPresent: true,
      });
      let mismatches = 0;
      let blockedCount = 0;
      // 0.01-unit lattice over the whole walkable area (about 2.7 million points).
      for (let x = WALK_BOUNDS.minX; x <= WALK_BOUNDS.maxX; x += 0.01) {
        for (let z = WALK_BOUNDS.minZ; z <= WALK_BOUNDS.maxZ; z += 0.01) {
          const a = isBlocked({ x, z }, boxes);
          const b = legacyBlocked(x, z, neighborhood, cornerBuilt);
          if (b) blockedCount++;
          if (a !== b) mismatches++;
        }
      }
      expect(mismatches).toBe(0);
      // Sanity: the sample really landed inside some stand/stall.
      expect(blockedCount).toBeGreaterThan(0);
    });
  }

  it('stand edges are not blocked (strict comparison) but a hair inside is', () => {
    const boxes = getColliders({
      neighborhood: 'central-park',
      builtPlots: [CORNER],
      sellerPresent: true,
    });
    for (const b of boxes) {
      const midX = (b.minX + b.maxX) / 2;
      const midZ = (b.minZ + b.maxZ) / 2;
      // Exactly on an edge: strict `<` means not blocked.
      expect(isBlocked({ x: b.minX, z: midZ }, [b])).toBe(false);
      expect(isBlocked({ x: b.maxX, z: midZ }, [b])).toBe(false);
      expect(isBlocked({ x: midX, z: b.minZ }, [b])).toBe(false);
      expect(isBlocked({ x: midX, z: b.maxZ }, [b])).toBe(false);
      // A hair inside: blocked.
      expect(isBlocked({ x: b.minX + 1e-9, z: midZ }, [b])).toBe(true);
      expect(isBlocked({ x: midX, z: b.maxZ - 1e-9 }, [b])).toBe(true);
    }
  });
});

describe('getColliders', () => {
  it('boxes every built plot (and only built plots), each centred on its own plot', () => {
    const fidi = plotsIn('fidi');
    expect(fidi.length).toBeGreaterThanOrEqual(2);
    const boxes = getColliders({
      neighborhood: 'fidi',
      builtPlots: fidi,
      sellerPresent: false,
    });
    expect(boxes.map((b) => b.id)).toEqual(fidi.map((_, i) => `own-stand-${i}`));
    fidi.forEach((plot, i) => {
      // Same footprint rule as the original single stand: centred 0.1 toward the crates,
      // which sit on the stand's right (+x on the far sidewalk, -x once turned around on the near one).
      expect((boxes[i].minX + boxes[i].maxX) / 2).toBeCloseTo(plot.x + 0.1 * standFacing(plot));
      expect((boxes[i].minZ + boxes[i].maxZ) / 2).toBeCloseTo(plot.z);
      expect(isBlocked({ x: plot.x, z: plot.z }, boxes)).toBe(true);
    });
    // Nothing built: nothing solid (empty and leased plots are paint on the ground).
    expect(
      getColliders({
        neighborhood: 'fidi',
        builtPlots: [],
        sellerPresent: false,
      })
    ).toEqual([]);
  });

  it('built stands never overlap one another in any district', () => {
    for (const n of NEIGHBORHOODS) {
      const boxes = plotsIn(n.id).map((p) => ownStandBox(p));
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          const a = boxes[i];
          const b = boxes[j];
          const overlap = a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;
          expect(overlap, `${n.id}: plots ${i} and ${j} overlap`).toBe(false);
        }
      }
    }
  });

  it('boxes the seller stand only in Central Park and only while the seller is present', () => {
    const ids = (neighborhood: NeighborhoodId, sellerPresent: boolean) =>
      getColliders({ neighborhood, builtPlots: [], sellerPresent }).map((b) => b.id);
    expect(ids('central-park', true)).toEqual(['seller-stand']);
    expect(ids('central-park', false)).toEqual([]);
    // The FOR SALE stand used to be solid in every district; the deal is Central Park only.
    for (const n of NEIGHBORHOODS.filter((d) => d.id !== 'central-park')) {
      expect(ids(n.id, true), n.id).not.toContain('seller-stand');
    }
    const seller = getColliders({
      neighborhood: 'central-park',
      builtPlots: [],
      sellerPresent: true,
    })[0];
    expect((seller.minX + seller.maxX) / 2).toBeCloseTo(SELLER.x - 0.1);
    expect(sellerStandPos()).toEqual({ x: SELLER.x, z: SELLER.z });
  });

  it('market has exactly the three stalls and ignores plots and the seller', () => {
    const ids = getColliders({
      neighborhood: 'market',
      builtPlots: [CORNER],
      sellerPresent: true,
    }).map((b) => b.id);
    expect(ids).toEqual(['market-stalls', 'market-pitchers', 'market-lemons']);
  });

  it('props are opt-in and add boxes without removing stands', () => {
    const opts = {
      neighborhood: 'central-park' as const,
      builtPlots: [CORNER],
      sellerPresent: true,
    };
    const base = getColliders(opts);
    const withProps = getColliders({ ...opts, includeProps: true });
    expect(withProps.length).toBeGreaterThan(base.length);
    expect(withProps.slice(0, base.length)).toEqual(base);
    const propIds = withProps.map((b) => b.id);
    expect(propIds).toContain('hydrant');
    expect(propIds).toContain('corner-sign-pole');
    const fidi = getColliders({
      neighborhood: 'fidi',
      builtPlots: [],
      sellerPresent: false,
      includeProps: true,
    });
    const subway = fidi.find((b) => b.id === 'subway-entrance')!;
    expect(subway.maxX - subway.minX).toBeCloseTo(2.2);
    expect(subway.maxZ - subway.minZ).toBeCloseTo(1.3);
  });

  it('no built plot overlaps a street prop in any district', () => {
    for (const n of NEIGHBORHOODS) {
      const plots = plotsIn(n.id);
      const props = getColliders({
        neighborhood: n.id,
        builtPlots: [],
        sellerPresent: false,
        includeProps: true,
      });
      for (const plot of plots) {
        const stand = ownStandBox(plot);
        for (const b of props) {
          const overlap = stand.minX < b.maxX && stand.maxX > b.minX && stand.minZ < b.maxZ && stand.maxZ > b.minZ;
          expect(overlap, `${plot.id} overlaps ${b.id}`).toBe(false);
        }
      }
    }
  });
});

describe('plot placement on both sidewalks (every district)', () => {
  const overlap = (a: Box, b: Box) => a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;
  /** The painted pad with its corner flags and sign stake, mirrored for a turned-around stand. */
  const padBox = (p: Vec2): Box => {
    const f = standFacing(p);
    const zA = p.z + f * -0.8;
    const zB = p.z + f * 0.7;
    return { id: 'pad', minX: p.x - 1.5, maxX: p.x + 1.5, minZ: Math.min(zA, zB), maxZ: Math.max(zA, zB) };
  };
  const roads: Box[] = [
    { id: 'avenue', minX: -AVENUE_HALF_WIDTH, maxX: AVENUE_HALF_WIDTH, minZ: -100, maxZ: 100 },
    { id: 'cross-street', minX: -100, maxX: 100, minZ: CROSS_STREET_Z_MIN, maxZ: CROSS_STREET_Z_MAX },
  ];
  /** Where people step off each cross-street crosswalk onto the near and far sidewalks. */
  const crosswalkLandings: Box[] = [-1, 1].flatMap((side) => [
    {
      id: `landing-far-${side}`,
      minX: side * CROSS_CROSSWALK_X - CROSS_CROSSWALK_HALF_WIDTH,
      maxX: side * CROSS_CROSSWALK_X + CROSS_CROSSWALK_HALF_WIDTH,
      minZ: CROSS_STREET_Z_MIN - 1,
      maxZ: CROSS_STREET_Z_MIN,
    },
    {
      id: `landing-near-${side}`,
      minX: side * CROSS_CROSSWALK_X - CROSS_CROSSWALK_HALF_WIDTH,
      maxX: side * CROSS_CROSSWALK_X + CROSS_CROSSWALK_HALF_WIDTH,
      minZ: CROSS_STREET_Z_MAX,
      maxZ: CROSS_STREET_Z_MAX + 1,
    },
  ]);

  for (const n of NEIGHBORHOODS.filter((d) => d.id !== 'market')) {
    it(`${n.id}: stands and pads stay off roads, crosswalk landings, props and each other`, () => {
      const plots = plotsIn(n.id);
      const props = getColliders({ neighborhood: n.id, builtPlots: [], sellerPresent: true, includeProps: true });
      const footprints = plots.map((p) => ({ plot: p, boxes: [ownStandBox(p, p.id), padBox(p)] }));
      for (const { plot, boxes } of footprints) {
        for (const box of boxes) {
          for (const r of [...roads, ...crosswalkLandings, ...props]) {
            if (plot.kind === 'seller' && r.id === 'seller-stand') continue; // the seller stand IS this plot
            expect(overlap(box, r), `${plot.id} (${box.id}) overlaps ${r.id}`).toBe(false);
          }
          // Inside the area the player can walk (so its sign, queue and counter can be reached).
          expect(box.minX).toBeGreaterThan(WALK_BOUNDS.minX);
          expect(box.maxX).toBeLessThan(WALK_BOUNDS.maxX);
          expect(box.maxZ).toBeLessThan(WALK_BOUNDS.maxZ);
        }
      }
      for (let i = 0; i < footprints.length; i++) {
        for (let j = i + 1; j < footprints.length; j++) {
          for (const a of footprints[i].boxes) {
            for (const b of footprints[j].boxes) {
              expect(overlap(a, b), `${footprints[i].plot.id} vs ${footprints[j].plot.id}`).toBe(false);
            }
          }
        }
      }
    });
  }

  it('puts the corner and the seller on the far sidewalk and side/plaza on the near one', () => {
    for (const p of plotsIn('fidi').concat(plotsIn('central-park'))) {
      const expected = p.kind === 'corner' || p.kind === 'seller' ? 'far' : 'near';
      expect(sidewalkOf(p.z), p.id).toBe(expected);
    }
  });

  it('nudges a near-side stand box the other way (its crates are on the other side once turned)', () => {
    const near = getPlot('fidi/plaza');
    const box = ownStandBox(near);
    expect(standFacing(near)).toBe(-1);
    expect((box.minX + box.maxX) / 2).toBeCloseTo(near.x - 0.1);
  });
});

describe('sellerStandShown / plotsOnStreet', () => {
  it('shows the seller stand only in its own district (Central Park) and only while present', () => {
    expect(sellerStandShown('central-park', true)).toBe(true);
    expect(sellerStandShown('central-park', false)).toBe(false);
    for (const n of NEIGHBORHOODS.filter((d) => d.id !== 'central-park')) {
      expect(sellerStandShown(n.id, true), n.id).toBe(false);
    }
  });

  it("keeps ordinary plots, and the seller plot only once it is the player's built stand", () => {
    const view = (id: string, status: 'empty' | 'leased' | 'built') => ({
      ...getPlot(id),
      status,
      staffed: false,
    });
    const park = [view('central-park/corner', 'empty'), view('central-park/side', 'leased')];
    expect(plotsOnStreet([...park, view(SELLER_PLOT_ID, 'empty')], true).map((p) => p.id)).toEqual([
      'central-park/corner',
      'central-park/side',
    ]);
    // Deal won: the seller is gone and its plot is the player's stand.
    expect(plotsOnStreet([...park, view(SELLER_PLOT_ID, 'built')], false).map((p) => p.id)).toContain(SELLER_PLOT_ID);
  });
});

describe('moveWithSliding', () => {
  const boxes = getColliders({
    neighborhood: 'central-park',
    builtPlots: [CORNER],
    sellerPresent: true,
  });
  const own = boxes.find((b) => b.id === 'own-stand-0')!;
  const midX = (own.minX + own.maxX) / 2;

  it('moves freely in open space', () => {
    const r = moveWithSliding({ x: 0, z: 1 }, { x: 0.1, z: 0.05 }, boxes);
    expect(r.moved).toBe(true);
    expect(r.pos).toEqual({ x: 0.1, z: 1.05 });
  });

  it('walking diagonally into the front face slides along it', () => {
    // Just in front of the stand (larger z = toward camera), heading up-left into it.
    const start: Vec2 = { x: midX, z: own.maxZ + 0.01 };
    const r = moveWithSliding(start, { x: -0.08, z: -0.08 }, boxes);
    expect(r.moved).toBe(true);
    expect(r.pos.x).toBeCloseTo(start.x - 0.08); // kept the x component
    expect(r.pos.z).toBe(start.z); // z was refused
  });

  it('walking straight into the face stops with moved=false', () => {
    const start: Vec2 = { x: midX, z: own.maxZ + 0.01 };
    const r = moveWithSliding(start, { x: 0, z: -0.08 }, boxes);
    expect(r.moved).toBe(false);
    expect(r.pos).toEqual(start);
  });

  it('slides along the side face too (z component survives)', () => {
    const start: Vec2 = { x: own.maxX + 0.01, z: CORNER.z };
    const r = moveWithSliding(start, { x: -0.08, z: 0.08 }, boxes);
    expect(r.moved).toBe(true);
    expect(r.pos.x).toBe(start.x);
    expect(r.pos.z).toBeCloseTo(CORNER.z + 0.08);
  });

  it('clamps to walk bounds exactly like the scene and reports no movement at the wall', () => {
    const atEdge = moveWithSliding({ x: 12.5, z: 1 }, { x: 0.5, z: 0 }, boxes);
    expect(atEdge.moved).toBe(false);
    expect(atEdge.pos).toEqual({ x: 12.5, z: 1 });
    const partial = moveWithSliding({ x: 12.45, z: 1 }, { x: 0.5, z: 0 }, boxes);
    expect(partial.pos.x).toBe(12.5);
    expect(partial.moved).toBe(true);
  });
});
