/**
 * HD-2D post-processing chain (tilt-shift, bloom on lights, vignette, SMAA).
 *
 * Why a separate class: CentralParkScene is already a very large file. All
 * knowledge about the `postprocessing` library stays here, so the scene only
 * needs four calls: render(), setSize(), setFocusScreenY(), setNightAmount().
 *
 * Pipeline (quality 'high'):
 *   RenderPass                      scene -> HDR half-float buffer (no tone mapping)
 *   EffectPass[ TiltShift, Bloom, Vignette, ToneMapping(ACES) ]
 *   EffectPass[ SMAA ]              anti-aliasing on the final, tone-mapped image
 *
 * Why tone mapping lives INSIDE the chain: three.js normally tone-maps while
 * drawing each material, which squashes everything into 0..1 before bloom can
 * see it. By drawing the scene with NoToneMapping into a float buffer, a lamp
 * whose colour is 3.0 stays 3.0 until bloom has looked at it. Tone mapping
 * then runs last, so the glow is compressed gracefully instead of clipping.
 *
 * Quality 'off' bypasses the composer entirely and calls renderer.render()
 * exactly like the game did before this module existed.
 */
import * as THREE from 'three';
import {
  BloomEffect,
  EffectComposer,
  EffectPass,
  KernelSize,
  RenderPass,
  SMAAEffect,
  TiltShiftEffect,
  ToneMappingEffect,
  ToneMappingMode,
  VignetteEffect,
} from 'postprocessing';
import { type FxQuality, screenYToTiltOffset, smoothToward } from './postfxQuality';

/* ------------------------------------------------------------------ *
 * Tunable constants. Kept together and named so art tweaks are one-line.
 * ------------------------------------------------------------------ */

/**
 * Tilt-shift geometry, in the effect's own units where the whole screen height
 * spans -1 (bottom) .. +1 (top).
 *  - Fully sharp band: |y - offset| < FOCUS_AREA - FEATHER = 0.6, i.e. 60% of
 *    the screen height centred on the player (it was 45%). Pixel art stays 1:1 crisp
 *    there because the effect outputs the untouched original inside this band, so the
 *    stands and the pedestrians walking within a few units of the player no longer
 *    sit on the soft edge of the blur.
 *  - Blur ramps up between 0.6 and FOCUS_AREA (1.0) away from the player, so it
 *    reaches full (still mild) strength only at the very top and bottom edges.
 */
const TILT_FOCUS_AREA = 1.0;
const TILT_FEATHER = 0.4;
/** Camera looks straight on, so the focus band is horizontal: no rotation. */
const TILT_ROTATION = 0;
/** Kawase blur kernel: SMALL keeps the miniature look subtle, not foggy. */
const TILT_KERNEL_HIGH = KernelSize.SMALL;
const TILT_KERNEL_LOW = KernelSize.VERY_SMALL;
/** Blur is computed at half resolution; it's blurry anyway, so this is free quality-wise. */
const TILT_RESOLUTION_SCALE = 0.5;
/** Focus follows the player with a soft lag so the band never jitters. */
const FOCUS_HALF_LIFE_SECONDS = 0.18;

/**
 * Bloom. Luminance is measured in linear HDR space (before tone mapping).
 * Ordinary lit surfaces and unlit colours top out below ~0.9, so a 0.95
 * threshold with 0.1 smoothing means ONLY materials deliberately pushed above
 * 1.0 (see CentralParkScene.registerGlow) produce glow.
 */
const BLOOM_THRESHOLD = 0.95;
const BLOOM_SMOOTHING = 0.1;
const BLOOM_RADIUS = 0.72;
const BLOOM_LEVELS_HIGH = 7;
const BLOOM_LEVELS_LOW = 5;
/** Low quality computes the bright-pass at half resolution. */
const BLOOM_RESOLUTION_SCALE_LOW = 0.5;
const BLOOM_INTENSITY_DAY = 0.3;
const BLOOM_INTENSITY_NIGHT = 1.0;

/**
 * Vignette: gentle at noon, a bit heavier at dusk to pull the eye to the lit area.
 * Both darkness values are about a third lower than the first version (0.42 / 0.62) so
 * the corners match the bright UI instead of looking dirty.
 */
const VIGNETTE_OFFSET = 0.32;
const VIGNETTE_DARKNESS_DAY = 0.28;
const VIGNETTE_DARKNESS_NIGHT = 0.42;

export class PostFx {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.Camera;

  // Only defined when quality !== 'off'.
  private composer: EffectComposer | null = null;
  private tiltShift: TiltShiftEffect | null = null;
  private bloom: BloomEffect | null = null;
  private vignette: VignetteEffect | null = null;

  // Smoothed vs requested focus position (normalized, 0 = top of screen).
  private focusY = 0.5;
  private focusTargetY = 0.5;
  private focusInitialised = false;

  constructor(renderer: THREE.WebGLRenderer, scene: THREE.Scene, camera: THREE.Camera, quality: FxQuality) {
    this.renderer = renderer;
    this.scene = scene;
    this.camera = camera;
    if (quality === 'off') return;

    const high = quality === 'high';

    // HalfFloatType: 16-bit float channels so values > 1.0 survive until bloom.
    // multisampling 0: MSAA is unavailable on a canvas made with antialias:false
    // and would be redundant with SMAA.
    const composer = new EffectComposer(renderer, {
      frameBufferType: THREE.HalfFloatType,
      multisampling: 0,
    });
    composer.addPass(new RenderPass(scene, camera));

    this.tiltShift = new TiltShiftEffect({
      offset: 0,
      rotation: TILT_ROTATION,
      focusArea: TILT_FOCUS_AREA,
      feather: TILT_FEATHER,
      kernelSize: high ? TILT_KERNEL_HIGH : TILT_KERNEL_LOW,
      resolutionScale: TILT_RESOLUTION_SCALE,
    });

    this.bloom = new BloomEffect({
      mipmapBlur: true,
      luminanceThreshold: BLOOM_THRESHOLD,
      luminanceSmoothing: BLOOM_SMOOTHING,
      radius: BLOOM_RADIUS,
      levels: high ? BLOOM_LEVELS_HIGH : BLOOM_LEVELS_LOW,
      intensity: BLOOM_INTENSITY_DAY,
      ...(high ? {} : { resolutionScale: BLOOM_RESOLUTION_SCALE_LOW }),
    });

    this.vignette = new VignetteEffect({
      offset: VIGNETTE_OFFSET,
      darkness: VIGNETTE_DARKNESS_DAY,
    });

    // Matches the renderer's former ACESFilmicToneMapping. Exposure still comes
    // from renderer.toneMappingExposure, which three feeds to this shader.
    const toneMapping = new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC });

    composer.addPass(new EffectPass(camera, this.tiltShift, this.bloom, this.vignette, toneMapping));
    if (high) {
      composer.addPass(new EffectPass(camera, new SMAAEffect()));
    }
    this.composer = composer;
  }

  /** Draw one frame. `dt` is seconds since the previous frame. */
  render(dt: number): void {
    if (this.composer === null || this.tiltShift === null) {
      // 'off': identical to the pre-postprocessing game.
      this.renderer.render(this.scene, this.camera);
      return;
    }
    this.focusY = this.focusInitialised
      ? smoothToward(this.focusY, this.focusTargetY, dt, FOCUS_HALF_LIFE_SECONDS)
      : this.focusTargetY;
    this.focusInitialised = true;
    this.tiltShift.offset = screenYToTiltOffset(this.focusY);
    this.composer.render(dt);
  }

  /** Resize internal buffers. Sizes are CSS pixels; the renderer's pixel ratio is applied internally. */
  setSize(width: number, height: number): void {
    this.composer?.setSize(width, height);
  }

  /** Centre the sharp band on this normalized screen Y (0 = top edge, 1 = bottom edge). */
  setFocusScreenY(normalizedY: number): void {
    this.focusTargetY = Math.min(1, Math.max(0, normalizedY));
  }

  /** 0 = broad daylight, 1 = full dusk. Strengthens bloom and vignette. */
  setNightAmount(night: number): void {
    if (this.bloom === null || this.vignette === null) return;
    const n = Math.min(1, Math.max(0, night));
    this.bloom.intensity = BLOOM_INTENSITY_DAY + (BLOOM_INTENSITY_NIGHT - BLOOM_INTENSITY_DAY) * n;
    this.vignette.darkness = VIGNETTE_DARKNESS_DAY + (VIGNETTE_DARKNESS_NIGHT - VIGNETTE_DARKNESS_DAY) * n;
  }

  /** Free every GPU render target and shader owned by the chain. */
  dispose(): void {
    this.composer?.dispose();
    this.composer = null;
  }
}
