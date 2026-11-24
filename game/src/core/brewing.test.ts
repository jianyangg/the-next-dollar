import { describe, expect, it } from 'vitest';
import { BREW_CHALLENGE_KINDS, applyBrewOutcome, pickChallenge, sweetSpots } from './brewing';

describe('sweetSpots', () => {
  it('uses base widths with one pitcher and no workers', () => {
    const s = sweetSpots({ pitchers: 1, workers: 0 });
    expect(s.perfectHalf).toBeCloseTo(0.055, 10);
    expect(s.goodHalf).toBeCloseTo(0.17, 10);
    expect(s.tubeWidth).toBeCloseTo(0.25, 10);
    expect(s.tripleTargetHalf).toBeCloseTo(0.068, 10);
  });

  it('widens with extra pitchers and workers', () => {
    const s = sweetSpots({ pitchers: 2, workers: 1 });
    expect(s.perfectHalf).toBeCloseTo(0.095, 10);
    expect(s.goodHalf).toBeCloseTo(0.225, 10);
    expect(s.tubeWidth).toBeCloseTo(0.315, 10);
    expect(s.tripleTargetHalf).toBeCloseTo(0.095, 10);
  });

  it('hits the caps with many pitchers and workers', () => {
    expect(sweetSpots({ pitchers: 5, workers: 5 })).toEqual({
      perfectHalf: 0.16,
      goodHalf: 0.32,
      tubeWidth: 0.42,
      tripleTargetHalf: 0.11,
    });
  });

  it('treats zero pitchers like one (no negative bonus)', () => {
    expect(sweetSpots({ pitchers: 0, workers: 0 })).toEqual(sweetSpots({ pitchers: 1, workers: 0 }));
  });
});

describe('pickChallenge', () => {
  const rolls = [0, 0.1, 0.25, 0.34, 0.5, 0.66, 0.75, 0.99, 0.999999];

  it('never repeats the last kind', () => {
    for (const last of BREW_CHALLENGE_KINDS) {
      for (const r of rolls) expect(pickChallenge(last, () => r)).not.toBe(last);
    }
  });

  it('can reach all 4 kinds when there is no last kind', () => {
    const seen = new Set(rolls.concat([0.3, 0.8]).map((r) => pickChallenge(null, () => r)));
    expect(seen.size).toBe(4);
  });

  it('picks uniformly by index from the filtered pool', () => {
    expect(pickChallenge('triple-squeeze', () => 0)).toBe('keep-in-tube');
    expect(pickChallenge('triple-squeeze', () => 0.999)).toBe('moving-bullseye');
  });
});

describe('applyBrewOutcome', () => {
  it('adds 6 / 4 / 2 cups by tier', () => {
    expect(applyBrewOutcome('perfect', 0, 10)).toEqual({ brewedCups: 6, added: 6 });
    expect(applyBrewOutcome('good', 0, 10)).toEqual({ brewedCups: 4, added: 4 });
    expect(applyBrewOutcome('sour', 3, 10)).toEqual({ brewedCups: 5, added: 2 });
  });

  it('clamps to cups in stock', () => {
    expect(applyBrewOutcome('perfect', 8, 10)).toEqual({ brewedCups: 10, added: 2 });
    expect(applyBrewOutcome('good', 10, 10)).toEqual({ brewedCups: 10, added: 0 });
  });
});
