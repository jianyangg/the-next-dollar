/**
 * Pure (WebGL-free) helpers for the HD-2D post-processing pipeline.
 *
 * Everything here is deterministic and side-effect free so it can be unit
 * tested in Vitest, which has no WebGL. The impure part (the actual
 * EffectComposer) lives in postfx.ts.
 */

/** 'high' = full chain + SMAA, 'low' = cheaper chain for phones, 'off' = plain renderer. */
export type FxQuality = 'high' | 'low' | 'off';

const VALID_QUALITIES: readonly FxQuality[] = ['high', 'low', 'off'];

/**
 * Parse the raw value of the `?fx=` URL parameter.
 *
 * Strict on purpose: only the exact strings 'high' | 'low' | 'off' are
 * accepted. Anything else (including wrong case or empty string) returns
 * null so the caller can tell "no/invalid value" apart from a real choice.
 * `null` input means the parameter was absent (URLSearchParams.get contract).
 */
export function parseFxParam(raw: string | null): FxQuality | null {
  if (raw === null) return null;
  return (VALID_QUALITIES as readonly string[]).includes(raw) ? (raw as FxQuality) : null;
}

export interface PickQualityInput {
  /** Already-parsed, valid `?fx=` value, or null when the user did not ask. */
  param: FxQuality | null;
  devicePixelRatio: number;
  /** True for touch-first devices (phones/tablets): `(pointer: coarse)`. */
  isCoarsePointer: boolean;
  /** GL MAX_TEXTURE_SIZE if known. Very small limits imply a weak GPU. */
  maxTextureSize?: number;
}

/** GPUs that can't make a 4096px texture are old/weak mobile parts. */
const MIN_TEXTURE_SIZE_FOR_HIGH = 4096;
/** Above this DPR the device is pixel-heavy (the canvas itself is capped at 2x by the scene). */
const MAX_DPR_FOR_HIGH = 2;

/**
 * Choose a quality tier. An explicit valid param always wins; otherwise
 * weak-device heuristics downgrade 'high' to 'low'. We never auto-select
 * 'off': turning effects fully off is a debugging/accessibility choice.
 */
export function pickQuality(input: PickQualityInput): FxQuality {
  if (input.param !== null) return input.param;
  if (input.isCoarsePointer) return 'low';
  if (input.devicePixelRatio > MAX_DPR_FOR_HIGH) return 'low';
  if (input.maxTextureSize !== undefined && input.maxTextureSize < MIN_TEXTURE_SIZE_FOR_HIGH) return 'low';
  return 'high';
}

export interface FxEnvironment {
  devicePixelRatio: number;
  isCoarsePointer: boolean;
  maxTextureSize?: number;
}

/**
 * Combine URL + environment into a final quality. Throws on a present-but-
 * invalid `?fx=` value (project rule: never silently substitute a default
 * for something the user explicitly typed).
 *
 * @param search e.g. `window.location.search` ("?fx=low&x=1")
 */
export function resolveFxQuality(search: string, env: FxEnvironment): FxQuality {
  const raw = new URLSearchParams(search).get('fx');
  const param = parseFxParam(raw);
  if (raw !== null && param === null) {
    throw new Error(`Invalid ?fx= value "${raw}". Expected one of: ${VALID_QUALITIES.join(', ')}.`);
  }
  return pickQuality({ param, ...env });
}

/**
 * Convert a normalized screen Y (0 = top edge, 1 = bottom edge, the way DOM
 * coordinates work) into the tilt-shift `offset`. The effect's coordinate
 * space runs from -1 (bottom) to +1 (top), so we flip and rescale.
 */
export function screenYToTiltOffset(normalizedY: number): number {
  const clamped = Math.min(1, Math.max(0, normalizedY));
  return 1 - 2 * clamped;
}

/**
 * Frame-rate-independent exponential smoothing. Moves `current` toward
 * `target` so that the remaining gap shrinks by half every `halfLifeSeconds`
 * regardless of how long each frame took. (A naive `current += (t-c)*0.1`
 * would converge faster on 144Hz screens than on 60Hz ones.)
 */
export function smoothToward(current: number, target: number, dtSeconds: number, halfLifeSeconds: number): number {
  if (dtSeconds <= 0) return current;
  if (halfLifeSeconds <= 0) return target;
  const keep = Math.pow(0.5, dtSeconds / halfLifeSeconds);
  return target + (current - target) * keep;
}
