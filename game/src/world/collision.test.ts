import { describe, expect, it } from 'vitest';
import {
  OWN_STAND_POS,
  SELLER_STAND_POS,
  WALK_BOUNDS,
  getColliders,
  isBlocked,
  moveWithSliding,
  type Vec2,
} from './collision';

// Inline copy of today's rule from CentralParkScene.animate() (lines 3022-3038),
// so the test fails if the extracted version ever drifts from the original.
function legacyBlocked(
  x: number,
  z: number,
  neighborhood: string,
  plotStatus: string
): boolean {
  if (neighborhood === 'market') {
    for (const sx of [-4.3, 0.0, 4.3]) {
      if (Math.abs(x - sx) < 1.25 && Math.abs(z - -1.3) < 0.5) return true;
    }
    return false;
  }
  const own = plotStatus === 'built' && Math.abs(x - (5.6 + 0.1)) < 1.3 && Math.abs(z - -1.6) < 0.5;
  const seller = Math.abs(x - (-5.8 - 0.1)) < 1.35 && Math.abs(z - -1.6) < 0.54;
  return own || seller;
}

describe('isBlocked parity with the inline rule', () => {
  const cases: Array<['central-park' | 'market' | 'columbia', 'empty' | 'leased' | 'built']> = [
    ['central-park', 'built'],
    ['central-park', 'empty'],
    ['central-park', 'leased'],
    ['columbia', 'built'],
    ['market', 'built'],
    ['market', 'empty'],
  ];
  for (const [neighborhood, plotStatus] of cases) {
    it(`${neighborhood} / ${plotStatus}: dense sample grid matches`, () => {
      const boxes = getColliders({ neighborhood, plotStatus });
      let mismatches = 0;
      let blockedCount = 0;
      // 0.01-unit lattice over the whole walkable area (about 2.7 million points).
      for (let x = WALK_BOUNDS.minX; x <= WALK_BOUNDS.maxX; x += 0.01) {
        for (let z = WALK_BOUNDS.minZ; z <= WALK_BOUNDS.maxZ; z += 0.01) {
          const a = isBlocked({ x, z }, boxes);
          const b = legacyBlocked(x, z, neighborhood, plotStatus);
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
    const boxes = getColliders({ neighborhood: 'central-park', plotStatus: 'built' });
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
  it('own stand only exists once the plot is built; seller stand always (outside the market)', () => {
    const ids = (plotStatus: 'empty' | 'leased' | 'built') =>
      getColliders({ neighborhood: 'central-park', plotStatus }).map((b) => b.id);
    expect(ids('empty')).toEqual(['seller-stand']);
    expect(ids('leased')).toEqual(['seller-stand']);
    expect(ids('built')).toEqual(['own-stand', 'seller-stand']);
  });

  it('market has exactly the three stalls and ignores plot status', () => {
    const ids = getColliders({ neighborhood: 'market', plotStatus: 'built' }).map((b) => b.id);
    expect(ids).toEqual(['market-stalls', 'market-pitchers', 'market-lemons']);
  });

  it('props are opt-in and add boxes without removing stands', () => {
    const base = getColliders({ neighborhood: 'central-park', plotStatus: 'built' });
    const withProps = getColliders({ neighborhood: 'central-park', plotStatus: 'built', includeProps: true });
    expect(withProps.length).toBeGreaterThan(base.length);
    expect(withProps.slice(0, base.length)).toEqual(base);
    const propIds = withProps.map((b) => b.id);
    expect(propIds).toContain('hydrant');
    expect(propIds).toContain('corner-sign-pole');
    const fidi = getColliders({ neighborhood: 'fidi', plotStatus: 'empty', includeProps: true });
    const subway = fidi.find((b) => b.id === 'subway-entrance')!;
    expect(subway.maxX - subway.minX).toBeCloseTo(2.2);
    expect(subway.maxZ - subway.minZ).toBeCloseTo(1.3);
  });

  it('anchor constants match the stand boxes', () => {
    const [own] = getColliders({ neighborhood: 'central-park', plotStatus: 'built' });
    expect((own.minX + own.maxX) / 2).toBeCloseTo(OWN_STAND_POS.x + 0.1);
    const seller = getColliders({ neighborhood: 'central-park', plotStatus: 'empty' })[0];
    expect((seller.minX + seller.maxX) / 2).toBeCloseTo(SELLER_STAND_POS.x - 0.1);
  });
});

describe('moveWithSliding', () => {
  const boxes = getColliders({ neighborhood: 'central-park', plotStatus: 'built' });
  const own = boxes.find((b) => b.id === 'own-stand')!;
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
    const start: Vec2 = { x: own.maxX + 0.01, z: -1.6 };
    const r = moveWithSliding(start, { x: -0.08, z: 0.08 }, boxes);
    expect(r.moved).toBe(true);
    expect(r.pos.x).toBe(start.x);
    expect(r.pos.z).toBeCloseTo(-1.52);
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
