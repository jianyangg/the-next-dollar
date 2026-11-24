/**
 * Character art: every person in the game (founders, shopkeepers, the hired worker, the
 * manager, district passers-by), drawn from one fixed palette by one renderer.
 *
 * pixelArt.ts keeps the public API (createMascotSpriteTexture, createVendorSpriteTexture,
 * createDistrictPedestrianTexture, portraits, the knocked-out sprite) and delegates here.
 * This module has NO canvas or three.js dependency in its core: `characterPixels` returns
 * palette keys per pixel, so the rules (complete outline, palette only, control blue only on
 * staff) are unit-tested in plain Node. `paintCharacter` turns that into a canvas.
 *
 * HOW A SPRITE IS MADE
 * Body parts are painted into an index buffer as "part N, material M" (class Spr). Only after
 * the whole figure is assembled is each pixel's colour decided, in four passes (render()):
 *   a. form shading    - per part: top edge light, right and bottom edge shadow.
 *   b. selective lines - where a part overlaps an earlier one, the pixel underneath takes its
 *                        OWN shadow tone (bangs leave a skin-shadow line on the forehead, an
 *                        arm a shirt-shadow line on the torso). No dark outline inside.
 *   c. outer outline   - every empty pixel touching the figure becomes #2b2118. Because it is
 *                        computed, the silhouette outline can never have a gap.
 *   d. rim + lift      - the LEFT silhouette edge takes the light tone (warm rim from the
 *                        top-left sun); materials as dark as the asphalt take it on every edge.
 * Painting first and colouring last is what lets a left-facing sprite be the mirror of the
 * right-facing one and still be lit from the left: mirror the buffer, THEN shade.
 */
import type { DistrictPedestrianKind, FounderSpecies, VendorKind } from './pixelArt';

// ============================================================================
// 1. PALETTE
// Each material is a three-tone ramp: _0 shadow, _1 base, _2 light. The ramps are
// hue-shifted: shadows lean cooler / toward purple-red, lights lean warmer / toward
// yellow, matching the scene's warm sun (#ffe2ae) and cool fill light (#9dc8ff).
// ============================================================================
export const CHARACTER_PALETTE = {
  out: '#2b2118', // outline + eyes (tokens.css --outline)
  white: '#fff8ec', // eye glint, cloth highlight
  blush: '#f2939a', // blush on lighter skin
  sk1_0: '#d99a86', sk1_1: '#f7cfae', sk1_2: '#fff0d8',
  sk2_0: '#bf7f6a', sk2_1: '#e8b088', sk2_2: '#f8d2a6',
  sk3_0: '#8f5548', sk3_1: '#c4875c', sk3_2: '#e2ad7a',
  sk4_0: '#5a3238', sk4_1: '#8a5438', sk4_2: '#b07a50',
  ko_0: '#9fc2b8', ko_1: '#c4ded6', ko_2: '#ddf2ec', // dizzy knocked-out skin
  hair_0: '#1d1826', hair_1: '#3a2a33', hair_2: '#7d5c5a', // near-black hair
  ink_0: '#272839', ink_1: '#3f4459', ink_2: '#626b88', // suits, dark trousers, caps
  brown_0: '#4a2b33', brown_1: '#744532', brown_2: '#a86a44',
  orange_0: '#9a3d32', orange_1: '#d26a32', orange_2: '#f4a052',
  tan_0: '#a8764c', tan_1: '#d6aa66', tan_2: '#f4d898',
  grey_0: '#6f6a82', grey_1: '#a6a2b0', grey_2: '#dedad6',
  cream_0: '#c2b4c2', cream_1: '#ece2d2', // its light tone is `white`
  // Founder ramps: the _1 base is the EXACT FOUNDER_CATALOG accent.
  lemon_0: '#c77a26', lemon_1: '#f0b429', lemon_2: '#ffe680', // Alex
  coral_0: '#b0434f', coral_1: '#eb6e5b', coral_2: '#ff9e80', // Maya
  green_0: '#2a7358', green_1: '#49b065', green_2: '#97d878', // Leo
  sky_0: '#2b5c9c', sky_1: '#3e88c9', sky_2: '#86c8de', // Sam
  navy_0: '#2e3566', navy_1: '#4a6499', navy_2: '#7d95c6', // Claire
  // Player staff only: control blue (tokens.css --accent, MARKER_BLUE in pixelArt.ts).
  ctrl_0: '#3a72b6', ctrl_1: '#5aa9e6', ctrl_2: '#a9d6f5',
  teal_0: '#1c4a55', teal_1: '#2e7f77', teal_2: '#5eb39c', // Dana only
  wine_0: '#561d3a', wine_1: '#8e2f45', wine_2: '#c45a5c', // also mouth and deep-skin blush
  rose_0: '#a8708c', rose_1: '#d896a6', rose_2: '#f6c6c4',
} as const;

export type PalKey = keyof typeof CHARACTER_PALETTE;
const PAL = CHARACTER_PALETTE;

type Mat =
  | 'sk1' | 'sk2' | 'sk3' | 'sk4' | 'ko' | 'hair' | 'ink' | 'brown' | 'orange' | 'tan' | 'grey' | 'cream'
  | 'lemon' | 'coral' | 'green' | 'sky' | 'navy' | 'ctrl' | 'teal' | 'wine' | 'rose';
type SkinMat = 'sk1' | 'sk2' | 'sk3' | 'sk4' | 'ko';

/** material -> [shadow, base, light] palette keys */
const RAMP: Record<Mat, readonly [PalKey, PalKey, PalKey]> = {
  sk1: ['sk1_0', 'sk1_1', 'sk1_2'], sk2: ['sk2_0', 'sk2_1', 'sk2_2'], sk3: ['sk3_0', 'sk3_1', 'sk3_2'],
  sk4: ['sk4_0', 'sk4_1', 'sk4_2'], ko: ['ko_0', 'ko_1', 'ko_2'], hair: ['hair_0', 'hair_1', 'hair_2'],
  ink: ['ink_0', 'ink_1', 'ink_2'], brown: ['brown_0', 'brown_1', 'brown_2'],
  orange: ['orange_0', 'orange_1', 'orange_2'], tan: ['tan_0', 'tan_1', 'tan_2'], grey: ['grey_0', 'grey_1', 'grey_2'],
  cream: ['cream_0', 'cream_1', 'white'], lemon: ['lemon_0', 'lemon_1', 'lemon_2'], coral: ['coral_0', 'coral_1', 'coral_2'],
  green: ['green_0', 'green_1', 'green_2'], sky: ['sky_0', 'sky_1', 'sky_2'], navy: ['navy_0', 'navy_1', 'navy_2'],
  ctrl: ['ctrl_0', 'ctrl_1', 'ctrl_2'], teal: ['teal_0', 'teal_1', 'teal_2'], wine: ['wine_0', 'wine_1', 'wine_2'],
  rose: ['rose_0', 'rose_1', 'rose_2'],
};
const MOUTH: PalKey = 'wine_1';
const BLUSH_OF: Record<SkinMat, PalKey> = { sk1: 'blush', sk2: 'blush', sk3: 'wine_2', sk4: 'wine_2', ko: 'ko_0' };

/** WCAG relative luminance of a #rrggbb colour. */
function luminance(hex: string): number {
  const v = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((ch) => (ch <= 0.03928 ? ch / 12.92 : ((ch + 0.055) / 1.055) ** 2.4));
  return 0.2126 * v[0] + 0.7152 * v[1] + 0.0722 * v[2];
}
/**
 * Materials whose base is about as dark as the asphalt (#393d46). The #2b2118 outline alone
 * vanishes there (contrast about 1.45:1), so these get a light ring on every outer edge.
 */
const DARK: ReadonlySet<Mat> = new Set(
  (Object.keys(RAMP) as Mat[]).filter((m) => luminance(PAL[RAMP[m][1]]) < 0.09)
);

// ============================================================================
// 2. THE PIXEL BUFFER
// ============================================================================
interface Part {
  mat: Mat;
  /** Draws a sel-out line (shadow tone) on the parts it overlaps. */
  line: boolean;
  /** 'auto' light top / shadow right+bottom; 'soft' shadow bottom only; 'flat' base only. */
  shade: 'auto' | 'soft' | 'flat';
  /** A far limb: one tone darker throughout. */
  back: boolean;
  rim: boolean;
}
interface PartOpts { line?: boolean; shade?: Part['shade']; back?: boolean; rim?: boolean }
type Span = readonly [number, number];

class Spr {
  readonly pt: Int16Array;
  readonly fx: (PalKey | null)[];
  readonly parts: (Part | null)[] = [null];
  cur = 0;
  /** Horizontal offset applied to all painting (passers-by sit on a 36-wide canvas). */
  ox = 0;
  /** Pixels painted off the canvas. Must stay 0: an off-canvas pixel means a clipped outline. */
  clipped = 0;
  constructor(readonly w: number, readonly h: number) {
    this.pt = new Int16Array(w * h);
    this.fx = new Array<PalKey | null>(w * h).fill(null);
  }
  part(mat: Mat, o: PartOpts = {}): this {
    this.parts.push({ mat, line: o.line !== false, shade: o.shade ?? 'auto', back: !!o.back, rim: o.rim !== false });
    this.cur = this.parts.length - 1;
    return this;
  }
  private idx(x: number, y: number): number {
    const xx = Math.round(x + this.ox);
    const yy = Math.round(y);
    if (xx < 0 || yy < 0 || xx >= this.w || yy >= this.h) {
      this.clipped++;
      return -1;
    }
    return yy * this.w + xx;
  }
  rect(x: number, y: number, w: number, h: number): this {
    for (let j = 0; j < h; j++)
      for (let i = 0; i < w; i++) {
        const k = this.idx(x + i, y + j);
        if (k >= 0) {
          this.pt[k] = this.cur;
          this.fx[k] = null;
        }
      }
    return this;
  }
  span(y: number, x0: number, x1: number): this {
    return x1 >= x0 ? this.rect(x0, y, x1 - x0 + 1, 1) : this;
  }
  /** One entry per row from y0: a single span, several spans, or null to skip the row. */
  rows(y0: number, list: ReadonlyArray<Span | readonly Span[] | null>): this {
    list.forEach((sp, j) => {
      if (!sp) return;
      const arr = (Array.isArray(sp[0]) ? sp : [sp]) as readonly Span[];
      for (const [a, b] of arr) this.span(y0 + j, a, b);
    });
    return this;
  }
  /** A fixed-colour detail. Keeps the part already there (so it adds no sel-out line). */
  dot(x: number, y: number, key: PalKey, w = 1, h = 1): this {
    for (let j = 0; j < h; j++)
      for (let i = 0; i < w; i++) {
        const k = this.idx(x + i, y + j);
        if (k < 0) continue;
        if (!this.pt[k]) this.pt[k] = this.cur;
        this.fx[k] = key;
      }
    return this;
  }
  /** Like dot, but only recolours pixels that are already filled (used for hair shine). */
  tint(x: number, y: number, key: PalKey, w = 1): this {
    for (let i = 0; i < w; i++) {
      const xx = Math.round(x + i + this.ox);
      const yy = Math.round(y);
      if (xx < 0 || yy < 0 || xx >= this.w || yy >= this.h) continue;
      const k = yy * this.w + xx;
      if (this.pt[k]) this.fx[k] = key;
    }
    return this;
  }
  mirror(): void {
    const { w, h } = this;
    for (let y = 0; y < h; y++)
      for (let x = 0; x < Math.floor(w / 2); x++) {
        const a = y * w + x;
        const b = y * w + (w - 1 - x);
        [this.pt[a], this.pt[b]] = [this.pt[b], this.pt[a]];
        [this.fx[a], this.fx[b]] = [this.fx[b], this.fx[a]];
      }
  }
}

/** A rendered sprite: one palette key (or null = transparent) per pixel, row-major. */
export interface CharacterPixels {
  w: number;
  h: number;
  keys: (PalKey | null)[];
  /** Pixels that were painted off-canvas (0 for every shipped sprite). */
  clipped: number;
}

function render(s: Spr): CharacterPixels {
  const { w, h, pt, fx, parts } = s;
  const N = w * h;
  const at = (x: number, y: number): number => (x < 0 || y < 0 || x >= w || y >= h ? 0 : pt[y * w + x]);
  const partOf = (p: number): Part => parts[p] as Part;
  const tone = new Int8Array(N).fill(1);
  // a. form shading
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const p = pt[i];
      if (!p || fx[i]) continue;
      const P = partOf(p);
      const top = at(x, y - 1) !== p;
      const bot = at(x, y + 1) !== p;
      const rgt = at(x + 1, y) !== p;
      let t = 1;
      if (P.shade === 'auto') t = rgt || bot ? 0 : top ? 2 : 1;
      else if (P.shade === 'soft') t = bot ? 0 : top ? 2 : 1;
      tone[i] = t;
    }
  // b. selective interior lines
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const p = pt[i];
      if (!p || fx[i]) continue;
      const P = partOf(p);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const q = at(x + dx, y + dy);
        if (!q || q <= p || !partOf(q).line) continue;
        // Same material stacked (sleeve over shirt): no line on the pixel BELOW the upper part,
        // so a shoulder does not draw a dark seam under itself.
        if (partOf(q).mat === P.mat && dy === -1) continue;
        tone[i] = 0;
        break;
      }
    }
  // c. outer outline ring (4-neighbour, so corners stay rounded)
  const ring = new Uint8Array(N);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (pt[i]) continue;
      if (at(x - 1, y) || at(x + 1, y) || at(x, y - 1) || at(x, y + 1)) ring[i] = 1;
    }
  // d. rim light on the left silhouette edge; light ring on dark materials
  const isRing = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < w && y < h && ring[y * w + x] === 1;
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const p = pt[i];
      if (!p || fx[i]) continue;
      const P = partOf(p);
      if (DARK.has(P.mat)) {
        if (isRing(x - 1, y) || isRing(x + 1, y) || isRing(x, y - 1) || isRing(x, y + 1)) tone[i] = 2;
      } else if (P.rim && isRing(x - 1, y)) tone[i] = 2;
      if (P.back) tone[i] = Math.max(0, tone[i] - 1);
    }
  const keys: (PalKey | null)[] = new Array<PalKey | null>(N).fill(null);
  for (let i = 0; i < N; i++) {
    if (ring[i]) keys[i] = 'out';
    else if (pt[i]) keys[i] = fx[i] ?? RAMP[partOf(pt[i]).mat][tone[i]];
  }
  return { w, h, keys, clipped: s.clipped };
}

// ============================================================================
// 3. THE FIGURE
// Layout on the 32x40 canvas (interior pixels; the outline is added around them):
//   hair top ~ row 4, head rows H..H+12 (H = 8), 16 wide (x 8..23)
//   torso rows 21..27, pants 28..30, legs 31..33, shoes 34..36
//   => the outline's bottom edge is row 37, the same baseline the scene was tuned with.
// ============================================================================
export type Facing = 'down' | 'up' | 'left' | 'right';
export type Mood = 'warm' | 'happy' | 'neutral' | 'angry';
type View = 'front' | 'back' | 'side';

const HEAD_ROWS: Span[] = [[10, 21], [9, 22], [8, 23], [8, 23], [8, 23], [8, 23], [8, 23], [8, 23], [8, 23], [8, 23], [8, 23], [9, 22], [10, 21]];
const TORSO_FRONT = { slim: [11, 20], std: [10, 21], wide: [9, 22] } as const;
const TORSO_SIDE = { slim: [12, 18], std: [12, 19], wide: [11, 20] } as const;

type HairRow = readonly [number, ...Span[]];
interface HairStyle {
  front?: readonly HairRow[];
  side?: readonly HairRow[];
  back?: readonly HairRow[];
  frontShine?: readonly (readonly [number, number, number])[];
  sideShine?: readonly (readonly [number, number, number])[];
  backShine?: readonly (readonly [number, number, number])[];
  frontGlint?: readonly [number, number];
  sideGlint?: readonly [number, number];
}

/** A hand-held prop. `side` is the screen side of the hand in the FRONT view. */
interface Carry {
  side: 'L' | 'R';
  /** (hx, hy) = top-left of the 3x2 hand; `out` = -1 extend left, +1 extend right, 0 centred (profile). */
  draw(c: Ctx, hx: number, hy: number, out: -1 | 0 | 1): void;
  /** Also shown in profile (in the near hand). Only one carry per spec should set this. */
  inProfile?: boolean;
}

interface Spec {
  id: string;
  ped?: boolean;
  ox?: number;
  skin: SkinMat;
  hairMat: Mat;
  hair: HairStyle;
  top: Mat;
  sleeve: number;
  sleeveMat?: Mat;
  legs: { kind: 'pants' | 'shorts' | 'skirt'; mat: Mat };
  shoe: Mat;
  build?: 'slim' | 'std' | 'wide';
  height?: 'tall' | 'std' | 'short';
  lashes?: boolean;
  idleKnee?: boolean;
  founder?: boolean;
  behind?(c: Ctx): void;
  behindHead?(c: Ctx): void;
  outfit?(c: Ctx): void;
  headwear?(c: Ctx): void;
  /** Draws the mouth area itself (mustache / beard). */
  beard?(c: Ctx): void;
  /** Custom arms; return true to skip the default arms. */
  arms?(c: Ctx): boolean;
  front?(c: Ctx): void;
  carry?: readonly Carry[];
}

interface Ctx {
  s: Spr;
  spec: Spec;
  view: View;
  front: boolean;
  back: boolean;
  side: boolean;
  walk: boolean;
  pose: 'idle' | 'walk1' | 'walk2';
  mood: Mood;
  blink: boolean;
  ko: boolean;
  portrait: boolean;
  accessory: Accessory;
  H: number;
  by: number;
  hip: number;
  swing: number;
  skin: SkinMat;
  T: readonly [number, number];
  arm(x: number, y: number, len?: number, o?: ArmOpts): void;
}
interface ArmOpts { sleeve?: number; mat?: Mat; back?: boolean; shoulder?: 'L' | 'R' }

export type Accessory = 'apron' | 'vest' | 'none';

export interface CharacterFrame {
  /** 0 standing, 1 and 2 the two walk frames (same meaning as the scene's stepPhase). */
  stepPhase?: 0 | 1 | 2;
  facing?: Facing;
  /** Upper body 1px lower: the exhale half of the idle breathing loop. */
  breathe?: boolean;
  blink?: boolean;
  accessory?: Accessory;
  mood?: Mood;
}

interface BuildOpts extends CharacterFrame {
  ko?: boolean;
  portrait?: boolean;
}

function buildFigure(spec: Spec, o: BuildOpts): Spr {
  const W = spec.ped ? 36 : 32;
  const s = new Spr(W, 40);
  s.ox = spec.ox ?? (spec.ped ? 2 : 0);
  const facing = o.facing ?? 'down';
  const view: View = facing === 'up' ? 'back' : facing === 'down' ? 'front' : 'side';
  const step = o.ko || o.portrait ? 0 : o.stepPhase ?? 0;
  const pose = step === 1 ? 'walk1' : step === 2 ? 'walk2' : 'idle';
  const walk = pose !== 'idle';
  const bob = (o.breathe ? 1 : 0) + (walk ? -1 : 0) + (o.ko ? 2 : 0);
  const hgt = { tall: -1, std: 0, short: 2 }[spec.height ?? 'std'];
  const build = spec.build ?? 'std';
  const c: Ctx = {
    s, spec, view, front: view === 'front', back: view === 'back', side: view === 'side',
    walk, pose, mood: o.mood ?? 'warm', blink: !!o.blink, ko: !!o.ko, portrait: !!o.portrait,
    accessory: o.accessory ?? 'none',
    H: 8 + hgt + bob,
    by: 21 + hgt + bob,
    hip: 28 + bob - (o.ko ? 1 : 0),
    swing: pose === 'walk1' ? 1 : pose === 'walk2' ? -1 : 0,
    skin: o.ko ? 'ko' : spec.skin,
    T: view === 'side' ? TORSO_SIDE[build] : TORSO_FRONT[build],
    arm: (x, y, len = 6, ao = {}) => armV(c, x, y, len, ao),
  };
  const props = !c.portrait && !c.ko;

  if (props && spec.behind) spec.behind(c);
  if (c.side && walk) {
    // The far arm peeks out behind the torso, swinging opposite the near arm.
    const fx = c.swing > 0 ? c.T[1] - 1 : c.T[0] - 2;
    c.arm(fx, c.by + 2, 5, { back: true });
  }
  legs(c);
  torso(c);
  if (spec.outfit) spec.outfit(c);
  accessoryLayer(c);
  head(c);
  // Arms come after the head so a raised arm (a crate on the shoulder) sits in front of it.
  if (c.ko) koArms(c);
  else if (!(props && spec.arms && spec.arms(c))) defaultArms(c);
  if (props) carries(c);
  if (spec.front) spec.front(c);
  if (c.ko) {
    // Dizzy stars beside the head (absolute canvas positions, so ignore the ped offset).
    const ox = s.ox;
    s.ox = 0;
    for (const [x, y] of [[3, 7], [W - 6, 5]] as const) {
      s.part('lemon', { shade: 'flat' }).rect(x + 1, y, 1, 3).rect(x, y + 1, 3, 1);
      s.dot(x + 1, y + 1, 'lemon_2');
    }
    s.ox = ox;
  }
  if (facing === 'left') s.mirror();
  return s;
}

function armV(c: Ctx, x: number, y: number, len: number, o: ArmOpts): void {
  const { s, spec } = c;
  const sl = Math.min(o.sleeve ?? spec.sleeve, len);
  const mat = o.mat ?? spec.sleeveMat ?? spec.top;
  if (sl > 0) {
    s.part(mat, { back: o.back }).rect(x, y, 3, sl);
    if (o.shoulder === 'L') s.rect(x, y - 1, 2, 1);
    if (o.shoulder === 'R') s.rect(x + 1, y - 1, 2, 1);
  }
  if (len - sl > 0) s.part(c.skin, { back: o.back }).rect(x, y + sl, 3, len - sl);
  if (sl === 0 && o.shoulder) s.part(c.skin, { back: o.back }).rect(o.shoulder === 'L' ? x : x + 1, y - 1, 2, 1);
}

/** Top-left of the near hand in profile. */
const profileHandX = (c: Ctx): number => 14 - c.swing;

function defaultArms(c: Ctx): void {
  const [tl, tr] = c.T;
  if (c.side) {
    const { s, spec } = c;
    const sl = Math.max(spec.sleeve, 0);
    const fx = profileHandX(c);
    // Upper arm fixed at the shoulder (3 rows), forearm swings with the stride (3 rows).
    s.part(sl > 0 ? spec.sleeveMat ?? spec.top : c.skin).rect(14, c.by + 1, 3, Math.min(3, Math.max(sl, 3)));
    if (sl > 0 && sl < 3) s.part(c.skin).rect(14, c.by + 1 + sl, 3, 3 - sl);
    if (sl > 3) s.part(spec.sleeveMat ?? spec.top).rect(fx, c.by + 4, 3, Math.min(sl - 3, 3));
    const skinRows = 3 - Math.max(0, Math.min(sl - 3, 3));
    if (skinRows > 0) s.part(c.skin).rect(fx, c.by + 7 - skinRows, 3, skinRows);
    return;
  }
  c.arm(tl - 3, c.by + 1 + c.swing, 6, { shoulder: 'R' });
  c.arm(tr + 1, c.by + 1 - c.swing, 6, { shoulder: 'L' });
}

function koArms(c: Ctx): void {
  // Knocked out: arms flung out sideways.
  const { s, spec } = c;
  const [tl, tr] = c.T;
  s.part(spec.sleeveMat ?? spec.top).rect(tl - 3, c.by + 2, 3, 3).rect(tr + 1, c.by + 2, 3, 3);
  s.part(c.skin).rect(tl - 5, c.by + 2, 2, 3).rect(tr + 4, c.by + 2, 2, 3);
}

function carries(c: Ctx): void {
  const list = c.spec.carry ?? [];
  if (c.side) {
    const k = list.find((p) => p.inProfile);
    if (k) {
      k.draw(c, profileHandX(c), c.by + 5, 0);
      handDot(c, profileHandX(c), c.by + 5, 3, 2);
    }
    return;
  }
  const [tl, tr] = c.T;
  for (const k of list) {
    // In the back view the same hand is on the other side of the screen.
    const screen = c.back ? (k.side === 'L' ? 'R' : 'L') : k.side;
    const hx = screen === 'L' ? tl - 3 : tr + 1;
    const hy = c.by + 5 + (screen === 'L' ? c.swing : -c.swing);
    k.draw(c, hx, hy, screen === 'L' ? -1 : 1);
    handDot(c, hx, hy, 3, 2);
  }
}

function legs(c: Ctx): void {
  const { s, spec } = c;
  const L = spec.legs;
  const legMat: Mat = L.kind === 'pants' ? L.mat : c.skin;
  const top = c.hip + 3;
  if (c.ko) {
    // Splayed: feet pushed out to the sides.
    s.part(legMat).rect(10, top, 4, 34 - top).rect(18, top, 4, 34 - top);
    shoe(c, 7, 34, 'L');
    shoe(c, 20, 34, 'R');
    return;
  }
  if (c.side) {
    if (!c.walk) {
      s.part(legMat).rect(14, top, 4, 34 - top);
      shoeSide(c, 13, 34, false);
    } else {
      // Two-frame stride: walk1 near leg forward, walk2 near leg back.
      const nearFwd = c.pose === 'walk1';
      const farX = nearFwd ? 11 : 17;
      const nearX = nearFwd ? 17 : 11;
      s.part(legMat, { back: true }).rect(farX, top, 3, 34 - top);
      shoeSide(c, farX - 1, 34, true);
      s.part(legMat).rect(nearX, top, 3, 33 - top);
      shoeSide(c, nearX - 1, 33, false);
    }
    return;
  }
  // Front and back: the lifted foot steps toward / away from the camera.
  let lUp = c.pose === 'walk1' ? 2 : 0;
  const rUp = c.pose === 'walk2' ? 2 : 0;
  if (spec.idleKnee && c.pose === 'idle' && !c.portrait) lUp = 2; // the jogger jogs on the spot
  s.part(legMat).rect(11, top, 4, 34 - lUp - top);
  s.part(legMat).rect(17, top, 4, 34 - rUp - top);
  shoe(c, 10, 34 - lUp, 'L');
  shoe(c, 17, 34 - rUp, 'R');
}

function shoe(c: Ctx, x: number, y: number, sideLR: 'L' | 'R'): void {
  const { s, spec } = c;
  s.part(spec.shoe);
  if (sideLR === 'L') s.span(y, x + 1, x + 4);
  else s.span(y, x, x + 3);
  s.rect(x, y + 1, 5, 2);
}
function shoeSide(c: Ctx, x: number, y: number, back: boolean): void {
  const { s, spec } = c;
  s.part(spec.shoe, { back });
  s.span(y, x + 1, x + 4);
  s.rect(x, y + 1, 7, 2);
}

function torso(c: Ctx): void {
  const { s, spec } = c;
  const [tl, tr] = c.T;
  const L = spec.legs;
  const w = tr - tl + 1;
  s.part(spec.top).rect(tl, c.by, w, c.hip - c.by);
  s.part(L.mat);
  if (L.kind === 'skirt') {
    s.rows(c.hip, [[tl, tr], [tl - 1, tr + 1], [tl - 1, tr + 1]]);
  } else if (c.side) {
    s.rect(tl, c.hip, w, 3);
  } else {
    s.rect(tl, c.hip, w, 2);
    s.span(c.hip + 2, tl, 14);
    s.span(c.hip + 2, 17, tr);
  }
}

/** The player's lemon apron (accessory 'apron') or a control-blue staff vest ('vest'). */
function accessoryLayer(c: Ctx): void {
  const { s } = c;
  const [tl, tr] = c.T;
  if (c.accessory === 'apron') {
    if (c.front) {
      s.part('cream').rect(12, c.by, 8, 1);
      s.part('cream').rect(11, c.by + 1, 10, c.hip - c.by + 2);
      s.dot(11, c.by + 5, 'cream_0', 10, 1);
      // Lemon emblem: the founder's lemon-yellow hero detail.
      s.part('lemon', { shade: 'flat' }).rect(14, c.by + 2, 4, 2);
      s.dot(14, c.by + 2, 'lemon_2');
      s.dot(17, c.by + 1, 'green_1');
    } else if (c.back) {
      s.part('cream').rect(12, c.by, 8, 1);
      s.part('cream').rect(tl, c.by + 5, tr - tl + 1, 1);
      s.part('cream').rect(14, c.by + 4, 4, 3);
    } else {
      s.part('cream').rect(17, c.by + 1, 3, c.hip - c.by + 2);
      s.part('lemon', { shade: 'flat' }).rect(18, c.by + 2, 2, 2);
    }
  } else if (c.accessory === 'vest') {
    if (c.front) s.part('ctrl').rect(tl, c.by, 4, c.hip - c.by).rect(tr - 3, c.by, 4, c.hip - c.by);
    else if (c.back) s.part('ctrl').rect(tl, c.by, tr - tl + 1, c.hip - c.by);
    else s.part('ctrl').rect(tl, c.by, tr - tl - 1, c.hip - c.by);
  }
}

// ---------------------------------------------------------------------------
// Head, face and hair
// ---------------------------------------------------------------------------
function head(c: Ctx): void {
  const { s, spec, H } = c;
  if (spec.behindHead) spec.behindHead(c);
  s.part(c.skin).rows(H, HEAD_ROWS);
  if (c.side) s.rect(24, H + 7, 1, 1); // nose bump in profile
  if (!c.back) face(c);
  hairDraw(c);
  if (c.side) {
    // Ear, drawn over the hair edge.
    s.part(c.skin, { line: false }).rect(13, H + 5, 2, 3);
    s.dot(13, H + 6, RAMP[c.skin][0]);
  }
  if (spec.headwear) spec.headwear(c);
  if (c.mood === 'angry' && !c.back) {
    // Anger mark: a small cross at the temple, readable even at 1x.
    s.part('coral', { line: false, shade: 'flat' });
    for (const [dx, dy] of [[0, 0], [2, 0], [1, 1], [0, 2], [2, 2]]) s.dot(21 + dx, H - 1 + dy, 'coral_2');
  }
}

/** Eyes are 2x3 with a white glint top-left. Moods change eyes and mouth. */
function face(c: Ctx): void {
  const { s, spec, H } = c;
  const ey = H + 5;
  const blushKey = BLUSH_OF[c.skin];
  const mood = c.mood;
  const eyes = c.side ? [20] : [11, 19];
  for (const ex of eyes) {
    if (c.ko) {
      // X_X
      s.dot(ex - 1, ey, 'out').dot(ex + 1, ey, 'out').dot(ex, ey + 1, 'out').dot(ex - 1, ey + 2, 'out').dot(ex + 1, ey + 2, 'out');
    } else if (c.blink) {
      s.dot(ex, ey + 2, 'out', 2, 1);
      s.dot(ex < 16 ? ex - 1 : ex + 2, ey + 1, 'out');
    } else if (mood === 'happy') {
      s.dot(ex - 1, ey + 1, 'out').dot(ex, ey, 'out', 2, 1).dot(ex + 2, ey + 1, 'out');
    } else if (mood === 'angry') {
      s.dot(ex, ey + 1, 'out', 2, 2);
      if (ex < 16) s.dot(ex - 1, ey - 1, 'out', 2, 1).dot(ex + 1, ey, 'out');
      else s.dot(ex + 1, ey - 1, 'out', 2, 1).dot(ex, ey, 'out');
    } else {
      s.dot(ex, ey, 'out', 2, 3);
      s.dot(ex, ey, 'white');
      if (spec.lashes) s.dot(ex < 16 ? ex - 1 : ex + 2, ey, 'out');
    }
  }
  if (c.ko) {
    // Wobbly mouth with the tongue out.
    if (c.side) s.dot(20, H + 9, 'out', 3, 1).dot(21, H + 10, 'coral_1', 2, 1);
    else s.dot(13, H + 9, 'out', 6, 1).dot(16, H + 10, 'coral_1', 2, 2).dot(16, H + 10, 'coral_2');
    return;
  }
  if (c.side) {
    if (mood !== 'neutral') s.dot(18, H + 8, blushKey, 2, 1);
    s.dot(21, H + 9, MOUTH, 2, 1);
    return;
  }
  if (spec.beard) {
    spec.beard(c);
    return;
  }
  if (mood === 'happy') {
    s.dot(9, H + 8, blushKey, 2, 1).dot(21, H + 8, blushKey, 2, 1);
    s.dot(14, H + 8, MOUTH, 4, 1).dot(15, H + 9, blushKey, 2, 1);
  } else if (mood === 'neutral') {
    s.dot(15, H + 9, MOUTH, 2, 1);
  } else if (mood === 'angry') {
    s.dot(9, H + 8, 'wine_2', 2, 1).dot(21, H + 8, 'wine_2', 2, 1);
    s.dot(15, H + 9, MOUTH, 2, 1).dot(14, H + 10, MOUTH).dot(17, H + 10, MOUTH);
  } else {
    // warm resting smile
    s.dot(9, H + 8, blushKey, 2, 1).dot(21, H + 8, blushKey, 2, 1);
    s.dot(14, H + 8, MOUTH).dot(15, H + 9, MOUTH, 2, 1).dot(17, H + 8, MOUTH);
  }
}

// Hair styles are data: per view, a list of [rowOffsetFromH, span, span, ...].
// Views without a hand-made table are derived from the front table (deriveSide/deriveBack).
const rep = (a: number, b: number, ...spans: Span[]): HairRow[] => {
  const out: HairRow[] = [];
  for (let o = a; o <= b; o++) out.push([o, ...spans]);
  return out;
};
const CROWN: HairRow[] = [[-4, [11, 20]], [-3, [9, 22]], [-2, [8, 23]], ...rep(-1, 2, [7, 24])];
const CROWN_SIDE: HairRow[] = [[-4, [10, 20]], [-3, [8, 22]], [-2, [7, 23]], ...rep(-1, 2, [7, 24])];

function rowExtents(rows: readonly HairRow[]): Map<number, [number, number]> {
  const m = new Map<number, [number, number]>();
  for (const [off, ...spans] of rows)
    for (const [a, b] of spans) {
      const e = m.get(off);
      m.set(off, e ? [Math.min(e[0], a), Math.max(e[1], b)] : [a, b]);
    }
  return m;
}
/** Back of the head: the crown as seen from the front, then solid hair down to the nape. */
function deriveBack(front: readonly HairRow[]): HairRow[] {
  const m = rowExtents(front);
  const offs = [...m.keys()].sort((a, b) => a - b);
  const last = Math.max(9, offs[offs.length - 1]);
  let lo = 7;
  let hi = 24;
  for (const o of offs) if (o >= 3) { const e = m.get(o) as [number, number]; lo = Math.min(lo, e[0]); hi = Math.max(hi, e[1]); }
  const out: HairRow[] = [];
  for (let o = offs[0]; o <= last; o++) {
    const e = m.get(o);
    if (o <= 2) { if (e) out.push([o, e]); continue; }
    out.push(o === last ? [o, [lo + 2, hi - 2]] : [o, [lo, hi]]);
  }
  return out;
}
/** Profile: the crown, then hair over the back half of the head and a short fringe in front. */
function deriveSide(front: readonly HairRow[]): HairRow[] {
  const m = rowExtents(front);
  const offs = [...m.keys()].sort((a, b) => a - b);
  const last = Math.max(8, offs[offs.length - 1]);
  const out: HairRow[] = [];
  for (let o = offs[0]; o <= last; o++) {
    const e = m.get(o);
    const lo = e ? Math.min(e[0], 7) : 7;
    if (o <= 2) { if (e) out.push([o, [e[0], Math.min(e[1], 24)]]); continue; }
    if (o === 3) out.push([o, [lo, 13], [18, 24]]);
    else if (o === last) out.push([o, [lo + 1, 11]]);
    else out.push([o, [lo, 12]]);
  }
  return out;
}

function hairDraw(c: Ctx): void {
  const { s, spec } = c;
  const hs = spec.hair;
  let rows: readonly HairRow[] | undefined;
  let shine: readonly (readonly [number, number, number])[] = [];
  let glint: readonly [number, number] | undefined;
  if (c.front || c.portrait) {
    rows = hs.front; shine = hs.frontShine ?? []; glint = hs.frontGlint;
  } else if (c.side) {
    rows = hs.side ?? (hs.front ? deriveSide(hs.front) : undefined);
    shine = hs.sideShine ?? (hs.side ? [] : [[-2, 14, 17]]);
    glint = hs.sideGlint;
  } else {
    rows = hs.back ?? (hs.front ? deriveBack(hs.front) : undefined);
    shine = hs.backShine ?? [[-2, 11, 14], [-1, 10, 11]];
  }
  if (!rows || rows.length === 0) return;
  s.part(spec.hairMat);
  for (const [off, ...spans] of rows) for (const [a, b] of spans) s.span(c.H + off, a, b);
  const light = RAMP[spec.hairMat][2];
  for (const [off, a, b] of shine) s.tint(a, c.H + off, light, b - a + 1);
  if (glint) s.tint(glint[1], c.H + glint[0], 'white');
}

// ---------------------------------------------------------------------------
// Shared details and props
// ---------------------------------------------------------------------------
function handDot(c: Ctx, x: number, y: number, w = 2, h = 2): void {
  c.s.part(c.skin, { line: false }).rect(x, y, w, h);
}
/** The founders' hero marker: a lemon pin with a leaf on a cream ring. No one else wears it. */
function lemonPin(c: Ctx, x: number, y: number): void {
  const { s } = c;
  s.part('cream', { shade: 'flat' }).rows(y - 1, [[x, x + 2], [x - 1, x + 3], [x - 1, x + 3], [x, x + 2]]);
  s.part('lemon', { shade: 'flat', line: false }).rect(x, y, 3, 2);
  s.dot(x, y, 'lemon_2');
  s.dot(x + 2, y - 1, 'green_1');
}
/** x of a prop `w` wide hanging from a hand at hx, extending `out`. */
const propX = (hx: number, w: number, out: -1 | 0 | 1): number => (out < 0 ? hx + 3 - w : out > 0 ? hx : hx + 1 - Math.floor(w / 2));

function pitcherProp(c: Ctx, x: number, y: number): void {
  const { s } = c;
  s.part('grey').rect(x + 5, y + 1, 2, 1).rect(x + 6, y + 2, 1, 3).rect(x + 5, y + 4, 2, 1);
  s.part('grey').rect(x, y, 5, 7);
  s.dot(x, y + 2, 'lemon_2', 4, 4).dot(x + 1, y + 3, 'lemon_1', 3, 3);
  s.dot(x, y, 'white', 1, 5);
}
function clipboardProp(c: Ctx, x: number, y: number): void {
  const { s } = c;
  s.part('brown').rect(x, y, 6, 8);
  s.dot(x + 1, y + 1, 'cream_1', 4, 6).dot(x + 1, y + 3, 'grey_1', 3, 1).dot(x + 1, y + 5, 'grey_1', 4, 1);
  s.part('ctrl', { shade: 'flat' }).rect(x + 2, y - 1, 2, 2);
}
/** A full-width bib apron (front) / ties and bow (back) / front edge (profile). */
function bibApron(c: Ctx, mat: Mat, trim: PalKey): void {
  const { s } = c;
  const [tl, tr] = c.T;
  if (c.front) {
    s.part(mat).rect(12, c.by, 8, 1);
    s.part(mat).rect(11, c.by + 1, 10, c.hip - c.by + 2);
    s.dot(11, c.by + 5, RAMP[mat][0], 10, 1);
    s.dot(13, c.by + 6, trim, 6, 1); // pocket top stitch
  } else if (c.back) {
    s.part(mat).rect(12, c.by, 8, 1);
    s.part(mat).rect(tl, c.by + 5, tr - tl + 1, 1);
    s.part(mat).rect(14, c.by + 4, 4, 3);
  } else {
    s.part(mat).rect(17, c.by + 1, 3, c.hip - c.by + 2);
  }
}
/** Hair covered by a cap: dome rows per view, plus a peak in front / profile. */
function capDome(c: Ctx, mat: Mat, peak: boolean): void {
  const { s, H } = c;
  s.part(mat);
  if (c.side) {
    s.rows(H - 4, [[9, 20], [8, 22], [7, 23], [7, 23], [7, 23], [7, 23], [7, 23]]);
    if (peak) s.part(mat).rect(18, H + 3, 8, 1);
  } else {
    s.rows(H - 4, [[10, 21], [8, 23], [7, 24], [7, 24], [7, 24], [7, 24], [7, 24]]);
    if (peak && c.front) s.part(mat).rect(7, H + 3, 18, 1);
  }
}

// ============================================================================
// 4. THE CAST
// ============================================================================
const HAIR = {
  alex: {
    front: [[-6, [11, 11], [17, 17]], [-5, [10, 12], [16, 18], [21, 21]], [-4, [9, 22]], [-3, [8, 23]], ...rep(-2, 2, [7, 24]),
      [3, [7, 10], [12, 16], [18, 24]], [4, [7, 9], [13, 15], [22, 24]], [5, [7, 8], [23, 24]], [6, [7, 7], [24, 24]]],
    frontShine: [[-3, 11, 13], [-2, 10, 11], [-4, 15, 16]], frontGlint: [-3, 12],
    side: [[-6, [9, 9], [14, 14]], [-5, [8, 10], [13, 15], [18, 19]], [-4, [8, 21]], [-3, [7, 22]], ...rep(-2, 2, [7, 24]),
      [3, [7, 14], [17, 24]], [4, [7, 13], [20, 22]], ...rep(5, 8, [7, 12]), [9, [8, 11]]],
    sideShine: [[-3, 15, 18], [-2, 18, 19]], sideGlint: [-3, 16],
    back: [[-6, [11, 11], [17, 17]], [-5, [10, 12], [16, 18], [21, 21]], [-4, [9, 22]], [-3, [8, 23]], ...rep(-2, 9, [7, 24]),
      [10, [8, 10], [13, 18], [21, 23]]],
    backShine: [[-3, 11, 14], [-2, 10, 12]],
  },
  maya: {
    front: [...CROWN.slice(0, 3), [-1, [7, 24]], ...rep(0, 2, [6, 25]), [3, [6, 15], [22, 25]], [4, [6, 12], [23, 25]],
      ...rep(5, 9, [6, 8], [23, 25]), [10, [6, 9], [22, 25]]],
    frontShine: [[-2, 11, 14], [-1, 10, 11], [0, 9, 9]], frontGlint: [-2, 12],
    side: [[-4, [10, 20]], [-3, [8, 22]], [-2, [7, 23]], ...rep(-1, 2, [6, 24]), [3, [6, 14], [19, 24]], [4, [6, 13], [22, 23]],
      ...rep(5, 9, [6, 12]), [10, [7, 12]]],
    sideShine: [[-2, 14, 18], [-1, 17, 18]], sideGlint: [-2, 15],
    back: [...CROWN.slice(0, 3), [-1, [7, 24]], ...rep(0, 9, [6, 25]), [10, [7, 24]]],
    backShine: [[-2, 11, 15], [-1, 10, 11]],
  },
  leo: {
    front: [[-6, [9, 11], [14, 17], [20, 22]], [-5, [8, 23]], [-4, [7, 24]], ...rep(-3, 2, [6, 25]), [-1, [5, 26]], [1, [5, 26]],
      [3, [6, 10], [12, 15], [17, 19], [21, 25]], [4, [6, 8], [13, 14], [23, 25]], [5, [6, 7], [24, 25]]],
    frontShine: [[-5, 10, 11], [-4, 15, 16], [-2, 8, 9], [-3, 20, 21], [0, 12, 13], [-1, 17, 18]], frontGlint: [-5, 10],
    side: [[-6, [8, 10], [13, 16]], [-5, [7, 21]], [-4, [6, 23]], ...rep(-3, 2, [5, 24]), [3, [5, 14], [17, 19], [21, 24]],
      ...rep(4, 8, [5, 12]), [9, [6, 11]]],
    sideShine: [[-5, 9, 10], [-4, 14, 15], [-2, 8, 9], [-1, 18, 19], [1, 12, 13]], sideGlint: [-5, 9],
    back: [[-6, [9, 11], [14, 17], [20, 22]], [-5, [8, 23]], [-4, [7, 24]], ...rep(-3, 8, [6, 25]), [-1, [5, 26]], [3, [5, 26]],
      [9, [7, 24]], [10, [9, 12], [15, 17], [20, 22]]],
    backShine: [[-5, 10, 11], [-4, 15, 16], [-2, 8, 9], [0, 19, 20], [3, 11, 12]],
  },
  sam: {
    front: [...rep(3, 6, [7, 9], [22, 24]), [4, [10, 12], [19, 21]]],
    frontShine: [[3, 8, 9]],
    side: [...rep(3, 8, [7, 13]), [9, [8, 12]]],
    sideShine: [[4, 9, 11]],
    back: [...rep(3, 9, [7, 24]), [10, [9, 22]]],
    backShine: [[4, 10, 13]],
  },
  claire: {
    front: [...CROWN, [3, [7, 13], [20, 24]], [4, [7, 10], [22, 24]], ...rep(5, 6, [7, 8], [23, 24])],
    frontShine: [[-3, 12, 15], [-2, 11, 12]], frontGlint: [-3, 13],
    side: [...CROWN_SIDE, [3, [7, 13], [19, 24]], ...rep(4, 7, [7, 12]), [8, [8, 11]]],
    sideShine: [[-3, 14, 17], [-2, 17, 18]], sideGlint: [-3, 15],
    back: [...CROWN, ...rep(3, 9, [7, 24]), [10, [9, 22]]],
    backShine: [[-3, 11, 14], [-2, 10, 11]],
  },
  underCap: {
    front: [...rep(3, 6, [7, 8], [23, 24]), [4, [9, 11], [20, 22]]],
    side: [...rep(3, 8, [7, 13]), [9, [8, 12]]],
    sideShine: [],
    back: [...rep(3, 9, [7, 24]), [10, [9, 22]]],
    backShine: [],
  },
} satisfies Record<string, HairStyle>;

// ---------------- FOUNDERS: exact catalog accents, a lemon pin each ----------------
const FOUNDERS: Record<FounderSpecies, Spec> = {
  // Alex: spiky chestnut hair, lemon-yellow striped tee
  squirrel: {
    id: 'alex', founder: true, skin: 'sk2', hairMat: 'brown', hair: HAIR.alex, top: 'lemon', sleeve: 2,
    legs: { kind: 'pants', mat: 'navy' }, shoe: 'brown',
    outfit(c) {
      const { s } = c;
      const [tl, tr] = c.T;
      s.part('cream', { line: false, shade: 'flat' });
      s.rect(tl, c.by + 3, tr - tl + 1, 1).rect(tl, c.by + 5, tr - tl + 1, 1);
      if (c.front && c.accessory === 'none') {
        s.part('cream', { shade: 'flat' }).rect(13, c.by, 6, 1);
        lemonPin(c, 12, c.by + 2);
      }
      if (c.side && c.accessory === 'none') lemonPin(c, 17, c.by + 1);
    },
  },
  // Maya: dark bob with a gold clip, coral cardigan over a cream shirt
  shiba: {
    id: 'maya', founder: true, skin: 'sk1', hairMat: 'hair', hair: HAIR.maya, top: 'coral', sleeve: 4, lashes: true,
    legs: { kind: 'pants', mat: 'ink' }, shoe: 'brown',
    outfit(c) {
      const { s } = c;
      if (c.front) {
        s.part('cream', { shade: 'soft' }).rect(14, c.by, 4, c.hip - c.by);
        if (c.accessory === 'none') lemonPin(c, 12, c.by + 2);
      }
      if (c.side) s.part('cream', { shade: 'soft' }).rect(18, c.by, 2, c.hip - c.by);
    },
    headwear(c) {
      if (c.back) return;
      const x = c.side ? 20 : 21;
      c.s.part('lemon', { shade: 'flat' }).rect(x, c.H + 2, 2, 1);
      c.s.dot(x, c.H + 2, 'lemon_2');
    },
  },
  // Leo: fluffy curls, varsity-green hoodie
  panda: {
    id: 'leo', founder: true, skin: 'sk4', hairMat: 'hair', hair: HAIR.leo, top: 'green', sleeve: 4,
    legs: { kind: 'pants', mat: 'ink' }, shoe: 'cream',
    outfit(c) {
      const { s } = c;
      const [tl, tr] = c.T;
      if (c.front) {
        s.part('cream', { shade: 'flat' }).rect(tl + 1, c.by + 5, tr - tl - 1, 1);
        s.part('cream', { line: false, shade: 'flat' }).rect(14, c.by + 1, 1, 2).rect(17, c.by + 1, 1, 2);
        if (c.accessory === 'none') lemonPin(c, 12, c.by + 2);
      } else if (c.back) {
        s.part('green').rows(c.by, [[12, 19], [12, 19], [13, 18]]); // hood lying on the back
      } else {
        s.part('cream', { shade: 'flat' }).rect(tl + 1, c.by + 5, tr - tl, 1);
        s.part('green').rect(12, c.by, 3, 3);
      }
    },
  },
  // Sam: blonde under an ink NYC cap, open sky-blue jacket
  penguin: {
    id: 'sam', founder: true, skin: 'sk1', hairMat: 'tan', hair: HAIR.sam, top: 'sky', sleeve: 4,
    legs: { kind: 'pants', mat: 'navy' }, shoe: 'ink',
    outfit(c) {
      const { s } = c;
      if (c.front) {
        s.part('cream', { shade: 'soft' }).rect(14, c.by, 4, c.hip - c.by);
        s.dot(15, c.by + 1, 'grey_1', 1, c.hip - c.by - 1);
        if (c.accessory === 'none') lemonPin(c, 12, c.by + 2);
      }
      if (c.side) s.part('cream', { shade: 'soft' }).rect(18, c.by, 2, c.hip - c.by);
    },
    headwear(c) {
      const { s, H } = c;
      capDome(c, 'ink', true);
      if (c.side) s.dot(18, H - 1, 'lemon_1', 2, 2);
      else if (c.front) s.dot(14, H - 1, 'lemon_1', 4, 2).dot(14, H - 1, 'lemon_2');
      else s.dot(13, H + 2, 'cream_1', 6, 1); // snapback strap
    },
  },
  // Claire: auburn ponytail, navy blazer with a white collar
  bunny: {
    id: 'claire', founder: true, skin: 'sk3', hairMat: 'orange', hair: HAIR.claire, top: 'navy', sleeve: 4, lashes: true,
    legs: { kind: 'pants', mat: 'ink' }, shoe: 'wine',
    behindHead(c) {
      const { s, H } = c;
      if (c.back) return;
      s.part('orange');
      if (c.side) {
        const sw = c.swing;
        s.rows(H + 2, [[4 + sw, 7], [3 + sw, 7], [3 + sw, 7], [3 + sw, 7], [3 + sw, 6], [3 + sw, 6], [4 + sw, 6], [4 + sw, 5]]);
      } else s.rows(H + 3, [[24, 26], [24, 27], [24, 27], [24, 27], [24, 26], [25, 26]]);
    },
    outfit(c) {
      const { s } = c;
      if (c.front) {
        s.part('cream', { shade: 'flat' }).rows(c.by, [[13, 18], [14, 17], [15, 16]]);
        if (c.accessory === 'none') lemonPin(c, 12, c.by + 3);
        s.dot(19, c.by + 3, 'navy_0').dot(19, c.by + 5, 'navy_0');
      }
      if (c.side) s.part('cream', { shade: 'flat' }).rows(c.by, [[17, 19], [18, 19]]);
    },
    headwear(c) {
      if (!c.back) return;
      const { s, H } = c;
      s.part('orange').rows(H + 4, [[14, 17], [13, 18], [13, 18], [13, 18], [13, 18], [14, 17], [14, 17], [15, 16]]);
      s.part('lemon', { shade: 'flat' }).rect(14, H + 3, 4, 1);
    },
  },
};

// ---------------- SHOPKEEPERS (VendorKind) ----------------
const VENDORS: Record<VendorKind, Spec> = {
  // Dana Reyes, the seller. Her own shape: a teal blazer slung over one shoulder, hooked on a
  // raised finger and hanging past her hip. Nobody else raises an arm at rest.
  broker: {
    id: 'dana', skin: 'sk3', hairMat: 'hair', top: 'cream', sleeve: 2, build: 'slim', height: 'tall', lashes: true,
    legs: { kind: 'skirt', mat: 'ink' }, shoe: 'wine',
    hair: {
      front: [...CROWN, [3, [7, 9], [13, 24]], [4, [7, 8], [16, 24]], ...rep(5, 11, [6, 8], [23, 25]), [12, [6, 8], [23, 24]]],
      frontShine: [[-3, 14, 18], [-2, 18, 20], [3, 18, 21]], frontGlint: [-3, 16],
    },
    behind(c) {
      const { s, by } = c;
      const sw = c.walk ? -c.swing : 0;
      if (c.front) {
        s.part('teal').rows(by - 4, [[23, 26], [22, 27], [22, 27], [21, 28], [21, 28], [21, 28], [21, 28], [21, 28], [21, 29],
          [21, 29], [21, 29], [21 + sw, 29 + sw], [21 + sw, 29 + sw], [22 + sw, 29 + sw], [23 + sw, 28 + sw]]);
        s.dot(26, by - 1, 'teal_0', 1, 8).dot(27, by + 3, 'lemon_0');
      } else if (c.side) {
        // Hangs down her back from the shoulder.
        s.part('teal').rows(by - 1, [[9, 13], [8, 13], [8, 13], [7, 13], [7, 13], [7, 13], [7, 13], [7 + sw, 12 + sw], [7 + sw, 12 + sw], [8 + sw, 11 + sw]]);
      }
    },
    outfit(c) {
      if (c.front) c.s.part(c.skin, { shade: 'flat' }).rows(c.by, [[14, 17], [15, 16]]); // V neck
      if (c.back) {
        // Seen from behind the slung blazer drapes over her back, on the raised-arm side.
        const sw = c.walk ? c.swing : 0;
        c.s.part('teal').rows(c.by - 2, [[6, 10], [5, 11], [4, 12], [4, 12], [4, 12], [4, 12], [3, 12], [3, 12], [3, 12],
          [3 + sw, 12 + sw], [3 + sw, 11 + sw], [4 + sw, 10 + sw]]);
        c.s.dot(9, c.by, 'teal_0', 1, 7);
      }
    },
    headwear(c) {
      const { s, H } = c;
      if (c.front) {
        s.part('ink').rect(9, H - 1, 5, 2).rect(18, H - 1, 5, 2).rect(14, H - 1, 4, 1);
        s.dot(10, H - 1, 'ink_2', 2, 1).dot(19, H - 1, 'ink_2', 2, 1);
        s.part('tan', { shade: 'flat' }).rect(7, H + 9, 1, 2);
      } else if (c.side) {
        s.part('ink').rect(17, H - 1, 5, 2).rect(12, H - 1, 5, 1);
        s.dot(18, H - 1, 'ink_2', 2, 1);
        s.part('tan', { shade: 'flat' }).rect(13, H + 9, 1, 2);
      } else {
        s.part('ink').rect(8, H - 1, 16, 1);
      }
    },
    arms(c) {
      const { s } = c;
      const [tl, tr] = c.T;
      if (c.side) {
        // Near arm raised to the shoulder, hand hooked on the blazer collar.
        s.part('cream').rect(13, c.by, 3, 2);
        s.part(c.skin).rect(12, c.by - 3, 3, 3);
        s.part('teal').rect(10, c.by - 4, 5, 1);
        handDot(c, 12, c.by - 5, 2, 1);
        return true;
      }
      if (c.back) {
        // Raised arm on screen-left (the blazer side), the other hangs.
        c.arm(tr + 1, c.by + 1 - c.swing, 6, { shoulder: 'L' });
        s.part('cream').rect(tl - 3, c.by - 1, 3, 3);
        s.part(c.skin).rect(tl - 4, c.by - 4, 3, 3);
        s.part('teal').rect(tl - 6, c.by - 5, 4, 1);
        return true;
      }
      c.arm(tl - 3, c.by + 1 + c.swing, 6, { shoulder: 'R' });
      s.part('cream').rect(tr + 1, c.by - 1, 3, 3);
      s.part(c.skin).rect(tr + 2, c.by - 4, 3, 3);
      s.part('teal').rect(tr + 2, c.by - 5, 4, 1);
      s.part(c.skin, { line: false }).rect(tr + 2, c.by - 6, 2, 1);
      return true;
    },
  },
  // June (carpentry): tan flat cap, leather tool apron, a plank taller than she is.
  carpenter: {
    id: 'june', skin: 'sk2', hairMat: 'orange', top: 'grey', sleeve: 2,
    legs: { kind: 'pants', mat: 'ink' }, shoe: 'brown',
    hair: { ...HAIR.underCap, front: [...rep(3, 6, [7, 8], [23, 24]), [3, [9, 12]], [-1, [6, 7]], [0, [5, 7]]] },
    behind(c) {
      // The plank stands beside her (front: screen right, back: screen left, profile: behind).
      const { s } = c;
      const dy = c.walk ? -c.swing : 0;
      if (c.side) {
        s.part('tan', { back: true }).rect(8, 3 + dy, 3, 33);
        return;
      }
      const x = c.front ? 25 : 3;
      s.part('tan').rect(x, 3 + dy, 4, 33);
      s.dot(x + 1, 8 + dy, 'tan_0', 1, 4).dot(x + 2, 20 + dy, 'tan_0', 1, 5);
    },
    headwear(c) {
      const { s, H } = c;
      capDome(c, 'tan', true);
      s.dot(c.side ? 14 : 15, H - 5, 'tan_0', 2, 1);
      if (c.front) s.part('lemon', { shade: 'flat' }).rect(23, H + 4, 4, 1).dot(26, H + 4, 'sk1_1');
      if (c.side) s.part('lemon', { shade: 'flat' }).rect(11, H + 4, 4, 1);
    },
    outfit(c) {
      const { s } = c;
      const [tl, tr] = c.T;
      s.part('brown').rect(tl - 1, c.hip - 3, tr - tl + 3, 5); // leather tool apron at the hips
      if (c.front) {
        s.dot(11, c.hip - 2, 'brown_0', 4, 2).dot(17, c.hip - 2, 'brown_0', 4, 2);
        s.dot(12, c.hip - 3, 'grey_2').dot(19, c.hip - 3, 'grey_2');
      }
    },
    arms(c) {
      if (c.side) return false;
      const [tl, tr] = c.T;
      // One arm holds the plank, the other swings.
      if (c.front) {
        c.arm(tl - 3, c.by + 1 + c.swing, 6, { shoulder: 'R' });
        c.arm(tr + 1, c.by + 1, 5, { shoulder: 'L' });
        handDot(c, tr + 2, c.by + 4, 2, 2);
      } else {
        c.arm(tr + 1, c.by + 1 - c.swing, 6, { shoulder: 'L' });
        c.arm(tl - 3, c.by + 1, 5, { shoulder: 'R' });
        handDot(c, tl - 3, c.by + 4, 2, 2);
      }
      return true;
    },
  },
  // Otis (glassware): cream bandana with ink dots, grey apron, a wide tray of glasses.
  glazier: {
    id: 'otis', skin: 'sk4', hairMat: 'hair', top: 'cream', sleeve: 4,
    legs: { kind: 'pants', mat: 'ink' }, shoe: 'ink',
    hair: { front: [...rep(3, 7, [7, 8], [23, 24])], side: [...rep(3, 8, [7, 12])], back: [...rep(3, 9, [7, 24]), [10, [9, 22]]] },
    beard(c) {
      const { s, H } = c;
      s.part('grey', { shade: 'soft' }).rows(H + 10, [[12, 19], [13, 18]]);
      s.dot(15, H + 9, MOUTH, 2, 1);
      if (c.mood !== 'neutral') s.dot(14, H + 8, MOUTH).dot(17, H + 8, MOUTH);
    },
    behind(c) {
      if (!c.back) return;
      // From behind, the tray shows on both sides of his body.
      const { s } = c;
      s.part('brown').rect(3, c.by + 3, 26, 2);
      for (const x of [4, 24]) s.part('cream').rect(x, c.by - 1, 3, 4);
    },
    headwear(c) {
      const { s, H } = c;
      s.part('cream');
      if (c.side) s.rows(H - 3, [[9, 20], [8, 22], [7, 23], [7, 23], [7, 23], [7, 23]]);
      else s.rows(H - 3, [[10, 21], [8, 23], [7, 24], [7, 24], [7, 24], [7, 24]]);
      for (const [x, y] of [[10, -2], [14, -1], [18, -2], [21, 0], [9, 1], [16, 1], [12, 2], [20, 2]]) s.tint(x, H + y, 'ink_1');
      // The knot: at the side in front, at the nape from behind, at the back in profile.
      if (c.front) s.part('cream').rect(3, H + 1, 4, 3).dot(3, H + 3, 'cream_0', 2, 1);
      else if (c.back) s.part('cream').rect(14, H + 3, 4, 3);
      else s.part('cream').rect(4, H, 3, 3);
      const ey = H + 5;
      if (c.front) {
        for (const x of [10, 18]) s.dot(x, ey - 1, 'grey_2', 4, 1).dot(x, ey + 3, 'grey_2', 4, 1);
        s.dot(14, ey, 'grey_2', 4, 1);
      } else if (c.side) {
        s.dot(19, ey - 1, 'grey_2', 4, 1).dot(19, ey + 3, 'grey_2', 4, 1).dot(15, ey, 'grey_2', 4, 1);
        s.part('grey', { shade: 'soft' }).rows(H + 10, [[17, 22], [18, 21]]);
      }
    },
    outfit(c) { bibApron(c, 'grey', 'white'); },
    arms(c) {
      const { s } = c;
      const [tl, tr] = c.T;
      if (c.side) {
        // Tray held out in front at chest height.
        s.part(c.skin).rect(15, c.by + 1, 3, 3);
        s.part('brown').rect(16, c.by + 3, 12, 2);
        for (const x of [17, 21, 25]) s.part('cream').rect(x, c.by - 1, 2, 4).tint(x, c.by - 1, 'white');
        handDot(c, 17, c.by + 4, 3, 1);
        return true;
      }
      c.arm(tl - 1, c.by + 1, 5, { shoulder: 'R' });
      c.arm(tr - 1, c.by + 1, 5, { shoulder: 'L' });
      if (c.front) {
        s.part('brown').rect(3, c.by + 3, 26, 2);
        for (const x of [4, 9, 14, 19, 24]) {
          s.part('cream').rect(x, c.by - 1, 3, 4);
          s.dot(x, c.by - 1, 'white', 1, 3).dot(x + 1, c.by + 1, 'lemon_2', 2, 2);
        }
        handDot(c, 8, c.by + 4);
        handDot(c, 22, c.by + 4);
      }
      return true;
    },
  },
  // Rocco (lemons): straw hat with a wine band, orange apron, a lemon crate on his shoulder.
  grower: {
    id: 'rocco', skin: 'sk1', hairMat: 'grey', top: 'cream', sleeve: 2, build: 'wide',
    legs: { kind: 'pants', mat: 'brown' }, shoe: 'brown',
    hair: { front: [...rep(3, 7, [7, 8], [23, 24])], side: [...rep(3, 8, [7, 12])], back: [...rep(3, 9, [7, 24]), [10, [9, 22]]] },
    beard(c) {
      const { s, H } = c;
      s.part('grey', { shade: 'soft' }).rows(H + 8, [[13, 18], [12, 19]]); // walrus mustache
      if (c.mood !== 'neutral') s.dot(9, H + 8, 'blush', 2, 1).dot(21, H + 8, 'blush', 2, 1);
      s.dot(15, H + 10, MOUTH, 2, 1);
    },
    headwear(c) {
      const { s, H } = c;
      s.part('tan').rows(H - 5, [[11, 20], [10, 21], [10, 21], [10, 21], [10, 21]]);
      s.dot(10, H - 2, 'wine_1', 12, 2);
      s.part('tan').rows(H, [[4, 27], [3, 28]]);
      for (let x = 4; x < 28; x += 3) s.tint(x, H + 1, 'tan_0');
      if (c.side) s.part('grey', { shade: 'soft' }).rect(19, H + 8, 4, 1); // mustache in profile
    },
    outfit(c) { bibApron(c, 'orange', 'tan_2'); },
    arms(c) {
      const { s } = c;
      const [tl, tr] = c.T;
      if (c.side) return false;
      // Crate hoisted on one shoulder: a tall, lopsided shape (front: screen right, back: left).
      const right = c.front;
      const armX = right ? tr + 1 : tl - 3;
      const crateX = right ? 22 : 1;
      c.arm(right ? tl - 3 : tr + 1, c.by + 1 + (right ? c.swing : -c.swing), 6, { shoulder: right ? 'R' : 'L' });
      for (const x of [crateX + 1, crateX + 5]) s.part('lemon').rect(x, c.by - 11, 3, 2);
      s.part('tan').rect(crateX, c.by - 9, 9, 6);
      s.dot(crateX + 1, c.by - 6, 'tan_0', 7, 1);
      s.part('cream').rect(armX, c.by - 1, 3, 2);
      s.part(c.skin).rect(armX, c.by - 3, 3, 2);
      return true;
    },
    carry: [{
      side: 'R', inProfile: true,
      draw(c, hx, hy, out) {
        if (!c.side) return; // in front/back views the crate is on his shoulder (arms above)
        const x = propX(hx, 8, out);
        for (const lx of [x + 1, x + 4]) c.s.part('lemon').rect(lx, hy - 1, 3, 2);
        c.s.part('tan').rect(x, hy + 1, 8, 5);
        c.s.dot(x + 1, hy + 3, 'tan_0', 6, 1);
      },
    }],
  },
  // The player's hired worker: control-blue flat cap and apron, carries a pitcher.
  helper: {
    id: 'worker', skin: 'sk3', hairMat: 'brown', hair: HAIR.underCap, top: 'cream', sleeve: 2,
    legs: { kind: 'pants', mat: 'ink' }, shoe: 'cream',
    headwear(c) {
      capDome(c, 'ctrl', true);
      c.s.dot(c.side ? 14 : 15, c.H - 5, 'ctrl_0', 2, 1);
    },
    outfit(c) { bibApron(c, 'ctrl', 'white'); },
    carry: [{
      side: 'R', inProfile: true,
      draw(c, hx, hy, out) { pitcherProp(c, out < 0 ? hx - 4 : hx + (out === 0 ? 1 : 0), hy); },
    }],
  },
};

// ---------------- THE MANAGER (control blue: headset, vest, clipboard clip) ----------------
const MANAGER: Spec = {
  id: 'manager', skin: 'sk4', hairMat: 'hair', top: 'cream', sleeve: 4, height: 'tall',
  legs: { kind: 'pants', mat: 'ink' }, shoe: 'brown',
  hair: {
    front: [[-4, [10, 21]], [-3, [8, 23]], ...rep(-2, 2, [7, 24]), [3, [7, 9], [22, 24]], [4, [7, 8], [23, 24]]],
    frontShine: [[-3, 11, 14], [-2, 10, 11]], frontGlint: [-3, 12],
  },
  headwear(c) {
    const { s, H } = c;
    if (c.side) {
      s.part('ctrl').rect(9, H - 5, 12, 1).rect(14, H - 4, 1, 8);
      s.part('ctrl').rect(12, H + 3, 3, 4);
      s.part('ctrl', { shade: 'flat' }).rect(15, H + 8, 5, 1);
      return;
    }
    s.part('ctrl').rect(7, H - 5, 18, 1);
    const cupX = c.front ? 4 : 25;
    s.part('ctrl').rect(c.front ? 6 : 25, H - 4, 1, 8);
    s.part('ctrl').rect(cupX, H + 3, 3, 4);
    if (c.front) s.part('ctrl', { shade: 'flat' }).rect(7, H + 8, 4, 1).dot(10, H + 8, 'ctrl_2');
  },
  outfit(c) {
    const { s } = c;
    const [tl, tr] = c.T;
    if (c.front) {
      s.part('ctrl').rect(10, c.by, 4, c.hip - c.by).rect(18, c.by, 4, c.hip - c.by);
      s.part('ink', { shade: 'soft' }).rect(15, c.by, 2, 5);
      s.dot(12, c.by + 3, 'white', 2, 1);
    } else if (c.back) {
      s.part('ctrl').rect(tl, c.by, tr - tl + 1, c.hip - c.by);
    } else {
      s.part('ctrl').rect(tl, c.by, tr - tl - 1, c.hip - c.by);
    }
  },
  carry: [{ side: 'L', inProfile: true, draw(c, hx, hy, out) { clipboardProp(c, propX(hx, 6, out), hy - 1); } }],
};

// ---------------- PASSERS-BY: one per district kind, 36x40, muted city colours ----------------
// No control blue, no lemon pin, no founder accent as a main garment.
const PEDS: Record<DistrictPedestrianKind, Spec> = {
  'park-dog-walker': {
    id: 'dogwalker', ped: true, ox: -1, skin: 'sk2', hairMat: 'brown', top: 'grey', sleeve: 4,
    legs: { kind: 'pants', mat: 'ink' }, shoe: 'brown',
    hair: { front: [...CROWN, [3, [7, 12], [16, 24]], [4, [7, 9], [22, 24]], ...rep(5, 6, [7, 8], [23, 24])],
      frontShine: [[-3, 11, 14]], frontGlint: [-3, 12] },
    outfit(c) {
      if (c.front) c.s.part('cream', { shade: 'soft' }).rect(14, c.by, 4, c.hip - c.by);
      if (c.side) c.s.part('cream', { shade: 'soft' }).rect(18, c.by, 2, c.hip - c.by);
    },
    front(c) {
      if (c.portrait || c.ko) return;
      // A small golden dog on a leash. Front/back: beside the walker; profile: trotting ahead.
      const { s } = c;
      const ox = s.ox;
      s.ox = 0;
      const step = c.pose === 'walk1' ? -1 : 0;
      const dy = 27 + step;
      const leashY = c.by + 6 - (c.side ? 0 : -c.swing);
      if (c.side) {
        // Facing right, ahead of the walker (mirrored for 'left' with the rest of the sprite).
        s.part('wine', { shade: 'flat' }).rect(16, leashY, 1, 1).rect(17, leashY + 1, 5, 1).rect(22, dy + 3, 1, 1);
        s.part('tan', { back: true }).rect(24, dy + 8, 2, 2).rect(28, dy + 8, 2, 2);
        s.part('tan').rect(23, dy + 3, 7, 5);
        s.part('tan').rect(22, dy + 1, 1, 3); // tail
        s.part('tan').rect(28, dy, 5, 5);
        s.dot(28, dy + 1, 'tan_0', 2, 3).dot(31, dy + 2, 'out').dot(32, dy + 3, 'out').dot(28, dy + 5, 'wine_2', 3, 1);
        s.part('tan').rect(26 + (c.pose === 'walk2' ? 1 : 0), dy + 8, 2, 2);
      } else {
        s.part('wine', { shade: 'flat' }).rect(25, leashY, 1, 1).rect(26, c.by + 7, 1, 1).rect(27, dy + 2, 1, 1);
        s.part('tan', { back: true }).rect(28, dy + 8, 2, 2).rect(32, dy + 8, 2, 2);
        s.part('tan').rect(28, dy + 3, 6, 5);
        s.part('tan').rect(33, dy + 1, 1, 3);
        s.part('tan').rect(26, dy, 5, 5);
        if (c.front) s.dot(29, dy + 1, 'tan_0', 2, 3).dot(27, dy + 2, 'out').dot(26, dy + 3, 'out');
        else s.dot(26, dy + 1, 'tan_0', 2, 3);
        s.dot(27, dy + 5, 'wine_2', 3, 1);
        s.part('tan').rect(29 + (c.pose === 'walk2' ? 1 : 0), dy + 8, 2, 2);
      }
      s.ox = ox;
    },
  },
  'park-jogger': {
    id: 'jogger', ped: true, idleKnee: true, skin: 'sk4', hairMat: 'hair', top: 'rose', sleeve: 0, build: 'slim',
    legs: { kind: 'shorts', mat: 'ink' }, shoe: 'wine',
    hair: { front: [...CROWN, [3, [7, 24]], ...rep(4, 5, [7, 8], [23, 24])], frontShine: [[-3, 11, 14]], frontGlint: [-3, 12] },
    behindHead(c) {
      // High ponytail swinging with the stride.
      const { s, H } = c;
      const dx = c.pose === 'walk1' ? 2 : c.pose === 'walk2' ? -1 : 0;
      if (c.back) return;
      s.part('hair');
      if (c.side) s.rows(H - 3, [[6, 9], [4, 9], [3, 8], [3, 7], [3 + dx, 6 + dx], [3 + dx, 5 + dx]]);
      else s.rows(H - 5, [[22 + dx, 25 + dx], [22 + dx, 27 + dx], [23 + dx, 28 + dx], [24 + dx, 28 + dx], [25 + dx, 28 + dx], [26 + dx, 28 + dx], [27 + dx, 28 + dx]]);
    },
    headwear(c) {
      const { s, H } = c;
      if (c.back) s.part('hair').rows(H + 4, [[14, 17], [14, 17], [15, 16], [15, 16]]);
      s.part('cream', { shade: 'flat' }).rect(7, H + 2, 18, 1);
      if (c.front) s.dot(7, H + 8, 'white', 1, 2).dot(24, H + 8, 'white', 1, 2);
      if (c.side) s.dot(14, H + 7, 'white');
    },
    outfit(c) { c.s.part('cream', { shade: 'flat', line: false }).rect(c.T[0], c.by + 3, c.T[1] - c.T[0] + 1, 1); },
  },
  'columbia-student': {
    id: 'student', ped: true, skin: 'sk3', hairMat: 'hair', top: 'grey', sleeve: 4,
    legs: { kind: 'pants', mat: 'navy' }, shoe: 'cream',
    hair: { front: [[-5, [10, 12], [15, 17], [20, 21]], [-4, [9, 22]], [-3, [8, 23]], ...rep(-2, 2, [7, 24]), [3, [7, 11], [13, 17], [20, 24]], [4, [7, 8], [14, 15], [23, 24]]],
      frontShine: [[-4, 10, 11], [-3, 15, 16], [-1, 19, 20]], frontGlint: [-4, 10] },
    behind(c) {
      // Backpack: peeks out at both sides from the front, sits behind the back in profile.
      if (c.front) c.s.part('brown').rect(5, c.by + 1, 22, 8);
      if (c.side) c.s.part('brown').rect(7, c.by, 6, 8);
    },
    outfit(c) {
      const { s } = c;
      if (c.front) {
        s.part('grey').rows(c.by, [[11, 20], [12, 19]]);
        s.part('brown', { shade: 'flat' }).rect(11, c.by + 1, 1, 5).rect(20, c.by + 1, 1, 5);
        s.part('wine', { shade: 'flat' }).rect(14, c.by + 3, 4, 2);
      } else if (c.back) {
        s.part('brown').rect(10, c.by, 12, 8);
        s.part('brown').rect(12, c.by + 4, 8, 3);
        s.dot(15, c.by + 4, 'tan_2', 2, 1);
      }
    },
    front(c) {
      const { s, H } = c;
      const ey = H + 5;
      if (c.ko) return; // glasses knocked off: the X eyes must read
      if (c.front) {
        for (const x of [10, 18]) {
          s.dot(x + 1, ey - 1, 'grey_2', 2, 1).dot(x, ey, 'grey_2', 1, 3).dot(x + 3, ey, 'grey_2', 1, 3).dot(x + 1, ey + 3, 'grey_2', 2, 1);
        }
        s.dot(14, ey + 1, 'grey_2', 4, 1);
      } else if (c.side && !c.ko) {
        s.dot(19, ey - 1, 'grey_2', 2, 1).dot(18, ey, 'grey_2', 1, 3).dot(21, ey, 'grey_2', 1, 3).dot(15, ey + 1, 'grey_2', 3, 1);
      }
    },
    carry: [{
      side: 'L', inProfile: true,
      draw(c, hx, hy, out) {
        // Books hugged in the arm.
        const x = propX(hx, 5, out);
        c.s.part('wine').rect(x, hy - 3, 5, 7);
        c.s.part('navy').rect(x + 1, hy - 4, 5, 2);
        c.s.dot(x, hy - 1, 'cream_1', 1, 4);
      },
    }],
  },
  'fidi-suit': {
    id: 'suit', ped: true, skin: 'sk1', hairMat: 'hair', top: 'ink', sleeve: 4,
    legs: { kind: 'pants', mat: 'ink' }, shoe: 'brown',
    hair: { front: [...CROWN, [3, [7, 9], [14, 24]], ...rep(4, 5, [7, 8], [23, 24])],
      frontShine: [[-3, 13, 18], [-2, 17, 20], [3, 16, 19]], frontGlint: [-3, 15] },
    outfit(c) {
      const { s } = c;
      if (c.front) {
        s.part('cream', { shade: 'flat' }).rows(c.by, [[13, 18], [14, 17], [15, 16]]);
        s.part('wine', { shade: 'soft' }).rect(15, c.by + 1, 2, 5);
        s.dot(13, c.by + 4, 'ink_2').dot(18, c.by + 4, 'ink_2');
      } else if (c.side) {
        s.part('cream', { shade: 'flat' }).rows(c.by, [[17, 19], [18, 19]]);
        s.part('wine', { shade: 'flat' }).rect(19, c.by + 1, 1, 4);
      }
    },
    carry: [{
      side: 'L', inProfile: true,
      draw(c, hx, hy, out) {
        // Brown leather briefcase with a brass clasp.
        const x = propX(hx, 8, out);
        c.s.part('brown', { shade: 'flat' }).rect(x + 2, hy + 1, 4, 1);
        c.s.part('brown').rect(x, hy + 2, 8, 6);
        c.s.dot(x + 3, hy + 4, 'tan_2', 2, 1);
      },
    }],
  },
  'broadway-theater': {
    id: 'theatre', ped: true, skin: 'sk2', hairMat: 'orange', top: 'ink', sleeve: 4, lashes: true,
    legs: { kind: 'pants', mat: 'ink' }, shoe: 'wine',
    hair: { front: [[-6, [13, 18]], [-5, [12, 19]], ...CROWN, [3, [7, 12], [19, 24]], ...rep(4, 6, [7, 8], [23, 24])],
      frontShine: [[-6, 14, 16], [-3, 11, 14]], frontGlint: [-6, 14] },
    behind(c) {
      // Long evening coat flaring below the hips.
      const [tl, tr] = c.T;
      c.s.part('ink').rows(c.hip, [[tl - 1, tr + 1], [tl - 1, tr + 1], [tl - 2, tr + 2], [tl - 2, tr + 2], [tl - 2, tr + 2]]);
    },
    outfit(c) {
      // Wine scarf with a long tail.
      const { s } = c;
      const [tl, tr] = c.T;
      if (c.side) {
        s.part('wine').rect(tl, c.by, tr - tl + 1, 2);
        s.part('wine').rect(17, c.by + 2, 2, 6);
        return;
      }
      s.part('wine').rect(11, c.by, 10, 2);
      const tx = c.front ? 17 : 12;
      s.part('wine').rect(tx, c.by + 2, 3, 6);
      s.dot(tx + 1, c.by + 3, 'wine_2', 1, 3).dot(tx + 1, c.by + 7, 'wine_2');
    },
    carry: [{
      side: 'R', inProfile: true,
      draw(c, hx, hy, out) {
        // Playbill: cream programme with a wine band.
        const x = propX(hx, 5, out);
        c.s.part('cream').rect(x, hy - 1, 5, 7);
        c.s.dot(x, hy - 1, 'wine_1', 5, 2).dot(x + 1, hy + 2, 'ink_1', 3, 1);
      },
    }],
  },
  'fifth-shopper': {
    id: 'shopper', ped: true, skin: 'sk1', hairMat: 'tan', top: 'rose', sleeve: 4, lashes: true,
    legs: { kind: 'pants', mat: 'ink' }, shoe: 'wine',
    hair: { front: [...CROWN.slice(0, 3), [-1, [7, 24]], ...rep(0, 2, [6, 25]), [3, [6, 13], [18, 25]], [4, [6, 9], [22, 25]], ...rep(5, 10, [6, 8], [23, 25])],
      frontShine: [[-2, 11, 15], [-1, 10, 11], [3, 9, 11]], frontGlint: [-2, 12] },
    headwear(c) {
      // Big ink sunglasses (knocked flying in the KO frame so the X eyes show).
      const { s, H } = c;
      const ey = H + 5;
      if (c.ko) return;
      if (c.front) {
        s.part('ink', { line: false }).rect(10, ey - 1, 5, 3).rect(17, ey - 1, 5, 3).rect(15, ey - 1, 2, 1);
        s.dot(11, ey - 1, 'ink_2', 2, 1).dot(18, ey - 1, 'ink_2', 2, 1);
      } else if (c.side) {
        s.part('ink', { line: false }).rect(18, ey - 1, 5, 3).rect(14, ey - 1, 4, 1);
        s.dot(19, ey - 1, 'ink_2', 2, 1);
      }
    },
    outfit(c) {
      const { s } = c;
      if (!c.front) return;
      s.part('rose', { shade: 'flat' }).rect(15, c.by, 2, c.hip - c.by + 2);
      s.dot(14, c.by + 2, 'tan_2').dot(14, c.by + 5, 'tan_2').dot(17, c.by + 2, 'tan_2').dot(17, c.by + 5, 'tan_2');
    },
    carry: [
      {
        side: 'L', inProfile: true,
        draw(c, hx, hy, out) {
          const x = propX(hx, 6, out);
          c.s.part('ink', { shade: 'flat' }).rect(x + 1, hy + 1, 4, 1);
          c.s.part('cream').rect(x, hy + 2, 6, 7);
          c.s.dot(x, hy + 4, 'wine_1', 6, 1);
        },
      },
      {
        side: 'R',
        draw(c, hx, hy, out) {
          const x = propX(hx, 6, out);
          c.s.part('ink', { shade: 'flat' }).rect(x + 1, hy + 1, 4, 1);
          c.s.part('wine').rect(x, hy + 2, 6, 7);
          c.s.dot(x + 1, hy + 4, 'rose_2', 4, 1);
        },
      },
    ],
  },
  'village-artist': {
    id: 'artist', ped: true, skin: 'sk3', hairMat: 'brown', top: 'orange', sleeve: 4,
    legs: { kind: 'pants', mat: 'ink' }, shoe: 'brown',
    hair: { front: [...rep(3, 8, [6, 8], [23, 25]), [9, [6, 8], [23, 24]], [3, [9, 12]]],
      side: [...rep(3, 9, [6, 12]), [10, [7, 11]]], back: [...rep(3, 9, [6, 25]), [10, [8, 23]]] },
    headwear(c) {
      // Wine beret tilted to one side, paintbrush tucked behind the ear.
      const { s, H } = c;
      const bx = c.side ? 13 : 22;
      s.part('tan', { shade: 'flat' }).rect(bx, H - 5, 1, 3).dot(bx, H - 6, 'rose_1');
      s.part('wine');
      if (c.side) s.rows(H - 5, [[9, 22], [7, 24], [6, 24], [6, 24], [7, 24], [7, 24], [7, 24], [7, 24]]);
      else s.rows(H - 5, [[11, 23], [8, 26], [6, 26], [6, 25], [7, 24], [7, 24], [7, 24], [7, 24]]);
      s.part('wine').rect(16, H - 6, 2, 1);
      if (!c.back) s.dot(10, H - 4, 'wine_2', 6, 1);
    },
    outfit(c) {
      // Paint drops on the sweater.
      const { s } = c;
      if (c.front || c.back) for (const [x, y, k] of [[12, 2, 'rose_1'], [18, 4, 'teal_2'], [14, 5, 'cream_1'], [19, 1, 'grey_2']] as const) s.dot(x, c.by + y, k);
      if (c.side) s.dot(16, c.by + 3, 'rose_1').dot(18, c.by + 5, 'teal_2');
    },
    carry: [{
      side: 'L', inProfile: true,
      draw(c, hx, hy, out) {
        // Takeaway coffee with a brown sleeve.
        const x = propX(hx, 4, out);
        c.s.part('cream').rect(x, hy - 2, 4, 5);
        c.s.dot(x, hy, 'brown_1', 4, 2);
        c.s.part('cream', { shade: 'flat' }).rect(x, hy - 3, 4, 1);
      },
    }],
  },
};

// ============================================================================
// 5. PUBLIC ENTRY POINTS
// ============================================================================
export type CharacterId = FounderSpecies | VendorKind | 'manager' | DistrictPedestrianKind;

function specOf(id: CharacterId): Spec {
  if (id in FOUNDERS) return FOUNDERS[id as FounderSpecies];
  if (id in VENDORS) return VENDORS[id as VendorKind];
  if (id === 'manager') return MANAGER;
  if (id in PEDS) return PEDS[id as DistrictPedestrianKind];
  throw new Error(`characterArt: no spec for "${id}"`);
}

/** Every character id this module draws (founders, shopkeepers, manager, passers-by). */
export const CHARACTER_IDS: readonly CharacterId[] = [
  ...(Object.keys(FOUNDERS) as FounderSpecies[]),
  ...(Object.keys(VENDORS) as VendorKind[]),
  'manager',
  ...(Object.keys(PEDS) as DistrictPedestrianKind[]),
];

/** Canvas width: 36 for passers-by (room for the dog and bags), 32 for everyone else. */
export function characterWidth(id: CharacterId): number {
  return specOf(id).ped ? 36 : 32;
}

/** One standing / walking frame, as palette keys. Pure: no canvas needed. */
export function characterPixels(id: CharacterId, frame: CharacterFrame = {}): CharacterPixels {
  return render(buildFigure(specOf(id), frame));
}

/** The knocked-out frame (taxi bonk): X eyes, dizzy skin, arms and feet flung out. */
export function knockedOutPixels(id: CharacterId): CharacterPixels {
  return render(buildFigure(specOf(id), { ko: true }));
}

/** A 32x32 head-and-shoulders portrait: the front idle figure without props, rows 1..32. */
export function portraitPixels(id: CharacterId): CharacterPixels {
  const full = render(buildFigure(specOf(id), { portrait: true }));
  const w = 32;
  const x0 = (full.w - w) / 2;
  const keys: (PalKey | null)[] = [];
  for (let y = 1; y < 33; y++) for (let x = 0; x < w; x++) keys.push(full.keys[y * full.w + x0 + x]);
  return { w, h: 32, keys, clipped: full.clipped };
}

/** Paint palette keys onto a fresh canvas (pixel-exact, no smoothing). */
export function paintPixels(p: CharacterPixels): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = p.w;
  canvas.height = p.h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('characterArt: 2D canvas context unavailable');
  ctx.imageSmoothingEnabled = false;
  const img = ctx.createImageData(p.w, p.h);
  p.keys.forEach((k, i) => {
    if (!k) return;
    const hex = PAL[k];
    img.data[i * 4] = parseInt(hex.slice(1, 3), 16);
    img.data[i * 4 + 1] = parseInt(hex.slice(3, 5), 16);
    img.data[i * 4 + 2] = parseInt(hex.slice(5, 7), 16);
    img.data[i * 4 + 3] = 255;
  });
  ctx.putImageData(img, 0, 0);
  return canvas;
}
