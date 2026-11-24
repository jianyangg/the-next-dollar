import { describe, expect, it } from 'vitest';
import * as triple from './tripleSqueeze';
import * as tube from './keepInTube';
import * as stir from './rapidStir';
import * as bull from './movingBullseye';
import { initGame, pressGame, pressStirKey, stepGame } from './index';

const zero = () => 0;
const seqRand = (...vals: number[]) => {
  let i = 0;
  return () => vals[i++ % vals.length];
};
const base = { pitchers: 1, workers: 0 };

describe('tripleSqueeze', () => {
  it('draws targets in rand-call order with 2-decimal rounding', () => {
    expect(triple.init(zero).targets).toEqual([0.18, 0.44, 0.72]);
    expect(triple.init(() => 0.5).targets).toEqual([0.24, 0.5, 0.79]);
  });

  it('moves the needle as a ping-pong at 1.38/s', () => {
    const s0 = triple.init(zero);
    expect(triple.step(s0, 0.5).state.needle).toBeCloseTo(0.69, 10);
    expect(triple.step(s0, 1).state.needle).toBeCloseTo(1 - 0.38, 10); // 1.38 -> 2 - 1.38 = 0.62
  });

  it('times out exactly at 3.2s with a tier from hits', () => {
    const at = (hits: number, elapsed: number) => ({ ...triple.init(zero), hits, elapsed });
    expect(triple.step(at(0, 3.0), 0.19).outcome).toBeUndefined();
    expect(triple.step(at(0, 3.0), 0.2).outcome).toBe('sour');
    expect(triple.step(at(1, 3.0), 0.2).outcome).toBe('sour');
    expect(triple.step(at(2, 3.0), 0.2).outcome).toBe('good');
    expect(triple.step(at(3, 3.0), 0.2).outcome).toBe('perfect');
  });

  it('scripts three hits to perfect, advancing a step per press', () => {
    let s = triple.init(zero);
    for (const [i, t] of [0.18, 0.44, 0.72].entries()) {
      s = { ...s, needle: t };
      const r = triple.press(s, base);
      s = r.state;
      expect(s.step).toBe(i + 1);
      expect(r.outcome).toBe(i === 2 ? 'perfect' : undefined);
    }
    expect(s.hits).toBe(3);
  });

  it('scripts two hits then a miss to good, and all misses to sour', () => {
    let s = triple.init(zero);
    s = triple.press({ ...s, needle: 0.18 }, base).state;
    s = triple.press({ ...s, needle: 0.44 }, base).state;
    expect(triple.press({ ...s, needle: 0 }, base).outcome).toBe('good');
    let m = triple.init(zero);
    m = triple.press({ ...m, needle: 1 }, base).state;
    m = triple.press({ ...m, needle: 1 }, base).state;
    expect(triple.press({ ...m, needle: 1 }, base).outcome).toBe('sour');
  });

  it('hit window is inclusive and widens with upgrades', () => {
    const s = { ...triple.init(zero), needle: 0.18 + 0.068 + 0.001 };
    expect(triple.press(s, base).state.hits).toBe(0);
    expect(triple.press(s, { pitchers: 2, workers: 1 }).state.hits).toBe(1);
  });

  it('does not mutate its input', () => {
    const s = triple.init(zero);
    const copy = JSON.parse(JSON.stringify(s));
    triple.step(s, 0.5);
    triple.press(s, base);
    expect(s).toEqual(copy);
  });
});

describe('keepInTube', () => {
  const inputs = { ...base, spaceHeld: false };

  it('starts centered with the original initial values', () => {
    expect(tube.init(() => 0.25)).toMatchObject({ center: 0.5, drop: 0.5, fill: 0.32, elapsed: 0 });
    expect(tube.init(() => 0.25).phase).toBeCloseTo(Math.PI / 2, 10);
  });

  it('caps physics dt at 0.05 but advances elapsed by the raw dt', () => {
    const r = tube.step(tube.init(zero), 0.2, inputs).state;
    expect(r.elapsed).toBeCloseTo(0.2, 10);
    expect(r.drop).toBeCloseTo(0.5 - 0.68 * 0.05, 10);
    // Tube center uses raw elapsed (0.2), not the capped 0.05.
    expect(r.center).toBeCloseTo(0.5 + 0.31 * Math.sin(0.2 * 2.15) + 0.11 * Math.cos(0.2 * 3.8), 10);
    // Drop is outside the tube here, so fill drains by 0.22 * 0.05.
    expect(r.fill).toBeCloseTo(0.32 - 0.22 * 0.05, 10);
  });

  it('accelerates right while space is held', () => {
    const r = tube.step(tube.init(zero), 0.04, { ...inputs, spaceHeld: true }).state;
    expect(r.drop).toBeCloseTo(0.5 + 1.15 * 0.04, 10);
  });

  it('clamps the drop to [0.03, 0.97]', () => {
    const s = { ...tube.init(zero), drop: 0.04 };
    expect(tube.step(s, 0.05, inputs).state.drop).toBe(0.03);
    expect(tube.step({ ...s, drop: 0.96 }, 0.05, { ...inputs, spaceHeld: true }).state.drop).toBe(0.97);
  });

  it('click adds 0.14 to the drop, capped at 0.97', () => {
    expect(tube.press(tube.init(zero)).state.drop).toBeCloseTo(0.64, 10);
    expect(tube.press({ ...tube.init(zero), drop: 0.9 }).state.drop).toBe(0.97);
  });

  it('fills to 1 inside the tube -> perfect', () => {
    const s = { ...tube.init(zero), fill: 0.999, drop: 0.7 };
    const r = tube.step(s, 0.01, { ...inputs, spaceHeld: true });
    expect(r.state.fill).toBe(1);
    expect(r.outcome).toBe('perfect');
  });

  it('times out exactly at 4.0s: good at fill >= 0.65, else sour', () => {
    const s = (fill: number) => ({ ...tube.init(zero), elapsed: 3.9, fill, drop: 0.5 });
    expect(tube.step(s(0.7), 0.09, inputs).outcome).toBeUndefined();
    expect(tube.step(s(0.7), 0.1, inputs).outcome).toBe('good');
    expect(tube.step(s(0.5), 0.1, inputs).outcome).toBe('sour');
  });
});

describe('rapidStir', () => {
  it('builds 4 keys with no immediate repeat, then SPACE', () => {
    expect(stir.init(zero).seq).toEqual(['W', 'A', 'W', 'A', 'SPACE']);
    // Many pseudo-random sequences never repeat adjacent keys.
    let seed = 7;
    const lcg = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
    for (let n = 0; n < 200; n++) {
      const { seq } = stir.init(lcg);
      expect(seq).toHaveLength(5);
      for (let i = 1; i < 4; i++) expect(seq[i]).not.toBe(seq[i - 1]);
    }
  });

  it('completing the sequence gives perfect', () => {
    let s = stir.init(zero);
    for (const [i, k] of s.seq.entries()) {
      const r = stir.pressKey(s, k);
      s = r.state;
      expect(r.outcome).toBe(i === 4 ? 'perfect' : undefined);
    }
  });

  it('wrong key adds a 0.28s penalty and flags a shake', () => {
    const r = stir.pressKey(stir.init(zero), 'S');
    expect(r.shake).toBe(true);
    expect(r.state.penalty).toBeCloseTo(0.28, 10);
    expect(r.state.index).toBe(0);
    expect(stir.step(r.state, 1.3).state.fuse).toBeCloseTo(1 - 1.58 / 2.6, 10);
  });

  it('lock button presses the expected key', () => {
    let s = stir.init(zero);
    s = stir.pressLock(s).state;
    expect(s.index).toBe(1);
  });

  it('fuse burns out exactly at 2.6s: good if index >= 3, else sour', () => {
    const at = (index: number) => ({ ...stir.init(zero), index });
    expect(stir.step(at(0), 2.59).outcome).toBeUndefined();
    expect(stir.step(at(2), 2.6)).toMatchObject({ outcome: 'sour', state: { fuse: 0 } });
    expect(stir.step(at(3), 2.6).outcome).toBe('good');
  });
});

describe('movingBullseye', () => {
  it('starts with needle 0, bullseye 0.78, phase rand*PI', () => {
    expect(bull.init(() => 0.5)).toMatchObject({ needle: 0, bullseye: 0.78 });
    expect(bull.init(() => 0.5).phase).toBeCloseTo(Math.PI / 2, 10);
  });

  it('moves needle at 1.95/s and bullseye on a cosine', () => {
    const r = bull.step(bull.init(zero), 0.5).state;
    expect(r.needle).toBeCloseTo(0.975, 10);
    expect(r.bullseye).toBeCloseTo(0.5 + 0.3 * Math.cos(1.2), 10);
  });

  it('times out exactly at 3.0s as sour', () => {
    const s = { ...bull.init(zero), elapsed: 2.8 };
    expect(bull.step(s, 0.19).outcome).toBeUndefined();
    expect(bull.step(s, 0.2).outcome).toBe('sour');
  });

  it('press picks tier by distance (inclusive thresholds)', () => {
    const at = (d: number) => ({ ...bull.init(zero), needle: 0.5, bullseye: 0.5 + d });
    expect(bull.press(at(0.05), base).outcome).toBe('perfect');
    expect(bull.press(at(0.1), base).outcome).toBe('good');
    expect(bull.press(at(0.3), base).outcome).toBe('sour');
    expect(bull.press(at(0.09), { pitchers: 2, workers: 1 }).outcome).toBe('perfect');
  });
});

describe('index dispatcher', () => {
  const inputs = { ...base, spaceHeld: false };

  it('initialises and steps each kind through one API', () => {
    for (const kind of ['triple-squeeze', 'keep-in-tube', 'rapid-stir', 'moving-bullseye'] as const) {
      const s = initGame(kind, seqRand(0.1, 0.2, 0.3, 0.4));
      expect(s.kind).toBe(kind);
      expect(stepGame(s, 0.016, inputs).state.kind).toBe(kind);
      expect(pressGame(s, base).state.kind).toBe(kind);
    }
  });

  it('only forwards stir keys to rapid-stir', () => {
    const t = initGame('triple-squeeze', zero);
    expect(pressStirKey(t, 'W').state).toBe(t);
    const s = initGame('rapid-stir', zero);
    expect(pressStirKey(s, 'W').state).toMatchObject({ index: 1 });
  });
});
