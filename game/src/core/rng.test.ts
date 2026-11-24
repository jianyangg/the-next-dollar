import { describe, expect, it, vi } from 'vitest';
import { pickChallenge } from './brewing';
import { initGame } from './minigames';
import { createRunStreams, parseSeed } from './rng';

const take = (r: () => number, n: number) => Array.from({ length: n }, r);
const NAMES = ['deal', 'gameplay', 'cosmetic'] as const;

describe('createRunStreams', () => {
  it.each(NAMES)('same seed gives identical first 1000 draws (%s)', (name) => {
    expect(take(createRunStreams(123)[name], 1000)).toEqual(take(createRunStreams(123)[name], 1000));
  });

  it.each(NAMES)('different seed gives a different sequence (%s)', (name) => {
    expect(take(createRunStreams(1)[name], 1000)).not.toEqual(take(createRunStreams(2)[name], 1000));
  });

  it('streams of one seed differ from each other', () => {
    const s = createRunStreams(5);
    const [d, g, c] = [take(s.deal, 50), take(s.gameplay, 50), take(s.cosmetic, 50)];
    expect(d).not.toEqual(g);
    expect(g).not.toEqual(c);
  });

  it('all draws are in [0, 1)', () => {
    const s = createRunStreams(99);
    for (const name of NAMES) {
      for (const v of take(s[name], 5000)) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(1);
      }
    }
  });

  it('extra cosmetic draws do not change gameplay draws', () => {
    const a = createRunStreams(42);
    const b = createRunStreams(42);
    take(a.gameplay, 10);
    take(b.gameplay, 10);
    take(b.cosmetic, 500); // only run b makes cosmetic draws
    expect(take(b.gameplay, 100)).toEqual(take(a.gameplay, 100));
  });
});

describe('parseSeed', () => {
  it.each(['0', '42', '4294967295'])('accepts %j', (raw) => {
    expect(parseSeed(raw)).toBe(Number(raw));
  });
  it.each(['', '-1', '4294967296', '1.5', 'abc', ' 42'])('rejects %j', (raw) => {
    expect(parseSeed(raw)).toBeNull();
  });
  it('rejects null', () => {
    expect(parseSeed(null)).toBeNull();
  });
});

describe('runRandom', () => {
  it('accessors throw before init and work after', async () => {
    // Fresh module instance so no other test's init can leak in.
    vi.resetModules();
    const mod = await import('./runRandom');
    expect(() => mod.gameplayRandom()).toThrow(/initRunRandom/);
    expect(() => mod.cosmeticRandom()).toThrow(/initRunRandom/);
    expect(() => mod.dealRandom()).toThrow(/initRunRandom/);
    expect(() => mod.getRunSeed()).toThrow(/initRunRandom/);
    mod.initRunRandom(7);
    expect(mod.getRunSeed()).toBe(7);
    const v = mod.gameplayRandom();
    expect(v).toBeGreaterThanOrEqual(0);
    expect(v).toBeLessThan(1);
  });
});

describe('determinism end to end', () => {
  it('same seed gives the same challenge and targets', () => {
    const run = () => {
      const rand = createRunStreams(7).gameplay;
      const kind = pickChallenge(null, rand);
      return { kind, game: initGame(kind, rand) };
    };
    expect(run()).toEqual(run());
  });
});
