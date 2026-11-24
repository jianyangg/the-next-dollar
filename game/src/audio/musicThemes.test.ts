import { describe, expect, it } from 'vitest';
import { NEIGHBORHOODS } from '../core/neighborhoods';
import { createRunStreams } from '../core/rng';
import {
  DEFAULT_MUSIC_THEME_ID,
  MUSIC_THEMES,
  PEDAL_LEVEL_TRIM,
  VOICE_SHAPES,
  eighthNoteSeconds,
  loopLengthSteps,
  voiceEnvelope,
} from './musicThemes';
import {
  decideThemeChange,
  midiToFreq,
  pickVariant,
  planRumble,
  soundEngine,
  stationChimeMidi,
  throttleAllows,
  varyRatio,
} from './soundEngine';

/** A fake random stream that replays a fixed list, for exact expectations. */
function sequence(values: number[]): () => number {
  let i = 0;
  return () => values[i++ % values.length];
}

describe('music theme data', () => {
  const themes = Object.values(MUSIC_THEMES);

  it('has a theme for every district in the game, keyed by its own id', () => {
    for (const hood of NEIGHBORHOODS) {
      expect(MUSIC_THEMES[hood.id], hood.id).toBeDefined();
      expect(MUSIC_THEMES[hood.id].id).toBe(hood.id);
    }
    expect(MUSIC_THEMES[DEFAULT_MUSIC_THEME_ID].id).toBe('central-park');
  });

  it('gives every district a different tempo, key or groove (no two themes identical)', () => {
    const fingerprints = themes.map((t) => JSON.stringify([t.bpm, t.stepsPerBar, t.progression[0].chord]));
    expect(new Set(fingerprints).size).toBe(themes.length);
  });

  it.each(themes.map((t) => [t.id, t] as const))('%s has sane timing', (_id, theme) => {
    // 60-160 BPM covers ballad to brisk swing; outside it the loop would feel broken.
    expect(theme.bpm).toBeGreaterThanOrEqual(60);
    expect(theme.bpm).toBeLessThanOrEqual(160);
    expect([6, 8]).toContain(theme.stepsPerBar);
    // Swing above 1/3 of an eighth would push off-beats past a triplet feel.
    expect(theme.swing).toBeGreaterThanOrEqual(0);
    expect(theme.swing).toBeLessThanOrEqual(0.34);
    expect(theme.warmthHz).toBeGreaterThan(500);
    expect(theme.warmthHz).toBeLessThan(6000);
    expect(eighthNoteSeconds(theme)).toBeCloseTo(30 / theme.bpm, 10);
    expect(loopLengthSteps(theme)).toBe(theme.progression.length * theme.stepsPerBar);
  });

  it.each(themes.map((t) => [t.id, t] as const))('%s has a well-formed progression', (_id, theme) => {
    expect(theme.progression.length).toBeGreaterThan(0);
    for (const bar of theme.progression) {
      // Every per-tick lane must have exactly one entry per tick of the bar.
      expect(bar.bass).toHaveLength(theme.stepsPerBar);
      expect(bar.melody).toHaveLength(theme.stepsPerBar);
      expect(bar.chord.length).toBeGreaterThan(0);
      for (const step of bar.compSteps) {
        expect(Number.isInteger(step)).toBe(true);
        expect(step).toBeGreaterThanOrEqual(0);
        expect(step).toBeLessThan(theme.stepsPerBar);
      }
      // Ranges: chords C3..C5, bass E1..E3, melody C4..C7. Each range keeps
      // the part audible on laptop speakers and out of the others' way.
      for (const midi of bar.chord) {
        expect(midi).toBeGreaterThanOrEqual(48);
        expect(midi).toBeLessThanOrEqual(72);
      }
      for (const midi of bar.bass) {
        if (midi === null) continue;
        expect(midi).toBeGreaterThanOrEqual(28);
        expect(midi).toBeLessThanOrEqual(56);
      }
      for (const hit of bar.melody) {
        if (hit === null) continue;
        const [midi, velocity] = hit;
        expect(midi).toBeGreaterThanOrEqual(60);
        expect(midi).toBeLessThanOrEqual(96);
        expect(velocity).toBeGreaterThan(0);
        expect(velocity).toBeLessThanOrEqual(1);
      }
    }
    // Every theme must actually have a tune.
    const melodyNotes = theme.progression.flatMap((bar) => bar.melody.filter((hit) => hit !== null));
    expect(melodyNotes.length).toBeGreaterThan(theme.progression.length);
  });

  it.each(themes.map((t) => [t.id, t] as const))('%s keeps levels in the shared family range', (_id, theme) => {
    // Similar gains across themes is what keeps a district change from being jarring.
    const gains = [
      theme.comp.downbeatVelocity,
      theme.comp.offbeatVelocity,
      theme.bass.rootGain,
      theme.bass.otherGain,
      theme.lead.gain,
    ];
    for (const g of gains) {
      expect(g).toBeGreaterThan(0.05);
      expect(g).toBeLessThanOrEqual(0.6);
    }
    for (const lane of [theme.percussion.shaker, theme.percussion.kick, theme.percussion.rim]) {
      expect(lane).toHaveLength(theme.stepsPerBar);
      for (const g of lane) {
        expect(g).toBeGreaterThanOrEqual(0);
        expect(g).toBeLessThanOrEqual(0.2);
      }
    }
  });

  it('keeps the central-park theme identical to the original single soundtrack', () => {
    const cp = MUSIC_THEMES['central-park'];
    expect(cp.bpm).toBe(106);
    expect(cp.swing * eighthNoteSeconds(cp)).toBeCloseTo(0.022, 10);
    expect(cp.progression[0].chord).toEqual([52, 55, 59, 62]);
    expect(cp.progression).toHaveLength(8);
  });

  it('converts MIDI to frequency with A4 = 440 Hz', () => {
    expect(midiToFreq(69)).toBeCloseTo(440, 6);
    expect(midiToFreq(81)).toBeCloseTo(880, 6);
    expect(midiToFreq(60)).toBeCloseTo(261.63, 1);
  });
});

describe('decideThemeChange', () => {
  it('is a no-op when asked for the theme that is already playing', () => {
    expect(decideThemeChange({ active: 'fidi', pending: null, playing: true }, 'fidi')).toBe('none');
  });

  it('is a no-op when asked again for the theme already queued', () => {
    expect(decideThemeChange({ active: 'fidi', pending: 'market', playing: true }, 'market')).toBe('none');
  });

  it('queues a different theme while music is audible (switch waits for a bar line)', () => {
    expect(decideThemeChange({ active: 'central-park', pending: null, playing: true }, 'broadway')).toBe('queue');
    // Changing your mind mid-queue re-targets the queue.
    expect(decideThemeChange({ active: 'central-park', pending: 'broadway', playing: true }, 'fidi')).toBe('queue');
  });

  it('cancels the queue when asked to go back to the theme that is still playing', () => {
    expect(decideThemeChange({ active: 'columbia', pending: 'fidi', playing: true }, 'columbia')).toBe(
      'cancel-queue'
    );
  });

  it('swaps immediately when nothing is audible (paused, muted, MP3, not started)', () => {
    expect(decideThemeChange({ active: 'central-park', pending: null, playing: false }, 'fifth-ave')).toBe(
      'swap-now'
    );
    expect(decideThemeChange({ active: 'central-park', pending: null, playing: false }, 'central-park')).toBe(
      'none'
    );
  });
});

describe('subway map station chime', () => {
  it('walks strictly downward in pitch from uptown (index 0) to downtown for lines up to 10 stations', () => {
    for (let count = 2; count <= 10; count++) {
      for (let i = 1; i < count; i++) {
        expect(stationChimeMidi(i, count)).toBeLessThan(stationChimeMidi(i - 1, count));
      }
    }
  });

  it('never goes back up on long lines, and stays in a pleasant chime range', () => {
    for (const count of [1, 7, 11, 25]) {
      for (let i = 0; i < count; i++) {
        const midi = stationChimeMidi(i, count);
        expect(midi).toBeGreaterThanOrEqual(67); // G4
        expect(midi).toBeLessThanOrEqual(88); // E6
        if (i > 0) expect(midi).toBeLessThanOrEqual(stationChimeMidi(i - 1, count));
      }
    }
  });

  it('clamps bad input instead of throwing (it is only a hover sound)', () => {
    expect(stationChimeMidi(-3, 7)).toBe(stationChimeMidi(0, 7));
    expect(stationChimeMidi(99, 7)).toBe(stationChimeMidi(6, 7));
    expect(stationChimeMidi(Number.NaN, 0)).toBe(67);
  });

  it('throttles chimes that start less than the gap after the previous one', () => {
    expect(throttleAllows(null, 0, 40)).toBe(true);
    expect(throttleAllows(1000, 1039, 40)).toBe(false);
    expect(throttleAllows(1000, 1040, 40)).toBe(true);
  });
});

describe('per-play variation helpers', () => {
  it('varyRatio stays within +-spread', () => {
    expect(varyRatio(0.03, () => 0)).toBeCloseTo(0.97, 10);
    expect(varyRatio(0.03, () => 0.5)).toBeCloseTo(1, 10);
    expect(varyRatio(0.03, () => 0.999999)).toBeLessThan(1.03);
  });

  it('pickVariant always returns a valid index', () => {
    expect(pickVariant(3, () => 0)).toBe(0);
    expect(pickVariant(3, () => 0.5)).toBe(1);
    expect(pickVariant(3, () => 0.999999)).toBe(2);
    expect(pickVariant(0, () => 0.7)).toBe(0);
  });

  it('is deterministic for the same seeded cosmetic stream', () => {
    const a = createRunStreams(1234).cosmetic;
    const b = createRunStreams(1234).cosmetic;
    expect(planRumble(1.1, a)).toEqual(planRumble(1.1, b));
  });
});

describe('subway ride rumble plan', () => {
  it('puts every clack inside the ride, in order, in pairs', () => {
    const plan = planRumble(1.1, sequence([0.1, 0.9, 0.4, 0.6, 0.3]));
    expect(plan.clackTimes.length).toBeGreaterThanOrEqual(2);
    expect(plan.clackTimes.length % 2).toBe(0);
    for (let i = 0; i < plan.clackTimes.length; i++) {
      expect(plan.clackTimes[i]).toBeGreaterThanOrEqual(0);
      expect(plan.clackTimes[i]).toBeLessThan(1.1);
      if (i > 0) expect(plan.clackTimes[i]).toBeGreaterThan(plan.clackTimes[i - 1]);
    }
    expect(plan.rumbleCutoffHz).toBeGreaterThanOrEqual(170);
    expect(plan.rumbleCutoffHz).toBeLessThanOrEqual(260);
    expect(plan.humHz).toBeGreaterThanOrEqual(52);
    expect(plan.humHz).toBeLessThanOrEqual(64);
  });

  it('differs between rides', () => {
    const stream = createRunStreams(99).cosmetic;
    expect(planRumble(1.1, stream)).not.toEqual(planRumble(1.1, stream));
  });
});

describe('sound engine without an AudioContext (Node, SSR, tests)', () => {
  it('accepts theme and subway calls in any order without throwing', () => {
    // There is no window here, so nothing plays; this checks the bookkeeping
    // paths (remember theme, duck/unduck, arrival switch) are safe.
    expect(() => {
      soundEngine.setMusicTheme('broadway');
      soundEngine.setMusicTheme('broadway');
      soundEngine.playSubwayDepart();
      soundEngine.setMusicTheme('fidi');
      soundEngine.playSubwayArrive('fidi');
      soundEngine.playMapStation(2, 7);
      soundEngine.playMapSelect();
      soundEngine.startMusic();
      soundEngine.setMusicTheme('central-park');
      soundEngine.stopMusic();
    }).not.toThrow();
  });
});

describe('sustain pedal (voiceEnvelope)', () => {
  it('never rises faster than 8 ms, so no note starts with a click', () => {
    for (const shape of Object.values(VOICE_SHAPES)) {
      expect(voiceEnvelope(shape, 0.002, 0.3, 0.1).attack).toBeGreaterThanOrEqual(0.008);
    }
  });

  it('holds at a sustain level instead of dying inside the written length', () => {
    const env = voiceEnvelope(VOICE_SHAPES.piano, 0.005, 0.4, 0.1);
    expect(env.sustainLevel).toBeGreaterThan(0);
    expect(env.sustainLevel).toBeLessThan(env.peak);
    expect(env.holdEnd).toBeCloseTo(0.4);
  });

  it('keeps ringing after the note ends: piano and Rhodes tails overlap the next eighth note', () => {
    const eighth = Math.max(...Object.values(MUSIC_THEMES).map((t) => eighthNoteSeconds(t)));
    for (const inst of ['piano', 'rhodes', 'vibes', 'pad'] as const) {
      const env = voiceEnvelope(VOICE_SHAPES[inst], 0.005, 0.3, 0.1);
      expect(env.release).toBeGreaterThan(eighth);
      expect(env.stopAt).toBeCloseTo(env.holdEnd + env.release);
    }
  });

  it('keeps bass and plucked tails short so the low end and groove stay clear', () => {
    for (const inst of ['upright', 'round', 'pluck', 'marimba', 'blip'] as const) {
      expect(VOICE_SHAPES[inst].release).toBeLessThanOrEqual(0.35);
    }
  });

  it('a quick overtone gets a tail in proportion to its own length, not the full pedal', () => {
    const click = voiceEnvelope(VOICE_SHAPES.piano, 0.004, 0.036, 0.02);
    expect(click.release).toBeLessThan(0.15);
  });

  it('trims the peak so longer, overlapping notes do not make the music louder overall', () => {
    expect(voiceEnvelope(VOICE_SHAPES.vibes, 0.01, 0.3, 0.1).peak).toBeCloseTo(0.1 * PEDAL_LEVEL_TRIM);
    expect(PEDAL_LEVEL_TRIM).toBeLessThan(1);
  });
});
