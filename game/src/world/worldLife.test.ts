import { describe, expect, it, vi } from 'vitest';

// CentralParkScene imports the sound engine (Web Audio); these tests never play sound.
vi.mock('../audio/soundEngine', () => ({ playStep: () => {} }));

import { NEIGHBORHOODS } from '../core/neighborhoods';

const NEIGHBORHOOD_IDS = NEIGHBORHOODS.map((n) => n.id);
import { OWN_STAND_POS, WALK_BOUNDS, getColliders, isBlocked, type Box } from './collision';
import {
  SUBWAY_ENTRANCE_XZ,
  SUBWAY_INTERACT_RADIUS,
  pickNearbyTarget,
  subwayCollider,
  withSubwayCollider,
} from './CentralParkScene';
import { buildGrid, findPath } from './pathfinding';
import { hasTraffic } from './collision';
import { idleFrameAt, moodForPatience, type IdleFrameKey } from './pixelArt';

function overlaps(a: Box, b: Box): boolean {
  return a.minX < b.maxX && a.maxX > b.minX && a.minZ < b.maxZ && a.maxZ > b.minZ;
}

describe('moodForPatience (face above a queued customer)', () => {
  it('is happy while most patience is left, flat when low, angry when nearly gone', () => {
    expect(moodForPatience(1)).toBe('happy');
    expect(moodForPatience(0.56)).toBe('happy');
    expect(moodForPatience(0.55)).toBe('neutral'); // boundary matches the patience bar's colour switch
    expect(moodForPatience(0.29)).toBe('neutral');
    expect(moodForPatience(0.28)).toBe('angry');
    expect(moodForPatience(0)).toBe('angry');
  });
});

describe('idleFrameAt (blink + breathe for characters standing still)', () => {
  const sample = (seed: number, seconds = 60, step = 0.02): Array<[number, IdleFrameKey]> => {
    const out: Array<[number, IdleFrameKey]> = [];
    for (let t = 0; t < seconds; t += step) out.push([t, idleFrameAt(t, seed)]);
    return out;
  };

  it('blinks once every 3 to 4 seconds, whatever the seed', () => {
    for (const seed of [0, 0.15, 0.4, 0.65, 0.9, 1.37]) {
      const frames = sample(seed);
      // A blink "starts" at every transition into 'blink'.
      const starts: number[] = [];
      for (let i = 1; i < frames.length; i++) {
        if (frames[i][1] === 'blink' && frames[i - 1][1] !== 'blink') starts.push(frames[i][0]);
      }
      expect(starts.length).toBeGreaterThan(10);
      for (let i = 1; i < starts.length; i++) {
        const gap = starts[i] - starts[i - 1];
        expect(gap).toBeGreaterThanOrEqual(2.95);
        expect(gap).toBeLessThanOrEqual(4.05);
      }
    }
  });

  it('keeps the eyes closed only briefly (a blink, not a nap)', () => {
    const frames = sample(0);
    const blinkShare = frames.filter(([, k]) => k === 'blink').length / frames.length;
    expect(blinkShare).toBeGreaterThan(0.02);
    expect(blinkShare).toBeLessThan(0.08);
  });

  it('breathes between blinks: both the rest and the lowered frame appear', () => {
    const kinds = new Set(sample(0.5).map(([, k]) => k));
    expect(kinds).toEqual(new Set(['rest', 'breathe', 'blink']));
  });

  it('desynchronises neighbours with different seeds', () => {
    const a = sample(0.15, 20).map(([, k]) => k).join();
    const b = sample(0.65, 20).map(([, k]) => k).join();
    expect(a).not.toEqual(b);
  });
});

describe('pickNearbyTarget', () => {
  it('returns null when nothing is in range', () => {
    expect(pickNearbyTarget([{ target: 'subway', dist: 3, radius: 2.1 }])).toBeNull();
  });
  it('picks the closest of several in-range targets', () => {
    expect(
      pickNearbyTarget([
        { target: 'own-stand', dist: 2.4, radius: 2.65 },
        { target: 'subway', dist: 1.2, radius: 2.1 },
      ])
    ).toBe('subway');
  });
  it('ignores a target whose radius does not reach the player, even if it is listed first', () => {
    expect(
      pickNearbyTarget([
        { target: 'seller-stand', dist: 3, radius: 2.75 },
        { target: 'own-stand', dist: 2.5, radius: 2.65 },
      ])
    ).toBe('own-stand');
  });
});

describe('subway entrance in every neighborhood', () => {
  const plotStatuses = ['empty', 'leased', 'built'] as const;
  const subway = subwayCollider();

  it('adds the box once, and never duplicates the one collision.ts already has for FiDi', () => {
    const fidi = getColliders({ neighborhood: 'fidi', plotStatus: 'empty', includeProps: true });
    expect(withSubwayCollider(fidi).filter((b) => b.id === 'subway-entrance')).toHaveLength(1);
    const park = getColliders({ neighborhood: 'central-park', plotStatus: 'empty', includeProps: true });
    expect(park.some((b) => b.id === 'subway-entrance')).toBe(false);
    expect(withSubwayCollider(park).filter((b) => b.id === 'subway-entrance')).toHaveLength(1);
  });

  it('uses the exact footprint collision.ts has for FiDi (one source of truth)', () => {
    const fidiBox = getColliders({ neighborhood: 'fidi', plotStatus: 'empty', includeProps: true }).find(
      (b) => b.id === 'subway-entrance'
    )!;
    expect(fidiBox.minX).toBeCloseTo(subway.minX, 9);
    expect(fidiBox.maxX).toBeCloseTo(subway.maxX, 9);
    expect(fidiBox.minZ).toBeCloseTo(subway.minZ, 9);
    expect(fidiBox.maxZ).toBeCloseTo(subway.maxZ, 9);
  });

  for (const neighborhood of NEIGHBORHOOD_IDS) {
    for (const plotStatus of plotStatuses) {
      it(`${neighborhood} / ${plotStatus}: overlaps no stand, plot pad or street prop`, () => {
        const others = getColliders({ neighborhood, plotStatus, includeProps: true }).filter(
          (b) => b.id !== 'subway-entrance'
        );
        for (const b of others) expect(overlaps(subway, b), `${b.id} overlaps the subway`).toBe(false);

        // The painted plot pad (2.55 x 1.45, centred on the own-stand spot) is not solid but
        // must stay clear of the stairs so the two never look like one object.
        const pad: Box = {
          id: 'plot-pad',
          minX: OWN_STAND_POS.x - 1.3,
          maxX: OWN_STAND_POS.x + 1.3,
          minZ: OWN_STAND_POS.z - 0.8,
          maxZ: OWN_STAND_POS.z + 0.7,
        };
        expect(overlaps(subway, pad)).toBe(false);
      });

      it(`${neighborhood} / ${plotStatus}: the player can walk up to it and press E`, () => {
        const boxes = withSubwayCollider(getColliders({ neighborhood, plotStatus, includeProps: true }));
        const grid = buildGrid(boxes, { hasTraffic: hasTraffic(neighborhood) });
        // Stand just in front (camera side) of the stairs, inside the interaction radius.
        const goal = { x: SUBWAY_ENTRANCE_XZ.x, z: subway.maxZ + 0.35 };
        expect(isBlocked(goal, boxes)).toBe(false);
        expect(Math.hypot(goal.x - SUBWAY_ENTRANCE_XZ.x, goal.z - SUBWAY_ENTRANCE_XZ.z)).toBeLessThan(
          SUBWAY_INTERACT_RADIUS
        );
        const result = findPath({ x: 0, z: 1 }, goal, grid);
        expect(result.kind).toBe('path');
      });
    }
  }

  it('sits inside the walkable area so the camera and bounds can reach it', () => {
    expect(SUBWAY_ENTRANCE_XZ.x).toBeGreaterThan(WALK_BOUNDS.minX);
    expect(SUBWAY_ENTRANCE_XZ.x).toBeLessThan(WALK_BOUNDS.maxX);
    expect(subway.maxZ).toBeGreaterThan(WALK_BOUNDS.minZ);
  });
});
