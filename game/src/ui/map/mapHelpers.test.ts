import { describe, expect, it } from 'vitest';
import { NEIGHBORHOODS } from '../../core/neighborhoods';
import { crowdFrames, crowdKinds, resetCrowdFramesCache } from './crowdSprites';
import { routeBetween, SUBWAY_LINE_ORDER, toPolylinePoints } from './mapRoute';
import { rentPips } from './rentTiers';

describe('routeBetween', () => {
  it('lists every station between two stops, going south', () => {
    expect(routeBetween('central-park', 'broadway')).toEqual(['central-park', 'fifth-ave', 'broadway']);
  });
  it('reverses the order going north', () => {
    expect(routeBetween('broadway', 'columbia')).toEqual(['broadway', 'fifth-ave', 'central-park', 'columbia']);
  });
  it('is a single stop when from equals to', () => {
    expect(routeBetween('fidi', 'fidi')).toEqual(['fidi']);
  });
  it('covers the whole line end to end', () => {
    expect(routeBetween('columbia', 'fidi')).toEqual([...SUBWAY_LINE_ORDER]);
  });
  it('throws for a station that is not on the line', () => {
    expect(() => routeBetween('columbia', 'fidi', ['columbia'])).toThrow(/not on the subway line/);
  });
  it('puts every neighbourhood on the line exactly once', () => {
    expect([...SUBWAY_LINE_ORDER].sort()).toEqual(NEIGHBORHOODS.map((n) => n.id).sort());
  });
  it('builds polyline points in order', () => {
    const pts = toPolylinePoints(['columbia', 'fidi'], (id) => (id === 'columbia' ? { x: 1, y: 2 } : { x: 3, y: 4 }));
    expect(pts).toBe('1,2 3,4');
  });
});

describe('rentPips', () => {
  const rents = NEIGHBORHOODS.map((n) => n.dailyRent);
  const pipsOf = (id: string) => rentPips(NEIGHBORHOODS.find((n) => n.id === id)!.dailyRent, rents);
  it('gives the free market no pips', () => {
    expect(pipsOf('market')).toBe(0);
  });
  it('splits the real rents into cheap, middle and pricey', () => {
    expect(pipsOf('central-park')).toBe(1); // $2
    expect(pipsOf('columbia')).toBe(1); // $3
    expect(pipsOf('broadway')).toBe(2); // $4
    expect(pipsOf('west-village')).toBe(2); // $5
    expect(pipsOf('fidi')).toBe(3); // $6
    expect(pipsOf('fifth-ave')).toBe(3); // $7
  });
  it('never decreases as rent rises', () => {
    const sorted = [...rents].sort((a, b) => a - b).map((r) => rentPips(r, rents));
    expect(sorted).toEqual([...sorted].sort());
  });
  it('rejects a rent that is not in the list', () => {
    expect(() => rentPips(99, rents)).toThrow();
  });
});

describe('crowd sprites', () => {
  it('drops duplicate pedestrians', () => {
    expect(crowdKinds('west-village')).toEqual(['village-artist', 'park-dog-walker', 'columbia-student']);
  });
  it('exports two frames per pedestrian and caches them', () => {
    resetCrowdFramesCache();
    let calls = 0;
    const make = (_k: unknown, phase: 0 | 1) => {
      calls += 1;
      return { image: { toDataURL: () => `frame-${phase}` } };
    };
    expect(crowdFrames('fidi-suit', make)).toEqual(['frame-0', 'frame-1']);
    crowdFrames('fidi-suit', make);
    expect(calls).toBe(2);
  });
  it('returns null when there is no canvas to export', () => {
    resetCrowdFramesCache();
    expect(crowdFrames('park-jogger', () => ({ image: null }))).toBeNull();
    resetCrowdFramesCache();
    expect(
      crowdFrames('park-jogger', () => {
        throw new Error('no 2d context');
      })
    ).toBeNull();
  });
});
