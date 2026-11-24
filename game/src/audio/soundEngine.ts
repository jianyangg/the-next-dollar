import type { NeighborhoodId } from '../core/neighborhoods';
import type { Random } from '../core/rng';
import { cosmeticRandom } from '../core/runRandom';
import {
  DEFAULT_MUSIC_THEME_ID,
  MUSIC_THEMES,
  VOICE_SHAPES,
  eighthNoteSeconds,
  voiceEnvelope,
  loopLengthSteps,
  type BassInstrument,
  type CompInstrument,
  type LeadInstrument,
  type MusicTheme,
  type VoiceShape,
} from './musicThemes';

/**
 * Zero-dependency Web Audio API sound effects and per-district procedural
 * soundtrack engine (with automatic `/audio/nyc-theme.mp3` support).
 * Safe in headless/SSR environments and resilient to browser autoplay policies.
 *
 * The music itself is described as data in musicThemes.ts; this file only
 * knows how to turn that data into oscillators on a clock.
 */

export interface SoundEngine {
  initOnGesture(): void;
  isMuted(): boolean;
  toggleMute(): boolean;
  startMusic(): void;
  stopMusic(): void;
  /**
   * Choose which district's soundtrack plays. Safe to call at any time:
   * - music playing: the current theme ducks and the new one starts on the
   *   next bar line (never two themes at once, never a click);
   * - music paused, muted, not started yet, or the MP3 theme in use: the
   *   choice is only remembered and used the next time procedural music runs;
   * - the same theme again: no-op (it does not restart).
   */
  setMusicTheme(district: NeighborhoodId): void;
  /**
   * Hush the music for a screen where play has stopped (the day's receipt, the run
   * ending). true fades the music out over about a second, so the won/lost sting is
   * heard alone and the change of state is felt; false fades it back up. The
   * soundtrack keeps its place underneath, so un-hushing never restarts it.
   */
  setMusicHushed(hushed: boolean): void;
  playCoin(combo?: number): void;
  playBrew(): void;
  playClick(): void;
  playBuy(): void;
  playReject(): void;
  /** Closing bell on a day that beat the 5% line (bright fanfare). */
  playDayEnd(): void;
  /** Closing bell on a day that missed the line: a short falling "wah-wah", clearly a loss. */
  playDayLost(): void;
  /** The moment today's earnings pass the line during play: a rising "level up" run. */
  playLineCrossed(): void;
  /** Generic one-shot whoosh. Superseded for rides by playSubwayDepart/playSubwayArrive. */
  playTravel(): void;
  /**
   * Start of a subway ride: two-tone door chime, doors thud, then a train
   * rumble with wheel clacks that runs about 1.1 s. Ducks the music for the ride.
   */
  playSubwayDepart(): void;
  /**
   * Doors open at `district`: air hiss, then the music swells back already
   * switched to that district's theme (this calls the theme switch itself).
   */
  playSubwayArrive(district: NeighborhoodId): void;
  /**
   * Subway map cursor moved onto station `index` of `count` (0 = uptown end).
   * A short chime whose pitch walks down the line. Throttled so fast hovering
   * cannot stack into noise.
   */
  playMapStation(index: number, count: number): void;
  /** Subway map station picked for inspection: soft two-note "ding-dong". */
  playMapSelect(): void;
  playHonkKo(): void;
  playPerfect(): void;
  playStep(): void;
}

type AudioContextConstructor = typeof AudioContext;

interface WindowWithWebkitAudio extends Window {
  webkitAudioContext?: AudioContextConstructor;
}

/** Convert MIDI note number to frequency in Hz. */
export function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

// ---------------------------------------------------------------------------
// Pure decision helpers.
//
// These hold the "what should happen" logic with no Web Audio calls, so tests
// can exercise them in Node without a real AudioContext. The engine class
// below only does "make it happen".
// ---------------------------------------------------------------------------

/** What the theme slot looks like when setMusicTheme is called. */
export interface ThemeSlotState {
  /** Theme whose notes are being scheduled right now (or would be, if playing). */
  readonly active: NeighborhoodId;
  /** Theme queued to take over at the next bar line, if any. */
  readonly pending: NeighborhoodId | null;
  /** True while the procedural scheduler is running and audible. */
  readonly playing: boolean;
}

/**
 * - none:          already playing (or already queued) that theme; do nothing.
 * - swap-now:      nothing is audible, so just replace the active theme.
 * - queue:         music is audible; duck now, switch on the next bar line.
 * - cancel-queue:  asked for the theme that is already playing while another
 *                  was queued; drop the queued one and un-duck.
 */
export type ThemeChangeDecision = 'none' | 'swap-now' | 'queue' | 'cancel-queue';

export function decideThemeChange(
  state: ThemeSlotState,
  requested: NeighborhoodId
): ThemeChangeDecision {
  if (!state.playing) {
    // Nothing audible: a queue would be pointless. Swap unless it is already exact.
    return state.active === requested && state.pending === null ? 'none' : 'swap-now';
  }
  if (state.pending === requested) return 'none';
  if (state.active === requested) {
    return state.pending === null ? 'none' : 'cancel-queue';
  }
  return 'queue';
}

/**
 * Major-pentatonic scale degrees in semitones. Pentatonic (5 notes per octave,
 * no half steps) is used because any sequence of its notes sounds pleasant, so
 * hovering stations in any order never sounds "wrong".
 */
const PENTATONIC_STEPS = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21] as const;
/** Lowest station chime: G4. The highest (with 10 degrees) is E6. */
const STATION_BASE_MIDI = 67;

/**
 * MIDI pitch for station `index` of `count` on the subway line. Index 0 is the
 * uptown end and gets the HIGHEST pitch ("up" on the map is up in pitch), so
 * walking downtown plays a descending scale.
 *
 * For lines with at most 10 stations every station gets its own scale degree
 * (strictly descending). Longer lines are spread across the same range, so
 * neighbours may share a pitch but the scale never turns back upward.
 * Out-of-range input is clamped rather than thrown on: this is a hover sound.
 */
export function stationChimeMidi(index: number, count: number): number {
  const safeCount = Number.isFinite(count) ? Math.max(1, Math.floor(count)) : 1;
  const rawIndex = Number.isFinite(index) ? Math.floor(index) : 0;
  const safeIndex = Math.min(safeCount - 1, Math.max(0, rawIndex));
  const fromDowntown = safeCount - 1 - safeIndex; // 0 at the downtown end
  const degrees = PENTATONIC_STEPS.length;
  const degree =
    safeCount <= degrees
      ? fromDowntown
      : Math.round((fromDowntown * (degrees - 1)) / (safeCount - 1));
  return STATION_BASE_MIDI + PENTATONIC_STEPS[degree];
}

/**
 * Throttle gate shared by rapid-fire sounds: allow a new play only if the
 * previous one started at least `minGapMs` ago. `lastMs` null = never played.
 */
export function throttleAllows(lastMs: number | null, nowMs: number, minGapMs: number): boolean {
  return lastMs === null || nowMs - lastMs >= minGapMs;
}

/**
 * A frequency multiplier in [1 - spread, 1 + spread], e.g. spread 0.03 gives
 * up to +-3% (about half a semitone). Small random detune is what keeps a
 * sound heard 500 times a run from feeling like a stuck recording; real
 * instruments never repeat a note exactly either. `random` is injected so the
 * engine passes the seeded cosmetic stream and tests pass a fixed sequence.
 */
export function varyRatio(spread: number, random: Random): number {
  return 1 + (random() * 2 - 1) * spread;
}

/** Pick one of `count` variants (0..count-1) using an injected random stream. */
export function pickVariant(count: number, random: Random): number {
  const safeCount = Math.max(1, Math.floor(count));
  return Math.min(safeCount - 1, Math.floor(random() * safeCount));
}

/** How one subway ride's rumble will sound; generated fresh per ride. */
export interface RumblePlan {
  /** Low-pass cutoff of the rumble noise in Hz: lower = heavier, further-away train. */
  readonly rumbleCutoffHz: number;
  /** Frequency of the motor hum under the rumble in Hz. */
  readonly humHz: number;
  /** Seconds after rumble start at which each wheel clack fires (sorted). */
  readonly clackTimes: readonly number[];
}

/**
 * Plan a ride's rumble: wheels cross rail joints in pairs ("clack-clack", the
 * front and rear trucks of one car), and the pairs speed up as the train
 * accelerates. Every ride gets a slightly different cutoff, hum and clack
 * spacing from `random`, so back-to-back rides do not sound copy-pasted.
 * All clack times fall inside [0, durationSec).
 */
export function planRumble(durationSec: number, random: Random): RumblePlan {
  const rumbleCutoffHz = 170 + random() * 90; // 170..260 Hz
  const humHz = 52 + random() * 12; // 52..64 Hz
  const clackTimes: number[] = [];
  const pairGap = 0.075 + random() * 0.025; // gap inside one "clack-clack"
  let t = 0.12 + random() * 0.08; // first joint
  let spacing = 0.42 + random() * 0.08; // gap between pairs, shrinking as we speed up
  while (t + pairGap < durationSec) {
    clackTimes.push(t, t + pairGap);
    t += spacing;
    spacing = Math.max(0.24, spacing * (0.82 + random() * 0.08));
  }
  return { rumbleCutoffHz, humHz, clackTimes };
}

const LOOKAHEAD_MS = 100;
const SCHEDULE_AHEAD_SEC = 0.26;
const MUSIC_BUS_GAIN = 0.085;
/** Music level while a queued theme waits for its bar line (25% of normal). */
const THEME_SWITCH_DUCK = MUSIC_BUS_GAIN * 0.25;
/** Music level during a subway ride (20% of normal): audible, clearly "underground". */
const RIDE_DUCK = MUSIC_BUS_GAIN * 0.2;
/**
 * Music level on a stop-the-game screen. Effectively silent; not 0 because the
 * glide is an exponential approach (setTargetAtTime) and must have a target above 0.
 */
const MUSIC_HUSHED = 0.0001;
/**
 * If a ride starts but the arrival call never comes (the travel flow was
 * interrupted), restore the music after this long instead of leaving it quiet
 * forever. A ride is about 1.2 s, so 4 s is never hit on the happy path.
 */
const RIDE_DUCK_FAILSAFE_MS = 4000;
const RIDE_RUMBLE_SEC = 1.1;
const MAP_STATION_MIN_GAP_MS = 40;
const SFX_BUS_GAIN = 0.22;
const CUSTOM_THEME_URL = '/audio/nyc-theme.mp3';
const CUSTOM_THEME_VOLUME = 0.28;

type Mp3Status = 'untested' | 'checking' | 'ready' | 'playing' | 'unavailable';

class WebAudioSoundEngine implements SoundEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private musicFilter: BiquadFilterNode | null = null;
  private sfxGain: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;

  private customAudio: HTMLAudioElement | null = null;
  private mp3Status: Mp3Status = 'untested';

  private muted = false;
  private musicDesired = false;
  private musicPlaying = false;
  private schedulerId: ReturnType<typeof setInterval> | null = null;
  private nextStepTime = 0;
  /** Tick within the active theme's loop: 0 .. progression.length * stepsPerBar - 1. */
  private currentStep = 0;
  private lastStepMs = 0;
  private lastMapStationMs: number | null = null;

  /** District whose theme is being scheduled (or will be, once music runs). */
  private activeThemeId: NeighborhoodId = DEFAULT_MUSIC_THEME_ID;
  /** District queued to take over on the next bar line, while music is audible. */
  private pendingThemeId: NeighborhoodId | null = null;
  /** True between playSubwayDepart and playSubwayArrive: music held at RIDE_DUCK. */
  private rideDucked = false;
  /** True while a stop-the-game screen is up (see setMusicHushed). Wins over the ride duck. */
  private hushed = false;
  private rideFailsafeId: ReturnType<typeof setTimeout> | null = null;

  private get activeTheme(): MusicTheme {
    return MUSIC_THEMES[this.activeThemeId];
  }

  /**
   * The level the music bus should rest at right now. Every place that brings
   * the music back up asks this, so a theme switch finishing mid-ride cannot
   * accidentally un-duck the ride.
   */
  private musicRestingGain(): number {
    if (this.hushed) return MUSIC_HUSHED;
    return this.rideDucked ? RIDE_DUCK : MUSIC_BUS_GAIN;
  }

  /**
   * Smoothly move the music bus toward `target`, starting now.
   *
   * Why not just cancelScheduledValues + setTargetAtTime? Cancelling removes
   * any in-flight automation, and some browsers then snap the gain back to the
   * last *scheduled* value before the new curve starts: an audible click.
   * Pinning the current value first (setValueAtTime(gain.value, now)) makes
   * the new curve start exactly where the old one was.
   */
  private glideMusicBus(target: number, timeConstant: number): void {
    if (!this.ctx || !this.musicGain) return;
    const now = this.ctx.currentTime;
    const gain = this.musicGain.gain;
    gain.cancelScheduledValues(now);
    gain.setValueAtTime(gain.value, now);
    gain.setTargetAtTime(target, now, timeConstant);
  }

  public setMusicTheme(district: NeighborhoodId): void {
    // Unknown id from a bad caller: ignore rather than crash the audio thread.
    if (!(district in MUSIC_THEMES)) return;

    const decision = decideThemeChange(
      { active: this.activeThemeId, pending: this.pendingThemeId, playing: this.musicPlaying },
      district
    );

    try {
      switch (decision) {
        case 'none':
          return;
        case 'swap-now':
          // Nothing audible (paused, muted, MP3 mode, or not started): just
          // remember it. startMusic / unmute will begin this theme at bar 0.
          this.commitTheme(district);
          return;
        case 'cancel-queue':
          this.pendingThemeId = null;
          this.glideMusicBus(this.musicRestingGain(), 0.15);
          return;
        case 'queue': {
          this.pendingThemeId = district;
          // Duck toward the bar line so the old theme fades out instead of
          // being cut. The time constant is a third of the time left, so the
          // fade is ~95% done by the switch (3 time constants = 95%).
          const ctx = this.ctx;
          if (!ctx) return;
          const secondsToBarLine = this.secondsUntilNextBarLine(ctx.currentTime);
          const duckTarget = Math.min(THEME_SWITCH_DUCK, this.musicRestingGain());
          this.glideMusicBus(duckTarget, Math.max(0.04, secondsToBarLine / 3));
          return;
        }
      }
    } catch {
      // Never throw from audio.
    }
  }

  /** Make `district` the active theme from its first bar, dropping any queue. */
  private commitTheme(district: NeighborhoodId): void {
    const changed = district !== this.activeThemeId;
    this.activeThemeId = district;
    this.pendingThemeId = null;
    if (changed) this.currentStep = 0;
    // Glide (50 ms time constant) rather than jump: old-theme tails may still
    // be ringing through the filter, and an instant cutoff jump can tick.
    if (this.ctx && this.musicFilter) {
      this.musicFilter.frequency.setTargetAtTime(this.activeTheme.warmthHz, this.ctx.currentTime, 0.05);
    }
  }

  /** Seconds from `now` until the next bar line of the active theme. */
  private secondsUntilNextBarLine(now: number): number {
    const theme = this.activeTheme;
    const stepsPerBar = theme.stepsPerBar;
    // nextStepTime is when the next not-yet-scheduled tick sounds. If that tick
    // is itself a bar line the switch happens there; otherwise count forward.
    const stepsToBarLine = (stepsPerBar - (this.currentStep % stepsPerBar)) % stepsPerBar;
    const barLineTime = this.nextStepTime + stepsToBarLine * eighthNoteSeconds(theme);
    return Math.max(0, barLineTime - now);
  }

  public initOnGesture(): void {
    try {
      const ctx = this.ensureContext();
      if (ctx && ctx.state === 'suspended') {
        void ctx.resume().catch(() => {
          // Autoplay may still be blocked; ignore safely.
        });
      }

      if (this.musicDesired && !this.muted) {
        if (this.mp3Status === 'ready' && this.customAudio) {
          this.playCustomAudioElement(this.customAudio);
        } else if (this.mp3Status === 'untested') {
          this.tryStartCustomMp3();
        } else if (this.mp3Status === 'unavailable' && !this.musicPlaying) {
          this.beginMusicScheduler();
        }
      }
    } catch {
      // Never throw on audio initialization failure.
    }
  }

  public isMuted(): boolean {
    return this.muted;
  }

  public toggleMute(): boolean {
    this.muted = !this.muted;

    try {
      if (this.ctx && this.masterGain) {
        const now = this.ctx.currentTime;
        this.masterGain.gain.cancelScheduledValues(now);
        this.masterGain.gain.setTargetAtTime(this.muted ? 0 : 1, now, 0.015);
      }

      if (this.customAudio) {
        this.customAudio.muted = this.muted;
      }

      if (this.muted) {
        this.pauseMusicScheduler();
        if (this.customAudio && !this.customAudio.paused) {
          this.customAudio.pause();
        }
      } else if (this.musicDesired) {
        this.initOnGesture();
        if (
          this.customAudio &&
          (this.mp3Status === 'ready' || this.mp3Status === 'playing')
        ) {
          this.playCustomAudioElement(this.customAudio);
        } else if (this.mp3Status === 'unavailable' && !this.musicPlaying) {
          this.beginMusicScheduler();
        } else if (this.mp3Status === 'untested') {
          this.tryStartCustomMp3();
        }
      }
    } catch {
      // Ignore Web Audio state errors.
    }

    return this.muted;
  }

  public startMusic(): void {
    this.musicDesired = true;
    if (this.muted) return;

    try {
      if (this.mp3Status === 'untested') {
        this.tryStartCustomMp3();
        return;
      }

      if (
        this.customAudio &&
        (this.mp3Status === 'ready' || this.mp3Status === 'playing')
      ) {
        this.playCustomAudioElement(this.customAudio);
        return;
      }

      if (this.mp3Status === 'unavailable') {
        this.startProceduralMusic();
      }
    } catch {
      // Ignore safely.
    }
  }

  public setMusicHushed(hushed: boolean): void {
    if (hushed === this.hushed) return;
    this.hushed = hushed;
    // Out: time constant 0.25 s, about a second to silence while the sting plays.
    // Back: 0.4 s, a slower swell so the new day "fades up" instead of snapping on.
    if (this.musicPlaying) this.glideMusicBus(this.musicRestingGain(), hushed ? 0.25 : 0.4);
    // The optional MP3 soundtrack has no gain node on our bus: pause and resume it.
    try {
      if (this.customAudio && this.mp3Status === 'playing' && this.musicDesired && !this.muted) {
        if (hushed) this.customAudio.pause();
        else this.playCustomAudioElement(this.customAudio);
      }
    } catch {
      // Ignore safely, like every other audio call.
    }
  }

  public stopMusic(): void {
    this.musicDesired = false;
    this.pauseMusicScheduler();
    try {
      if (this.customAudio && !this.customAudio.paused) {
        this.customAudio.pause();
      }
    } catch {
      // Ignore safely.
    }
  }

  public playCoin(combo = 1): void {
    const ctx = this.getActiveSfxContext();
    if (!ctx || !this.sfxGain) return;

    try {
      const now = ctx.currentTime;
      // Climb a cheerful C-major pentatonic scale with combo: C5, D5, E5, G5, A5, C6
      const pentatonic = [523.25, 587.33, 659.25, 783.99, 880.0, 1046.5];
      const safeCombo = Number.isFinite(combo) ? Math.floor(combo) : 1;
      const idx = Math.min(pentatonic.length - 1, Math.max(0, safeCombo - 1));
      // The combo is told by WHICH scale note plays, so per-play variation
      // stays tiny (+-1%, far less than the 12%+ gap between scale steps):
      // enough to stop machine-gun sameness, never enough to blur the climb.
      const rootFreq = pentatonic[idx] * varyRatio(0.01, cosmeticRandom);
      const fifthFreq = rootFreq * 1.5;

      // Bright 2-note coin chime
      this.playTone(ctx, this.sfxGain, {
        type: 'sine',
        freq: rootFreq,
        start: now,
        attack: 0.006,
        duration: 0.13,
        gain: 0.42,
      });
      this.playTone(ctx, this.sfxGain, {
        type: 'triangle',
        freq: rootFreq * 2,
        start: now,
        attack: 0.006,
        duration: 0.08,
        gain: 0.1,
      });

      this.playTone(ctx, this.sfxGain, {
        type: 'sine',
        freq: fifthFreq,
        start: now + 0.065,
        attack: 0.006,
        duration: 0.22,
        gain: 0.46,
      });
      this.playTone(ctx, this.sfxGain, {
        type: 'triangle',
        freq: fifthFreq * 2,
        start: now + 0.065,
        attack: 0.006,
        duration: 0.14,
        gain: 0.1,
      });

      // Extra golden sparkle overtone on combo >= 3
      if (safeCombo >= 3) {
        this.playTone(ctx, this.sfxGain, {
          type: 'sine',
          freq: rootFreq * 2,
          start: now + 0.12,
          attack: 0.006,
          duration: 0.2,
          gain: Math.min(0.24, 0.14 + (safeCombo - 3) * 0.025),
        });
        this.playTone(ctx, this.sfxGain, {
          type: 'triangle',
          freq: rootFreq * 3,
          start: now + 0.12,
          attack: 0.006,
          duration: 0.12,
          gain: 0.07,
        });
      }
    } catch {
      // Ignore safely.
    }
  }

  public playBrew(): void {
    const ctx = this.getActiveSfxContext();
    if (!ctx || !this.sfxGain) return;

    try {
      const now = ctx.currentTime;
      // Cheerful ascending bubbly pour arpeggio: C5 -> E5 -> G5 -> C6.
      // Every pour is a little different: +-3% pitch, a slightly faster or
      // slower bubble run, and a different fizz brightness, like real pouring.
      const notes = [523.25, 659.25, 783.99, 1046.5];
      const detune = varyRatio(0.03, cosmeticRandom);
      const bubbleGap = 0.05 + cosmeticRandom() * 0.012;
      const fizzTop = 2000 + cosmeticRandom() * 450;
      notes.forEach((baseFreq, i) => {
        const freq = baseFreq * detune;
        const t = now + i * bubbleGap;
        this.playTone(ctx, this.sfxGain!, {
          type: 'sine',
          freq: freq * 0.92,
          endFreq: freq * 1.03,
          start: t,
          attack: 0.008,
          duration: 0.14,
          gain: 0.34,
        });
      });

      // Soft fizzy pour shimmer
      this.playNoiseSweep(ctx, this.sfxGain, {
        start: now,
        duration: 0.24,
        startFreq: 900,
        endFreq: fizzTop,
        q: 2.2,
        gain: 0.08,
      });
    } catch {
      // Ignore safely.
    }
  }

  public playClick(): void {
    const ctx = this.getActiveSfxContext();
    if (!ctx || !this.sfxGain) return;

    try {
      const now = ctx.currentTime;
      // Subtle crisp UI tap. Clicks are the most repeated sound in the game,
      // so each one picks one of three slightly different taps and detunes
      // it by up to 3%: the ear stops noticing a sound that never changes,
      // but finds an exact repeat mechanical when it does notice.
      const voicings = [
        { type: 'triangle' as const, freq: 700, endFreq: 500 },
        { type: 'triangle' as const, freq: 760, endFreq: 530 },
        { type: 'sine' as const, freq: 650, endFreq: 470 },
      ];
      const voicing = voicings[pickVariant(voicings.length, cosmeticRandom)];
      const detune = varyRatio(0.03, cosmeticRandom);
      this.playTone(ctx, this.sfxGain, {
        type: voicing.type,
        freq: voicing.freq * detune,
        endFreq: voicing.endFreq * detune,
        start: now,
        attack: 0.004,
        duration: 0.038,
        // A sine has no upper harmonics, so it reads quieter at equal gain.
        gain: voicing.type === 'sine' ? 0.3 : 0.26,
      });
    } catch {
      // Ignore safely.
    }
  }

  public playBuy(): void {
    const ctx = this.getActiveSfxContext();
    if (!ctx || !this.sfxGain) return;

    try {
      const now = ctx.currentTime;
      // Warm 3-note success chord. All three voicings are the same C-major
      // chord (so "bought" always means the same thing), in different
      // inversions: root position C-E-G, E-G-C and G-C-E.
      const voicings = [
        [523.25, 659.25, 783.99],
        [659.25, 783.99, 1046.5],
        [783.99, 1046.5, 1318.51],
      ];
      const chord = voicings[pickVariant(voicings.length, cosmeticRandom)];
      const detune = varyRatio(0.015, cosmeticRandom);
      chord.forEach((baseFreq, idx) => {
        const freq = baseFreq * detune;
        const start = now + idx * 0.048;
        this.playTone(ctx, this.sfxGain!, {
          type: 'triangle',
          freq,
          start,
          attack: 0.01,
          duration: 0.28 - idx * 0.02,
          gain: 0.3,
        });
        this.playTone(ctx, this.sfxGain!, {
          type: 'sine',
          freq: freq * 2,
          start,
          attack: 0.01,
          duration: 0.16,
          gain: 0.09,
        });
      });
    } catch {
      // Ignore safely.
    }
  }

  public playReject(): void {
    const ctx = this.getActiveSfxContext();
    if (!ctx || !this.sfxGain) return;

    try {
      const now = ctx.currentTime;
      // Soft descending 2-note thud: E3 -> C3. The falling shape is the
      // meaning ("no"), so only a small +-2% detune is applied to both notes.
      const detune = varyRatio(0.02, cosmeticRandom);
      this.playTone(ctx, this.sfxGain, {
        type: 'triangle',
        freq: 164.81 * detune,
        endFreq: 150 * detune,
        start: now,
        attack: 0.008,
        duration: 0.11,
        gain: 0.38,
      });
      this.playTone(ctx, this.sfxGain, {
        type: 'triangle',
        freq: 130.81 * detune,
        endFreq: 112 * detune,
        start: now + 0.095,
        attack: 0.008,
        duration: 0.16,
        gain: 0.42,
      });
    } catch {
      // Ignore safely.
    }
  }

  public playDayEnd(): void {
    const ctx = this.getActiveSfxContext();
    if (!ctx || !this.sfxGain) return;

    try {
      const now = ctx.currentTime;
      // Pleasant 4-note evening wrap-up fanfare: F4 -> A4 -> C5 -> F5
      const notes = [349.23, 440.0, 523.25, 698.46];
      notes.forEach((freq, i) => {
        const isLast = i === notes.length - 1;
        const start = now + i * 0.11;
        const duration = isLast ? 0.52 : 0.24;

        this.playTone(ctx, this.sfxGain!, {
          type: 'triangle',
          freq,
          start,
          attack: 0.012,
          duration,
          gain: isLast ? 0.34 : 0.28,
        });
        this.playTone(ctx, this.sfxGain!, {
          type: 'sine',
          freq: freq * 2,
          start,
          attack: 0.015,
          duration: duration * 0.7,
          gain: 0.08,
        });
      });

      // Warm Fmaj7 pad glow under the final note
      const padStart = now + 0.33;
      [349.23, 440.0, 523.25, 659.25].forEach((freq) => {
        this.playTone(ctx, this.sfxGain!, {
          type: 'sine',
          freq,
          start: padStart,
          attack: 0.03,
          duration: 0.56,
          gain: 0.11,
        });
      });
    } catch {
      // Ignore safely.
    }
  }

  public playDayLost(): void {
    const ctx = this.getActiveSfxContext();
    if (!ctx || !this.sfxGain) return;
    try {
      const now = ctx.currentTime;
      // Falling minor steps (E4 -> D#4 -> D4 -> C#4), the last one held: "missed it".
      const notes = [329.63, 311.13, 293.66, 277.18];
      notes.forEach((freq, i) => {
        const isLast = i === notes.length - 1;
        this.playTone(ctx, this.sfxGain!, {
          type: 'square',
          freq,
          start: now + i * 0.2,
          attack: 0.01,
          duration: isLast ? 0.6 : 0.18,
          gain: 0.12,
        });
      });
    } catch {
      // Ignore safely.
    }
  }

  public playLineCrossed(): void {
    const ctx = this.getActiveSfxContext();
    if (!ctx || !this.sfxGain) return;
    try {
      const now = ctx.currentTime;
      // Fast rising C-major run ending an octave up (C5 E5 G5 C6 E6): "level up".
      const notes = [523.25, 659.25, 783.99, 1046.5, 1318.51];
      notes.forEach((freq, i) => {
        const isLast = i === notes.length - 1;
        this.playTone(ctx, this.sfxGain!, {
          type: 'square',
          freq,
          start: now + i * 0.05,
          attack: 0.004,
          duration: isLast ? 0.4 : 0.07,
          gain: isLast ? 0.16 : 0.12,
        });
      });
    } catch {
      // Ignore safely.
    }
  }

  public playTravel(): void {
    const ctx = this.getActiveSfxContext();
    if (!ctx || !this.sfxGain) return;

    try {
      const now = ctx.currentTime;
      // Quick breezy whoosh
      this.playNoiseSweep(ctx, this.sfxGain, {
        start: now,
        duration: 0.24,
        startFreq: 380,
        endFreq: 1350,
        q: 1.6,
        gain: 0.16,
      });

      // Light 2-note airy chime: G5 -> D6
      this.playTone(ctx, this.sfxGain, {
        type: 'sine',
        freq: 783.99,
        start: now + 0.03,
        attack: 0.01,
        duration: 0.16,
        gain: 0.24,
      });
      this.playTone(ctx, this.sfxGain, {
        type: 'sine',
        freq: 1174.66,
        start: now + 0.1,
        attack: 0.01,
        duration: 0.22,
        gain: 0.22,
      });
    } catch {
      // Ignore safely.
    }
  }

  // ---------------------------------------------------------------------------
  // Subway ride: depart -> (rumble under the closed doors) -> arrive.
  // ---------------------------------------------------------------------------

  public playSubwayDepart(): void {
    // Duck the music for the ride even when SFX are unavailable this instant,
    // so the ride/arrive pair always stays balanced.
    this.beginRideDuck();

    const ctx = this.getActiveSfxContext();
    if (!ctx || !this.sfxGain) return;

    try {
      const now = ctx.currentTime;
      const sfx = this.sfxGain;

      // 1. Door chime: an original two-tone falling fourth (A5 -> E5) on a
      //    soft bell. Two falling tones is the universal "doors closing"
      //    signal; the interval and timbre are our own.
      const chime = [
        { freq: 880.0, at: 0, dur: 0.22 },
        { freq: 659.25, at: 0.2, dur: 0.34 },
      ];
      for (const note of chime) {
        this.playTone(ctx, sfx, { type: 'sine', freq: note.freq, start: now + note.at, attack: 0.006, duration: note.dur, gain: 0.2 });
        this.playTone(ctx, sfx, {
          type: 'sine',
          freq: note.freq * 2.76, // inharmonic bell partial (see the 'bell' lead)
          start: now + note.at,
          attack: 0.004,
          duration: note.dur * 0.35,
          gain: 0.035,
        });
      }

      // 2. Doors thud shut just as the chime ends: a low sine drop plus a
      //    short dull noise burst for the rubber edges meeting.
      const thudAt = now + 0.55;
      this.playTone(ctx, sfx, { type: 'sine', freq: 95, endFreq: 48, start: thudAt, attack: 0.004, duration: 0.16, gain: 0.42 });
      this.playNoiseSweep(ctx, sfx, { start: thudAt, duration: 0.09, startFreq: 420, endFreq: 180, q: 1.1, gain: 0.12 });

      // 3. Train rumble under the cover phase, fresh variation each ride.
      this.playRideRumble(ctx, sfx, now + 0.35, planRumble(RIDE_RUMBLE_SEC, cosmeticRandom));
    } catch {
      // Ignore safely.
    }
  }

  public playSubwayArrive(district: NeighborhoodId): void {
    const ctx = this.getActiveSfxContext();
    if (ctx && this.sfxGain) {
      try {
        // Doors-open hiss: pneumatic air release, a noise sweep falling in
        // pitch and fading out.
        this.playNoiseSweep(ctx, this.sfxGain, {
          start: ctx.currentTime,
          duration: 0.42,
          startFreq: 5200,
          endFreq: 1600,
          q: 0.8,
          gain: 0.1,
        });
      } catch {
        // Ignore safely.
      }
    }

    this.switchThemeForArrival(district);
    this.endRideDuck();
  }

  public playMapStation(index: number, count: number): void {
    // Throttle on wall-clock time so a fast sweep across the map plays at
    // most one chime per 40 ms (25 per second) instead of a smear of noise.
    const nowMs = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (!throttleAllows(this.lastMapStationMs, nowMs, MAP_STATION_MIN_GAP_MS)) return;
    this.lastMapStationMs = nowMs;

    const ctx = this.getActiveSfxContext();
    if (!ctx || !this.sfxGain) return;

    try {
      const now = ctx.currentTime;
      // Pitch carries meaning here (where on the line you are), so no detune.
      const freq = midiToFreq(stationChimeMidi(index, count));
      this.playTone(ctx, this.sfxGain, { type: 'sine', freq, start: now, attack: 0.003, duration: 0.09, gain: 0.16 });
      this.playTone(ctx, this.sfxGain, { type: 'triangle', freq: freq * 2, start: now, attack: 0.002, duration: 0.03, gain: 0.04 });
    } catch {
      // Ignore safely.
    }
  }

  public playMapSelect(): void {
    const ctx = this.getActiveSfxContext();
    if (!ctx || !this.sfxGain) return;

    try {
      const now = ctx.currentTime;
      // "Ding-dong": a falling major third (E5 -> C5), softer than the ride
      // chime (peak 0.17 vs 0.2+) because inspecting is not committing.
      const notes = [
        { freq: 659.25, at: 0, dur: 0.18, gain: 0.17 },
        { freq: 523.25, at: 0.13, dur: 0.32, gain: 0.16 },
      ];
      for (const note of notes) {
        this.playTone(ctx, this.sfxGain, { type: 'sine', freq: note.freq, start: now + note.at, attack: 0.005, duration: note.dur, gain: note.gain });
        this.playTone(ctx, this.sfxGain, {
          type: 'triangle',
          freq: note.freq * 2,
          start: now + note.at,
          attack: 0.004,
          duration: note.dur * 0.4,
          gain: note.gain * 0.18,
        });
      }
    } catch {
      // Ignore safely.
    }
  }

  /**
   * Low rumble + motor hum + wheel clacks, all fading in and out so the ride
   * never starts or stops with a click.
   */
  private playRideRumble(ctx: AudioContext, dest: AudioNode, start: number, plan: RumblePlan): void {
    const end = start + RIDE_RUMBLE_SEC;

    // Rumble: noise through a low-pass, with a slow swell and fade.
    const source = ctx.createBufferSource();
    source.buffer = this.getNoiseBuffer(ctx);
    source.loop = true; // the noise buffer is 0.5 s; the ride is longer
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(plan.rumbleCutoffHz, start);
    lp.Q.value = 0.9;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, start);
    env.gain.linearRampToValueAtTime(0.32, start + 0.25);
    env.gain.setValueAtTime(0.32, end - 0.35);
    env.gain.exponentialRampToValueAtTime(0.0001, end);
    source.connect(lp);
    lp.connect(env);
    env.connect(dest);
    source.start(start);
    source.stop(end + 0.02);

    // Motor hum under it.
    this.playTone(ctx, dest, { type: 'sine', freq: plan.humHz, start, attack: 0.25, duration: RIDE_RUMBLE_SEC, gain: 0.12 });

    // Wheel clacks: short, slightly metallic noise ticks.
    for (const offset of plan.clackTimes) {
      const at = start + offset;
      this.playNoiseSweep(ctx, dest, { start: at, duration: 0.05, startFreq: 1400, endFreq: 700, q: 2.5, gain: 0.14 });
    }
  }

  /** Hold the music low for the ride, with a failsafe release. */
  private beginRideDuck(): void {
    this.rideDucked = true;
    if (this.musicPlaying) this.glideMusicBus(RIDE_DUCK, 0.12);

    if (this.rideFailsafeId !== null) clearTimeout(this.rideFailsafeId);
    this.rideFailsafeId = setTimeout(() => {
      this.rideFailsafeId = null;
      this.endRideDuck();
    }, RIDE_DUCK_FAILSAFE_MS);
  }

  private endRideDuck(): void {
    if (this.rideFailsafeId !== null) {
      clearTimeout(this.rideFailsafeId);
      this.rideFailsafeId = null;
    }
    if (!this.rideDucked) return;
    this.rideDucked = false;
    // Swell back over ~1 s (time constant 0.35 s): the new district "fades up"
    // as the doors open rather than snapping on.
    if (this.musicPlaying) this.glideMusicBus(this.musicRestingGain(), 0.35);
  }

  /**
   * On arrival the music is already ducked under the ride, so there is no
   * need to wait for a bar line: start the destination theme at its bar 0
   * right away. This also overrides a switch the caller may have queued with
   * setMusicTheme during the ride.
   */
  private switchThemeForArrival(district: NeighborhoodId): void {
    if (!(district in MUSIC_THEMES)) return;
    try {
      const needsSwitch = district !== this.activeThemeId || this.pendingThemeId !== null;
      if (!needsSwitch) return; // same district: keep playing, no restart
      if (!this.musicPlaying || !this.ctx || !this.musicFilter) {
        this.commitTheme(district);
        return;
      }
      this.commitTheme(district);
      // Leave a short breath after the hiss before the new bar 0. Never move
      // the clock backward: ticks before nextStepTime are already booked
      // (they belong to the old theme, and are ducked).
      this.nextStepTime = Math.max(this.nextStepTime, this.ctx.currentTime + 0.18);
    } catch {
      // Ignore safely.
    }
  }

  public playHonkKo(): void {
    const ctx = this.getActiveSfxContext();
    if (!ctx || !this.sfxGain) return;

    try {
      const now = ctx.currentTime;

      // Playful NYC taxi double-honk ("beep-beep!") through a warm low-pass filter
      const hornFilter = ctx.createBiquadFilter();
      hornFilter.type = 'lowpass';
      hornFilter.frequency.setValueAtTime(1450, now);
      hornFilter.Q.value = 1.2;
      hornFilter.connect(this.sfxGain);

      const honkNotes = [392.0, 493.88]; // G4 + B4 dual-tone cab horn
      const honks: readonly { offset: number; dur: number }[] = [
        { offset: 0, dur: 0.095 },
        { offset: 0.135, dur: 0.13 },
      ];

      for (const honk of honks) {
        const start = now + honk.offset;
        for (const freq of honkNotes) {
          this.playTone(ctx, hornFilter, {
            type: 'sawtooth',
            freq,
            start,
            attack: 0.008,
            duration: honk.dur,
            gain: 0.16,
          });
        }
      }

      // Gentle cartoon descending soul-float chime
      const soulNotes = [659.25, 587.33, 493.88, 392.0]; // E5 -> D5 -> B4 -> G4
      soulNotes.forEach((freq, i) => {
        const isLast = i === soulNotes.length - 1;
        const start = now + 0.31 + i * 0.09;
        const duration = isLast ? 0.34 : 0.16;

        this.playTone(ctx, this.sfxGain!, {
          type: 'sine',
          freq,
          endFreq: isLast ? freq * 0.88 : freq * 0.97,
          start,
          attack: 0.014,
          duration,
          gain: isLast ? 0.26 : 0.22,
        });
        this.playTone(ctx, this.sfxGain!, {
          type: 'triangle',
          freq: freq * 2,
          start,
          attack: 0.012,
          duration: duration * 0.6,
          gain: 0.055,
        });
      });
    } catch {
      // Ignore safely.
    }
  }

  public playPerfect(): void {
    const ctx = this.getActiveSfxContext();
    if (!ctx || !this.sfxGain) return;

    try {
      const now = ctx.currentTime;
      // Crisp, bright 3-note golden fanfare chime: G5 -> B5 -> D6 (+ shimmering octave sparkle)
      const notes = [783.99, 987.77, 1174.66];
      notes.forEach((freq, i) => {
        const isLast = i === notes.length - 1;
        const start = now + i * 0.062;
        const duration = isLast ? 0.36 : 0.16;

        this.playTone(ctx, this.sfxGain!, {
          type: 'sine',
          freq,
          start,
          attack: 0.006,
          duration,
          gain: isLast ? 0.42 : 0.34,
        });
        this.playTone(ctx, this.sfxGain!, {
          type: 'triangle',
          freq: freq * 2,
          start,
          attack: 0.006,
          duration: duration * 0.65,
          gain: isLast ? 0.14 : 0.09,
        });
      });

      // Final golden G6 shimmer bell
      this.playTone(ctx, this.sfxGain, {
        type: 'sine',
        freq: 1567.98,
        start: now + 0.145,
        attack: 0.008,
        duration: 0.34,
        gain: 0.22,
      });
    } catch {
      // Ignore safely.
    }
  }

  public playStep(): void {
    const nowMs =
      typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (nowMs - this.lastStepMs < 280) return;
    this.lastStepMs = nowMs;

    const ctx = this.getActiveSfxContext();
    if (!ctx || !this.masterGain) return;

    try {
      const now = ctx.currentTime;
      const jitter = 0.92 + cosmeticRandom() * 0.16; // subtle ±8% pitch variation

      // Soft low-pass filter at 300Hz for a muted, cozy sneaker pat
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(300, now);
      lp.Q.value = 0.7;
      lp.connect(this.masterGain);

      // Warm muffled sine tap: 145Hz -> 65Hz over 40ms at very low gain (0.035)
      this.playTone(ctx, lp, {
        type: 'sine',
        freq: 145 * jitter,
        endFreq: 65 * jitter,
        start: now,
        attack: 0.008,
        duration: 0.04,
        gain: 0.035,
      });
    } catch {
      // Ignore safely.
    }
  }

  // ---------------------------------------------------------------------------
  // Internal Web Audio plumbing
  // ---------------------------------------------------------------------------

  private ensureContext(): AudioContext | null {
    if (this.ctx) return this.ctx;
    if (typeof window === 'undefined') return null;

    const AudioCtx =
      window.AudioContext || (window as WindowWithWebkitAudio).webkitAudioContext;
    if (!AudioCtx) return null;

    const ctx = new AudioCtx();
    const masterGain = ctx.createGain();
    masterGain.gain.value = this.muted ? 0 : 1;
    masterGain.connect(ctx.destination);

    // Warm low-pass filter on the music bus for cozy lo-fi Rhodes tone
    const musicFilter = ctx.createBiquadFilter();
    musicFilter.type = 'lowpass';
    musicFilter.frequency.value = 2100;
    musicFilter.Q.value = 0.6;

    const musicGain = ctx.createGain();
    musicGain.gain.value = this.musicRestingGain();

    musicFilter.connect(musicGain);
    musicGain.connect(masterGain);

    const sfxGain = ctx.createGain();
    sfxGain.gain.value = SFX_BUS_GAIN;
    sfxGain.connect(masterGain);

    this.ctx = ctx;
    this.masterGain = masterGain;
    this.musicFilter = musicFilter;
    this.musicGain = musicGain;
    this.sfxGain = sfxGain;

    return ctx;
  }

  private getActiveSfxContext(): AudioContext | null {
    if (this.muted) return null;

    try {
      const ctx = this.ensureContext();
      if (!ctx) return null;

      if (ctx.state === 'suspended') {
        void ctx.resume().catch(() => {
          // Autoplay blocked until next user gesture.
        });
      }

      return ctx;
    } catch {
      return null;
    }
  }

  private tryStartCustomMp3(): void {
    if (typeof Audio === 'undefined') {
      this.mp3Status = 'unavailable';
      this.startProceduralMusic();
      return;
    }

    this.mp3Status = 'checking';

    try {
      const audio = new Audio(CUSTOM_THEME_URL);
      audio.loop = true;
      audio.volume = CUSTOM_THEME_VOLUME;
      audio.muted = this.muted;
      audio.preload = 'auto';

      const fallbackToProcedural = (): void => {
        if (this.mp3Status === 'unavailable') return;
        this.mp3Status = 'unavailable';
        if (this.customAudio === audio) {
          this.customAudio = null;
        }
        try {
          audio.pause();
        } catch {
          // Ignore safely.
        }
        if (this.musicDesired && !this.muted) {
          this.startProceduralMusic();
        }
      };

      audio.addEventListener('error', fallbackToProcedural, { once: true });
      this.customAudio = audio;
      this.playCustomAudioElement(audio);
    } catch {
      this.mp3Status = 'unavailable';
      this.customAudio = null;
      if (this.musicDesired && !this.muted) {
        this.startProceduralMusic();
      }
    }
  }

  private playCustomAudioElement(audio: HTMLAudioElement): void {
    try {
      audio.muted = this.muted;
      audio.volume = CUSTOM_THEME_VOLUME;
      const playPromise = audio.play();
      if (playPromise && typeof playPromise.then === 'function') {
        void playPromise
          .then(() => {
            if (this.customAudio !== audio || this.mp3Status === 'unavailable') {
              audio.pause();
              return;
            }
            this.mp3Status = 'playing';
            this.pauseMusicScheduler();
            if (!this.musicDesired || this.muted) {
              audio.pause();
            }
          })
          .catch((err: unknown) => {
            if (this.mp3Status === 'unavailable') return;
            const errName =
              typeof err === 'object' && err !== null && 'name' in err
                ? String((err as { name?: unknown }).name)
                : '';
            if (errName === 'NotAllowedError') {
              // File may exist, just waiting for user gesture.
              this.mp3Status = 'ready';
              return;
            }
            // Missing file / decode error -> fall back cleanly to procedural groove.
            this.mp3Status = 'unavailable';
            if (this.customAudio === audio) {
              this.customAudio = null;
            }
            if (this.musicDesired && !this.muted) {
              this.startProceduralMusic();
            }
          });
      }
    } catch {
      this.mp3Status = 'unavailable';
      if (this.customAudio === audio) {
        this.customAudio = null;
      }
      if (this.musicDesired && !this.muted) {
        this.startProceduralMusic();
      }
    }
  }

  private startProceduralMusic(): void {
    if (this.muted || !this.musicDesired) return;

    try {
      const ctx = this.ensureContext();
      if (!ctx) return;

      if (ctx.state === 'suspended') {
        void ctx.resume().catch(() => {
          // Will start automatically once initOnGesture runs.
        });
      }

      if (!this.musicPlaying) {
        this.beginMusicScheduler();
      }
    } catch {
      // Ignore safely.
    }
  }

  private beginMusicScheduler(): void {
    const ctx = this.ctx;
    if (!ctx || !this.musicGain || !this.musicFilter) return;

    this.pauseMusicScheduler();

    const now = ctx.currentTime;
    this.musicFilter.frequency.setValueAtTime(this.activeTheme.warmthHz, now);
    this.glideMusicBus(this.musicRestingGain(), 0.08);

    this.musicPlaying = true;
    this.nextStepTime = now + 0.06;

    this.scheduleMusicAhead();
    this.schedulerId = setInterval(() => {
      this.scheduleMusicAhead();
    }, LOOKAHEAD_MS);
  }

  private pauseMusicScheduler(): void {
    if (this.schedulerId !== null) {
      clearInterval(this.schedulerId);
      this.schedulerId = null;
    }
    this.musicPlaying = false;

    // A switch that was waiting for its bar line will never get one now, so
    // make it the active theme; resuming then starts it cleanly from bar 0.
    if (this.pendingThemeId !== null) {
      this.commitTheme(this.pendingThemeId);
    }

    this.glideMusicBus(0.0001, 0.05);
  }

  /**
   * The "lookahead scheduler" pattern: a coarse JavaScript timer (every
   * LOOKAHEAD_MS) books every tick that falls inside the next
   * SCHEDULE_AHEAD_SEC on the audio clock. JavaScript timers jitter by tens of
   * milliseconds, but notes booked on the audio clock play sample-accurately,
   * so the groove stays tight even when the main thread is busy.
   */
  private scheduleMusicAhead(): void {
    const ctx = this.ctx;
    if (
      !ctx ||
      !this.musicFilter ||
      !this.musicGain ||
      !this.musicPlaying ||
      this.muted
    ) {
      return;
    }
    if (ctx.state !== 'running') return;

    try {
      // Catch up cleanly if the tab was backgrounded
      if (this.nextStepTime < ctx.currentTime - 0.1) {
        this.nextStepTime = ctx.currentTime + 0.05;
      }

      const horizon = ctx.currentTime + SCHEDULE_AHEAD_SEC;
      while (this.nextStepTime < horizon) {
        // A queued theme takes over exactly on a bar line, like a band
        // finishing the bar before changing tunes. Old notes booked before
        // this point keep their own decays (already ducked), so the two
        // themes never play on top of each other.
        if (this.pendingThemeId !== null && this.currentStep % this.activeTheme.stepsPerBar === 0) {
          const barLine = this.nextStepTime;
          this.activeThemeId = this.pendingThemeId;
          this.pendingThemeId = null;
          this.currentStep = 0;
          // Swell the new theme in from the duck, and move the tone filter to
          // its colour, both starting at the bar line. These are appended after
          // the in-progress duck (no cancel), so the duck finishes first.
          this.musicGain.gain.setTargetAtTime(this.musicRestingGain(), barLine, 0.25);
          this.musicFilter.frequency.setTargetAtTime(this.activeTheme.warmthHz, barLine, 0.2);
        }

        const theme = this.activeTheme;
        const eighth = eighthNoteSeconds(theme);
        // Swing: delay every off-beat eighth by a fraction of an eighth.
        const isOffbeat = this.currentStep % 2 === 1;
        const swungTime = this.nextStepTime + (isOffbeat ? theme.swing * eighth : 0);

        this.scheduleMusicStep(
          ctx,
          theme,
          this.musicFilter,
          this.musicGain,
          this.currentStep,
          swungTime
        );
        this.nextStepTime += eighth;
        this.currentStep = (this.currentStep + 1) % loopLengthSteps(theme);
      }
    } catch {
      // Ignore transient scheduling issues.
    }
  }

  /**
   * Play every part of one tick of `theme`. `warmDest` runs through the
   * low-pass filter (chords and bass, which should be soft); `directDest`
   * skips it (lead and percussion, which need their sparkle).
   */
  private scheduleMusicStep(
    ctx: AudioContext,
    theme: MusicTheme,
    warmDest: AudioNode,
    directDest: AudioNode,
    step: number,
    time: number
  ): void {
    const stepsPerBar = theme.stepsPerBar;
    const barIndex = Math.floor(step / stepsPerBar);
    const beatStep = step % stepsPerBar;
    const bar = theme.progression[barIndex];
    const eighth = eighthNoteSeconds(theme);

    // 1. Chord comping
    if (bar.compSteps.includes(beatStep)) {
      const isDownbeat = beatStep === 0;
      const { comp } = theme;
      const chordDur = eighth * (isDownbeat ? comp.downbeatLength : comp.offbeatLength);
      const velocity = isDownbeat ? comp.downbeatVelocity : comp.offbeatVelocity;
      bar.chord.forEach((midi, idx) => {
        this.playCompNote(
          comp.instrument,
          ctx,
          warmDest,
          midiToFreq(midi),
          time + idx * comp.strumSec,
          chordDur,
          velocity
        );
      });
    }

    // 2. Bass
    const bassMidi = bar.bass[beatStep];
    if (bassMidi !== null && bassMidi !== undefined) {
      const isRoot = beatStep === 0;
      const { bass } = theme;
      this.playBassNote(
        bass.instrument,
        ctx,
        warmDest,
        midiToFreq(bassMidi),
        time,
        eighth * (isRoot ? bass.rootLength : bass.otherLength),
        isRoot ? bass.rootGain : bass.otherGain
      );
    }

    // 3. Percussion
    const { percussion } = theme;
    const shakerGain = percussion.shaker[beatStep] ?? 0;
    if (shakerGain > 0) this.playBrushedShaker(ctx, directDest, time, shakerGain);
    const kickGain = percussion.kick[beatStep] ?? 0;
    if (kickGain > 0) this.playSoftKick(ctx, directDest, time, kickGain);
    const rimGain = percussion.rim[beatStep] ?? 0;
    if (rimGain > 0) this.playRimClick(ctx, directDest, time, rimGain);

    // 4. Lead melody
    const melodyHit = bar.melody[beatStep];
    if (melodyHit !== null && melodyHit !== undefined) {
      const [melodyMidi, vel] = melodyHit;
      this.playLeadNote(
        theme.lead.instrument,
        ctx,
        directDest,
        midiToFreq(melodyMidi),
        time,
        eighth * theme.lead.length,
        theme.lead.gain * vel
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Instruments. Each one is a recipe of a few oscillators with envelopes.
  // A sound's "colour" (timbre) comes from which harmonics are present and how
  // fast each fades: a pluck is bright and short, a pad swells slowly, a bell
  // has partials that are NOT whole-number multiples of the pitch.
  // ---------------------------------------------------------------------------

  private playCompNote(
    instrument: CompInstrument,
    ctx: AudioContext,
    dest: AudioNode,
    freq: number,
    start: number,
    duration: number,
    gain: number
  ): void {
    const shape = VOICE_SHAPES[instrument];
    switch (instrument) {
      case 'rhodes':
        this.playRhodesNote(ctx, dest, freq, start, duration, gain, shape);
        return;
      case 'piano':
        // Triangle body plus 2nd and 3rd harmonics that die quickly: a hammer
        // hit is bright for an instant, then mellows.
        this.playVoice(ctx, dest, shape, { type: 'triangle', freq, start, attack: 0.005, duration, gain: gain * 0.8 });
        this.playVoice(ctx, dest, shape, {
          type: 'sine',
          freq: freq * 2,
          start,
          attack: 0.004,
          duration: Math.min(0.3, duration * 0.45),
          gain: gain * 0.22,
        });
        this.playVoice(ctx, dest, shape, {
          type: 'sine',
          freq: freq * 3,
          start,
          attack: 0.004,
          duration: Math.min(0.12, duration * 0.25),
          gain: gain * 0.08,
        });
        return;
      case 'pluck':
        // Nylon string: very fast attack and short decay, with an octave
        // overtone that is gone almost immediately (the "pick" sound).
        this.playVoice(ctx, dest, shape, {
          type: 'triangle',
          freq,
          start,
          attack: 0.003,
          duration: Math.min(0.45, duration),
          gain: gain * 0.85,
        });
        this.playVoice(ctx, dest, shape, { type: 'sine', freq: freq * 2, start, attack: 0.002, duration: 0.06, gain: gain * 0.2 });
        return;
      case 'pad':
        // Two slightly detuned sines that slowly swell: the detune makes a
        // gentle "chorus" shimmer like a string section.
        this.playVoice(ctx, dest, shape, {
          type: 'sine',
          freq: freq * 0.997,
          start,
          attack: Math.min(0.35, duration * 0.3),
          duration,
          gain: gain * 0.6,
        });
        this.playVoice(ctx, dest, shape, {
          type: 'sine',
          freq: freq * 1.003,
          start,
          attack: Math.min(0.4, duration * 0.35),
          duration,
          gain: gain * 0.5,
        });
        return;
    }
  }

  private playBassNote(
    instrument: BassInstrument,
    ctx: AudioContext,
    dest: AudioNode,
    freq: number,
    start: number,
    duration: number,
    gain: number
  ): void {
    const shape = VOICE_SHAPES[instrument];
    if (instrument === 'upright') {
      this.playUprightBass(ctx, dest, freq, start, duration, gain, shape);
      return;
    }
    // 'round': a pure sine, a touch louder because a sine alone has less
    // perceived weight than the upright's triangle + sine.
    this.playVoice(ctx, dest, shape, { type: 'sine', freq, start, attack: 0.006, duration, gain: gain * 1.15 });
  }

  private playLeadNote(
    instrument: LeadInstrument,
    ctx: AudioContext,
    dest: AudioNode,
    freq: number,
    start: number,
    duration: number,
    gain: number
  ): void {
    const shape = VOICE_SHAPES[instrument];
    switch (instrument) {
      case 'marimba':
        this.playMarimbaNote(ctx, dest, freq, start, duration, gain, shape);
        return;
      case 'vibes':
        // Metal bar: long sine ring and a faint 4th harmonic shimmer, no wooden click.
        this.playVoice(ctx, dest, shape, { type: 'sine', freq, start, attack: 0.008, duration, gain });
        this.playVoice(ctx, dest, shape, {
          type: 'sine',
          freq: freq * 4,
          start,
          attack: 0.006,
          duration: Math.min(0.25, duration * 0.3),
          gain: gain * 0.12,
        });
        return;
      case 'bell':
        // Celesta: fundamental plus an inharmonic partial (2.76x, the ratio of
        // a struck metal bar's second mode). The "not quite an octave" partial
        // is what the ear hears as "bell".
        this.playVoice(ctx, dest, shape, { type: 'sine', freq, start, attack: 0.004, duration, gain: gain * 0.9 });
        this.playVoice(ctx, dest, shape, {
          type: 'sine',
          freq: freq * 2.76,
          start,
          attack: 0.003,
          duration: Math.min(0.4, duration * 0.35),
          gain: gain * 0.18,
        });
        return;
      case 'flute':
        // Breathy: slow-ish attack, triangle reinforced by a sine. No transient.
        this.playVoice(ctx, dest, shape, { type: 'triangle', freq, start, attack: 0.045, duration, gain: gain * 0.7 });
        this.playVoice(ctx, dest, shape, { type: 'sine', freq, start, attack: 0.06, duration, gain: gain * 0.45 });
        return;
      case 'blip':
        // Ticker: short sine with an octave, like a terminal beep softened.
        this.playVoice(ctx, dest, shape, { type: 'sine', freq, start, attack: 0.003, duration: Math.min(0.2, duration), gain });
        this.playVoice(ctx, dest, shape, {
          type: 'sine',
          freq: freq * 2,
          start,
          attack: 0.003,
          duration: Math.min(0.08, duration * 0.4),
          gain: gain * 0.25,
        });
        return;
    }
  }

  /** A soft, rounded kick: a sine that drops from 110 Hz to 45 Hz in 0.14 s. */
  private playSoftKick(ctx: AudioContext, dest: AudioNode, start: number, gain: number): void {
    this.playTone(ctx, dest, { type: 'sine', freq: 110, endFreq: 45, start, attack: 0.004, duration: 0.14, gain: gain * 2.2 });
  }

  /** A woody rim click: a very short burst of noise around 1.8 kHz. */
  private playRimClick(ctx: AudioContext, dest: AudioNode, start: number, gain: number): void {
    const source = ctx.createBufferSource();
    source.buffer = this.getNoiseBuffer(ctx);
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(1800, start);
    filter.Q.value = 4;
    const env = ctx.createGain();
    const dur = 0.03;
    env.gain.setValueAtTime(0.0001, start);
    env.gain.linearRampToValueAtTime(gain * 2.5, start + 0.002);
    env.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    source.connect(filter);
    filter.connect(env);
    env.connect(dest);
    source.start(start);
    source.stop(start + dur + 0.015);
  }

  private playRhodesNote(
    ctx: AudioContext,
    dest: AudioNode,
    freq: number,
    start: number,
    duration: number,
    gain: number,
    shape: VoiceShape
  ): void {
    // Dual subtly detuned warm sine + soft triangle body
    this.playVoice(ctx, dest, shape, {
      type: 'sine',
      freq: freq * 0.9985,
      start,
      attack: 0.012,
      duration,
      gain: gain * 0.72,
    });
    this.playVoice(ctx, dest, shape, {
      type: 'triangle',
      freq: freq * 1.0015,
      start,
      attack: 0.014,
      duration: duration * 0.85,
      gain: gain * 0.32,
    });
    // Gentle Rhodes tine bell overtone (2x frequency, quick decay)
    this.playVoice(ctx, dest, shape, {
      type: 'sine',
      freq: freq * 2,
      start,
      attack: 0.008,
      duration: Math.min(0.22, duration * 0.4),
      gain: gain * 0.14,
    });
  }

  private playUprightBass(
    ctx: AudioContext,
    dest: AudioNode,
    freq: number,
    start: number,
    duration: number,
    gain: number,
    shape: VoiceShape
  ): void {
    // Woody triangle fundamental with quick finger-pluck envelope
    this.playVoice(ctx, dest, shape, {
      type: 'triangle',
      freq,
      start,
      attack: 0.008,
      duration,
      gain,
    });
    // Soft warm sine reinforcement
    this.playVoice(ctx, dest, shape, {
      type: 'sine',
      freq,
      start,
      attack: 0.012,
      duration: duration * 0.9,
      gain: gain * 0.45,
    });
  }

  private playMarimbaNote(
    ctx: AudioContext,
    dest: AudioNode,
    freq: number,
    start: number,
    duration: number,
    gain: number,
    shape: VoiceShape
  ): void {
    // Warm resonant sine bar tone
    this.playVoice(ctx, dest, shape, {
      type: 'sine',
      freq,
      start,
      attack: 0.006,
      duration,
      gain,
    });
    // Crisp wooden mallet 4th-harmonic transient
    this.playVoice(ctx, dest, shape, {
      type: 'triangle',
      freq: freq * 4,
      start,
      attack: 0.004,
      duration: 0.036,
      gain: gain * 0.2,
    });
  }

  private playBrushedShaker(
    ctx: AudioContext,
    dest: AudioNode,
    start: number,
    gain: number
  ): void {
    const source = ctx.createBufferSource();
    source.buffer = this.getNoiseBuffer(ctx);

    const filter = ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.setValueAtTime(6800, start);
    filter.Q.value = 0.7;

    const env = ctx.createGain();
    const dur = 0.048;
    env.gain.setValueAtTime(0.0001, start);
    env.gain.linearRampToValueAtTime(gain, start + 0.008);
    env.gain.exponentialRampToValueAtTime(0.0001, start + dur);

    source.connect(filter);
    filter.connect(env);
    env.connect(dest);

    source.start(start);
    source.stop(start + dur + 0.015);
  }

  /**
   * One music oscillator with the sustain-pedal envelope (see VOICE_SHAPES):
   *   rise to the peak over `attack` (never shorter than the instrument's minimum,
   *   so no click), settle toward the sustain level while the note is written, then
   *   keep ringing and fade over the release tail after it ends.
   * setTargetAtTime is an exponential approach, the way a real string loses energy;
   * a time constant of release / 5 leaves under 1% of the level when the
   * oscillator stops. Sound effects keep playTone: their snap is the point.
   */
  private playVoice(
    ctx: AudioContext,
    dest: AudioNode,
    shape: VoiceShape,
    opts: { type: OscillatorType; freq: number; start: number; attack: number; duration: number; gain: number }
  ): void {
    const env = voiceEnvelope(shape, opts.attack, opts.duration, opts.gain);
    const osc = ctx.createOscillator();
    const amp = ctx.createGain();
    osc.type = opts.type;
    osc.frequency.setValueAtTime(opts.freq, opts.start);

    const peakAt = opts.start + env.attack;
    amp.gain.setValueAtTime(0.0001, opts.start);
    amp.gain.linearRampToValueAtTime(env.peak, peakAt);
    // Held: ease from the peak toward the sustain level over about the note's length.
    amp.gain.setTargetAtTime(env.sustainLevel, peakAt, Math.max(0.02, (env.holdEnd - env.attack) / 3));
    // Pedal tail: from wherever the hold left it, fade to silence.
    amp.gain.setTargetAtTime(0.0001, opts.start + env.holdEnd, env.release / 5);

    osc.connect(amp);
    amp.connect(dest);
    osc.start(opts.start);
    osc.stop(opts.start + env.stopAt);
  }

  private playTone(
    ctx: AudioContext,
    dest: AudioNode,
    opts: {
      type: OscillatorType;
      freq: number;
      endFreq?: number;
      start: number;
      attack: number;
      duration: number;
      gain: number;
    }
  ): void {
    const osc = ctx.createOscillator();
    const env = ctx.createGain();

    osc.type = opts.type;
    osc.frequency.setValueAtTime(opts.freq, opts.start);
    if (opts.endFreq !== undefined) {
      osc.frequency.exponentialRampToValueAtTime(
        Math.max(20, opts.endFreq),
        opts.start + opts.duration
      );
    }

    const peakTime = opts.start + Math.max(0.004, opts.attack);
    const endTime = opts.start + Math.max(opts.attack + 0.01, opts.duration);

    env.gain.setValueAtTime(0.0001, opts.start);
    env.gain.linearRampToValueAtTime(opts.gain, peakTime);
    env.gain.exponentialRampToValueAtTime(0.0001, endTime);

    osc.connect(env);
    env.connect(dest);

    osc.start(opts.start);
    osc.stop(endTime + 0.02);
  }

  private getNoiseBuffer(ctx: AudioContext): AudioBuffer {
    if (this.noiseBuffer && this.noiseBuffer.sampleRate === ctx.sampleRate) {
      return this.noiseBuffer;
    }
    const length = Math.floor(ctx.sampleRate * 0.5);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      data[i] = cosmeticRandom() * 2 - 1;
    }
    this.noiseBuffer = buffer;
    return buffer;
  }

  private playNoiseSweep(
    ctx: AudioContext,
    dest: AudioNode,
    opts: {
      start: number;
      duration: number;
      startFreq: number;
      endFreq: number;
      q: number;
      gain: number;
    }
  ): void {
    const source = ctx.createBufferSource();
    source.buffer = this.getNoiseBuffer(ctx);

    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = opts.q;
    filter.frequency.setValueAtTime(opts.startFreq, opts.start);
    filter.frequency.exponentialRampToValueAtTime(
      Math.max(40, opts.endFreq),
      opts.start + opts.duration
    );

    const env = ctx.createGain();
    const peak = opts.start + opts.duration * 0.25;
    const end = opts.start + opts.duration;
    env.gain.setValueAtTime(0.0001, opts.start);
    env.gain.linearRampToValueAtTime(opts.gain, peak);
    env.gain.exponentialRampToValueAtTime(0.0001, end);

    source.connect(filter);
    filter.connect(env);
    env.connect(dest);

    source.start(opts.start);
    source.stop(end + 0.02);
  }
}

export const soundEngine: SoundEngine = new WebAudioSoundEngine();

export function initOnGesture(): void {
  soundEngine.initOnGesture();
}

export function isMuted(): boolean {
  return soundEngine.isMuted();
}

export function toggleMute(): boolean {
  return soundEngine.toggleMute();
}

export function startMusic(): void {
  soundEngine.startMusic();
}

export function setMusicHushed(hushed: boolean): void {
  soundEngine.setMusicHushed(hushed);
}

export function stopMusic(): void {
  soundEngine.stopMusic();
}

export function playCoin(combo = 1): void {
  soundEngine.playCoin(combo);
}

export function playBrew(): void {
  soundEngine.playBrew();
}

export function playClick(): void {
  soundEngine.playClick();
}

export function playBuy(): void {
  soundEngine.playBuy();
}

export function playReject(): void {
  soundEngine.playReject();
}

export function playDayEnd(): void {
  soundEngine.playDayEnd();
}

export function playTravel(): void {
  soundEngine.playTravel();
}

export function setMusicTheme(district: NeighborhoodId): void {
  soundEngine.setMusicTheme(district);
}

export function playSubwayDepart(): void {
  soundEngine.playSubwayDepart();
}

export function playSubwayArrive(district: NeighborhoodId): void {
  soundEngine.playSubwayArrive(district);
}

export function playMapStation(index: number, count: number): void {
  soundEngine.playMapStation(index, count);
}

export function playMapSelect(): void {
  soundEngine.playMapSelect();
}

export function playHonkKo(): void {
  soundEngine.playHonkKo();
}

export function playPerfect(): void {
  soundEngine.playPerfect();
}

export function playStep(): void {
  soundEngine.playStep();
}
