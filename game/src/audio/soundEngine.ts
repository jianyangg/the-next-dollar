import { cosmeticRandom } from '../core/runRandom';

/**
 * Zero-dependency Web Audio API sound effects & upbeat NYC Afternoon Jazz-Bossa
 * tycoon soundtrack engine (with automatic `/audio/nyc-theme.mp3` support).
 * Safe in headless/SSR environments and resilient to browser autoplay policies.
 */

export interface SoundEngine {
  initOnGesture(): void;
  isMuted(): boolean;
  toggleMute(): boolean;
  startMusic(): void;
  stopMusic(): void;
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
  playTravel(): void;
  playHonkKo(): void;
  playPerfect(): void;
  playStep(): void;
}

type AudioContextConstructor = typeof AudioContext;

interface WindowWithWebkitAudio extends Window {
  webkitAudioContext?: AudioContextConstructor;
}

/** Convert MIDI note number to frequency in Hz. */
function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/**
 * 8-bar upbeat NYC Afternoon Jazz-Bossa / Tycoon Groove (106 BPM, subtle swing):
 * A-section: Cmaj9 | Am9 | Dm9 | G13
 * B-section: Fmaj9 | Em7 | Dm9 | G7
 */
type MelodyHit = readonly [midi: number, velocity: number] | null;

interface BarPattern {
  chord: readonly number[];
  /** Syncopated Rhodes comping hits keyed by 8th-note step (0..7). */
  compSteps: readonly number[];
  /** Plucked upright bass notes keyed by 8th-note step (0..7). */
  bass: readonly (number | null)[];
  /** Cheerful marimba/vibraphone lead melody keyed by 8th-note step (0..7). */
  melody: readonly MelodyHit[];
}

const NYC_JAZZ_BOSSA_PROGRESSION: readonly BarPattern[] = [
  // --- A Section: Cmaj9 -> Am9 -> Dm9 -> G13 ---
  {
    // Bar 0: Cmaj9 (E3 G3 B3 D4)
    chord: [52, 55, 59, 62],
    compSteps: [0, 3, 6],
    bass: [36, null, null, 43, 43, null, 40, null], // C2 .. G2 G2 . E2 .
    melody: [
      [76, 0.9], // E5
      null,
      [79, 0.8], // G5
      [76, 0.72], // E5
      null,
      [74, 0.85], // D5
      [72, 0.78], // C5
      null,
    ],
  },
  {
    // Bar 1: Am9 (E3 G3 B3 C4)
    chord: [52, 55, 59, 60],
    compSteps: [0, 2, 5],
    bass: [45, null, null, 40, 40, null, 43, null], // A2 .. E2 E2 . G2 .
    melody: [
      [71, 0.82], // B4
      null,
      [72, 0.88], // C5
      null,
      [76, 0.92], // E5
      null,
      [74, 0.72], // D5
      null,
    ],
  },
  {
    // Bar 2: Dm9 (F3 A3 C4 E4)
    chord: [53, 57, 60, 64],
    compSteps: [0, 3, 6],
    bass: [38, null, null, 45, 45, null, 41, null], // D2 .. A2 A2 . F2 .
    melody: [
      [77, 0.9], // F5
      null,
      [76, 0.8], // E5
      [74, 0.76], // D5
      null,
      [72, 0.84], // C5
      [69, 0.78], // A4
      null,
    ],
  },
  {
    // Bar 3: G13 (F3 A3 B3 E4)
    chord: [53, 57, 59, 64],
    compSteps: [0, 2, 5],
    bass: [43, null, null, 38, 38, null, 40, null], // G2 .. D2 D2 . E2 .
    melody: [
      [74, 0.86], // D5
      null,
      [76, 0.9], // E5
      null,
      [74, 0.78], // D5
      [71, 0.74], // B4
      null,
      [72, 0.68], // C5 pickup
    ],
  },
  // --- B Section: Fmaj9 -> Em7 -> Dm9 -> G7 ---
  {
    // Bar 4: Fmaj9 (E3 A3 C4 G4)
    chord: [52, 57, 60, 67],
    compSteps: [0, 3, 6],
    bass: [41, null, null, 48, 48, null, 45, null], // F2 .. C3 C3 . A2 .
    melody: [
      [79, 0.94], // G5
      null,
      [76, 0.82], // E5
      [79, 0.86], // G5
      null,
      [81, 0.92], // A5
      [79, 0.78], // G5
      null,
    ],
  },
  {
    // Bar 5: Em7 (G3 B3 D4 G4)
    chord: [55, 59, 62, 67],
    compSteps: [0, 2, 5],
    bass: [40, null, null, 47, 47, null, 43, null], // E2 .. B2 B2 . G2 .
    melody: [
      [76, 0.88], // E5
      null,
      [74, 0.76], // D5
      null,
      [71, 0.84], // B4
      null,
      [74, 0.78], // D5
      null,
    ],
  },
  {
    // Bar 6: Dm9 (F3 A3 C4 E4)
    chord: [53, 57, 60, 64],
    compSteps: [0, 3, 6],
    bass: [38, null, null, 45, 45, null, 41, null], // D2 .. A2 A2 . F2 .
    melody: [
      [76, 0.88], // E5
      null,
      [74, 0.82], // D5
      [72, 0.78], // C5
      null,
      [74, 0.86], // D5
      [76, 0.8], // E5
      null,
    ],
  },
  {
    // Bar 7: G7 turnaround (F3 G3 B3 D4)
    chord: [53, 55, 59, 62],
    compSteps: [0, 2, 5],
    bass: [43, null, null, 38, 43, null, 41, null], // G2 .. D2 G2 . F2 .
    melody: [
      [74, 0.86], // D5
      null,
      [71, 0.8], // B4
      null,
      [67, 0.78], // G4
      null,
      [74, 0.72], // D5 turnaround
      null,
    ],
  },
];

const MUSIC_BPM = 106;
const EIGHTH_SEC = 60 / MUSIC_BPM / 2;
const SWING_OFFSET_SEC = 0.022; // subtle ~54% jazz-bossa swing on offbeats
const LOOKAHEAD_MS = 100;
const SCHEDULE_AHEAD_SEC = 0.26;
const MUSIC_BUS_GAIN = 0.085;
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
  private currentStep = 0; // 0..63 (8 bars * 8 eighth-notes)
  private lastStepMs = 0;

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
      const rootFreq = pentatonic[idx];
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
      // Cheerful ascending bubbly pour arpeggio: C5 -> E5 -> G5 -> C6
      const notes = [523.25, 659.25, 783.99, 1046.5];
      notes.forEach((freq, i) => {
        const t = now + i * 0.055;
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
        endFreq: 2200,
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
      // Subtle crisp UI tap
      this.playTone(ctx, this.sfxGain, {
        type: 'triangle',
        freq: 700,
        endFreq: 500,
        start: now,
        attack: 0.004,
        duration: 0.038,
        gain: 0.26,
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
      // Warm 3-note success chord (C5 -> E5 -> G5)
      const chord = [523.25, 659.25, 783.99];
      chord.forEach((freq, idx) => {
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
      // Soft descending 2-note thud: E3 -> C3
      this.playTone(ctx, this.sfxGain, {
        type: 'triangle',
        freq: 164.81,
        endFreq: 150,
        start: now,
        attack: 0.008,
        duration: 0.11,
        gain: 0.38,
      });
      this.playTone(ctx, this.sfxGain, {
        type: 'triangle',
        freq: 130.81,
        endFreq: 112,
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
    musicGain.gain.value = MUSIC_BUS_GAIN;

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
    this.musicGain.gain.cancelScheduledValues(now);
    this.musicGain.gain.setTargetAtTime(MUSIC_BUS_GAIN, now, 0.08);

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

    if (this.ctx && this.musicGain) {
      const now = this.ctx.currentTime;
      this.musicGain.gain.cancelScheduledValues(now);
      this.musicGain.gain.setTargetAtTime(0.0001, now, 0.05);
    }
  }

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
        // Apply subtle jazz-bossa swing to offbeat 8th notes
        const isOffbeat = this.currentStep % 2 === 1;
        const swungTime = this.nextStepTime + (isOffbeat ? SWING_OFFSET_SEC : 0);

        this.scheduleMusicStep(
          ctx,
          this.musicFilter,
          this.musicGain,
          this.currentStep,
          swungTime
        );
        this.nextStepTime += EIGHTH_SEC;
        this.currentStep =
          (this.currentStep + 1) % (NYC_JAZZ_BOSSA_PROGRESSION.length * 8);
      }
    } catch {
      // Ignore transient scheduling issues.
    }
  }

  private scheduleMusicStep(
    ctx: AudioContext,
    warmDest: AudioNode,
    directDest: AudioNode,
    step: number,
    time: number
  ): void {
    const barIndex = Math.floor(step / 8);
    const beatStep = step % 8; // 0..7 (eighth notes)
    const bar = NYC_JAZZ_BOSSA_PROGRESSION[barIndex];

    // 1. Warm Rhodes electric piano chord stabs (dual detuned sine/triangle through low-pass filter)
    if (bar.compSteps.includes(beatStep)) {
      const isDownbeat = beatStep === 0;
      const chordDur = isDownbeat ? EIGHTH_SEC * 2.5 : EIGHTH_SEC * 1.6;
      const velocity = isDownbeat ? 0.28 : 0.21;

      bar.chord.forEach((midi, idx) => {
        const freq = midiToFreq(midi);
        const strum = idx * 0.009; // gentle electric-piano roll
        this.playRhodesNote(ctx, warmDest, freq, time + strum, chordDur, velocity);
      });
    }

    // 2. Soft plucked upright bass
    const bassMidi = bar.bass[beatStep];
    if (bassMidi !== null) {
      const isRoot = beatStep === 0;
      this.playUprightBass(
        ctx,
        warmDest,
        midiToFreq(bassMidi),
        time,
        isRoot ? EIGHTH_SEC * 2.1 : EIGHTH_SEC * 1.25,
        isRoot ? 0.5 : 0.4
      );
    }

    // 3. Subtle brushed hi-hat / shaker (soft high-pass filtered noise bursts)
    const shakerAccents = [0.11, 0.055, 0.08, 0.06, 0.1, 0.055, 0.085, 0.06];
    this.playBrushedShaker(ctx, directDest, time, shakerAccents[beatStep]);

    // 4. Cheerful, bouncy marimba / vibraphone lead melody
    const melodyHit = bar.melody[beatStep];
    if (melodyHit !== null) {
      const [melodyMidi, vel] = melodyHit;
      this.playMarimbaNote(
        ctx,
        directDest,
        midiToFreq(melodyMidi),
        time,
        EIGHTH_SEC * 1.65,
        0.25 * vel
      );
    }
  }

  private playRhodesNote(
    ctx: AudioContext,
    dest: AudioNode,
    freq: number,
    start: number,
    duration: number,
    gain: number
  ): void {
    // Dual subtly detuned warm sine + soft triangle body
    this.playTone(ctx, dest, {
      type: 'sine',
      freq: freq * 0.9985,
      start,
      attack: 0.012,
      duration,
      gain: gain * 0.72,
    });
    this.playTone(ctx, dest, {
      type: 'triangle',
      freq: freq * 1.0015,
      start,
      attack: 0.014,
      duration: duration * 0.85,
      gain: gain * 0.32,
    });
    // Gentle Rhodes tine bell overtone (2x frequency, quick decay)
    this.playTone(ctx, dest, {
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
    gain: number
  ): void {
    // Woody triangle fundamental with quick finger-pluck envelope
    this.playTone(ctx, dest, {
      type: 'triangle',
      freq,
      start,
      attack: 0.008,
      duration,
      gain,
    });
    // Soft warm sine reinforcement
    this.playTone(ctx, dest, {
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
    gain: number
  ): void {
    // Warm resonant sine bar tone
    this.playTone(ctx, dest, {
      type: 'sine',
      freq,
      start,
      attack: 0.006,
      duration,
      gain,
    });
    // Crisp wooden mallet 4th-harmonic transient
    this.playTone(ctx, dest, {
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

export function playHonkKo(): void {
  soundEngine.playHonkKo();
}

export function playPerfect(): void {
  soundEngine.playPerfect();
}

export function playStep(): void {
  soundEngine.playStep();
}
