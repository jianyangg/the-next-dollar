import { describe, expect, it } from 'vitest';
import { createRunStreams } from '../rng';
import { lemonadeBrew as brew, pressGame, pressStirKey, squeeze, stepGame, stir, sweeten } from './index';
import type { LemonadeBrewState } from './lemonadeBrew';
import type { LemonKind, SqueezeState } from './squeeze';
import type { StirQuadrant } from './stir';

// Every test runs at a fixed 60 fps so results never depend on the machine.
const DT = 1 / 60;
const seeded = (seed: number) => createRunStreams(seed).gameplay;

/**
 * Squeeze a batch to the end with a "controller": a function that looks at the state
 * each frame and decides whether to hold. Returns the finished squeeze state.
 */
function runSqueeze(lemons: LemonKind[], hold: (s: SqueezeState, frame: number) => boolean): SqueezeState {
  let s = squeeze.init(lemons);
  for (let frame = 0; !s.done && frame < 60 * 30; frame++) s = squeeze.step(s, DT, hold(s, frame)).state;
  expect(s.done).toBe(true);
  return s;
}

/** A skilled squeezer: hold below the middle of the zone, let go above it. */
const feather = (s: SqueezeState) => {
  const spec = squeeze.currentLemon(s);
  return s.pressure < (spec.zoneLow + spec.zoneHigh) / 2;
};
/** Mashing: hold one frame, let go the next, as fast as possible. */
const mash = (_: SqueezeState, frame: number) => frame % 2 === 0;
/** Leaning on it: hold the whole time. */
const holdDown = () => true;

describe('squeeze physics', () => {
  it('raises pressure while held and drops it on release, at fixed rates', () => {
    let s = squeeze.init(['plump']);
    s = squeeze.step(s, 0.25, true).state; // dt is capped at 0.05 per frame
    expect(s.pressure).toBeCloseTo(0.05 * squeeze.PRESSURE_RISE_PER_SEC, 10);
    for (let i = 0; i < 10; i++) s = squeeze.step(s, 0.02, true).state;
    expect(s.pressure).toBeCloseTo(0.06 + 0.2 * squeeze.PRESSURE_RISE_PER_SEC, 10);
    const before = s.pressure;
    s = squeeze.step(s, 0.02, false).state;
    expect(s.pressure).toBeCloseTo(before - 0.02 * squeeze.PRESSURE_FALL_PER_SEC, 10);
  });

  it('runs juice only inside the zone and adds bitterness only above it', () => {
    const spec = squeeze.LEMON_SPECS.plump;
    const below = squeeze.step({ ...squeeze.init(['plump']), pressure: spec.zoneLow - 0.1 }, DT, false).state;
    expect(below.juice).toBe(0);
    expect(below.bitterUnits).toBe(0);

    const inside = squeeze.step({ ...squeeze.init(['plump']), pressure: 0.5 }, DT, true).state;
    expect(inside.juice).toBeCloseTo(squeeze.JUICE_FLOW_PER_SEC * DT, 10);
    expect(inside.flowing).toBe(true);
    expect(inside.bitterUnits).toBe(0);

    const above = squeeze.step({ ...squeeze.init(['plump']), pressure: 0.95 }, DT, true);
    expect(above.state.juice).toBe(0);
    expect(above.state.aboveZone).toBe(true);
    expect(above.state.bitterUnits).toBeCloseTo(squeeze.BITTER_PER_SEC_ABOVE * DT, 10);
    expect(above.cues).toContain('seeds');
  });

  it('moves to the next lemon when one is spent, resetting the pressure', () => {
    const s = { ...squeeze.init(['plump', 'dry']), pressure: 0.5, lemonJuice: 1 - 0.001 };
    const r = squeeze.step(s, DT, true);
    expect(r.cues).toContain('lemon-done');
    expect(r.state).toMatchObject({ index: 1, pressure: 0, lemonJuice: 0, done: false });
    expect(r.state.juice).toBeCloseTo(0.001, 10);
  });

  it('takes a stuck lemon off after LEMON_MAX_SEC of pressing (and not before pressing starts)', () => {
    let idle = squeeze.init(['plump']);
    for (let i = 0; i < 600; i++) idle = squeeze.step(idle, DT, false).state;
    expect(idle).toMatchObject({ index: 0, lemonTime: 0, done: false });

    const stuck = runSqueeze(['plump'], holdDown);
    expect(squeeze.result(stuck).bitterness).toBeGreaterThan(0.9);
  });

  it('mashing cannot stall a lemon: its clock keeps running once pressed', () => {
    let frames = 0;
    let s = squeeze.init(['plump']);
    for (; !s.done && frames < 60 * 30; frames++) s = squeeze.step(s, DT, mash(s, frames)).state;
    expect(frames * DT).toBeCloseTo(squeeze.LEMON_MAX_SEC, 1);
  });

  it('holding at the right pressure beats mashing and beats leaning on it', () => {
    for (const lemons of [['plump', 'plump'], ['dry', 'dry', 'dry'], ['seedy', 'seedy']] as LemonKind[][]) {
      const good = squeeze.result(runSqueeze(lemons, feather));
      const mashed = squeeze.result(runSqueeze(lemons, mash));
      const leaned = squeeze.result(runSqueeze(lemons, holdDown));
      expect(good.efficiency).toBeGreaterThan(0.99);
      expect(good.bitterness).toBe(0);
      // Mashing never builds pressure: almost no juice.
      expect(mashed.efficiency).toBeLessThan(0.2);
      expect(mashed.bitterness).toBe(0);
      // Leaning on it crushes seeds: less juice and very bitter.
      expect(leaned.efficiency).toBeLessThan(good.efficiency);
      expect(leaned.bitterness).toBeGreaterThan(0.5);
    }
  });

  it('dry lemons cap the yield even when squeezed perfectly; plump ones do not', () => {
    expect(squeeze.result(runSqueeze(['plump', 'plump'], feather)).yield).toBeCloseTo(1, 6);
    expect(squeeze.result(runSqueeze(['dry', 'dry'], feather)).yield).toBeCloseTo(
      squeeze.LEMON_SPECS.dry.juice,
      6
    );
  });

  it('a worker squeeze is a fixed average job', () => {
    const w = squeeze.workerResult(['plump', 'plump']);
    expect(w).toEqual({ yield: squeeze.WORKER_SQUEEZE.efficiency, ...squeeze.WORKER_SQUEEZE });
  });
});

describe('sweeten physics', () => {
  it('pours at a fixed rate while pouring, and locks on release', () => {
    let s = sweeten.press(sweeten.init(0.5, 0.1)).state;
    for (let i = 0; i < 60; i++) s = sweeten.step(s, DT);
    expect(s.sweetness).toBeCloseTo(sweeten.SUGAR_POUR_PER_SEC, 10);
    const r = sweeten.release(s);
    expect(r.overshoot).toBe(false);
    expect(r.state.phase).toBe('reveal');
    let after = r.state;
    for (let i = 0; i < 60; i++) after = sweeten.step(after, DT);
    expect(after.sweetness).toBe(s.sweetness); // no pouring after release
    expect(after.phase).toBe('done');
    expect(sweeten.tasteError(after)).toBeCloseTo(0, 10);
  });

  it('offers one "water + lemon" fix after an over-pour, which dilutes the sweetness', () => {
    const over = sweeten.release({ ...sweeten.init(0.4, 0.1), phase: 'pour', sweetness: 0.8 });
    expect(over.overshoot).toBe(true);
    expect(over.state.phase).toBe('offer');
    const fixed = sweeten.press(over.state);
    expect(fixed.fixed).toBe(true);
    expect(fixed.state).toMatchObject({ phase: 'ready', fixUsed: true });
    expect(fixed.state.sweetness).toBeCloseTo(0.8 * sweeten.FIX_DILUTE, 10);
    // A second over-pour is not offered the fix again.
    const again = sweeten.release({ ...fixed.state, phase: 'pour', sweetness: 0.9 });
    expect(again.overshoot).toBe(false);
    expect(again.state.phase).toBe('reveal');
  });

  it('declining the fix (waiting out the offer) keeps it too sweet', () => {
    let s = sweeten.release({ ...sweeten.init(0.4, 0.1), phase: 'pour', sweetness: 0.8 }).state;
    for (let i = 0; i < Math.ceil(sweeten.FIX_OFFER_SEC / DT) + 1; i++) s = sweeten.step(s, DT);
    expect(s.phase).toBe('done');
    expect(sweeten.tasteError(s)).toBeCloseTo(0.4, 10);
  });

  it('narrows the taste band with difficulty', () => {
    expect(sweeten.bandForDifficulty(0)).toBeCloseTo(0.12, 10);
    expect(sweeten.bandForDifficulty(1)).toBeCloseTo(0.05, 10);
  });
});

describe('stir physics', () => {
  /** Make `n` clockwise quarter turns, `interval(i)` seconds apart (stepped at DT). */
  function stirWith(n: number, interval: (i: number) => number) {
    let s = stir.turn(stir.init(), 'W').state;
    let at: StirQuadrant = 'W';
    for (let i = 0; i < n && !s.done; i++) {
      for (let t = 0; t < Math.round(interval(i) / DT); t++) s = stir.step(s, DT);
      at = stir.STIR_ORDER[(stir.STIR_ORDER.indexOf(at) + 1) % 4] as StirQuadrant;
      s = stir.turn(s, at).state;
    }
    return s;
  }

  it('counts only the next clockwise quadrant, ignoring reversals and jitter', () => {
    let s = stir.turn(stir.init(), 'W').state;
    expect(stir.nextQuadrant(s)).toBe('D');
    expect(stir.turn(s, 'A').outcome).toBe('ignored');
    expect(stir.turn(s, 'S').outcome).toBe('ignored');
    for (let i = 0; i < 15; i++) s = stir.step(s, DT);
    const r = stir.turn(s, 'D');
    expect(r.outcome).toBe('turn');
    expect(r.state.quarters).toBe(1);
  });

  it('does not start the clock before the first turn', () => {
    let s = stir.init();
    for (let i = 0; i < 600; i++) s = stir.step(s, DT);
    expect(s).toMatchObject({ clock: 0, done: false });
  });

  it('a steady rhythm dissolves everything with no slop', () => {
    const s = stirWith(20, () => 0.25);
    expect(s.done).toBe(true);
    expect(s.dissolve).toBeCloseTo(1, 10);
    expect(s.slop).toBe(0);
    expect(s.quarters).toBe(10);
  });

  it('a steady rhythm beats a fast one and an erratic one', () => {
    const steady = stirWith(40, () => 0.25);
    const fast = stirWith(40, () => 0.05);
    const erratic = stirWith(40, (i) => (i % 2 === 0 ? 0.15 : 0.45));
    // Fast finishes too, but splashes the pitcher.
    expect(fast.slop).toBeGreaterThan(0.3);
    expect(steady.slop).toBe(0);
    // Erratic turns dissolve less per quarter, so they need more of them.
    expect(erratic.quarters).toBeGreaterThan(steady.quarters);
    expect(erratic.rhythm).toBeLessThan(steady.rhythm);
  });

  it('too slow lets grains settle: nothing dissolves, and the clock runs out gritty', () => {
    const s = stirWith(40, () => 0.6);
    expect(s.done).toBe(true);
    expect(s.dissolve).toBe(0);
  });

  it('maps the pointer to quadrants in screen coordinates (y down)', () => {
    expect(stir.quadrantAt(0, -10)).toBe('W');
    expect(stir.quadrantAt(10, 0)).toBe('D');
    expect(stir.quadrantAt(0, 10)).toBe('S');
    expect(stir.quadrantAt(-10, 0)).toBe('A');
    expect(stir.quadrantAt(2, 2, 12)).toBeNull();
  });
});

/** Drive a whole brew with simple scripted play. */
function playBrew(start: LemonadeBrewState, opts: { sweetAt: number; stirEvery: number; squeezeHold?: typeof feather }) {
  let s = start;
  let outcome: ReturnType<typeof brew.step>['outcome'];
  let quality: ReturnType<typeof brew.step>['quality'];
  let sinceTurn = 0;
  let quadrant: StirQuadrant = 'W';
  for (let frame = 0; frame < 60 * 60 && !outcome; frame++) {
    let held = false;
    if (s.phase === 'squeeze') held = (opts.squeezeHold ?? feather)(s.squeeze);
    // Pour until the sweetness reaches `sweetAt`, then let go (the frame after a
    // fresh press is required, so hold only once the previous release went through).
    if (s.phase === 'sweeten') held = s.sweeten.phase === 'ready' ? !s.held : s.sweeten.phase === 'pour' && s.sweeten.sweetness < opts.sweetAt;
    const r = brew.step(s, DT, { held });
    s = r.state;
    outcome = r.outcome;
    quality = r.quality;
    if (s.phase === 'stir' && !outcome) {
      sinceTurn += DT;
      if (sinceTurn >= opts.stirEvery - 1e-9) {
        sinceTurn = 0;
        const t = brew.stirTurn(s, quadrant);
        s = t.state;
        outcome = t.outcome;
        quality = t.quality;
        quadrant = stir.STIR_ORDER[(stir.STIR_ORDER.indexOf(quadrant) + 1) % 4] as StirQuadrant;
      }
    }
  }
  return { state: s, outcome, quality };
}

describe('lemonade brew (composed)', () => {
  const config = { difficulty: 0, targetSweetness: 0.5, workerSqueezes: false, allowTwists: false };

  it('same seed gives the same lemons; different seeds can differ', () => {
    expect(brew.init(seeded(7), config).squeeze.lemons).toEqual(brew.init(seeded(7), config).squeeze.lemons);
    const batches = new Set([1, 2, 3, 4, 5, 6, 7, 8].map((n) => brew.init(seeded(n), config).squeeze.lemons.join()));
    expect(batches.size).toBeGreaterThan(1);
  });

  it('draws 2 or 3 lemons, harder difficulty giving more dry/seedy lemons and more 3-lemon batches', () => {
    const stats = (difficulty: number) => {
      const rand = seeded(99);
      let plump = 0;
      let total = 0;
      let threes = 0;
      for (let i = 0; i < 400; i++) {
        const lemons = squeeze.drawLemons(rand, difficulty);
        expect([2, 3]).toContain(lemons.length);
        total += lemons.length;
        plump += lemons.filter((k) => k === 'plump').length;
        threes += lemons.length === 3 ? 1 : 0;
      }
      return { plumpShare: plump / total, threes };
    };
    const easy = stats(0);
    const hard = stats(1);
    expect(easy.plumpShare).toBeGreaterThan(hard.plumpShare + 0.3);
    expect(hard.threes).toBeGreaterThan(easy.threes);
  });

  it('difficulty never changes speed: the same inputs move everything identically', () => {
    // Same lemons forced onto both, so only the difficulty-driven content differs.
    const make = (difficulty: number): LemonadeBrewState => {
      const s = brew.init(seeded(3), { ...config, difficulty });
      return { ...s, squeeze: squeeze.init(['seedy', 'seedy']) };
    };
    const script = (s0: LemonadeBrewState) => {
      const trace: number[] = [];
      let s = s0;
      for (let f = 0; f < 240; f++) {
        s = brew.step(s, DT, { held: f % 50 < 30 }).state;
        trace.push(s.squeeze.pressure, s.squeeze.juice, s.sweeten.sweetness);
      }
      return trace;
    };
    expect(script(make(0))).toEqual(script(make(1)));
    // ...while the content really is different.
    expect(make(1).sweeten.band).toBeLessThan(make(0).sweeten.band);
  });

  it('a held key carried over from the squeeze does not start the sugar pour', () => {
    let s: LemonadeBrewState = { ...brew.init(seeded(1), config), phase: 'sweeten', held: true };
    for (let i = 0; i < 30; i++) s = brew.step(s, DT, { held: true }).state;
    expect(s.sweeten.sweetness).toBe(0);
    s = brew.step(s, DT, { held: false }).state;
    s = brew.step(s, DT, { held: true }).state;
    expect(s.sweeten.phase).toBe('pour');
    expect(s.sweeten.sweetness).toBeGreaterThan(0);
  });

  it('skilled play is perfect; sloppy play is sour; both report raw numbers', () => {
    const good = playBrew(brew.init(seeded(11), config), { sweetAt: 0.5, stirEvery: 0.25 });
    expect(good.outcome).toBe('perfect');
    expect(good.quality).toMatchObject({ tier: 'perfect', bitterness: 0, slop: 0, fixUsed: false });
    expect(good.quality?.dissolve).toBeCloseTo(1, 10);
    expect(good.state.phase).toBe('done');

    const bad = playBrew(brew.init(seeded(11), config), {
      sweetAt: 0.95,
      stirEvery: 0.05,
      squeezeHold: holdDown,
    });
    expect(bad.outcome).toBe('sour');
    expect(bad.quality?.yield).toBeLessThan(good.quality?.yield ?? 0);
  });

  it('a worker skips the squeeze step and caps the tier at good', () => {
    const s = brew.init(seeded(11), { ...config, workerSqueezes: true });
    expect(s.phase).toBe('sweeten');
    const r = playBrew(s, { sweetAt: 0.5, stirEvery: 0.25 });
    expect(r.outcome).toBe('good');
    expect(r.quality?.efficiency).toBeCloseTo(squeeze.WORKER_SQUEEZE.efficiency, 10);
  });

  it('stays deterministic end to end for a seed', () => {
    const run = () => playBrew(brew.init(seeded(42), { ...config, difficulty: 0.7 }), { sweetAt: 0.48, stirEvery: 0.3 });
    expect(run()).toEqual(run());
  });

  it('does not mutate its input', () => {
    const s = brew.init(seeded(5), config);
    const copy = structuredClone(s);
    brew.step(s, DT, { held: true });
    brew.stirTurn({ ...s, phase: 'stir' }, 'W');
    expect(s).toEqual(copy);
  });
});

describe('tier mapping', () => {
  const clean = { yield: 1, efficiency: 1, bitterness: 0 };
  const parts = { squeezed: clean, tasteError: 0, band: 0.1, fixUsed: false, dissolve: 1, slop: 0 };

  it('maps score thresholds to the existing BrewTier', () => {
    expect(brew.tierForScore(1)).toBe('perfect');
    expect(brew.tierForScore(brew.TIER_THRESHOLDS.perfect)).toBe('perfect');
    expect(brew.tierForScore(brew.TIER_THRESHOLDS.perfect - 0.001)).toBe('good');
    expect(brew.tierForScore(brew.TIER_THRESHOLDS.good)).toBe('good');
    expect(brew.tierForScore(brew.TIER_THRESHOLDS.good - 0.001)).toBe('sour');
  });

  it('weights sum to 1, so a flawless brew scores exactly 1', () => {
    const w = brew.SCORE_WEIGHTS;
    expect(w.efficiency + w.clean + w.taste + w.dissolve).toBeCloseTo(1, 10);
    expect(brew.scoreBrew(parts)).toMatchObject({ score: 1, tier: 'perfect', yield: 1 });
  });

  it('takes slop and the fix off the yield, and a missed taste lowers the tier', () => {
    const q = brew.scoreBrew({ ...parts, slop: 0.2, fixUsed: true });
    expect(q.yield).toBeCloseTo(0.8 * (1 - sweeten.FIX_YIELD_COST), 10);
    expect(brew.scoreBrew({ ...parts, tasteError: 0.2 }).tier).toBe('good'); // taste at 0, rest perfect
    expect(brew.scoreBrew({ ...parts, tasteError: 0.2, squeezed: { ...clean, bitterness: 1 } }).tier).toBe('sour');
  });

  it('taste score is 1 on target, 0.5 at the band edge, 0 at twice the band', () => {
    expect(brew.tasteScore(0, 0.1)).toBe(1);
    expect(brew.tasteScore(0.1, 0.1)).toBeCloseTo(0.5, 10);
    expect(brew.tasteScore(0.25, 0.1)).toBe(0);
  });
});

describe('dispatcher wiring', () => {
  const inputs = { pitchers: 1, workers: 0, spaceHeld: true };

  it('steps the brew with spaceHeld as the hold level, ignores the lock press, and forwards stir keys', () => {
    const s = brew.init(seeded(2), { difficulty: 0, targetSweetness: 0.5, workerSqueezes: false, allowTwists: false });
    const stepped = stepGame(s, DT, inputs).state;
    expect(stepped.kind === 'lemonade-brew' && stepped.squeeze.pressure).toBeGreaterThan(0);
    expect(pressGame(s, inputs).state).toBe(s);
    const stirring: LemonadeBrewState = { ...s, phase: 'stir' };
    const turned = pressStirKey(stirring, 'S').state;
    expect(turned.kind === 'lemonade-brew' && turned.stir.at).toBe('S');
    expect(pressStirKey(stirring, 'SPACE').state).toBe(stirring);
  });
});

describe('brew twists (one random change per step, never a faster clock)', () => {
  const base = { difficulty: 0, targetSweetness: 0.5, workerSqueezes: false };

  it('the twists do not change which lemons a seed gives', () => {
    for (const seed of [1, 2, 3]) {
      const plain = brew.init(seeded(seed), { ...base, allowTwists: false });
      const twisty = brew.init(seeded(seed), { ...base, allowTwists: true });
      expect(twisty.squeeze.lemons).toEqual(plain.squeeze.lemons);
    }
  });

  it('day 1 (twists off) is always the plain recipe; later every twist shows up', () => {
    for (let seed = 1; seed <= 20; seed++) {
      expect(brew.init(seeded(seed), { ...base, allowTwists: false }).twists).toEqual(brew.PLAIN_TWISTS);
    }
    const seen = new Set<string>();
    for (let seed = 1; seed <= 40; seed++) {
      const t = brew.init(seeded(seed), { ...base, allowTwists: true }).twists;
      seen.add(t.squeeze).add(t.sweeten).add(t.stir);
    }
    for (const v of ['juicer', 'tough-rind', 'sugar', 'honey', 'clockwise', 'counter']) expect(seen).toContain(v);
  });

  it('tough rind: the juicy zone climbs as the lemon empties, by TOUGH_RIND_SHIFT at most', () => {
    const spec = squeeze.LEMON_SPECS.plump;
    const s = squeeze.init(['plump'], { toughRind: true });
    expect(squeeze.juicyZone(s).low).toBeCloseTo(spec.zoneLow);
    const half = { ...s, lemonJuice: spec.juice / 2 };
    expect(squeeze.juicyZone(half).low).toBeCloseTo(spec.zoneLow + squeeze.TOUGH_RIND_SHIFT / 2);
    // Parked at the start of the old zone, the juice stops once the zone has moved past it.
    const parked = squeeze.step({ ...half, pressure: spec.zoneLow + 0.01 }, DT, true).state;
    expect(parked.lemonJuice).toBe(half.lemonJuice);
    // The plain juicer never moves its zone.
    expect(squeeze.juicyZone({ ...squeeze.init(['plump']), lemonJuice: 0.9 }).low).toBe(spec.zoneLow);
  });

  it('honey keeps pouring for HONEY_DRIP_SEC after release, at the same pour rate', () => {
    let s = sweeten.press(sweeten.init(0.5, 0.1, 'honey')).state;
    for (let i = 0; i < 30; i++) s = sweeten.step(s, DT); // 0.5 s of pouring
    const atRelease = s.sweetness;
    s = sweeten.release(s).state;
    expect(s.phase).toBe('drip');
    for (let i = 0; i < 30 && s.phase === 'drip'; i++) s = sweeten.step(s, DT);
    expect(s.sweetness).toBeCloseTo(atRelease + sweeten.HONEY_DRIP_SEC * sweeten.SUGAR_POUR_PER_SEC, 5);
    // 0.25 poured + 0.125 dripped = 0.375: under the 0.4..0.6 band, so no fix is offered.
    expect(s.phase).toBe('reveal');
  });

  it('honey that drips over the band offers the fix, with the overshoot cue', () => {
    let s: LemonadeBrewState = {
      ...brew.init(seeded(1), { ...base, allowTwists: false, twists: { ...brew.PLAIN_TWISTS, sweeten: 'honey' } }),
      phase: 'sweeten',
    };
    s = { ...s, sweeten: { ...s.sweeten, phase: 'pour', sweetness: 0.55 } };
    let cues: string[] = [];
    s = brew.step(s, DT, { held: true }).state;
    s = brew.release(s).state; // 0.55 + drip 0.125 = ~0.68 > 0.5 + band
    for (let i = 0; i < 30 && s.sweeten.phase === 'drip'; i++) {
      const r = brew.step(s, DT, { held: false });
      s = r.state;
      cues = cues.concat(r.cues ?? []);
    }
    expect(s.sweeten.phase).toBe('offer');
    expect(cues).toContain('overshoot');
  });

  it('counter stir: W A S D counts as turns, W D S A does not', () => {
    let s = stir.turn(stir.init(-1), 'W').state;
    expect(stir.nextQuadrant(s)).toBe('A');
    expect(stir.turn(s, 'D').outcome).toBe('ignored');
    s = stir.turn(s, 'A').state;
    expect(s.quarters).toBe(1);
    expect(stir.nextQuadrant(s)).toBe('S');
  });
});
