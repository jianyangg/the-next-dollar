import type { NeighborhoodId } from '../core/neighborhoods';

/**
 * District soundtracks, described as plain data.
 *
 * HOW A THEME IS DESCRIBED
 * ------------------------
 * The game has no recorded music. The sound engine (soundEngine.ts) "performs"
 * each theme live with Web Audio oscillators, the same way a sequencer or a
 * player piano reads a score. This file is that score. A theme is:
 *
 * - bpm: tempo in quarter-note beats per minute. The engine's clock ticks in
 *   eighth notes (half a beat), so one tick lasts 60 / bpm / 2 seconds.
 * - stepsPerBar: how many eighth-note ticks make one bar. 8 = four beats
 *   (4/4 time, most pop and jazz). 6 = three beats (3/4 time, a waltz).
 * - swing: how late every off-beat eighth note is played, as a fraction of one
 *   eighth. 0 is perfectly straight (a drum machine); about 0.33 is a heavy
 *   "long-short" jazz shuffle. Small values give a relaxed human lilt.
 * - warmthHz: cutoff of the low-pass filter on the chord and bass voices. A
 *   lower number removes more treble, so the band sounds darker and softer.
 * - progression: the bars, played in order and then looped. Each bar lists
 *     chord     the notes the chord instrument plays (MIDI numbers, see below),
 *     compSteps which ticks of the bar the chord is struck on ("comping"),
 *     bass      one bass note (or null for silence) per tick,
 *     melody    one [note, velocity] pair (or null) per tick for the lead.
 * - comp / bass / lead: which synthesized instrument plays each part, how
 *   loud it is, and how long each note rings (in eighth notes).
 * - percussion: per-tick loudness of a shaker, a soft kick drum and a rim
 *   click. 0 means "do not play on this tick".
 *
 * MIDI note numbers are the standard way to name pitches with integers:
 * 60 is middle C, +1 is one semitone (one piano key) up, +12 is one octave up.
 * The engine converts them to frequency with f = 440 * 2^((midi - 69) / 12).
 *
 * WHY DATA AND NOT CODE
 * ---------------------
 * Keeping the music as data separates "what to play" from "how to make sound".
 * A designer can rewrite a melody here without touching audio plumbing, the
 * tests can check every theme for mistakes (a melody array one tick too short,
 * a note far outside hearing range) without a real AudioContext, and adding a
 * district is one more entry rather than one more code path.
 *
 * WHY EACH DISTRICT SOUNDS THE WAY IT DOES
 * ----------------------------------------
 * All seven share the same small band (soft keys, round bass, a mallet or
 * breathy lead, light percussion) and similar loudness, so travelling feels
 * like turning a street corner rather than changing radio stations. What
 * changes is key, tempo, groove and instrument colour:
 * - central-park: the original sunny C-major jazz-bossa. The home theme.
 * - columbia: slower F-major campus stroll on warm piano and vibraphone; sparse
 *   half-note chords leave room, like a quiet library lawn.
 * - broadway: G-major showtune swing at a brisk tempo with a walking bass,
 *   off-beat piano stabs and a rim click on beats 2 and 4 (the "and-a" bounce
 *   of a pit orchestra).
 * - market: D-major street-market groove. Straight time, a busy marimba line,
 *   a syncopated bass and a tresillo rim pattern so it feels like stalls
 *   clattering and haggling.
 * - west-village: an E-flat-major cafe waltz in 3/4. "Oom-pah-pah": bass on beat
 *   one, nylon-guitar plucks on two and three, a soft flute on top.
 * - fidi: C minor, no swing, a pulsing eighth-note bass and a short "ticker"
 *   blip lead. Steady and a bit tense, like a trading floor.
 * - fifth-ave: D-flat-major lush ninth chords on a slow-swelling pad with a
 *   celesta-like bell lead. Unhurried and expensive.
 */

/** One lead note: [MIDI pitch, velocity 0..1]. null means a rest on that tick. */
export type MelodyHit = readonly [midi: number, velocity: number] | null;

export interface BarPattern {
  /** Chord tones as MIDI numbers, struck together (with a small strum). */
  readonly chord: readonly number[];
  /** Ticks (0..stepsPerBar-1) on which the chord is struck. */
  readonly compSteps: readonly number[];
  /** One bass note per tick (length must equal stepsPerBar). */
  readonly bass: readonly (number | null)[];
  /** One lead note per tick (length must equal stepsPerBar). */
  readonly melody: readonly MelodyHit[];
}

/** Chord instruments: how each struck chord tone is synthesized. */
export type CompInstrument =
  /** Electric piano: detuned sine + triangle with a bell-like overtone. */
  | 'rhodes'
  /** Acoustic-ish piano: brighter attack with faster-fading harmonics. */
  | 'piano'
  /** Nylon guitar pluck: short, percussive triangle. */
  | 'pluck'
  /** Soft string pad: slow swell, long ring. */
  | 'pad';

/** Bass instruments. */
export type BassInstrument =
  /** Plucked upright bass: woody triangle plus sine body. */
  | 'upright'
  /** Round synth bass: pure sine, shorter, tighter. */
  | 'round';

/** Lead (melody) instruments. */
export type LeadInstrument =
  /** Wooden bar with a quick mallet click. */
  | 'marimba'
  /** Vibraphone: metal bar, longer ring. */
  | 'vibes'
  /** Celesta / music-box bell: slightly inharmonic shimmer. */
  | 'bell'
  /** Soft flute: gentle attack, no click. */
  | 'flute'
  /** Short digital "ticker" blip. */
  | 'blip';

/**
 * SUSTAIN PEDAL. How a music note starts, holds and dies away.
 *
 * Why this exists: every note used to rise in a few milliseconds and then fall
 * exponentially all the way to silence BY THE END of its written length. An
 * exponential fall loses half its loudness very early, so each note sounded like a
 * short "ping" that was gone before the next one arrived: sharp and sudden, with
 * gaps between notes. A pianist fixes exactly that with the sustain pedal: the
 * dampers lift, so a struck string keeps ringing after the key is let go, and
 * consecutive notes blur into each other.
 *
 * We imitate it with three numbers per instrument:
 *   minAttack  the shortest allowed rise (s). Below ~10 ms a rise is heard as a click.
 *   sustain    while the note is written, the volume settles toward this fraction of
 *              its peak instead of dropping to silence (0.4 = 40% of the peak).
 *   release    after the written length ends, the note keeps ringing and fades out
 *              over this many seconds: the "pedal tail" that overlaps the next note.
 *
 * Struck, sustaining instruments (piano, Rhodes, vibes, pad) get the long tails.
 * Plucked and mallet sounds and the basses get short tails, so the groove and the
 * low end stay clear instead of turning to mud.
 */
export interface VoiceShape {
  readonly minAttack: number;
  readonly sustain: number;
  readonly release: number;
}

export type MusicInstrument = CompInstrument | BassInstrument | LeadInstrument;

export const VOICE_SHAPES: Readonly<Record<MusicInstrument, VoiceShape>> = {
  rhodes: { minAttack: 0.015, sustain: 0.45, release: 0.9 },
  piano: { minAttack: 0.012, sustain: 0.35, release: 0.9 },
  pluck: { minAttack: 0.008, sustain: 0.2, release: 0.35 },
  pad: { minAttack: 0.02, sustain: 0.8, release: 1.2 },
  upright: { minAttack: 0.012, sustain: 0.3, release: 0.25 },
  round: { minAttack: 0.015, sustain: 0.4, release: 0.3 },
  marimba: { minAttack: 0.008, sustain: 0.2, release: 0.35 },
  vibes: { minAttack: 0.012, sustain: 0.5, release: 1.0 },
  bell: { minAttack: 0.01, sustain: 0.3, release: 0.8 },
  flute: { minAttack: 0.04, sustain: 0.7, release: 0.4 },
  blip: { minAttack: 0.008, sustain: 0.2, release: 0.15 },
};

/**
 * Notes now ring on and overlap, which adds up to more sound than the old pings.
 * This trim keeps the overall music level about where it was. Set by reasoning,
 * not by ear: re-tune it after listening.
 */
export const PEDAL_LEVEL_TRIM = 0.8;

/** The concrete envelope of one oscillator, in seconds from its start. */
export interface VoiceEnvelope {
  /** Time to reach the peak. */
  readonly attack: number;
  /** Peak gain (after the pedal trim). */
  readonly peak: number;
  /** The level it settles toward while the note is held. */
  readonly sustainLevel: number;
  /** When the written note ends and the pedal tail begins. */
  readonly holdEnd: number;
  /** How long the tail rings after holdEnd. */
  readonly release: number;
  /** When the oscillator can stop: the tail is inaudible (< 1% of peak) by then. */
  readonly stopAt: number;
}

/**
 * Turn a note request (attack, written duration, gain) plus an instrument's pedal
 * shape into the envelope the audio engine schedules. Pure, so it is unit tested.
 *
 * A quick overtone partial (say a 40 ms mallet click) keeps a tail in proportion to
 * its own length, capped by the instrument's release: a pedal lets strings ring, but
 * bright harmonics still die fast on a real instrument, so they must not linger.
 */
export function voiceEnvelope(shape: VoiceShape, attack: number, duration: number, gain: number): VoiceEnvelope {
  const a = Math.max(shape.minAttack, attack);
  const holdEnd = Math.max(a + 0.01, duration);
  const release = Math.min(shape.release, holdEnd * 2 + 0.05);
  const peak = gain * PEDAL_LEVEL_TRIM;
  return { attack: a, peak, sustainLevel: peak * shape.sustain, holdEnd, release, stopAt: holdEnd + release };
}

export interface MusicTheme {
  readonly id: NeighborhoodId;
  /** Human-readable name, for logs and a future music-room screen. */
  readonly title: string;
  readonly bpm: number;
  readonly stepsPerBar: 6 | 8;
  /** Off-beat delay as a fraction of one eighth note (0 = straight). */
  readonly swing: number;
  /** Low-pass cutoff in Hz for the chord and bass voices. */
  readonly warmthHz: number;
  readonly comp: {
    readonly instrument: CompInstrument;
    /** Loudness of the chord struck on tick 0 of the bar. */
    readonly downbeatVelocity: number;
    /** Loudness of every other chord hit. */
    readonly offbeatVelocity: number;
    /** Delay between successive chord tones, in seconds (a gentle roll). */
    readonly strumSec: number;
    /** How long a downbeat chord rings, in eighth notes. */
    readonly downbeatLength: number;
    /** How long any other chord hit rings, in eighth notes. */
    readonly offbeatLength: number;
  };
  readonly bass: {
    readonly instrument: BassInstrument;
    /** Gain of the note on tick 0 (the chord root, usually). */
    readonly rootGain: number;
    /** Gain of every other bass note. */
    readonly otherGain: number;
    readonly rootLength: number;
    readonly otherLength: number;
  };
  readonly lead: {
    readonly instrument: LeadInstrument;
    /** Peak gain at velocity 1. Each MelodyHit velocity scales this. */
    readonly gain: number;
    readonly length: number;
  };
  /** Per-tick gains, each array of length stepsPerBar. 0 = silent. */
  readonly percussion: {
    readonly shaker: readonly number[];
    readonly kick: readonly number[];
    readonly rim: readonly number[];
  };
  readonly progression: readonly BarPattern[];
}

/** Convenience for percussion lanes that never play. */
const SILENT_8 = [0, 0, 0, 0, 0, 0, 0, 0] as const;
const SILENT_6 = [0, 0, 0, 0, 0, 0] as const;

// ---------------------------------------------------------------------------
// central-park: the original theme, moved here unchanged.
// 8-bar NYC Afternoon Jazz-Bossa, 106 BPM, subtle swing.
// A-section: Cmaj9 | Am9 | Dm9 | G13   B-section: Fmaj9 | Em7 | Dm9 | G7
// ---------------------------------------------------------------------------
const CENTRAL_PARK: MusicTheme = {
  id: 'central-park',
  title: 'Afternoon Jazz-Bossa',
  bpm: 106,
  stepsPerBar: 8,
  // The original engine delayed off-beats by a fixed 0.022 s. At 106 BPM one
  // eighth is 60 / 106 / 2 = 0.283 s, so 0.022 s is 0.0778 of an eighth.
  swing: 0.022 / (60 / 106 / 2),
  warmthHz: 2100,
  comp: {
    instrument: 'rhodes',
    downbeatVelocity: 0.28,
    offbeatVelocity: 0.21,
    strumSec: 0.009,
    downbeatLength: 2.5,
    offbeatLength: 1.6,
  },
  bass: { instrument: 'upright', rootGain: 0.5, otherGain: 0.4, rootLength: 2.1, otherLength: 1.25 },
  lead: { instrument: 'marimba', gain: 0.25, length: 1.65 },
  percussion: {
    shaker: [0.11, 0.055, 0.08, 0.06, 0.1, 0.055, 0.085, 0.06],
    kick: SILENT_8,
    rim: SILENT_8,
  },
  progression: [
    {
      // Bar 0: Cmaj9 (E3 G3 B3 D4)
      chord: [52, 55, 59, 62],
      compSteps: [0, 3, 6],
      bass: [36, null, null, 43, 43, null, 40, null], // C2 .. G2 G2 . E2 .
      melody: [[76, 0.9], null, [79, 0.8], [76, 0.72], null, [74, 0.85], [72, 0.78], null],
    },
    {
      // Bar 1: Am9 (E3 G3 B3 C4)
      chord: [52, 55, 59, 60],
      compSteps: [0, 2, 5],
      bass: [45, null, null, 40, 40, null, 43, null], // A2 .. E2 E2 . G2 .
      melody: [[71, 0.82], null, [72, 0.88], null, [76, 0.92], null, [74, 0.72], null],
    },
    {
      // Bar 2: Dm9 (F3 A3 C4 E4)
      chord: [53, 57, 60, 64],
      compSteps: [0, 3, 6],
      bass: [38, null, null, 45, 45, null, 41, null], // D2 .. A2 A2 . F2 .
      melody: [[77, 0.9], null, [76, 0.8], [74, 0.76], null, [72, 0.84], [69, 0.78], null],
    },
    {
      // Bar 3: G13 (F3 A3 B3 E4)
      chord: [53, 57, 59, 64],
      compSteps: [0, 2, 5],
      bass: [43, null, null, 38, 38, null, 40, null], // G2 .. D2 D2 . E2 .
      melody: [[74, 0.86], null, [76, 0.9], null, [74, 0.78], [71, 0.74], null, [72, 0.68]],
    },
    {
      // Bar 4: Fmaj9 (E3 A3 C4 G4)
      chord: [52, 57, 60, 67],
      compSteps: [0, 3, 6],
      bass: [41, null, null, 48, 48, null, 45, null], // F2 .. C3 C3 . A2 .
      melody: [[79, 0.94], null, [76, 0.82], [79, 0.86], null, [81, 0.92], [79, 0.78], null],
    },
    {
      // Bar 5: Em7 (G3 B3 D4 G4)
      chord: [55, 59, 62, 67],
      compSteps: [0, 2, 5],
      bass: [40, null, null, 47, 47, null, 43, null], // E2 .. B2 B2 . G2 .
      melody: [[76, 0.88], null, [74, 0.76], null, [71, 0.84], null, [74, 0.78], null],
    },
    {
      // Bar 6: Dm9 (F3 A3 C4 E4)
      chord: [53, 57, 60, 64],
      compSteps: [0, 3, 6],
      bass: [38, null, null, 45, 45, null, 41, null], // D2 .. A2 A2 . F2 .
      melody: [[76, 0.88], null, [74, 0.82], [72, 0.78], null, [74, 0.86], [76, 0.8], null],
    },
    {
      // Bar 7: G7 turnaround (F3 G3 B3 D4)
      chord: [53, 55, 59, 62],
      compSteps: [0, 2, 5],
      bass: [43, null, null, 38, 43, null, 41, null], // G2 .. D2 G2 . F2 .
      melody: [[74, 0.86], null, [71, 0.8], null, [67, 0.78], null, [74, 0.72], null],
    },
  ],
};

// ---------------------------------------------------------------------------
// columbia: gentle campus stroll. F major, 84 BPM, light swing.
// Fmaj7 | Dm7 | Gm7 | C7 | Fmaj7 | Bbmaj7 | Gm7 | C9sus4
// Chords mostly on beats 1 and 3 (ticks 0 and 4) so the music breathes.
// ---------------------------------------------------------------------------
const COLUMBIA: MusicTheme = {
  id: 'columbia',
  title: 'Library Lawn',
  bpm: 84,
  stepsPerBar: 8,
  swing: 0.06,
  warmthHz: 1800,
  comp: {
    instrument: 'piano',
    downbeatVelocity: 0.27,
    offbeatVelocity: 0.2,
    strumSec: 0.014,
    downbeatLength: 3.2,
    offbeatLength: 2.4,
  },
  bass: { instrument: 'upright', rootGain: 0.48, otherGain: 0.36, rootLength: 3, otherLength: 2.2 },
  lead: { instrument: 'vibes', gain: 0.23, length: 2.4 },
  percussion: {
    shaker: [0.07, 0.03, 0.05, 0.035, 0.065, 0.03, 0.05, 0.035],
    kick: SILENT_8,
    rim: SILENT_8,
  },
  progression: [
    {
      // Fmaj7 (F3 A3 C4 E4)
      chord: [53, 57, 60, 64],
      compSteps: [0, 4],
      bass: [41, null, null, null, 48, null, null, null], // F2 . . . C3
      melody: [[72, 0.85], null, null, null, [69, 0.7], null, [72, 0.72], null],
    },
    {
      // Dm7 (F3 A3 C4 D4)
      chord: [53, 57, 60, 62],
      compSteps: [0, 4],
      bass: [38, null, null, null, 45, null, null, null], // D2 . . . A2
      melody: [[74, 0.85], null, null, [72, 0.7], null, null, [69, 0.7], null],
    },
    {
      // Gm7 (F3 Bb3 D4 G4)
      chord: [53, 58, 62, 67],
      compSteps: [0, 4],
      bass: [43, null, null, null, 50, null, null, null], // G2 . . . D3
      melody: [[70, 0.8], null, null, [74, 0.75], null, null, [72, 0.7], null],
    },
    {
      // C7 (E3 G3 Bb3 C4)
      chord: [52, 55, 58, 60],
      compSteps: [0, 3, 6],
      bass: [36, null, null, null, 43, null, null, null], // C2 . . . G2
      melody: [[70, 0.78], null, [69, 0.7], null, [67, 0.72], null, null, [72, 0.65]],
    },
    {
      // Fmaj7 (F3 A3 C4 E4)
      chord: [53, 57, 60, 64],
      compSteps: [0, 4],
      bass: [41, null, null, null, 48, null, null, null],
      melody: [[77, 0.85], null, null, [76, 0.72], null, null, [72, 0.72], null],
    },
    {
      // Bbmaj7 (F3 A3 Bb3 D4)
      chord: [53, 57, 58, 62],
      compSteps: [0, 4],
      bass: [46, null, null, null, 41, null, null, null], // Bb2 . . . F2
      melody: [[74, 0.82], null, null, [77, 0.74], null, null, [74, 0.7], null],
    },
    {
      // Gm7 (F3 Bb3 D4 G4)
      chord: [53, 58, 62, 67],
      compSteps: [0, 4],
      bass: [43, null, null, null, 50, null, null, null],
      melody: [[72, 0.8], null, [70, 0.7], null, [69, 0.72], null, [67, 0.68], null],
    },
    {
      // C9sus4 (F3 G3 Bb3 D4): a hanging chord that leans back into Fmaj7
      chord: [53, 55, 58, 62],
      compSteps: [0, 3, 6],
      bass: [36, null, null, null, 43, null, null, null],
      melody: [[67, 0.75], null, null, [69, 0.68], null, [70, 0.66], null, null],
    },
  ],
};

// ---------------------------------------------------------------------------
// broadway: showtune swing. G major, 132 BPM, strong swing.
// G6 | Em7 | Am7 | D7 | Bm7 | E7 | Am7 | D7 (a classic I-vi-ii-V turnaround)
// Walking bass on every beat, rim click on beats 2 and 4 (ticks 2 and 6).
// ---------------------------------------------------------------------------
const BROADWAY: MusicTheme = {
  id: 'broadway',
  title: 'Curtain Up',
  bpm: 132,
  stepsPerBar: 8,
  swing: 0.24,
  warmthHz: 2600,
  comp: {
    instrument: 'piano',
    downbeatVelocity: 0.24,
    offbeatVelocity: 0.2,
    strumSec: 0.006,
    downbeatLength: 1.8,
    offbeatLength: 1.2,
  },
  bass: { instrument: 'upright', rootGain: 0.46, otherGain: 0.4, rootLength: 1.8, otherLength: 1.7 },
  lead: { instrument: 'vibes', gain: 0.22, length: 1.5 },
  percussion: {
    shaker: [0.08, 0.045, 0.07, 0.05, 0.08, 0.045, 0.07, 0.05],
    kick: [0.15, 0, 0, 0, 0.11, 0, 0, 0],
    rim: [0, 0, 0.09, 0, 0, 0, 0.09, 0],
  },
  progression: [
    {
      // G6 (G3 B3 D4 E4)
      chord: [55, 59, 62, 64],
      compSteps: [0, 3, 5],
      bass: [43, null, 47, null, 50, null, 47, null], // G2 B2 D3 B2
      melody: [[71, 0.9], [74, 0.75], [79, 0.9], null, [76, 0.8], null, [74, 0.78], [71, 0.7]],
    },
    {
      // Em7 (E3 G3 B3 D4)
      chord: [52, 55, 59, 62],
      compSteps: [0, 3, 5],
      bass: [40, null, 43, null, 47, null, 45, null], // E2 G2 B2 A2
      melody: [[67, 0.85], null, [71, 0.75], [74, 0.8], null, [76, 0.85], null, null],
    },
    {
      // Am7 (G3 A3 C4 E4)
      chord: [55, 57, 60, 64],
      compSteps: [0, 3, 5],
      bass: [45, null, 48, null, 52, null, 50, null], // A2 C3 E3 D3
      melody: [[72, 0.88], [76, 0.75], [79, 0.85], null, [81, 0.9], null, [79, 0.75], null],
    },
    {
      // D7 (F#3 A3 C4 D4)
      chord: [54, 57, 60, 62],
      compSteps: [0, 3, 5],
      bass: [38, null, 42, null, 45, null, 46, null], // D2 F#2 A2 Bb2 (chromatic step up to B)
      melody: [[78, 0.88], null, [76, 0.75], [74, 0.78], [72, 0.72], null, [69, 0.7], null],
    },
    {
      // Bm7 (F#3 A3 B3 D4)
      chord: [54, 57, 59, 62],
      compSteps: [0, 3, 5],
      bass: [47, null, 45, null, 42, null, 41, null], // B2 A2 F#2 F2 (chromatic step down to E)
      melody: [[74, 0.88], [78, 0.78], [81, 0.9], null, [78, 0.8], null, [74, 0.75], null],
    },
    {
      // E7 (G#3 B3 D4 E4)
      chord: [56, 59, 62, 64],
      compSteps: [0, 3, 5],
      bass: [40, null, 44, null, 47, null, 46, null], // E2 G#2 B2 Bb2 (step down to A)
      melody: [[80, 0.88], null, [76, 0.78], null, [74, 0.8], null, [71, 0.74], null],
    },
    {
      // Am7 (G3 A3 C4 E4)
      chord: [55, 57, 60, 64],
      compSteps: [0, 3, 5],
      bass: [45, null, 43, null, 40, null, 39, null], // A2 G2 E2 Eb2 (step down to D)
      melody: [[72, 0.85], [76, 0.72], [81, 0.85], null, [79, 0.8], [76, 0.72], null, [72, 0.7]],
    },
    {
      // D7 (F#3 A3 C4 D4)
      chord: [54, 57, 60, 62],
      compSteps: [0, 3, 5],
      bass: [38, null, 42, null, 45, null, 42, null], // D2 F#2 A2 F#2 -> back to G
      melody: [[74, 0.85], null, [78, 0.8], null, [81, 0.88], null, [78, 0.7], null],
    },
  ],
};

// ---------------------------------------------------------------------------
// market (Union Square supply market): busy, percussive. D major, 118 BPM,
// straight time. D | G | A7 | G | D | Bm | Em7 | A7
// Syncopated bass (tick 3 pushes ahead of beat 3), tresillo rim (ticks 0 3 6).
// ---------------------------------------------------------------------------
const MARKET: MusicTheme = {
  id: 'market',
  title: 'Union Square Bustle',
  bpm: 118,
  stepsPerBar: 8,
  swing: 0.02,
  warmthHz: 2400,
  comp: {
    instrument: 'pluck',
    downbeatVelocity: 0.24,
    offbeatVelocity: 0.18,
    strumSec: 0.007,
    downbeatLength: 1.4,
    offbeatLength: 1,
  },
  bass: { instrument: 'round', rootGain: 0.46, otherGain: 0.38, rootLength: 1.6, otherLength: 1.2 },
  // A busier line, so each note is a little quieter to keep overall loudness level with the others.
  lead: { instrument: 'marimba', gain: 0.21, length: 1.3 },
  percussion: {
    shaker: [0.1, 0.06, 0.09, 0.06, 0.1, 0.06, 0.09, 0.07],
    kick: [0.16, 0, 0, 0.09, 0.13, 0, 0, 0],
    rim: [0.08, 0, 0, 0.08, 0, 0, 0.08, 0],
  },
  progression: [
    {
      // D (D3 F#3 A3 D4)
      chord: [50, 54, 57, 62],
      compSteps: [0, 2, 3, 5, 6],
      bass: [38, null, null, 45, null, null, 50, null], // D2 . . A2 . . D3
      melody: [[74, 0.85], [78, 0.7], [81, 0.85], [78, 0.7], [74, 0.8], null, [76, 0.75], [78, 0.7]],
    },
    {
      // G (D3 G3 B3 D4)
      chord: [50, 55, 59, 62],
      compSteps: [0, 2, 3, 5, 6],
      bass: [43, null, null, 50, null, null, 47, null], // G2 . . D3 . . B2
      melody: [[79, 0.88], null, [83, 0.8], [81, 0.72], [79, 0.78], null, [78, 0.7], [76, 0.68]],
    },
    {
      // A7 (E3 G3 A3 C#4)
      chord: [52, 55, 57, 61],
      compSteps: [0, 2, 3, 5, 6],
      bass: [45, null, null, 40, null, null, 43, null], // A2 . . E2 . . G2
      melody: [[76, 0.85], [79, 0.72], [81, 0.8], null, [85, 0.82], null, [83, 0.75], [81, 0.7]],
    },
    {
      // G (D3 G3 B3 D4)
      chord: [50, 55, 59, 62],
      compSteps: [0, 2, 3, 5, 6],
      bass: [43, null, null, 50, null, null, 45, null],
      melody: [[79, 0.85], null, [78, 0.75], [76, 0.72], [74, 0.8], null, [71, 0.7], null],
    },
    {
      // D (D3 F#3 A3 D4)
      chord: [50, 54, 57, 62],
      compSteps: [0, 2, 3, 5, 6],
      bass: [38, null, null, 45, null, null, 50, null],
      melody: [[78, 0.88], [81, 0.72], [86, 0.82], null, [81, 0.78], [78, 0.7], [74, 0.75], null],
    },
    {
      // Bm (D3 F#3 B3 D4)
      chord: [50, 54, 59, 62],
      compSteps: [0, 2, 3, 5, 6],
      bass: [47, null, null, 42, null, null, 45, null], // B2 . . F#2 . . A2
      melody: [[78, 0.85], null, [74, 0.75], [78, 0.72], [83, 0.82], null, [81, 0.72], null],
    },
    {
      // Em7 (E3 G3 B3 D4)
      chord: [52, 55, 59, 62],
      compSteps: [0, 2, 3, 5, 6],
      bass: [40, null, null, 47, null, null, 43, null], // E2 . . B2 . . G2
      melody: [[79, 0.85], [76, 0.72], [74, 0.75], null, [71, 0.78], null, [74, 0.72], [76, 0.7]],
    },
    {
      // A7 (E3 G3 A3 C#4)
      chord: [52, 55, 57, 61],
      compSteps: [0, 2, 3, 5, 6],
      bass: [45, null, null, 40, null, null, 44, null], // A2 . . E2 . . G#2
      melody: [[73, 0.85], null, [76, 0.75], [79, 0.78], null, [81, 0.8], [79, 0.7], [76, 0.68]],
    },
  ],
};

// ---------------------------------------------------------------------------
// west-village: cafe waltz in 3/4. E-flat major, 96 BPM, gentle lilt.
// Ebmaj7 | Cm7 | Fm7 | Bb7 | Gm7 | C7 | Fm7 | Bb7
// "Oom-pah-pah": bass on beat 1 (tick 0), guitar on beats 2 and 3 (ticks 2, 4).
// ---------------------------------------------------------------------------
const WEST_VILLAGE: MusicTheme = {
  id: 'west-village',
  title: 'Bleecker Street Waltz',
  bpm: 96,
  stepsPerBar: 6,
  swing: 0.1,
  warmthHz: 1900,
  comp: {
    instrument: 'pluck',
    downbeatVelocity: 0.22,
    offbeatVelocity: 0.2,
    strumSec: 0.016,
    downbeatLength: 1.6,
    offbeatLength: 1.6,
  },
  bass: { instrument: 'upright', rootGain: 0.52, otherGain: 0.36, rootLength: 3, otherLength: 1.4 },
  lead: { instrument: 'flute', gain: 0.24, length: 2.2 },
  percussion: {
    shaker: [0.06, 0.03, 0.05, 0.03, 0.05, 0.03],
    kick: SILENT_6,
    rim: SILENT_6,
  },
  progression: [
    {
      // Ebmaj7 (Eb3 G3 Bb3 D4)
      chord: [51, 55, 58, 62],
      compSteps: [2, 4],
      bass: [39, null, null, null, null, null], // Eb2
      melody: [[70, 0.85], null, null, null, [74, 0.75], null],
    },
    {
      // Cm7 (Eb3 G3 Bb3 C4)
      chord: [51, 55, 58, 60],
      compSteps: [2, 4],
      bass: [36, null, null, null, null, null], // C2
      melody: [[75, 0.85], null, null, null, [74, 0.72], [72, 0.65]],
    },
    {
      // Fm7 (F3 Ab3 C4 Eb4)
      chord: [53, 56, 60, 63],
      compSteps: [2, 4],
      bass: [41, null, null, null, null, null], // F2
      melody: [[72, 0.85], null, null, null, [68, 0.72], null],
    },
    {
      // Bb7 (D3 F3 Ab3 Bb3)
      chord: [50, 53, 56, 58],
      compSteps: [2, 4],
      bass: [46, null, null, null, null, null], // Bb2
      melody: [[70, 0.8], null, [68, 0.7], null, [65, 0.7], null],
    },
    {
      // Gm7 (F3 G3 Bb3 D4)
      chord: [53, 55, 58, 62],
      compSteps: [2, 4],
      bass: [43, null, null, null, null, null], // G2
      melody: [[67, 0.82], null, null, null, [70, 0.75], [74, 0.68]],
    },
    {
      // C7 (E3 G3 Bb3 C4)
      chord: [52, 55, 58, 60],
      compSteps: [2, 4],
      bass: [48, null, null, null, null, null], // C3
      melody: [[76, 0.85], null, null, null, [72, 0.72], null],
    },
    {
      // Fm7 (F3 Ab3 C4 Eb4)
      chord: [53, 56, 60, 63],
      compSteps: [2, 4],
      bass: [41, null, null, null, null, null],
      melody: [[75, 0.82], null, [72, 0.72], null, [68, 0.7], null],
    },
    {
      // Bb7 (D3 F3 Ab3 Bb3), with a bass pickup on the last tick
      chord: [50, 53, 56, 58],
      compSteps: [2, 4],
      bass: [46, null, null, null, null, 45], // Bb2 ... A2 (leads into Eb's neighbourhood)
      melody: [[70, 0.8], null, null, null, [65, 0.68], [67, 0.62]],
    },
  ],
};

// ---------------------------------------------------------------------------
// fidi (Financial District): minor, steady, a little tense. C minor, 112 BPM,
// straight. Cm9 | Abmaj7 | Fm9 | G7 | Cm9 | Ebmaj7 | Abmaj7 | G7
// Pulsing eighth-note bass and quarter-note kick, like a ticker tape.
// ---------------------------------------------------------------------------
const FIDI: MusicTheme = {
  id: 'fidi',
  title: 'Ticker Tape',
  bpm: 112,
  stepsPerBar: 8,
  swing: 0,
  warmthHz: 1900,
  comp: {
    instrument: 'rhodes',
    downbeatVelocity: 0.24,
    offbeatVelocity: 0.17,
    strumSec: 0.004,
    downbeatLength: 2,
    offbeatLength: 1,
  },
  // Eight bass notes per bar instead of three or four, so each one is quieter and shorter.
  bass: { instrument: 'round', rootGain: 0.4, otherGain: 0.26, rootLength: 1, otherLength: 0.8 },
  lead: { instrument: 'blip', gain: 0.22, length: 1 },
  percussion: {
    shaker: [0.08, 0.05, 0.08, 0.05, 0.08, 0.05, 0.08, 0.05],
    kick: [0.14, 0, 0.1, 0, 0.14, 0, 0.1, 0],
    rim: [0, 0, 0.06, 0, 0, 0, 0.06, 0],
  },
  progression: [
    {
      // Cm9 (Eb3 G3 Bb3 D4)
      chord: [51, 55, 58, 62],
      compSteps: [0, 3, 6],
      bass: [36, 36, 48, 36, 36, 36, 48, 36], // C2 pulse with octave jumps
      melody: [[72, 0.85], null, [75, 0.7], null, [79, 0.8], null, [75, 0.65], null],
    },
    {
      // Abmaj7 (Eb3 G3 Ab3 C4)
      chord: [51, 55, 56, 60],
      compSteps: [0, 3, 6],
      bass: [44, 44, 56, 44, 44, 44, 56, 44], // Ab2 pulse
      melody: [[72, 0.82], null, [75, 0.7], null, [79, 0.78], null, [80, 0.72], null],
    },
    {
      // Fm9 (F3 Ab3 C4 G4)
      chord: [53, 56, 60, 67],
      compSteps: [0, 3, 6],
      bass: [41, 41, 53, 41, 41, 41, 53, 41], // F2 pulse
      melody: [[77, 0.85], null, [75, 0.7], null, [72, 0.78], null, [68, 0.68], null],
    },
    {
      // G7 (F3 G3 B3 D4)
      chord: [53, 55, 59, 62],
      compSteps: [0, 3, 6],
      bass: [43, 43, 55, 43, 43, 43, 50, 47], // G2 pulse, then D3 B2 leading home to C
      melody: [[71, 0.85], null, [74, 0.72], null, [77, 0.78], null, [74, 0.68], null],
    },
    {
      // Cm9 (Eb3 G3 Bb3 D4)
      chord: [51, 55, 58, 62],
      compSteps: [0, 3, 6],
      bass: [36, 36, 48, 36, 36, 36, 48, 36],
      melody: [[72, 0.85], null, [75, 0.7], [79, 0.72], null, [82, 0.78], [79, 0.66], null],
    },
    {
      // Ebmaj7 (D3 G3 Bb3 Eb4)
      chord: [50, 55, 58, 63],
      compSteps: [0, 3, 6],
      bass: [39, 39, 51, 39, 39, 39, 51, 39], // Eb2 pulse
      melody: [[79, 0.85], null, [74, 0.72], null, [75, 0.78], null, [70, 0.66], null],
    },
    {
      // Abmaj7 (Eb3 G3 Ab3 C4)
      chord: [51, 55, 56, 60],
      compSteps: [0, 3, 6],
      bass: [44, 44, 56, 44, 44, 44, 56, 44],
      melody: [[72, 0.82], null, [75, 0.72], null, [80, 0.8], null, [79, 0.7], null],
    },
    {
      // G7 (F3 G3 B3 D4)
      chord: [53, 55, 59, 62],
      compSteps: [0, 3, 6],
      bass: [43, 43, 55, 43, 43, 43, 50, 47],
      melody: [[74, 0.82], null, [71, 0.72], null, [67, 0.75], null, [71, 0.66], [74, 0.6]],
    },
  ],
};

// ---------------------------------------------------------------------------
// fifth-ave: elegant and lush. D-flat major, 88 BPM, soft swing.
// Dbmaj9 | Bbm9 | Gbmaj9 | Ab13 | Fm7 | Bbm9 | Ebm9 | Ab7
// One long pad chord per bar (with a softer re-voice on beat 3) and a sparse bell.
// ---------------------------------------------------------------------------
const FIFTH_AVE: MusicTheme = {
  id: 'fifth-ave',
  title: 'Window Shopping',
  bpm: 88,
  stepsPerBar: 8,
  swing: 0.1,
  warmthHz: 2300,
  comp: {
    instrument: 'pad',
    // Pads sustain and overlap, so they are set quieter than struck instruments.
    downbeatVelocity: 0.2,
    offbeatVelocity: 0.12,
    strumSec: 0.02,
    downbeatLength: 7,
    offbeatLength: 3.5,
  },
  bass: { instrument: 'upright', rootGain: 0.48, otherGain: 0.34, rootLength: 3.5, otherLength: 3 },
  lead: { instrument: 'bell', gain: 0.22, length: 2.6 },
  percussion: {
    shaker: [0.05, 0.025, 0.04, 0.025, 0.05, 0.025, 0.04, 0.025],
    kick: SILENT_8,
    rim: SILENT_8,
  },
  progression: [
    {
      // Dbmaj9 (F3 Ab3 C4 Eb4)
      chord: [53, 56, 60, 63],
      compSteps: [0, 4],
      bass: [37, null, null, null, 44, null, null, null], // Db2 . . . Ab2
      melody: [[77, 0.8], null, null, [80, 0.72], null, null, [84, 0.7], null],
    },
    {
      // Bbm9 (Db3 F3 Ab3 C4)
      chord: [49, 53, 56, 60],
      compSteps: [0, 4],
      bass: [46, null, null, null, 41, null, null, null], // Bb2 . . . F2
      melody: [[82, 0.8], null, null, null, [80, 0.7], null, [77, 0.66], null],
    },
    {
      // Gbmaj9 (F3 Ab3 Bb3 Db4)
      chord: [53, 56, 58, 61],
      compSteps: [0, 4],
      bass: [42, null, null, null, 49, null, null, null], // Gb2 . . . Db3
      melody: [[78, 0.8], null, null, [77, 0.7], null, null, [73, 0.68], null],
    },
    {
      // Ab13 (Gb3 Bb3 C4 F4)
      chord: [54, 58, 60, 65],
      compSteps: [0, 4],
      bass: [44, null, null, null, 39, null, null, null], // Ab2 . . . Eb2
      melody: [[75, 0.78], null, null, null, [72, 0.7], null, null, null],
    },
    {
      // Fm7 (Eb3 Ab3 C4 F4)
      chord: [51, 56, 60, 65],
      compSteps: [0, 4],
      bass: [41, null, null, null, 48, null, null, null], // F2 . . . C3
      melody: [[80, 0.8], null, null, [77, 0.72], null, null, [75, 0.68], null],
    },
    {
      // Bbm9 (Db3 F3 Ab3 C4)
      chord: [49, 53, 56, 60],
      compSteps: [0, 4],
      bass: [46, null, null, null, 41, null, null, null],
      melody: [[73, 0.78], null, null, [77, 0.72], null, null, [82, 0.7], null],
    },
    {
      // Ebm9 (Gb3 Bb3 Db4 F4)
      chord: [54, 58, 61, 65],
      compSteps: [0, 4],
      bass: [39, null, null, null, 46, null, null, null], // Eb2 . . . Bb2
      melody: [[78, 0.8], null, null, [77, 0.72], null, [75, 0.68], null, null],
    },
    {
      // Ab7 (Gb3 Ab3 C4 Eb4)
      chord: [54, 56, 60, 63],
      compSteps: [0, 4],
      bass: [44, null, null, null, 39, null, null, null],
      melody: [[72, 0.78], null, null, [75, 0.7], null, null, [80, 0.68], null],
    },
  ],
};

/**
 * Every district's theme, keyed by district id. Typed as a Record over
 * NeighborhoodId so the compiler refuses to build if a district is added to
 * neighborhoods.ts without a theme here.
 */
export const MUSIC_THEMES: Readonly<Record<NeighborhoodId, MusicTheme>> = {
  'central-park': CENTRAL_PARK,
  columbia: COLUMBIA,
  broadway: BROADWAY,
  market: MARKET,
  'west-village': WEST_VILLAGE,
  fidi: FIDI,
  'fifth-ave': FIFTH_AVE,
};

/** The theme that plays before any district has been chosen. */
export const DEFAULT_MUSIC_THEME_ID: NeighborhoodId = 'central-park';

/** Length of one eighth-note tick for a theme, in seconds. */
export function eighthNoteSeconds(theme: MusicTheme): number {
  return 60 / theme.bpm / 2;
}

/** Total ticks in one loop of the theme's progression. */
export function loopLengthSteps(theme: MusicTheme): number {
  return theme.progression.length * theme.stepsPerBar;
}
