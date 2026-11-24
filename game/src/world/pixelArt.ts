import * as THREE from 'three';

function makeCanvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.imageSmoothingEnabled = false;
  return [canvas, ctx];
}

function toPixelTexture(
  canvas: HTMLCanvasElement,
  repeatX = 1,
  repeatY = 1
): THREE.CanvasTexture {
  const tex = new THREE.CanvasTexture(canvas);
  tex.magFilter = THREE.NearestFilter;
  tex.minFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.colorSpace = THREE.SRGBColorSpace;
  if (repeatX !== 1 || repeatY !== 1) {
    tex.wrapS = THREE.RepeatWrapping;
    tex.wrapT = THREE.RepeatWrapping;
    tex.repeat.set(repeatX, repeatY);
  }
  tex.needsUpdate = true;
  return tex;
}

// Deterministic tiny hash for subtle pixel grain
function hash2(x: number, y: number, seed = 13): number {
  const n = Math.sin(x * 127.1 + y * 311.7 + seed * 74.7) * 43758.5453;
  return n - Math.floor(n);
}

// Color manipulation helpers for cohesive JRPG HD-2D shading (warm highlights, cool-shifted shadows)
function parseHex(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  const full =
    clean.length === 3
      ? clean[0] + clean[0] + clean[1] + clean[1] + clean[2] + clean[2]
      : clean.slice(0, 6);
  const num = parseInt(full, 16);
  if (Number.isNaN(num)) return [128, 128, 128];
  return [(num >> 16) & 255, (num >> 8) & 255, num & 255];
}

function toHex(r: number, g: number, b: number): string {
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  return (
    '#' +
    ((1 << 24) + (clamp(r) << 16) + (clamp(g) << 8) + clamp(b)).toString(16).slice(1)
  );
}

function shadeHex(hex: string, amount: number, coolShift = 0): string {
  const [r, g, b] = parseHex(hex);
  const factor = 1 - amount;
  return toHex(r * factor - coolShift * 6, g * factor - coolShift * 2, b * factor + coolShift * 10);
}

function tintHex(hex: string, amount: number, warmShift = 0): string {
  const [r, g, b] = parseHex(hex);
  return toHex(
    r + (255 - r) * amount + warmShift * 10,
    g + (255 - g) * amount + warmShift * 6,
    b + (255 - b) * amount - warmShift * 4
  );
}

export function createSidewalkTexture(repeatX = 1, repeatY = 1): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(32, 32);
  ctx.fillStyle = '#d6cdb8';
  ctx.fillRect(0, 0, 32, 32);

  // Subtle concrete aggregate grain
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const r = hash2(x, y, 1);
      if (r < 0.14) {
        ctx.fillStyle = '#c8beaa';
        ctx.fillRect(x, y, 1, 1);
      } else if (r > 0.87) {
        ctx.fillStyle = '#e3dbc8';
        ctx.fillRect(x, y, 1, 1);
      } else if (r > 0.48 && r < 0.51) {
        ctx.fillStyle = '#beb39e';
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }

  // Expansion joints (2x2 concrete slabs)
  ctx.fillStyle = '#978d79';
  ctx.fillRect(0, 15, 32, 1);
  ctx.fillRect(15, 0, 1, 32);
  ctx.fillRect(0, 31, 32, 1);
  ctx.fillRect(31, 0, 1, 32);

  // Deep joint corner accents
  ctx.fillStyle = '#7e7462';
  ctx.fillRect(15, 15, 1, 1);
  ctx.fillRect(31, 15, 1, 1);
  ctx.fillRect(15, 31, 1, 1);
  ctx.fillRect(31, 31, 1, 1);

  // Top-left slab sunlit bevel highlights
  ctx.fillStyle = '#eae3d3';
  ctx.fillRect(1, 0, 14, 1);
  ctx.fillRect(16, 0, 15, 1);
  ctx.fillRect(1, 16, 14, 1);
  ctx.fillRect(16, 16, 15, 1);
  ctx.fillRect(0, 1, 1, 14);
  ctx.fillRect(16, 1, 1, 14);
  ctx.fillRect(0, 17, 1, 14);
  ctx.fillRect(16, 17, 1, 14);

  return toPixelTexture(c, repeatX, repeatY);
}

export function createAsphaltTexture(repeatX = 1, repeatY = 1): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(32, 32);
  ctx.fillStyle = '#393d46';
  ctx.fillRect(0, 0, 32, 32);

  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const r = hash2(x, y, 5);
      if (r < 0.18) {
        ctx.fillStyle = '#2f333b';
        ctx.fillRect(x, y, 1, 1);
      } else if (r > 0.85) {
        ctx.fillStyle = '#484d59';
        ctx.fillRect(x, y, 1, 1);
      } else if (r > 0.72 && r < 0.75) {
        ctx.fillStyle = '#535966';
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }
  return toPixelTexture(c, repeatX, repeatY);
}

export function createGrassTexture(repeatX = 1, repeatY = 1): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(32, 32);
  ctx.fillStyle = '#68a247';
  ctx.fillRect(0, 0, 32, 32);

  // Dappled meadow shading
  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const r = hash2(x, y, 9);
      if (r < 0.16) {
        ctx.fillStyle = '#548b38';
        ctx.fillRect(x, y, 1, 1);
      } else if (r > 0.81) {
        ctx.fillStyle = '#7fb956';
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }

  // Crisp JRPG pixel grass tufts
  const tufts = [
    [4, 6],
    [18, 4],
    [25, 14],
    [9, 21],
    [21, 25],
    [13, 12],
  ];
  for (const [tx, ty] of tufts) {
    ctx.fillStyle = '#497a30';
    ctx.fillRect(tx, ty + 2, 3, 1);
    ctx.fillStyle = '#97cf64';
    ctx.fillRect(tx, ty, 1, 2);
    ctx.fillRect(tx + 2, ty + 1, 1, 1);
    ctx.fillStyle = '#b4e37a';
    ctx.fillRect(tx + 1, ty, 1, 1);
  }

  // Tiny sunlit Central Park wildflowers
  ctx.fillStyle = '#fff5b8';
  ctx.fillRect(14, 26, 1, 1);
  ctx.fillRect(27, 8, 1, 1);
  ctx.fillStyle = '#ffd966';
  ctx.fillRect(6, 15, 1, 1);

  return toPixelTexture(c, repeatX, repeatY);
}

export function createParkPathTexture(repeatX = 1, repeatY = 1): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(32, 32);
  ctx.fillStyle = '#c8b08a';
  ctx.fillRect(0, 0, 32, 32);

  for (let y = 0; y < 32; y++) {
    for (let x = 0; x < 32; x++) {
      const r = hash2(x, y, 17);
      if (r < 0.18) {
        ctx.fillStyle = '#b1966d';
        ctx.fillRect(x, y, 1, 1);
      } else if (r > 0.83) {
        ctx.fillStyle = '#dcc7a2';
        ctx.fillRect(x, y, 1, 1);
      } else if (r > 0.45 && r < 0.48) {
        ctx.fillStyle = '#a0845c';
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }
  // Subtle stepping pebbles
  ctx.fillStyle = '#e5d4b3';
  ctx.fillRect(7, 9, 2, 1);
  ctx.fillRect(22, 18, 2, 1);
  ctx.fillRect(13, 27, 2, 1);
  return toPixelTexture(c, repeatX, repeatY);
}

export function createStoneWallTexture(repeatX = 1, repeatY = 1): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(32, 16);
  ctx.fillStyle = '#8b857b';
  ctx.fillRect(0, 0, 32, 16);

  // Stone block courses
  const rows = [3, 8, 12];
  rows.forEach((ry, idx) => {
    const offset = idx % 2 === 0 ? 0 : 4;
    const h = idx === 2 ? 4 : 5;
    for (let x = -4; x < 32; x += 8) {
      const bx = x + offset;
      const v = hash2(bx, ry, 23);
      ctx.fillStyle = v > 0.55 ? '#9f988c' : v < 0.25 ? '#847e74' : '#928b80';
      ctx.fillRect(bx + 1, ry + 1, 6, h - 1);
      ctx.fillStyle = '#b8b2a5';
      ctx.fillRect(bx + 1, ry + 1, 6, 1);
      ctx.fillStyle = '#655f56';
      ctx.fillRect(bx, ry, 8, 1);
      ctx.fillRect(bx, ry, 1, h);
    }
  });

  // Carved cap stone trim
  ctx.fillStyle = '#cfc9bc';
  ctx.fillRect(0, 0, 32, 2);
  ctx.fillStyle = '#e2ddd1';
  ctx.fillRect(0, 0, 32, 1);
  ctx.fillStyle = '#666057';
  ctx.fillRect(0, 2, 32, 1);

  // Tiny moss tufts along mortar
  ctx.fillStyle = '#5e8446';
  ctx.fillRect(5, 8, 2, 1);
  ctx.fillRect(21, 12, 2, 1);

  return toPixelTexture(c, repeatX, repeatY);
}

export function createBrownstoneFacadeTexture(
  baseHex = '#a6543a',
  darkHex = '#803d29',
  trimHex = '#d7c6ab',
  awningHex = '#2f6d52'
): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(64, 80);

  // Brick base with subtle per-brick tonal variation
  ctx.fillStyle = baseHex;
  ctx.fillRect(0, 0, 64, 80);
  const lightBrick = tintHex(baseHex, 0.14, 0.3);

  for (let y = 0; y < 56; y += 4) {
    const off = (y / 4) % 2 === 0 ? 0 : 4;
    for (let x = off - 4; x < 64; x += 8) {
      const r = hash2(x, y, 31);
      if (r > 0.72) {
        ctx.fillStyle = lightBrick;
        ctx.fillRect(x + 1, y + 1, 6, 3);
      } else if (r < 0.18) {
        ctx.fillStyle = shadeHex(baseHex, 0.12, 0.2);
        ctx.fillRect(x + 1, y + 1, 6, 3);
      }
    }
    ctx.fillStyle = darkHex;
    ctx.fillRect(0, y, 64, 1);
    for (let x = off; x < 64; x += 8) {
      ctx.fillRect(x, y, 1, 4);
    }
  }

  // Ornate roof cornice at top
  ctx.fillStyle = shadeHex(darkHex, 0.32, 0.2);
  ctx.fillRect(0, 0, 64, 7);
  ctx.fillStyle = tintHex(trimHex, 0.1, 0.2);
  ctx.fillRect(0, 0, 64, 1);
  ctx.fillStyle = trimHex;
  ctx.fillRect(0, 7, 64, 2);
  ctx.fillStyle = '#3c1e15';
  ctx.fillRect(0, 9, 64, 1);
  // Dentil brackets
  for (let x = 2; x < 64; x += 6) {
    ctx.fillStyle = darkHex;
    ctx.fillRect(x, 2, 3, 4);
    ctx.fillStyle = baseHex;
    ctx.fillRect(x, 2, 2, 2);
  }

  // Ground floor limestone rustication
  ctx.fillStyle = '#b9a68b';
  ctx.fillRect(0, 56, 64, 24);
  ctx.fillStyle = '#d4c3a8';
  ctx.fillRect(0, 56, 64, 1);
  for (let y = 60; y < 80; y += 5) {
    ctx.fillStyle = '#96836a';
    ctx.fillRect(0, y, 64, 1);
    ctx.fillStyle = '#cab79b';
    ctx.fillRect(0, y + 1, 64, 1);
  }

  // Upper floor windows (2 floors x 3 windows)
  const floorYs = [14, 35];
  const winXs = [8, 26, 44];
  for (const wy of floorYs) {
    for (const wx of winXs) {
      // Carved stone lintel & sill with shadow
      ctx.fillStyle = '#4a291e';
      ctx.fillRect(wx - 1, wy - 3, 14, 1);
      ctx.fillStyle = trimHex;
      ctx.fillRect(wx - 1, wy - 2, 14, 2);
      ctx.fillStyle = '#efe4cf';
      ctx.fillRect(wx - 1, wy - 2, 14, 1);
      ctx.fillStyle = trimHex;
      ctx.fillRect(wx - 1, wy + 13, 14, 2);
      ctx.fillStyle = '#70604c';
      ctx.fillRect(wx - 1, wy + 15, 14, 1);

      // Dark window frame
      ctx.fillStyle = '#29211e';
      ctx.fillRect(wx, wy, 12, 13);
      // Warm interior glass
      ctx.fillStyle = '#f2c977';
      ctx.fillRect(wx + 1, wy + 1, 10, 11);
      // Soft upper curtain shadow
      ctx.fillStyle = '#d9a456';
      ctx.fillRect(wx + 1, wy + 1, 10, 2);
      // Glass reflection + muntins
      ctx.fillStyle = '#fff3c4';
      ctx.fillRect(wx + 2, wy + 3, 3, 4);
      ctx.fillRect(wx + 7, wy + 8, 2, 3);
      ctx.fillStyle = '#473934';
      ctx.fillRect(wx + 5, wy + 1, 2, 11);
      ctx.fillRect(wx + 1, wy + 6, 10, 1);
    }
  }

  // Wrought-iron fire escape zig-zag on left/middle
  ctx.fillStyle = '#1e2128';
  ctx.fillRect(6, 26, 34, 2);
  ctx.fillRect(6, 47, 34, 2);
  for (let x = 8; x < 39; x += 4) {
    ctx.fillRect(x, 22, 1, 5);
    ctx.fillRect(x, 43, 1, 5);
  }
  ctx.fillStyle = '#363b47';
  ctx.fillRect(6, 22, 34, 1);
  ctx.fillRect(6, 43, 34, 1);
  ctx.fillStyle = '#1e2128';
  for (let i = 0; i < 18; i++) {
    ctx.fillRect(14 + Math.floor(i * 0.9), 28 + i, 2, 1);
  }

  // Ground floor storefront window (left)
  ctx.fillStyle = '#2b231f';
  ctx.fillRect(6, 61, 28, 16);
  ctx.fillStyle = '#9ac6d6';
  ctx.fillRect(8, 63, 24, 12);
  ctx.fillStyle = '#d4edf5';
  ctx.fillRect(10, 64, 5, 9);
  ctx.fillRect(17, 65, 2, 7);
  ctx.fillStyle = '#6c98ab';
  ctx.fillRect(8, 72, 24, 3);

  // Scalloped striped storefront awning
  for (let x = 5; x < 35; x += 4) {
    const isMain = (x - 5) % 8 === 0;
    ctx.fillStyle = isMain ? awningHex : '#f5edd9';
    ctx.fillRect(x, 57, 4, 5);
    ctx.fillStyle = isMain ? shadeHex(awningHex, 0.25) : '#d8cdb4';
    ctx.fillRect(x + 1, 61, 2, 1);
  }
  ctx.fillStyle = '#1d2026';
  ctx.fillRect(5, 62, 30, 1);

  // Paneled wood entrance door
  ctx.fillStyle = '#362116';
  ctx.fillRect(43, 60, 14, 20);
  ctx.fillStyle = '#6b4029';
  ctx.fillRect(45, 62, 10, 18);
  ctx.fillStyle = '#845236';
  ctx.fillRect(46, 63, 8, 1);
  ctx.fillStyle = '#f5d284';
  ctx.fillRect(47, 64, 6, 6);
  ctx.fillStyle = '#fff1be';
  ctx.fillRect(48, 65, 2, 3);
  ctx.fillStyle = '#53301e';
  ctx.fillRect(47, 72, 6, 6);
  ctx.fillStyle = '#f0cb69';
  ctx.fillRect(53, 72, 1, 2);

  return toPixelTexture(c);
}

export function createIronFenceTexture(repeatX = 1): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(16, 16);
  ctx.clearRect(0, 0, 16, 16);

  // Top & bottom horizontal bars with metallic rim
  ctx.fillStyle = '#1c2028';
  ctx.fillRect(0, 3, 16, 2);
  ctx.fillRect(0, 13, 16, 2);
  ctx.fillStyle = '#3a4252';
  ctx.fillRect(0, 3, 16, 1);

  // Vertical wrought-iron pickets + spear finials
  for (let x = 1; x < 16; x += 4) {
    ctx.fillStyle = '#232832';
    ctx.fillRect(x, 2, 2, 14);
    ctx.fillStyle = '#475164';
    ctx.fillRect(x, 1, 1, 2);
    ctx.fillRect(x, 5, 1, 8);
    ctx.fillStyle = '#14171d';
    ctx.fillRect(x + 1, 0, 1, 1);
  }
  return toPixelTexture(c, repeatX, 1);
}

export function createTreeSpriteTexture(variant: 'summer' | 'autumn' = 'summer'): THREE.CanvasTexture {
  // 48x60 preserves exact 4:5 aspect ratio with richer HD-2D foliage clusters & bark grain
  const [c, ctx] = makeCanvas(48, 60);
  ctx.clearRect(0, 0, 48, 60);

  const colors =
    variant === 'summer'
      ? {
          outline: '#182c1a',
          shadow: '#2b572a',
          mid: '#4b8e38',
          light: '#7cc450',
          top: '#aee36f',
          spark: '#d2f598',
        }
      : {
          outline: '#361d14',
          shadow: '#7a351c',
          mid: '#c45b26',
          light: '#eb9634',
          top: '#f8c852',
          spark: '#ffe694',
        };

  // Ground roots & trunk with bark shading
  ctx.fillStyle = '#2c1b12';
  ctx.fillRect(19, 36, 10, 21);
  ctx.fillRect(17, 54, 14, 4);
  ctx.fillStyle = '#5c3a24';
  ctx.fillRect(20, 36, 8, 20);
  ctx.fillRect(18, 55, 12, 2);
  ctx.fillStyle = '#7d5235';
  ctx.fillRect(21, 37, 4, 18);
  ctx.fillStyle = '#996a47';
  ctx.fillRect(21, 38, 2, 14);
  // Subtle bark crevices
  ctx.fillStyle = '#3f2617';
  ctx.fillRect(25, 41, 1, 5);
  ctx.fillRect(23, 47, 1, 6);
  ctx.fillRect(26, 49, 1, 5);

  // Layered pixel foliage clusters
  const blobs = [
    { x: 24, y: 22, r: 17, col: colors.outline },
    { x: 14, y: 28, r: 11, col: colors.outline },
    { x: 34, y: 28, r: 11, col: colors.outline },
    { x: 24, y: 12, r: 10, col: colors.outline },
    { x: 24, y: 22, r: 15.5, col: colors.shadow },
    { x: 14, y: 28, r: 9.5, col: colors.shadow },
    { x: 34, y: 28, r: 9.5, col: colors.shadow },
    { x: 24, y: 12, r: 8.5, col: colors.shadow },
    { x: 23, y: 19, r: 13, col: colors.mid },
    { x: 14, y: 25, r: 7.5, col: colors.mid },
    { x: 32, y: 25, r: 7.5, col: colors.mid },
    { x: 23, y: 11, r: 7, col: colors.mid },
    { x: 21, y: 15, r: 9, col: colors.light },
    { x: 14, y: 22, r: 4.8, col: colors.light },
    { x: 30, y: 21, r: 4.5, col: colors.light },
    { x: 20, y: 10, r: 5.5, col: colors.top },
    { x: 16, y: 18, r: 3.2, col: colors.top },
    { x: 27, y: 15, r: 3, col: colors.top },
    { x: 19, y: 8, r: 2.5, col: colors.spark },
  ];

  for (const b of blobs) {
    ctx.fillStyle = b.col;
    for (let y = Math.floor(b.y - b.r); y <= Math.ceil(b.y + b.r); y++) {
      for (let x = Math.floor(b.x - b.r); x <= Math.ceil(b.x + b.r); x++) {
        if (x < 0 || x >= 48 || y < 0 || y >= 60) continue;
        const d2 = (x - b.x) * (x - b.x) + (y - b.y) * (y - b.y);
        if (d2 <= b.r * b.r) {
          ctx.fillRect(x, y, 1, 1);
        }
      }
    }
  }

  // Dappled pixel leaf accents for hand-pixeled texture
  for (let y = 6; y < 38; y += 2) {
    for (let x = 6; x < 42; x += 2) {
      const r = hash2(x, y, variant === 'summer' ? 41 : 47);
      const dx = x - 24;
      const dy = y - 21;
      if (dx * dx + dy * dy < 185) {
        if (r > 0.91 && y < 22) {
          ctx.fillStyle = colors.spark;
          ctx.fillRect(x, y, 1, 1);
        } else if (r < 0.08 && y > 20) {
          ctx.fillStyle = colors.shadow;
          ctx.fillRect(x, y, 2, 1);
        }
      }
    }
  }

  return toPixelTexture(c);
}

// Tiny 3x5 pixel bitmap font for crisp chalkboard stand signs
const TINY_FONT: Record<string, string[]> = {
  A: ['010', '101', '111', '101', '101'],
  B: ['110', '101', '110', '101', '110'],
  C: ['011', '100', '100', '100', '011'],
  D: ['110', '101', '101', '101', '110'],
  E: ['111', '100', '110', '100', '111'],
  F: ['111', '100', '110', '100', '100'],
  G: ['011', '100', '101', '101', '011'],
  H: ['101', '101', '111', '101', '101'],
  I: ['111', '010', '010', '010', '111'],
  L: ['100', '100', '100', '100', '111'],
  M: ['101', '111', '111', '101', '101'],
  N: ['110', '101', '101', '101', '101'],
  O: ['010', '101', '101', '101', '010'],
  P: ['110', '101', '110', '100', '100'],
  R: ['110', '101', '110', '101', '101'],
  S: ['011', '100', '010', '001', '110'],
  T: ['111', '010', '010', '010', '010'],
  U: ['101', '101', '101', '101', '111'],
  V: ['101', '101', '101', '101', '010'],
  W: ['101', '101', '111', '111', '101'],
  Y: ['101', '101', '010', '010', '010'],
  $: ['010', '011', '010', '110', '010'],
  '2': ['110', '001', '010', '100', '111'],
  '3': ['110', '001', '010', '001', '110'],
  '4': ['101', '101', '111', '001', '001'],
  '5': ['111', '100', '110', '001', '110'],
  ' ': ['000', '000', '000', '000', '000'],
};

function drawTinyText(
  ctx: CanvasRenderingContext2D,
  text: string,
  startX: number,
  startY: number,
  color: string
) {
  ctx.fillStyle = color;
  let cx = startX;
  for (const ch of text.toUpperCase()) {
    const glyph = TINY_FONT[ch];
    if (glyph) {
      for (let r = 0; r < glyph.length; r++) {
        for (let col = 0; col < glyph[r].length; col++) {
          if (glyph[r][col] === '1') {
            ctx.fillRect(cx + col, startY + r, 1, 1);
          }
        }
      }
      cx += 4;
    } else {
      cx += 3;
    }
  }
}

export function createLemonadeStandFrontTexture(
  awningPrimary = '#f6c93b',
  signLabel = 'LEMONADE'
): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(64, 48);
  ctx.clearRect(0, 0, 64, 48);

  const primaryDark = shadeHex(awningPrimary, 0.25, 0.15);
  const primaryLight = tintHex(awningPrimary, 0.22, 0.25);

  // --- WOODEN COUNTER BODY (rich cedar planks & grain) ---
  ctx.fillStyle = '#3d2212';
  ctx.fillRect(2, 16, 60, 32);
  ctx.fillStyle = '#9c6233';
  ctx.fillRect(4, 18, 56, 28);

  // Vertical wood planks with grain & nail heads
  for (let x = 4; x < 60; x += 7) {
    const shade = hash2(x, 18, 53);
    ctx.fillStyle = shade > 0.6 ? '#ab6f3d' : shade < 0.3 ? '#8c562b' : '#9c6233';
    ctx.fillRect(x + 1, 18, 6, 28);
    // Warm sunlit left edge of each plank
    ctx.fillStyle = '#ba7e4a';
    ctx.fillRect(x + 1, 18, 1, 28);
    // Plank seam
    ctx.fillStyle = '#5e361a';
    ctx.fillRect(x, 18, 1, 28);
    // Tiny wood grain flecks
    ctx.fillStyle = '#7d4a23';
    ctx.fillRect(x + 3, 21 + ((x * 3) % 14), 1, 5);
    ctx.fillRect(x + 5, 31 + ((x * 5) % 10), 1, 4);
    // Iron nail heads top & bottom
    ctx.fillStyle = '#362013';
    ctx.fillRect(x + 3, 20, 1, 1);
    ctx.fillRect(x + 3, 43, 1, 1);
  }

  // Lower wooden baseboard trim & subtle ground shadow
  ctx.fillStyle = '#6b3e1e';
  ctx.fillRect(4, 44, 56, 2);
  ctx.fillStyle = '#472713';
  ctx.fillRect(2, 46, 60, 2);

  // Side corner wooden posts
  ctx.fillStyle = '#6e401e';
  ctx.fillRect(3, 16, 3, 30);
  ctx.fillRect(58, 16, 3, 30);
  ctx.fillStyle = '#b57845';
  ctx.fillRect(4, 17, 1, 28);
  ctx.fillRect(59, 17, 1, 28);

  // --- BEVELED COUNTERTOP OVERHANG & CORBEL BRACKETS ---
  ctx.fillStyle = '#4a2914';
  ctx.fillRect(0, 14, 64, 5);
  ctx.fillStyle = '#d49a5c';
  ctx.fillRect(1, 15, 62, 2);
  ctx.fillStyle = '#e8b678';
  ctx.fillRect(1, 15, 62, 1);
  ctx.fillStyle = '#8a5428';
  ctx.fillRect(1, 17, 62, 1);
  // Cast shadow beneath countertop lip
  ctx.fillStyle = 'rgba(28, 14, 6, 0.45)';
  ctx.fillRect(4, 19, 56, 2);
  // Decorative wooden shelf corbels
  ctx.fillStyle = '#573117';
  ctx.fillRect(6, 19, 3, 4);
  ctx.fillRect(55, 19, 3, 4);
  ctx.fillStyle = '#a86b3a';
  ctx.fillRect(7, 19, 1, 3);
  ctx.fillRect(56, 19, 1, 3);

  // --- FRAMED CHALKBOARD PRICE SIGN WITH PIXEL LEMON ART ---
  // Outer wooden frame
  ctx.fillStyle = '#3b2111';
  ctx.fillRect(10, 23, 44, 19);
  ctx.fillStyle = '#b87b46';
  ctx.fillRect(11, 24, 42, 17);
  ctx.fillStyle = '#d69d63';
  ctx.fillRect(11, 24, 42, 1);
  // Slate chalkboard interior
  ctx.fillStyle = '#202d28';
  ctx.fillRect(13, 26, 38, 13);
  ctx.fillStyle = '#283832';
  ctx.fillRect(14, 27, 36, 11);
  // Chalk inner corner flourishes
  ctx.fillStyle = '#a8bfb4';
  ctx.fillRect(14, 27, 2, 1);
  ctx.fillRect(48, 27, 2, 1);
  ctx.fillRect(14, 37, 2, 1);
  ctx.fillRect(48, 37, 2, 1);

  // Pixel lemon illustration on left of chalkboard
  ctx.fillStyle = '#3d6e2c';
  ctx.fillRect(17, 28, 3, 1); // leaf
  ctx.fillStyle = '#6bbf44';
  ctx.fillRect(18, 28, 2, 1);
  ctx.fillStyle = '#d99a16';
  ctx.fillRect(15, 30, 7, 5);
  ctx.fillStyle = '#ffe047';
  ctx.fillRect(16, 29, 5, 7);
  ctx.fillRect(15, 31, 7, 3);
  ctx.fillStyle = '#fff6a6';
  ctx.fillRect(17, 30, 2, 2); // gleam

  // Crisp chalk lettering (clamped to fit inside chalkboard)
  const cleanLabel = signLabel.trim().slice(0, 6) || 'FRESH';
  drawTinyText(ctx, cleanLabel, 24, 28, '#fff7d6');
  // Subtle chalk divider + price callout
  ctx.fillStyle = '#7ea392';
  ctx.fillRect(24, 34, 23, 1);
  drawTinyText(ctx, '$3', 32, 35, '#ffe066');

  // --- SCALLOPED STRIPED AWNING VALANCE ACROSS TOP ---
  const stripeW = 8;
  for (let x = 0; x < 64; x += stripeW) {
    const isPrimary = (x / stripeW) % 2 === 0;
    const baseCol = isPrimary ? awningPrimary : '#fff8e7';
    const shadeCol = isPrimary ? primaryDark : '#dfd4bc';
    const hiCol = isPrimary ? primaryLight : '#ffffff';

    // Upper valance body
    ctx.fillStyle = baseCol;
    ctx.fillRect(x, 0, stripeW, 9);
    // Subtle sunlit highlight & fold edge
    ctx.fillStyle = hiCol;
    ctx.fillRect(x + 1, 0, 2, 8);
    ctx.fillStyle = shadeCol;
    ctx.fillRect(x + stripeW - 1, 0, 1, 9);

    // Rounded scalloped bottom tab
    ctx.fillStyle = baseCol;
    ctx.fillRect(x + 1, 9, stripeW - 2, 2);
    ctx.fillRect(x + 2, 11, stripeW - 4, 1);
    ctx.fillStyle = shadeCol;
    ctx.fillRect(x + 1, 10, stripeW - 2, 1);
    // Crisp dark outline under scallop
    ctx.fillStyle = '#2d1c12';
    ctx.fillRect(x, 9, 1, 1);
    ctx.fillRect(x + stripeW - 1, 9, 1, 1);
    ctx.fillRect(x + 1, 11, 1, 1);
    ctx.fillRect(x + stripeW - 2, 11, 1, 1);
    ctx.fillRect(x + 2, 12, stripeW - 4, 1);
  }

  return toPixelTexture(c);
}

export function createAwningRoofTexture(
  primaryHex = '#f6c93b',
  repeatX = 1,
  repeatY = 1
): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(64, 64);
  const darkPrimary = shadeHex(primaryHex, 0.24, 0.15);
  const lightPrimary = tintHex(primaryHex, 0.2, 0.25);
  const creamBase = '#fff7e5';
  const creamDark = '#ded3ba';
  const creamLight = '#ffffff';

  const stripeW = 8;
  for (let x = 0; x < 64; x += stripeW) {
    const isPrimary = (x / stripeW) % 2 === 0;
    const base = isPrimary ? primaryHex : creamBase;
    const dark = isPrimary ? darkPrimary : creamDark;
    const light = isPrimary ? lightPrimary : creamLight;

    ctx.fillStyle = base;
    ctx.fillRect(x, 0, stripeW, 64);
    // Soft canopy rib highlight & fold crease
    ctx.fillStyle = light;
    ctx.fillRect(x + 1, 0, 2, 60);
    ctx.fillStyle = dark;
    ctx.fillRect(x + stripeW - 1, 0, 1, 64);

    // Subtle canvas weave pixel dither
    for (let y = 0; y < 60; y += 2) {
      if ((y / 2) % 2 === 0) {
        ctx.fillStyle = dark;
        ctx.fillRect(x + 4, y, 1, 1);
      }
    }

    // Bottom valance trim accent
    ctx.fillStyle = dark;
    ctx.fillRect(x, 58, stripeW, 2);
    ctx.fillStyle = isPrimary ? '#362112' : '#574a38';
    ctx.fillRect(x, 62, stripeW, 2);
  }

  // Sunlit top ridge gradient strip
  ctx.fillStyle = 'rgba(255, 250, 232, 0.18)';
  ctx.fillRect(0, 0, 64, 10);

  return toPixelTexture(c, repeatX, repeatY);
}

export function createLemonCrateTexture(): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(32, 32);

  // Dark crate interior backing (visible through slat gaps)
  ctx.fillStyle = '#3b2414';
  ctx.fillRect(0, 0, 32, 32);

  // Plump pixel lemons peeking through the top & slat gaps
  const lemons = [
    [5, 4],
    [12, 3],
    [19, 4],
    [25, 5],
    [8, 12],
    [16, 12],
    [23, 12],
  ];
  for (const [lx, ly] of lemons) {
    ctx.fillStyle = '#c98b12';
    ctx.fillRect(lx, ly, 5, 4);
    ctx.fillStyle = '#ffe042';
    ctx.fillRect(lx + 1, ly, 3, 4);
    ctx.fillRect(lx, ly + 1, 5, 2);
    ctx.fillStyle = '#fff8a8';
    ctx.fillRect(lx + 1, ly + 1, 2, 1);
  }
  // Tiny green lemon leaves
  ctx.fillStyle = '#4e9634';
  ctx.fillRect(10, 3, 2, 2);
  ctx.fillRect(23, 3, 2, 2);

  // Horizontal wooden crate slats (bottom, middle, upper)
  const slats = [
    { y: 7, h: 5 },
    { y: 15, h: 6 },
    { y: 24, h: 6 },
  ];
  for (const s of slats) {
    ctx.fillStyle = '#9c6334';
    ctx.fillRect(2, s.y, 28, s.h);
    ctx.fillStyle = '#bd804a';
    ctx.fillRect(2, s.y, 28, 1);
    ctx.fillStyle = '#6e421e';
    ctx.fillRect(2, s.y + s.h - 1, 28, 1);
    // Subtle wood grain
    ctx.fillStyle = '#824f26';
    ctx.fillRect(7, s.y + 2, 6, 1);
    ctx.fillRect(18, s.y + 3, 7, 1);
  }

  // Sturdy vertical corner posts
  ctx.fillStyle = '#472814';
  ctx.fillRect(0, 0, 4, 32);
  ctx.fillRect(28, 0, 4, 32);
  ctx.fillStyle = '#8c562b';
  ctx.fillRect(1, 1, 2, 30);
  ctx.fillRect(29, 1, 2, 30);
  ctx.fillStyle = '#b57743';
  ctx.fillRect(1, 1, 1, 30);
  ctx.fillRect(29, 1, 1, 30);

  // Iron nail heads on corner posts
  ctx.fillStyle = '#261a14';
  for (const ny of [9, 17, 26]) {
    ctx.fillRect(2, ny, 1, 1);
    ctx.fillRect(29, ny, 1, 1);
  }

  // Bottom rim shadow
  ctx.fillStyle = '#2d180c';
  ctx.fillRect(0, 30, 32, 2);

  return toPixelTexture(c);
}

export function createParkBenchTexture(): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(48, 32);

  // Dark gap backing between timber slats
  ctx.fillStyle = '#251a14';
  ctx.fillRect(0, 0, 48, 32);

  // 4 classic Central Park weathered hardwood slats
  const slatYs = [1, 9, 17, 25];
  for (const sy of slatYs) {
    ctx.fillStyle = '#7c4e2d';
    ctx.fillRect(0, sy, 48, 6);
    // Sunlit top bevel
    ctx.fillStyle = '#a36c42';
    ctx.fillRect(0, sy, 48, 1);
    ctx.fillStyle = '#8f5b35';
    ctx.fillRect(0, sy + 1, 48, 1);
    // Underside shadow
    ctx.fillStyle = '#57341c';
    ctx.fillRect(0, sy + 5, 48, 1);

    // Subtle wood grain streaks
    for (let x = 2; x < 46; x += 6) {
      const r = hash2(x, sy, 67);
      ctx.fillStyle = r > 0.5 ? '#694023' : '#96613a';
      ctx.fillRect(x, sy + 2 + (x % 2), 4, 1);
    }
  }

  // Cast-iron bench straps & bolt heads (left, center, right)
  const strapXs = [5, 23, 41];
  for (const sx of strapXs) {
    ctx.fillStyle = '#232830';
    ctx.fillRect(sx, 0, 2, 32);
    ctx.fillStyle = '#47505e';
    for (const sy of slatYs) {
      ctx.fillRect(sx, sy + 2, 2, 2); // iron carriage bolts
    }
  }

  return toPixelTexture(c);
}

export function createPitcherTexture(): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(20, 24);
  ctx.clearRect(0, 0, 20, 24);

  const px = (x: number, y: number, w: number, h: number, col: string) => {
    ctx.fillStyle = col;
    ctx.fillRect(x, y, w, h);
  };

  // Subtle base contact shadow
  px(4, 22, 10, 2, 'rgba(20, 26, 36, 0.25)');

  // Pitcher dark glass outline & curved handle
  const outline = '#22313f';
  // Spout + top rim
  px(2, 3, 12, 2, outline);
  px(3, 2, 10, 2, outline);
  // Glass body
  px(3, 4, 11, 18, outline);
  px(4, 21, 9, 2, outline);
  // Curved glass handle on right
  px(14, 6, 4, 2, outline);
  px(16, 7, 2, 9, outline);
  px(14, 15, 4, 2, outline);
  px(15, 7, 2, 1, '#a9d8eb');
  px(16, 8, 1, 7, '#ccebf7');

  // Translucent ice-blue glass interior
  px(4, 4, 9, 17, '#c7ebf8');
  px(3, 4, 2, 2, '#dff5fc'); // pouring spout highlight
  px(5, 3, 7, 1, '#ffffff'); // gleaming rim

  // Bright golden lemonade liquid fill
  px(4, 9, 9, 11, '#f7cd2e');
  px(4, 17, 9, 3, '#e3a617'); // richer depth at bottom
  px(4, 9, 9, 2, '#ffe96b'); // bright meniscus surface

  // Floating lemon slice (rind + bright segments)
  px(5, 11, 5, 4, '#d99014');
  px(6, 11, 3, 4, '#fff27a');
  px(5, 12, 5, 2, '#fff27a');
  px(7, 12, 1, 2, '#fffce0');

  // Second submerged lemon wedge
  px(9, 15, 3, 3, '#d99014');
  px(10, 15, 2, 2, '#fff38a');

  // Bobbing ice cubes near surface
  px(9, 9, 3, 3, '#d4f3ff');
  px(10, 9, 2, 1, '#ffffff');
  px(5, 8, 3, 2, '#dff7ff');
  px(5, 8, 1, 1, '#ffffff');

  // Crisp vertical glass specular gleam along left side
  px(5, 5, 1, 14, '#ffffff');
  px(6, 6, 1, 6, 'rgba(255, 255, 255, 0.72)');
  // Right edge cool glass refraction
  px(12, 5, 1, 15, '#9ed2e6');

  // Thick glass base reflection
  px(5, 20, 7, 1, '#dff5fc');

  return toPixelTexture(c);
}

// ============================================================================
// FRIENDLY HUMAN GROWTOPIA-STYLE CHIBIS (clean hairstyles, 2 symmetrical eyes)
// ============================================================================

export type FounderSpecies = 'squirrel' | 'shiba' | 'panda' | 'penguin' | 'bunny';

export interface FounderOption {
  id: FounderSpecies;
  name: string;
  title: string;
  tagline: string;
  accent: string;
}

export const FOUNDER_CATALOG: FounderOption[] = [
  {
    id: 'squirrel',
    name: 'Alex',
    title: 'Central Park Hustler',
    tagline: 'Spiky chestnut hair, sunny tee, relentless cash flow.',
    accent: '#f0b429',
  },
  {
    id: 'shiba',
    name: 'Maya',
    title: 'Neighborhood Strategist',
    tagline: 'Dark-brown bob, coral cardigan, sharp unit economics.',
    accent: '#eb6e5b',
  },
  {
    id: 'panda',
    name: 'Leo',
    title: 'Campus Founder',
    tagline: 'Fluffy curls, varsity hoodie, beating the 5% hurdle.',
    accent: '#49b065',
  },
  {
    id: 'penguin',
    name: 'Sam',
    title: 'Uptown Operator',
    tagline: 'Blonde hair, NYC cap, teal jacket, icy pricing power.',
    accent: '#3e88c9',
  },
  {
    id: 'bunny',
    name: 'Claire',
    title: 'Wall St. Analyst',
    tagline: 'Auburn ponytail, navy blazer, disciplined ROIC.',
    accent: '#4a6499',
  },
];

interface HumanChibiStyle {
  outline: string;
  skin: string;
  skinShade: string;
  skinLight: string;
  hair: string;
  hairShade: string;
  hairLight: string;
  shirt: string;
  shirtShade: string;
  shirtLight: string;
  shirtAccent: string;
  pants: string;
  shoe: string;
  cheek: string;
}

const HUMAN_CHIBI_STYLES: Record<FounderSpecies, HumanChibiStyle> = {
  // Alex: warm chestnut spiky hair, sunny yellow-striped tee, jeans
  squirrel: {
    outline: '#2b2118',
    skin: '#f8cca4',
    skinShade: '#e3ac82',
    skinLight: '#ffe2c7',
    hair: '#7a4424',
    hairShade: '#542c16',
    hairLight: '#a66338',
    shirt: '#f5c542',
    shirtShade: '#d49d20',
    shirtLight: '#ffe380',
    shirtAccent: '#fff9e6',
    pants: '#42638f',
    shoe: '#6b422a',
    cheek: '#f6a2a8',
  },
  // Maya: dark-brown bob with gold clip, coral cardigan, dark pants
  shiba: {
    outline: '#2b2118',
    skin: '#f4c49c',
    skinShade: '#dda379',
    skinLight: '#ffdec2',
    hair: '#472c22',
    hairShade: '#2e1b14',
    hairLight: '#6e4738',
    shirt: '#eb6e5b',
    shirtShade: '#c24d3c',
    shirtLight: '#ff9685',
    shirtAccent: '#fff6e8',
    pants: '#343847',
    shoe: '#52342c',
    cheek: '#f79ea8',
  },
  // Leo: fluffy curly dark hair, varsity green/cream hoodie, sneakers
  panda: {
    outline: '#2b2118',
    skin: '#e5b085',
    skinShade: '#c98e63',
    skinLight: '#f7cba4',
    hair: '#332826',
    hairShade: '#211918',
    hairLight: '#54423f',
    shirt: '#3f9e59',
    shirtShade: '#2a753f',
    shirtLight: '#68c480',
    shirtAccent: '#f7f1de',
    pants: '#36465e',
    shoe: '#f2f4f7',
    cheek: '#e8908e',
  },
  // Sam: blonde hair + navy NYC cap, teal jacket, jeans
  penguin: {
    outline: '#2b2118',
    skin: '#fad0ab',
    skinShade: '#e3af86',
    skinLight: '#ffe6cf',
    hair: '#e6b84c',
    hairShade: '#b8892a',
    hairLight: '#fae08c',
    shirt: '#2e8a8a',
    shirtShade: '#1e6363',
    shirtLight: '#52b0b0',
    shirtAccent: '#f5f7fa',
    pants: '#3f5b82',
    shoe: '#3a4252',
    cheek: '#f7a6ad',
  },
  // Claire: warm auburn ponytail, Wall St. navy blazer + white collar, slacks
  bunny: {
    outline: '#2b2118',
    skin: '#f7c9a3',
    skinShade: '#dfa67d',
    skinLight: '#ffe1c7',
    hair: '#9c4328',
    hairShade: '#6e2b18',
    hairLight: '#c96240',
    shirt: '#2c3d63',
    shirtShade: '#1d2945',
    shirtLight: '#445b8c',
    shirtAccent: '#f7f8fc',
    pants: '#2b3140',
    shoe: '#382a26',
    cheek: '#f59fa8',
  },
};

// ============================================================================
// SHOPKEEPERS: the seller and the three market vendors.
//
// Founders are what the PLAYER picks, so a vendor that wore a founder's face would
// look like the player's twin. Vendors get their own faces and, more importantly, a
// "this person runs a shop" read at a glance: a full-width shop apron in a bold colour
// plus a different hat for each trade (visor, flat cap, bandana, straw hat).
// ============================================================================

/** The four shopkeeper looks. Each id names the trade, not a person. */
export type VendorKind = 'broker' | 'carpenter' | 'glazier' | 'grower';

type VendorHat = 'visor' | 'flatcap' | 'bandana' | 'straw';

interface VendorStyle extends HumanChibiStyle {
  hat: VendorHat;
  hatMain: string;
  hatLight: string;
  hatDark: string;
  apron: string;
  apronShade: string;
  /** Colour of the little chest emblem and the pocket stitching. */
  apronTrim: string;
}

const VENDOR_STYLES: Record<VendorKind, VendorStyle> = {
  // Stand broker (the seller): green visor, forest-green apron over a white shirt.
  broker: {
    outline: '#2b2118',
    skin: '#d8a279',
    skinShade: '#bd8460',
    skinLight: '#ecbb94',
    hair: '#2f2a2a',
    hairShade: '#1e1a1a',
    hairLight: '#4a4343',
    shirt: '#f4f1e8',
    shirtShade: '#d9d4c4',
    shirtLight: '#ffffff',
    shirtAccent: '#ffffff',
    pants: '#3a3f4d',
    shoe: '#2f2a28',
    cheek: '#e8957f',
    hat: 'visor',
    hatMain: '#2f8f63',
    hatLight: '#58b98a',
    hatDark: '#1d6342',
    apron: '#2f7d5b',
    apronShade: '#1f5a41',
    apronTrim: '#f2d36b',
  },
  // Stall-kit carpenter: tan flat cap, leather-brown apron with a tool pocket.
  carpenter: {
    outline: '#2b2118',
    skin: '#f1c3a0',
    skinShade: '#d9a37e',
    skinLight: '#fddcc0',
    hair: '#b4532a',
    hairShade: '#8a3b1b',
    hairLight: '#d97a4a',
    shirt: '#8a5a3a',
    shirtShade: '#6b4429',
    shirtLight: '#a8754f',
    shirtAccent: '#c9a27a',
    pants: '#4a4036',
    shoe: '#3a2c22',
    cheek: '#f2a08f',
    hat: 'flatcap',
    hatMain: '#c9a269',
    hatLight: '#e3c58f',
    hatDark: '#8f6c3a',
    apron: '#b9823f',
    apronShade: '#8b5e27',
    apronTrim: '#fff0c2',
  },
  // Glassware seller: white bandana with blue dots, cobalt apron.
  glazier: {
    outline: '#2b2118',
    skin: '#8d5a3b',
    skinShade: '#744529',
    skinLight: '#a87350',
    hair: '#1f1b1b',
    hairShade: '#141111',
    hairLight: '#3a3333',
    shirt: '#dbe9f5',
    shirtShade: '#b9cfe2',
    shirtLight: '#f2f8fd',
    shirtAccent: '#ffffff',
    pants: '#2d3442',
    shoe: '#262230',
    cheek: '#c97a6a',
    hat: 'bandana',
    hatMain: '#f2f7ff',
    hatLight: '#3f7fc4',
    hatDark: '#c4d4e6',
    apron: '#2f6fb0',
    apronShade: '#214f82',
    apronTrim: '#ffffff',
  },
  // Lemon grower: wide straw hat with a green band, sunny-yellow apron.
  grower: {
    outline: '#2b2118',
    skin: '#f5d0b0',
    skinShade: '#dcad88',
    skinLight: '#ffe6cd',
    hair: '#b7b2a6',
    hairShade: '#948f84',
    hairLight: '#d6d2c8',
    shirt: '#fff6c8',
    shirtShade: '#e6d9a0',
    shirtLight: '#ffffff',
    shirtAccent: '#ffffff',
    pants: '#5a6b48',
    shoe: '#5a4430',
    cheek: '#f4a5a0',
    hat: 'straw',
    hatMain: '#e9cf7a',
    hatLight: '#f7e7a6',
    hatDark: '#58a55c',
    apron: '#f2c230',
    apronShade: '#c79a14',
    apronTrim: '#58a55c',
  },
};

/** Every drawable person: a founder (player) or a shopkeeper. */
type CharacterId = FounderSpecies | VendorKind;

const CHARACTER_STYLES: Record<CharacterId, HumanChibiStyle> = { ...HUMAN_CHIBI_STYLES, ...VENDOR_STYLES };

function isVendorKind(id: CharacterId): id is VendorKind {
  return id in VENDOR_STYLES;
}

/**
 * A resting pose for a character who is standing still. Both flags default to false,
 * which is the normal standing frame.
 *   breathe     - the whole upper body (torso + head) sits 1 pixel lower, the "exhale" half
 *                 of a slow breathing loop. The feet stay planted.
 *   eyesClosed  - the eyes are drawn as a closed lid line, for blinking.
 */
export interface IdlePose {
  breathe?: boolean;
  eyesClosed?: boolean;
}

/** The three frames an idle character cycles through. */
export type IdleFrameKey = 'rest' | 'breathe' | 'blink';

export const IDLE_POSES: Record<IdleFrameKey, IdlePose> = {
  rest: {},
  breathe: { breathe: true },
  blink: { eyesClosed: true },
};

const BREATH_PERIOD_S = 2.6;
const BLINK_HOLD_S = 0.16;

/**
 * Which idle frame should show at time `t` (seconds)?  Pure and deterministic, so it is
 * unit-tested without a canvas.
 *
 *   - A blink happens once per "blink period" and lasts BLINK_HOLD_S. The period is
 *     3..4 seconds, derived from `seed`, so several shopkeepers standing side by side do
 *     not all blink in unison (which looks robotic).
 *   - Between blinks the character breathes: half of every BREATH_PERIOD_S is 'rest', the
 *     other half is 'breathe' (1px lower).
 *   - A blink always wins over a breath.
 */
export function idleFrameAt(t: number, seed = 0): IdleFrameKey {
  const frac = seed - Math.floor(seed);
  const blinkPeriod = 3 + frac; // 3.0 .. 4.0 s
  const blinkClock = (((t + seed * 1.7) % blinkPeriod) + blinkPeriod) % blinkPeriod;
  if (blinkClock > blinkPeriod - BLINK_HOLD_S) return 'blink';
  const breathClock = (((t + seed) % BREATH_PERIOD_S) + BREATH_PERIOD_S) % BREATH_PERIOD_S;
  return breathClock > BREATH_PERIOD_S / 2 ? 'breathe' : 'rest';
}

/** How a queued customer feels, from how much patience they have left (0..1). */
export type QueueMood = 'happy' | 'neutral' | 'angry';

/**
 * Same thresholds as the patience bar's colour (WorldOverlays.patienceColor): plenty left
 * is green, getting low is amber, nearly gone is red. Keeping the two in step means the
 * face above a customer's head and the bar beside it never disagree.
 */
export function moodForPatience(ratio: number): QueueMood {
  return ratio > 0.55 ? 'happy' : ratio > 0.28 ? 'neutral' : 'angry';
}

function drawRoundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  col: string
) {
  ctx.fillStyle = col;
  ctx.fillRect(x + 1, y, w - 2, h);
  ctx.fillRect(x, y + 1, w, h - 2);
}

function drawFriendlyHumanHead(
  ctx: CanvasRenderingContext2D,
  species: CharacterId,
  hx: number,
  hy: number,
  facing: 'down' | 'up' | 'left' | 'right',
  eyesClosed = false
) {
  const s = CHARACTER_STYLES[species];
  const px = (x: number, y: number, w: number, h: number, col: string) => {
    ctx.fillStyle = col;
    ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  };

  const faceShift = facing === 'left' ? -1 : facing === 'right' ? 1 : 0;

  // --- BACK PONYTAIL (Claire) drawn behind head ---
  if (species === 'bunny') {
    const tailX = facing === 'left' ? hx + 16 : facing === 'right' ? hx - 2 : hx + 15;
    drawRoundedRect(ctx, tailX, hy + 5, 6, 9, s.outline);
    px(tailX + 1, hy + 6, 4, 7, s.hair);
    px(tailX + 2, hy + 6, 2, 3, s.hairLight);
    px(tailX + 1, hy + 11, 4, 2, s.hairShade);
    // Gold hair tie
    px(tailX + 1, hy + 6, 2, 2, '#f2c138');
  }

  // --- CLEAN ROUNDED CHIBI HEAD (18w x 16h) ---
  // Soft warm dark-brown outline (#2b2118)
  px(hx + 2, hy, 14, 16, s.outline);
  px(hx + 1, hy + 1, 16, 14, s.outline);
  px(hx, hy + 3, 18, 10, s.outline);

  // Warm human skin fill
  px(hx + 2, hy + 1, 14, 14, s.skin);
  px(hx + 1, hy + 3, 16, 10, s.skin);
  px(hx + 4, hy + 2, 10, 2, s.skinLight);
  px(hx + 2, hy + 13, 14, 2, s.skinShade);

  // --- BACK OF HEAD (facing === 'up') ---
  if (facing === 'up') {
    px(hx + 1, hy + 1, 16, 13, s.hair);
    px(hx + 2, hy + 11, 14, 3, s.hairShade);
    px(hx + 4, hy + 3, 10, 2, s.hairLight);
    if (isVendorKind(species)) {
      drawVendorHeadwear(ctx, VENDOR_STYLES[species], hx, hy, 'up', 0);
    } else if (species === 'penguin') {
      // Back of navy NYC cap with snapback strap
      px(hx + 1, hy - 2, 16, 7, s.outline);
      px(hx + 2, hy - 1, 14, 5, '#243c6b');
      px(hx + 4, hy - 1, 10, 2, '#3d5e9c');
      px(hx + 6, hy + 3, 6, 2, '#f5f2e8');
    } else if (species === 'bunny') {
      // Centered back ponytail
      drawRoundedRect(ctx, hx + 6, hy + 7, 6, 9, s.outline);
      px(hx + 7, hy + 8, 4, 7, s.hair);
      px(hx + 8, hy + 8, 2, 3, s.hairLight);
      px(hx + 7, hy + 7, 4, 2, '#f2c138');
    }
    return;
  }

  // --- TWO SYMMETRICAL FRIENDLY EYES (ALWAYS BOTH VISIBLE on down/left/right!) ---
  const drawFriendlyEye = (ex: number, ey: number, pupilDx: number) => {
    if (eyesClosed) {
      // Blink: a skin-coloured lid over the eye with a dark lash line along its bottom edge.
      px(ex, ey - 1, 3, 1, s.outline);
      px(ex, ey, 3, 2, s.skin);
      px(ex, ey + 2, 3, 1, s.outline);
      return;
    }
    // Soft dark-brown top lash / frame
    px(ex, ey - 1, 3, 1, s.outline);
    // Crisp 3x4 white sclera
    px(ex, ey, 3, 4, '#ffffff');
    // Warm dark 2x3 pupil
    px(ex + pupilDx, ey + 1, 2, 3, '#261e1c');
    // Friendly 1px white sparkle glint in upper-left of pupil
    px(ex + pupilDx, ey + 1, 1, 1, '#ffffff');
  };

  const leftEyeX = hx + 3 + faceShift;
  const rightEyeX = hx + 12 + faceShift;
  const eyeY = hy + 7;
  const leftPupilDx = facing === 'left' ? 0 : 1;
  const rightPupilDx = facing === 'right' ? 1 : 0;

  drawFriendlyEye(leftEyeX, eyeY, leftPupilDx);
  drawFriendlyEye(rightEyeX, eyeY, rightPupilDx);

  // Soft rosy blush cheeks
  px(hx + 2 + faceShift, hy + 11, 2, 1, s.cheek);
  px(hx + 14 + faceShift, hy + 11, 2, 1, s.cheek);

  // Cute small warm smile (never harsh black!)
  px(hx + 7 + faceShift, hy + 12, 4, 1, '#8c5342');
  px(hx + 8 + faceShift, hy + 13, 2, 1, '#b57360');

  // --- DISTINCT HUMAN HAIRSTYLES ---
  if (isVendorKind(species)) {
    drawVendorHeadwear(ctx, VENDOR_STYLES[species], hx, hy, facing, faceShift);
  } else if (species === 'squirrel') {
    // ALEX: Warm chestnut spiky hair
    px(hx + 1, hy - 2, 16, 7, s.outline);
    px(hx + 4, hy - 4, 4, 3, s.outline);
    px(hx + 10, hy - 3, 4, 2, s.outline);
    px(hx, hy + 1, 18, 5, s.outline);
    // Main hair fill
    px(hx + 2, hy - 1, 14, 6, s.hair);
    px(hx + 1, hy + 1, 16, 4, s.hair);
    // Spiky top tufts
    px(hx + 5, hy - 3, 2, 3, s.hair);
    px(hx + 11, hy - 2, 2, 2, s.hair);
    // Highlight band + spiky bangs
    px(hx + 4, hy, 10, 2, s.hairLight);
    px(hx + 3, hy + 4, 3, 2, s.hair);
    px(hx + 8, hy + 4, 3, 2, s.hair);
    px(hx + 13, hy + 4, 2, 2, s.hair);
    // Sideburns
    px(hx + 1, hy + 5, 2, 3, s.hairShade);
    px(hx + 15, hy + 5, 2, 3, s.hairShade);
  } else if (species === 'shiba') {
    // MAYA: Cute dark-brown bob hair with gleaming gold hair clip
    px(hx + 1, hy - 2, 16, 7, s.outline);
    px(hx - 1, hy + 2, 4, 12, s.outline);
    px(hx + 15, hy + 2, 4, 12, s.outline);
    // Crown & side bob locks
    px(hx + 2, hy - 1, 14, 6, s.hair);
    px(hx + 1, hy + 1, 16, 4, s.hair);
    px(hx, hy + 3, 3, 10, s.hair);
    px(hx + 15, hy + 3, 3, 10, s.hair);
    px(hx, hy + 10, 3, 3, s.hairShade);
    px(hx + 15, hy + 10, 3, 3, s.hairShade);
    // Soft swept bangs + shine
    px(hx + 4, hy, 10, 2, s.hairLight);
    px(hx + 3, hy + 4, 6, 2, s.hair);
    px(hx + 11, hy + 4, 4, 2, s.hair);
    // Cute gold hair clip on right temple
    px(hx + 13, hy + 4, 3, 1, '#ffd43b');
    px(hx + 14, hy + 3, 1, 1, '#fff3a8');
  } else if (species === 'panda') {
    // LEO: Fluffy curly dark hair
    drawRoundedRect(ctx, hx, hy - 3, 18, 8, s.outline);
    drawRoundedRect(ctx, hx + 3, hy - 5, 6, 5, s.outline);
    drawRoundedRect(ctx, hx + 9, hy - 5, 6, 5, s.outline);
    px(hx + 1, hy - 2, 16, 6, s.hair);
    px(hx + 4, hy - 4, 4, 4, s.hair);
    px(hx + 10, hy - 4, 4, 4, s.hair);
    // Fluffy curl highlights
    px(hx + 4, hy - 3, 2, 2, s.hairLight);
    px(hx + 10, hy - 3, 2, 2, s.hairLight);
    px(hx + 2, hy, 3, 2, s.hairLight);
    px(hx + 13, hy, 3, 2, s.hairLight);
    // Curly fringe bangs & side curls
    px(hx + 2, hy + 4, 3, 2, s.hair);
    px(hx + 7, hy + 4, 4, 2, s.hair);
    px(hx + 13, hy + 4, 3, 2, s.hair);
    px(hx + 1, hy + 5, 2, 3, s.hairShade);
    px(hx + 15, hy + 5, 2, 3, s.hairShade);
  } else if (species === 'penguin') {
    // SAM: Golden blonde hair + crisp navy NYC baseball cap
    // Blonde hair peeking under cap
    px(hx + 1, hy + 4, 3, 4, s.hair);
    px(hx + 14, hy + 4, 3, 4, s.hair);
    px(hx + 4, hy + 4, 3, 2, s.hairLight);
    px(hx + 11, hy + 4, 3, 2, s.hairLight);

    // Navy NYC cap dome
    const capMain = '#243c6b';
    const capLight = '#3f62a3';
    const capDark = '#182a4d';
    px(hx + 1, hy - 3, 16, 7, s.outline);
    px(hx + 2, hy - 2, 14, 5, capMain);
    px(hx + 4, hy - 2, 10, 2, capLight);
    // Gold NY badge
    px(hx + 7 + faceShift, hy, 4, 2, '#ffd43b');
    // Cap visor brim
    px(hx, hy + 2, 18, 3, s.outline);
    px(hx + 1, hy + 3, 16, 1, capDark);
    px(hx + 3, hy + 2, 12, 1, capLight);
  } else if (species === 'bunny') {
    // CLAIRE: Warm auburn hair swept neatly back into ponytail
    px(hx + 1, hy - 2, 16, 7, s.outline);
    px(hx, hy + 1, 18, 5, s.outline);
    px(hx + 2, hy - 1, 14, 6, s.hair);
    px(hx + 1, hy + 1, 16, 4, s.hair);
    px(hx + 4, hy, 10, 2, s.hairLight);
    // Neat side-parted bangs
    px(hx + 2, hy + 4, 8, 2, s.hair);
    px(hx + 12, hy + 4, 4, 2, s.hair);
    px(hx + 1, hy + 5, 2, 4, s.hairShade);
    px(hx + 15, hy + 5, 2, 4, s.hairShade);
  }
}

/**
 * Short hair plus the trade hat for a shopkeeper. Called after the face is drawn so the
 * hat overlaps the forehead the way a real hat would. `faceShift` slides details toward
 * the side the character is looking at (-1 left, +1 right, 0 front/back).
 */
function drawVendorHeadwear(
  ctx: CanvasRenderingContext2D,
  s: VendorStyle,
  hx: number,
  hy: number,
  facing: 'down' | 'up' | 'left' | 'right',
  faceShift: number
) {
  const px = (x: number, y: number, w: number, h: number, col: string) => {
    ctx.fillStyle = col;
    ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  };
  const front = facing !== 'up';

  // Short hair cap shared by every vendor (the hat sits on top of it).
  px(hx + 1, hy - 1, 16, 7, s.outline);
  px(hx, hy + 1, 18, 5, s.outline);
  px(hx + 2, hy, 14, 6, s.hair);
  px(hx + 1, hy + 2, 16, 3, s.hair);
  if (front) {
    px(hx + 3, hy + 4, 4, 2, s.hair);
    px(hx + 11, hy + 4, 4, 2, s.hair);
  }
  px(hx + 1, hy + 5, 2, 3, s.hairShade);
  px(hx + 15, hy + 5, 2, 3, s.hairShade);

  if (s.hat === 'visor') {
    // Open-top green visor: a band across the forehead and a short brim in front.
    px(hx, hy + 1, 18, 5, s.outline);
    px(hx + 1, hy + 2, 16, 3, s.hatMain);
    px(hx + 3, hy + 2, 10, 1, s.hatLight);
    if (front) {
      px(hx + 1, hy + 5, 16, 2, s.outline);
      px(hx + 2, hy + 5, 14, 1, s.hatDark);
    }
  } else if (s.hat === 'flatcap') {
    // Newsboy flat cap: a soft dome with a stitched button and a small peak.
    px(hx, hy - 3, 18, 8, s.outline);
    px(hx + 1, hy - 2, 16, 6, s.hatMain);
    px(hx + 3, hy - 2, 11, 2, s.hatLight);
    px(hx + 8, hy - 4, 2, 2, s.outline);
    px(hx + 8, hy - 3, 2, 1, s.hatDark);
    if (front) {
      px(hx + 2, hy + 4, 14, 3, s.outline);
      px(hx + 3, hy + 4, 12, 2, s.hatDark);
    }
  } else if (s.hat === 'bandana') {
    // White bandana with blue dots, knotted at the side (or at the back when seen from behind).
    px(hx, hy - 2, 18, 8, s.outline);
    px(hx + 1, hy - 1, 16, 6, s.hatMain);
    px(hx + 4, hy, 2, 1, s.hatLight);
    px(hx + 9, hy + 1, 2, 1, s.hatLight);
    px(hx + 13, hy, 2, 1, s.hatLight);
    px(hx + 6, hy + 3, 2, 1, s.hatLight);
    px(hx + 11, hy + 3, 2, 1, s.hatLight);
    px(hx + 1, hy + 4, 16, 1, s.hatDark);
    if (front) {
      const knotX = faceShift < 0 ? hx + 16 : hx - 2;
      px(knotX, hy + 2, 4, 4, s.outline);
      px(knotX + 1, hy + 3, 2, 2, s.hatMain);
    } else {
      px(hx + 7, hy + 5, 4, 4, s.outline);
      px(hx + 8, hy + 5, 2, 3, s.hatMain);
    }
  } else {
    // Wide straw hat: a tall crown, a coloured band, and a brim that shades the forehead.
    px(hx + 3, hy - 5, 12, 6, s.outline);
    px(hx + 4, hy - 4, 10, 4, s.hatMain);
    px(hx + 5, hy - 4, 6, 1, s.hatLight);
    px(hx + 4, hy - 1, 10, 1, s.hatDark);
    px(hx - 3, hy + 1, 24, 4, s.outline);
    px(hx - 2, hy + 2, 22, 2, s.hatMain);
    px(hx - 2, hy + 3, 22, 1, s.hatLight);
  }
}

/**
 * Draw one standing/walking character onto a 32x40 canvas. Shared by the founder sprite
 * (`createMascotSpriteTexture`) and the shopkeeper sprite (`createVendorSpriteTexture`) so
 * the two always have the same proportions, feet, arms and walk cycle.
 *
 * There is NO baked ground shadow in here: the scene already draws a soft contact-shadow
 * mesh under every character, and a second painted one made feet look doubled and heavy.
 */
function drawCharacterSprite(
  id: CharacterId,
  stepPhase: 0 | 1 | 2,
  facing: 'down' | 'up' | 'left' | 'right',
  accessory: 'apron' | 'vest' | 'shop-apron' | 'none',
  idle: IdlePose
): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(32, 40);
  ctx.clearRect(0, 0, 32, 40);

  const s = CHARACTER_STYLES[id];
  const px = (x: number, y: number, w: number, h: number, col: string) => {
    ctx.fillStyle = col;
    ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  };

  const isSide = facing === 'left' || facing === 'right';
  const dir = facing === 'left' ? -1 : 1;
  // Walking frames hop UP 1px; the idle "exhale" sinks the upper body DOWN 1px.
  const bob = idle.breathe ? 1 : stepPhase === 0 ? 0 : -1;

  // --- STUBBY BOUNCY FEET (3-frame stride) ---
  const leftFootY = stepPhase === 1 ? 32 : 34;
  const rightFootY = stepPhase === 2 ? 32 : 34;
  if (isSide) {
    const stride = stepPhase === 1 ? 2 : stepPhase === 2 ? -2 : 0;
    drawRoundedRect(ctx, 13 - stride, stepPhase === 2 ? 32 : 34, 6, 4, s.outline);
    px(14 - stride, (stepPhase === 2 ? 32 : 34) + 1, 4, 2, shadeHex(s.shoe, 0.2));
    drawRoundedRect(ctx, 13 + stride, stepPhase === 1 ? 32 : 34, 6, 4, s.outline);
    px(14 + stride, (stepPhase === 1 ? 32 : 34) + 1, 4, 2, s.shoe);
  } else {
    drawRoundedRect(ctx, 9, leftFootY, 6, 4, s.outline);
    px(10, leftFootY + 1, 4, 2, s.shoe);
    drawRoundedRect(ctx, 17, rightFootY, 6, 4, s.outline);
    px(18, rightFootY + 1, 4, 2, s.shoe);
  }

  // --- COMPACT CHIBI TORSO ---
  const by = 24 + bob;
  drawRoundedRect(ctx, 9, by, 14, 11, s.outline);
  px(10, by + 1, 12, 7, s.shirt);
  px(10, by + 1, 12, 1, s.shirtLight);
  px(10, by + 7, 12, 1, s.shirtShade);
  // Pants
  px(10, by + 8, 12, 2, s.pants);

  // Outfit-specific shirt details (founders only, and only when not covered by apron/vest)
  if (accessory === 'none' && facing !== 'up' && !isVendorKind(id)) {
    if (id === 'squirrel') {
      // Sunny yellow-striped tee
      px(10, by + 3, 12, 1, s.shirtAccent);
      px(10, by + 5, 12, 1, s.shirtAccent);
    } else if (id === 'shiba') {
      // Coral cardigan open over cream shirt
      px(14, by + 1, 4, 7, s.shirtAccent);
    } else if (id === 'panda') {
      // Varsity hoodie cream chest stripe & strings
      px(12, by + 3, 8, 2, s.shirtAccent);
      px(14, by + 1, 1, 3, s.shirtAccent);
      px(17, by + 1, 1, 3, s.shirtAccent);
    } else if (id === 'penguin') {
      // Teal jacket zipper over white tee
      px(14, by + 1, 4, 7, s.shirtAccent);
      px(15, by + 1, 2, 7, '#cfd8e6');
    } else if (id === 'bunny') {
      // Crisp Wall St. navy blazer + white collar + gold accent
      px(13, by + 1, 6, 5, s.shirtAccent);
      px(15, by + 2, 2, 4, '#d9a938');
    }
  }

  // --- ROLE ACCESSORIES (apron / vest / shopkeeper apron) ---
  if (accessory === 'apron') {
    if (facing === 'up') {
      px(10, by + 5, 12, 1, '#fff9eb');
      px(14, by + 5, 4, 2, '#e3d6bc');
    } else {
      const ax = isSide ? (dir > 0 ? 13 : 10) : 11;
      const aw = isSide ? 8 : 10;
      px(ax, by + 2, aw, 8, '#fff9eb');
      px(ax, by + 2, 1, 8, '#e0d3b8');
      px(ax + aw - 1, by + 2, 1, 8, '#e0d3b8');
      px(10, by + 6, 12, 1, '#fff9eb');
      // Pixel lemon emblem on apron
      px(ax + Math.floor(aw / 2) - 1, by + 4, 3, 2, '#ffd43b');
      px(ax + Math.floor(aw / 2), by + 3, 1, 1, '#58b342');
    }
  } else if (accessory === 'shop-apron' && isVendorKind(id)) {
    // A bold, full-width bib apron in the trade colour: the quickest "shopkeeper" signal.
    const v = VENDOR_STYLES[id];
    if (facing === 'up') {
      // Seen from behind: a waist band with a bow, and the neck strap across the shoulders.
      px(10, by + 1, 12, 1, v.apronShade);
      px(10, by + 5, 12, 2, v.apron);
      px(14, by + 4, 4, 3, v.apronShade);
    } else {
      const ax = isSide ? (dir > 0 ? 13 : 10) : 11;
      const aw = isSide ? 8 : 10;
      px(ax + 1, by + 1, aw - 2, 1, v.apronShade); // neck strap
      px(ax, by + 2, aw, 8, v.apron);
      px(ax, by + 2, 1, 8, v.apronShade);
      px(ax + aw - 1, by + 2, 1, 8, v.apronShade);
      px(ax, by + 9, aw, 1, v.apronShade);
      // Chest emblem in the trim colour.
      px(ax + Math.floor(aw / 2) - 1, by + 3, 2, 2, v.apronTrim);
      // Pocket with a stitched top edge.
      px(ax + 2, by + 6, aw - 4, 3, v.apronShade);
      px(ax + 2, by + 6, aw - 4, 1, v.apronTrim);
    }
  } else if (accessory === 'vest') {
    const vestMain = '#237868';
    const vestDark = '#175449';
    if (facing === 'up') {
      px(10, by + 1, 12, 7, vestMain);
      px(10, by + 6, 12, 2, vestDark);
    } else {
      px(10, by + 1, 4, 7, vestMain);
      px(18, by + 1, 4, 7, vestMain);
      px(14, by + 1, 4, 7, '#fffdf5');
      px(15, by + 2, 2, 1, '#e8584a'); // bowtie
      px(13, by + 4, 1, 1, '#ffd43b');
      px(13, by + 6, 1, 1, '#ffd43b');
    }
  }

  // --- STUBBY ARMS / HANDS ---
  const armSwing = stepPhase === 1 ? 1 : stepPhase === 2 ? -1 : 0;
  if (isSide) {
    const ax = 14 + (stepPhase === 1 ? -1 : stepPhase === 2 ? 1 : 0);
    drawRoundedRect(ctx, ax, by + 2, 5, 6, s.outline);
    px(ax + 1, by + 3, 3, 2, s.shirtLight);
    px(ax + 1, by + 5, 3, 2, s.skin);
  } else {
    drawRoundedRect(ctx, 6, by + 2 + armSwing, 4, 6, s.outline);
    px(7, by + 3 + armSwing, 2, 2, s.shirt);
    px(7, by + 5 + armSwing, 2, 2, s.skin);

    drawRoundedRect(ctx, 22, by + 2 - armSwing, 4, 6, s.outline);
    px(23, by + 3 - armSwing, 2, 2, s.shirt);
    px(23, by + 5 - armSwing, 2, 2, s.skin);
  }

  // --- FRIENDLY CHIBI HEAD (centered at x=7, y=9+bob) ---
  drawFriendlyHumanHead(ctx, id, 7, 9 + bob, facing, idle.eyesClosed === true);

  return toPixelTexture(c);
}

/** A founder (the player's character). `idle` selects a standing-still frame. */
export function createMascotSpriteTexture(
  species: FounderSpecies,
  stepPhase: 0 | 1 | 2 = 0,
  facing: 'down' | 'up' | 'left' | 'right' = 'down',
  accessory: 'apron' | 'vest' | 'none' = 'none',
  idle: IdlePose = {}
): THREE.CanvasTexture {
  return drawCharacterSprite(species, stepPhase, facing, accessory, idle);
}

/**
 * A shopkeeper: the stand seller ('broker') or one of the three Union Square vendors.
 * Always wears the full shop apron and the trade hat; never shares a face with a founder.
 */
export function createVendorSpriteTexture(
  kind: VendorKind,
  stepPhase: 0 | 1 | 2 = 0,
  facing: 'down' | 'up' | 'left' | 'right' = 'down',
  idle: IdlePose = {}
): THREE.CanvasTexture {
  return drawCharacterSprite(kind, stepPhase, facing, 'shop-apron', idle);
}

const mascotPortraitCache = new Map<FounderSpecies, string>();

export function createMascotPortraitDataUrl(species: FounderSpecies): string {
  const cached = mascotPortraitCache.get(species);
  if (cached) return cached;

  const [c, ctx] = makeCanvas(32, 32);
  ctx.clearRect(0, 0, 32, 32);

  const s = HUMAN_CHIBI_STYLES[species];
  const px = (x: number, y: number, w: number, h: number, col: string) => {
    ctx.fillStyle = col;
    ctx.fillRect(x, y, w, h);
  };

  // Peeking shoulders & collar at bottom of 32x32 portrait
  drawRoundedRect(ctx, 9, 25, 14, 7, s.outline);
  px(10, 26, 12, 6, s.shirt);
  px(10, 26, 12, 1, s.shirtLight);
  if (species === 'shiba' || species === 'penguin') {
    px(14, 26, 4, 6, s.shirtAccent);
  } else if (species === 'bunny') {
    px(13, 26, 6, 5, s.shirtAccent);
    px(15, 27, 2, 5, '#d9a938');
  } else if (species === 'squirrel') {
    px(10, 28, 12, 1, s.shirtAccent);
  } else if (species === 'panda') {
    px(12, 28, 8, 2, s.shirtAccent);
  }

  // Centered friendly human chibi head
  drawFriendlyHumanHead(ctx, species, 7, 9, 'down');

  const url = c.toDataURL('image/png');
  mascotPortraitCache.set(species, url);
  return url;
}

export function createKnockedOutSpriteTexture(species: FounderSpecies): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(32, 40);
  ctx.clearRect(0, 0, 32, 40);

  const s = HUMAN_CHIBI_STYLES[species];
  const px = (x: number, y: number, w: number, h: number, col: string) => {
    ctx.fillStyle = col;
    ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  };

  // Dizzy pale greenish-blue KO skin palette
  const koSkin = '#c4ded6';
  const koSkinShade = '#9fc2b8';
  const koSkinLight = '#ddf2ec';

  // Splayed knocked-out shoes sticking out at the sides
  drawRoundedRect(ctx, 6, 33, 6, 4, s.outline);
  px(7, 34, 4, 2, s.shoe);
  drawRoundedRect(ctx, 20, 33, 6, 4, s.outline);
  px(21, 34, 4, 2, s.shoe);

  // Slumped compact chibi torso
  const by = 26;
  drawRoundedRect(ctx, 9, by, 14, 10, s.outline);
  px(10, by + 1, 12, 6, s.shirt);
  px(10, by + 1, 12, 1, s.shirtLight);
  px(10, by + 6, 12, 1, s.shirtShade);
  px(10, by + 7, 12, 2, s.pants);

  // Flopped arms splayed outward
  drawRoundedRect(ctx, 4, by + 2, 6, 4, s.outline);
  px(5, by + 3, 2, 2, koSkin);
  px(7, by + 3, 2, 2, s.shirt);
  drawRoundedRect(ctx, 22, by + 2, 6, 4, s.outline);
  px(23, by + 3, 2, 2, s.shirt);
  px(25, by + 3, 2, 2, koSkin);

  // --- KNOCKED-OUT HEAD (same friendly chibi silhouette, dizzy greenish-blue skin) ---
  const hx = 7;
  const hy = 11;

  // Back ponytail for Claire
  if (species === 'bunny') {
    drawRoundedRect(ctx, hx + 15, hy + 5, 6, 9, s.outline);
    px(hx + 16, hy + 6, 4, 7, s.hair);
    px(hx + 17, hy + 6, 2, 3, s.hairLight);
    px(hx + 16, hy + 6, 2, 2, '#f2c138');
  }

  // Head outline & dizzy pale greenish-blue skin
  px(hx + 2, hy, 14, 16, s.outline);
  px(hx + 1, hy + 1, 16, 14, s.outline);
  px(hx, hy + 3, 18, 10, s.outline);
  px(hx + 2, hy + 1, 14, 14, koSkin);
  px(hx + 1, hy + 3, 16, 10, koSkin);
  px(hx + 4, hy + 2, 10, 2, koSkinLight);
  px(hx + 2, hy + 13, 14, 2, koSkinShade);

  // Crisp X X pixel eyes!
  const drawXEye = (ex: number, ey: number) => {
    px(ex, ey, 1, 1, s.outline);
    px(ex + 2, ey, 1, 1, s.outline);
    px(ex + 1, ey + 1, 1, 1, s.outline);
    px(ex, ey + 2, 1, 1, s.outline);
    px(ex + 2, ey + 2, 1, 1, s.outline);
  };
  drawXEye(hx + 3, hy + 7);
  drawXEye(hx + 12, hy + 7);

  // Cute mouth + little red tongue sticking out!
  px(hx + 6, hy + 11, 6, 1, s.outline);
  px(hx + 9, hy + 12, 3, 3, s.outline);
  px(hx + 9, hy + 12, 2, 2, '#eb525a');
  px(hx + 9, hy + 12, 1, 1, '#ff8f95');

  // Re-apply species hairstyle cleanly over forehead
  if (species === 'squirrel') {
    px(hx + 1, hy - 2, 16, 7, s.outline);
    px(hx + 4, hy - 4, 4, 3, s.outline);
    px(hx + 10, hy - 3, 4, 2, s.outline);
    px(hx, hy + 1, 18, 5, s.outline);
    px(hx + 2, hy - 1, 14, 6, s.hair);
    px(hx + 1, hy + 1, 16, 4, s.hair);
    px(hx + 5, hy - 3, 2, 3, s.hair);
    px(hx + 11, hy - 2, 2, 2, s.hair);
    px(hx + 4, hy, 10, 2, s.hairLight);
    px(hx + 3, hy + 4, 3, 2, s.hair);
    px(hx + 8, hy + 4, 3, 2, s.hair);
    px(hx + 13, hy + 4, 2, 2, s.hair);
  } else if (species === 'shiba') {
    px(hx + 1, hy - 2, 16, 7, s.outline);
    px(hx - 1, hy + 2, 4, 12, s.outline);
    px(hx + 15, hy + 2, 4, 12, s.outline);
    px(hx + 2, hy - 1, 14, 6, s.hair);
    px(hx + 1, hy + 1, 16, 4, s.hair);
    px(hx, hy + 3, 3, 10, s.hair);
    px(hx + 15, hy + 3, 3, 10, s.hair);
    px(hx + 4, hy, 10, 2, s.hairLight);
    px(hx + 3, hy + 4, 6, 2, s.hair);
    px(hx + 11, hy + 4, 4, 2, s.hair);
    px(hx + 13, hy + 4, 3, 1, '#ffd43b');
  } else if (species === 'panda') {
    drawRoundedRect(ctx, hx, hy - 3, 18, 8, s.outline);
    drawRoundedRect(ctx, hx + 3, hy - 5, 6, 5, s.outline);
    drawRoundedRect(ctx, hx + 9, hy - 5, 6, 5, s.outline);
    px(hx + 1, hy - 2, 16, 6, s.hair);
    px(hx + 4, hy - 4, 4, 4, s.hair);
    px(hx + 10, hy - 4, 4, 4, s.hair);
    px(hx + 4, hy - 3, 2, 2, s.hairLight);
    px(hx + 10, hy - 3, 2, 2, s.hairLight);
    px(hx + 2, hy + 4, 3, 2, s.hair);
    px(hx + 7, hy + 4, 4, 2, s.hair);
    px(hx + 13, hy + 4, 3, 2, s.hair);
  } else if (species === 'penguin') {
    px(hx + 1, hy + 4, 3, 4, s.hair);
    px(hx + 14, hy + 4, 3, 4, s.hair);
    px(hx + 1, hy - 3, 16, 7, s.outline);
    px(hx + 2, hy - 2, 14, 5, '#243c6b');
    px(hx + 4, hy - 2, 10, 2, '#3f62a3');
    px(hx + 7, hy, 4, 2, '#ffd43b');
    px(hx, hy + 2, 18, 3, s.outline);
    px(hx + 1, hy + 3, 16, 1, '#182a4d');
  } else if (species === 'bunny') {
    px(hx + 1, hy - 2, 16, 7, s.outline);
    px(hx, hy + 1, 18, 5, s.outline);
    px(hx + 2, hy - 1, 14, 6, s.hair);
    px(hx + 1, hy + 1, 16, 4, s.hair);
    px(hx + 4, hy, 10, 2, s.hairLight);
    px(hx + 2, hy + 4, 8, 2, s.hair);
    px(hx + 12, hy + 4, 4, 2, s.hair);
  }

  // Tiny golden cartoon dizzy stars orbiting above head
  px(6, 5, 2, 2, '#ffe066');
  px(24, 4, 2, 2, '#ffe066');
  px(15, 2, 2, 1, '#fff6b8');

  return toPixelTexture(c);
}

export function createSoulSpriteTexture(): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(20, 24);
  ctx.clearRect(0, 0, 20, 24);

  const px = (x: number, y: number, w: number, h: number, col: string) => {
    ctx.fillStyle = col;
    ctx.fillRect(x, y, w, h);
  };

  // Soft outer ethereal cyan aura
  const aura = 'rgba(130, 232, 255, 0.42)';
  const rim = 'rgba(92, 206, 242, 0.78)';
  const body = 'rgba(222, 251, 255, 0.88)';
  const core = 'rgba(255, 255, 255, 0.94)';

  // Outer glow halo
  px(5, 2, 10, 14, aura);
  px(3, 4, 14, 10, aura);

  // Soft cyan outline of ghost head & wavy tail
  px(6, 3, 8, 12, rim);
  px(4, 5, 12, 8, rim);
  // Wavy ghost tail
  px(6, 15, 7, 3, rim);
  px(8, 18, 5, 2, rim);
  px(10, 20, 3, 2, rim);
  px(11, 22, 2, 1, aura);

  // Luminous translucent body fill
  px(6, 4, 8, 10, body);
  px(5, 5, 10, 8, body);
  px(7, 14, 5, 3, body);
  px(9, 17, 3, 2, body);
  px(10, 19, 2, 2, body);

  // Bright white inner soul core
  px(7, 5, 6, 7, core);
  px(8, 12, 3, 3, core);

  // Tiny cute ghost eyes & little 'o' mouth
  px(7, 8, 2, 2, '#2b6c85');
  px(11, 8, 2, 2, '#2b6c85');
  px(7, 8, 1, 1, '#ffffff');
  px(11, 8, 1, 1, '#ffffff');
  px(9, 11, 2, 1, '#4b9ab8');

  // Floating ethereal sparkle pixels
  px(2, 6, 1, 1, '#ffffff');
  px(17, 11, 1, 1, '#ffffff');
  px(4, 17, 1, 1, 'rgba(180, 244, 255, 0.85)');

  return toPixelTexture(c);
}

// ============================================================================
// CRISP 16x16 PIXEL-ART GAME UI ICONS
// ============================================================================

export type UiIconKind =
  | 'coin'
  | 'lemon'
  | 'pitcher'
  | 'book'
  | 'map'
  | 'sun'
  | 'hurdle'
  | 'market';

const uiIconCache = new Map<UiIconKind, string>();

export function createUiIconDataUrl(kind: UiIconKind): string {
  const cached = uiIconCache.get(kind);
  if (cached) return cached;

  const [c, ctx] = makeCanvas(16, 16);
  ctx.clearRect(0, 0, 16, 16);

  const outline = '#191622';
  const px = (x: number, y: number, w: number, h: number, col: string) => {
    ctx.fillStyle = col;
    ctx.fillRect(x, y, w, h);
  };

  if (kind === 'coin') {
    // Gleaming gold pixel coin
    px(4, 1, 8, 14, outline);
    px(2, 3, 12, 10, outline);
    px(1, 5, 14, 6, outline);
    px(4, 2, 8, 12, '#f5b82e');
    px(3, 3, 10, 10, '#ffd84d');
    px(2, 5, 12, 6, '#ffd84d');
    // Rim highlight & depth
    px(4, 2, 8, 1, '#fff5a8');
    px(3, 3, 2, 4, '#fff5a8');
    px(4, 13, 8, 1, '#c98014');
    px(11, 5, 2, 6, '#d98f1a');
    // Center '$' bar
    px(7, 4, 2, 8, '#c4740e');
    px(6, 5, 4, 1, '#c4740e');
    px(6, 7, 4, 2, '#c4740e');
    px(6, 10, 4, 1, '#c4740e');
    px(7, 4, 1, 7, '#fff7ba');
  } else if (kind === 'lemon') {
    // Plump sunny pixel lemon with fresh green leaf
    px(8, 1, 5, 3, outline);
    px(9, 2, 3, 1, '#58c443');
    px(10, 2, 2, 1, '#92eb6c');

    px(4, 4, 8, 10, outline);
    px(2, 6, 12, 6, outline);
    px(1, 7, 14, 4, outline);
    px(4, 5, 8, 8, '#ffe03d');
    px(3, 6, 10, 6, '#ffe03d');
    px(2, 7, 12, 4, '#ffe03d');
    // Warm depth & crisp white glint
    px(4, 11, 8, 2, '#e39e14');
    px(10, 7, 3, 4, '#e39e14');
    px(4, 6, 3, 2, '#fff9b8');
    px(4, 6, 2, 1, '#ffffff');
  } else if (kind === 'pitcher') {
    // Gleaming mini glass pitcher
    px(2, 2, 9, 13, outline);
    px(11, 4, 3, 2, outline);
    px(12, 5, 2, 6, outline);
    px(11, 10, 3, 2, outline);
    px(12, 5, 1, 5, '#b8e7fa');
    // Glass interior
    px(3, 3, 7, 11, '#c9eefc');
    px(4, 3, 5, 1, '#ffffff');
    // Golden lemonade inside
    px(3, 7, 7, 6, '#ffd83d');
    px(3, 11, 7, 2, '#e39c14');
    px(4, 7, 5, 1, '#fff5a3');
    // Ice cube + specular streak
    px(6, 7, 3, 2, '#ffffff');
    px(4, 4, 1, 9, '#ffffff');
  } else if (kind === 'book') {
    // Accounting ledger book with gold clasp
    px(2, 1, 12, 14, outline);
    px(3, 2, 10, 12, '#2d7a5e');
    px(3, 2, 2, 12, '#1c5440'); // spine
    px(5, 2, 8, 2, '#44a37f'); // highlight
    // Cream page edge
    px(4, 12, 9, 2, '#fff6de');
    px(4, 13, 9, 1, '#d9ccb0');
    // Gold emblem & clasp
    px(7, 5, 4, 4, '#ffd43b');
    px(8, 6, 2, 2, '#fff6b8');
    px(12, 6, 2, 3, '#f0b429');
  } else if (kind === 'map') {
    // Folded NYC parchment map with Central Park green & red pin
    px(1, 2, 14, 12, outline);
    px(2, 3, 12, 10, '#f7e7c1');
    // Blue river edges
    px(2, 3, 2, 10, '#5ea8e6');
    px(12, 3, 2, 10, '#5ea8e6');
    // Central Park green rectangle
    px(6, 5, 4, 6, '#58b849');
    px(6, 5, 4, 1, '#8be072');
    // Subtle fold crease
    px(6, 3, 1, 10, 'rgba(92, 68, 38, 0.25)');
    px(10, 3, 1, 10, 'rgba(92, 68, 38, 0.25)');
    // Red location pin
    px(7, 4, 3, 3, outline);
    px(8, 5, 1, 1, '#ff4d4d');
  } else if (kind === 'sun') {
    // Cheerful golden pixel sun
    px(5, 5, 6, 6, outline);
    px(4, 6, 8, 4, outline);
    px(6, 4, 4, 8, outline);
    px(5, 5, 6, 6, '#ffd43b');
    px(6, 6, 3, 3, '#fff6a8');
    // Crisp sun rays
    const rays = [
      [7, 1, 2, 2],
      [7, 13, 2, 2],
      [1, 7, 2, 2],
      [13, 7, 2, 2],
      [2, 2, 2, 2],
      [12, 2, 2, 2],
      [2, 12, 2, 2],
      [12, 12, 2, 2],
    ];
    for (const [rx, ry, rw, rh] of rays) {
      px(rx, ry, rw, rh, '#ffb703');
    }
  } else if (kind === 'hurdle') {
    // Track hurdle bar (5% capital hurdle gate!)
    // Posts
    px(2, 3, 3, 12, outline);
    px(11, 3, 3, 12, outline);
    px(3, 4, 1, 10, '#cfd8e6');
    px(12, 4, 1, 10, '#cfd8e6');
    // Striped red/white top hurdle crossbar
    px(1, 3, 14, 5, outline);
    px(2, 4, 12, 3, '#ffffff');
    px(2, 4, 3, 3, '#f04b4b');
    px(8, 4, 3, 3, '#f04b4b');
    // Feet
    px(1, 13, 5, 2, outline);
    px(10, 13, 5, 2, outline);
    px(2, 14, 3, 1, '#8c99ad');
    px(11, 14, 3, 1, '#8c99ad');
  } else if (kind === 'market') {
    // Striped Supply Market stall icon
    px(1, 2, 14, 6, outline);
    // Red & cream awning stripes
    for (let x = 2; x < 14; x += 3) {
      px(x, 3, 3, 4, (x - 2) % 6 === 0 ? '#e84a4a' : '#fff7e5');
    }
    // Wooden stall posts & counter
    px(2, 8, 2, 6, outline);
    px(12, 8, 2, 6, outline);
    px(2, 10, 12, 5, outline);
    px(3, 11, 10, 3, '#b8763e');
    px(3, 11, 10, 1, '#e3a566');
    // Mini lemons on counter
    px(5, 9, 2, 2, '#ffe03d');
    px(9, 9, 2, 2, '#ffe03d');
  }

  const url = c.toDataURL('image/png');
  uiIconCache.set(kind, url);
  return url;
}

// ============================================================================
// DISTINCT NYC NEIGHBORHOOD ARCHITECTURAL & PLAZA PIXEL TEXTURES
// ============================================================================

export function createCobblestoneTexture(repeatX = 1, repeatY = 1): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(32, 32);
  // Warm dark mortar bed
  ctx.fillStyle = '#5c544b';
  ctx.fillRect(0, 0, 32, 32);

  const stonePalette = ['#b8ab96', '#a89a85', '#c4b7a1', '#9c8f7c', '#b3a38c'];
  const rowH = 6;
  for (let row = 0; row < 6; row++) {
    const y = row * rowH;
    const offset = row % 2 === 0 ? 0 : 4;
    for (let x = -4; x < 32; x += 8) {
      const sx = x + offset;
      const r = hash2(sx, y, 71);
      const base = stonePalette[Math.floor(r * stonePalette.length) % stonePalette.length];
      const hi = tintHex(base, 0.2, 0.25);
      const sh = shadeHex(base, 0.22, 0.1);

      // Rounded cobblestone paver
      ctx.fillStyle = base;
      ctx.fillRect(sx + 1, y + 1, 6, 4);
      ctx.fillStyle = hi;
      ctx.fillRect(sx + 1, y + 1, 5, 1);
      ctx.fillRect(sx + 1, y + 1, 1, 3);
      ctx.fillStyle = sh;
      ctx.fillRect(sx + 2, y + 4, 5, 1);
      ctx.fillRect(sx + 6, y + 2, 1, 3);
    }
  }

  return toPixelTexture(c, repeatX, repeatY);
}

export function createCampusBrickFacadeTexture(): THREE.CanvasTexture {
  // Columbia University red-brick & cream limestone neoclassical facade (64x80)
  const [c, ctx] = makeCanvas(64, 80);

  // Classic ivy-league red brick base
  ctx.fillStyle = '#9c3e32';
  ctx.fillRect(0, 0, 64, 80);
  for (let y = 0; y < 58; y += 4) {
    const off = (y / 4) % 2 === 0 ? 0 : 4;
    for (let x = off - 4; x < 64; x += 8) {
      const r = hash2(x, y, 83);
      if (r > 0.7) {
        ctx.fillStyle = '#b04d40';
        ctx.fillRect(x + 1, y + 1, 6, 3);
      } else if (r < 0.2) {
        ctx.fillStyle = '#823127';
        ctx.fillRect(x + 1, y + 1, 6, 3);
      }
    }
    ctx.fillStyle = '#6e2820';
    ctx.fillRect(0, y, 64, 1);
    for (let x = off; x < 64; x += 8) {
      ctx.fillRect(x, y, 1, 4);
    }
  }

  // Cream limestone neoclassical entablature & balustrade cornice at top
  ctx.fillStyle = '#d9ccb2';
  ctx.fillRect(0, 0, 64, 10);
  ctx.fillStyle = '#f0e6d2';
  ctx.fillRect(0, 0, 64, 2);
  ctx.fillRect(0, 8, 64, 2);
  ctx.fillStyle = '#9e9078';
  ctx.fillRect(0, 10, 64, 2);
  // Carved frieze dentils
  for (let x = 2; x < 64; x += 5) {
    ctx.fillStyle = '#b8aa8f';
    ctx.fillRect(x, 3, 2, 4);
  }

  // Cream limestone ground-floor arcade & steps base
  ctx.fillStyle = '#ded2ba';
  ctx.fillRect(0, 56, 64, 24);
  ctx.fillStyle = '#f2ead9';
  ctx.fillRect(0, 56, 64, 2);
  for (let y = 62; y < 80; y += 6) {
    ctx.fillStyle = '#b8aa90';
    ctx.fillRect(0, y, 64, 1);
  }

  // Tall fluted neoclassical limestone pilasters framing the bays
  const colXs = [2, 21, 40, 58];
  for (const cx of colXs) {
    ctx.fillStyle = '#cfc2a7';
    ctx.fillRect(cx, 11, 4, 69);
    ctx.fillStyle = '#ede4d1';
    ctx.fillRect(cx + 1, 11, 2, 69);
    ctx.fillStyle = '#9e9078';
    ctx.fillRect(cx + 3, 11, 1, 69);
    // Column capital & base
    ctx.fillStyle = '#f5eedf';
    ctx.fillRect(cx - 1, 11, 6, 2);
    ctx.fillRect(cx - 1, 54, 6, 2);
  }

  // Arched neoclassical multi-pane windows (2 floors x 3 bays)
  const bayXs = [8, 27, 46];
  const floorYs = [16, 36];
  for (const wy of floorYs) {
    for (const wx of bayXs) {
      // Limestone arch surround & keystone
      ctx.fillStyle = '#ebe1cc';
      ctx.fillRect(wx + 1, wy - 2, 9, 3);
      ctx.fillRect(wx - 1, wy + 13, 13, 2);
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(wx + 4, wy - 3, 3, 2); // keystone
      // Dark window frame
      ctx.fillStyle = '#2b2623';
      ctx.fillRect(wx, wy, 11, 13);
      ctx.fillRect(wx + 1, wy - 1, 9, 2);
      // Warm sunlit library glass
      ctx.fillStyle = '#e8cf8a';
      ctx.fillRect(wx + 1, wy + 1, 9, 11);
      ctx.fillStyle = '#fff3c4';
      ctx.fillRect(wx + 2, wy + 2, 3, 4);
      // White wooden muntin grid
      ctx.fillStyle = '#f2ead8';
      ctx.fillRect(wx + 5, wy, 1, 12);
      ctx.fillRect(wx + 1, wy + 5, 9, 1);
      ctx.fillRect(wx + 1, wy + 9, 9, 1);
    }
  }

  // Ground floor arched oak campus doors & blue Columbia banner accent
  ctx.fillStyle = '#2d231d';
  ctx.fillRect(26, 61, 13, 19);
  ctx.fillStyle = '#5c3824';
  ctx.fillRect(28, 63, 9, 17);
  ctx.fillStyle = '#f2d080';
  ctx.fillRect(30, 65, 5, 6);
  // Light blue Columbia campus banners flanking entrance
  ctx.fillStyle = '#6da9e4';
  ctx.fillRect(10, 60, 6, 13);
  ctx.fillRect(48, 60, 6, 13);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(12, 63, 2, 5);
  ctx.fillRect(50, 63, 2, 5);

  return toPixelTexture(c);
}

export function createTheaterMarqueeFacadeTexture(): THREE.CanvasTexture {
  // Broadway Theater facade with glowing golden/red marquee & poster cases (64x80)
  const [c, ctx] = makeCanvas(64, 80);

  // Rich art-deco charcoal-burgundy masonry
  ctx.fillStyle = '#38242e';
  ctx.fillRect(0, 0, 64, 80);
  for (let y = 0; y < 44; y += 4) {
    ctx.fillStyle = '#291922';
    ctx.fillRect(0, y, 64, 1);
    const off = (y / 4) % 2 === 0 ? 0 : 4;
    for (let x = off; x < 64; x += 8) {
      ctx.fillRect(x, y, 1, 4);
    }
  }

  // Art-deco gold vertical ribs & rooftop parapet
  ctx.fillStyle = '#d9a432';
  ctx.fillRect(0, 0, 64, 4);
  ctx.fillStyle = '#ffe078';
  ctx.fillRect(0, 0, 64, 1);
  for (const rx of [2, 16, 46, 60]) {
    ctx.fillStyle = '#8c6422';
    ctx.fillRect(rx, 4, 2, 38);
    ctx.fillStyle = '#f0be4a';
    ctx.fillRect(rx, 4, 1, 38);
  }

  // Vertical glowing Broadway blade sign (center upper facade)
  ctx.fillStyle = '#1c1218';
  ctx.fillRect(22, 7, 20, 32);
  ctx.fillStyle = '#b82534';
  ctx.fillRect(24, 9, 16, 28);
  ctx.fillStyle = '#ff4d5a';
  ctx.fillRect(26, 11, 12, 24);
  // Chasing golden marquee bulbs down the blade sign
  for (let y = 10; y < 36; y += 4) {
    ctx.fillStyle = '#fff49c';
    ctx.fillRect(24, y, 2, 2);
    ctx.fillRect(38, y, 2, 2);
  }
  // Glowing pixel letters inside blade sign
  ctx.fillStyle = '#fff9d6';
  for (let y = 13; y < 33; y += 5) {
    ctx.fillRect(29, y, 6, 3);
    ctx.fillStyle = '#ffd147';
    ctx.fillRect(30, y + 1, 4, 1);
    ctx.fillStyle = '#fff9d6';
  }

  // Grand glowing horizontal Broadway Marquee canopy (y=40..54)
  ctx.fillStyle = '#1a1117';
  ctx.fillRect(1, 39, 62, 16);
  ctx.fillStyle = '#d99e26';
  ctx.fillRect(2, 40, 60, 14);
  ctx.fillStyle = '#fff4c7';
  ctx.fillRect(4, 42, 56, 10);
  // Marquee show title pixel stripes
  ctx.fillStyle = '#c41e32';
  ctx.fillRect(8, 44, 48, 2);
  ctx.fillStyle = '#291a22';
  ctx.fillRect(12, 48, 40, 2);
  // Bright chasing marquee light bulbs along top & bottom edges
  for (let x = 3; x < 60; x += 4) {
    ctx.fillStyle = x % 8 === 3 ? '#ffffff' : '#ffe46b';
    ctx.fillRect(x, 40, 2, 2);
    ctx.fillRect(x, 52, 2, 2);
  }

  // Ground floor marble lobby & glowing poster cases
  ctx.fillStyle = '#261c24';
  ctx.fillRect(0, 55, 64, 25);
  // Left & right illuminated playbill poster cases
  for (const px of [5, 47]) {
    ctx.fillStyle = '#d9a432';
    ctx.fillRect(px, 59, 12, 16);
    ctx.fillStyle = '#fff0b3';
    ctx.fillRect(px + 1, 60, 10, 14);
    ctx.fillStyle = px === 5 ? '#e84855' : '#3a86ff';
    ctx.fillRect(px + 2, 62, 8, 7);
    ctx.fillStyle = '#ffd43b';
    ctx.fillRect(px + 3, 70, 6, 2);
  }

  // Warm glowing double theater entrance doors + red carpet
  ctx.fillStyle = '#8c222e';
  ctx.fillRect(21, 58, 22, 22);
  ctx.fillStyle = '#ffd978';
  ctx.fillRect(23, 60, 8, 14);
  ctx.fillRect(33, 60, 8, 14);
  ctx.fillStyle = '#fff5cc';
  ctx.fillRect(24, 61, 3, 6);
  ctx.fillRect(34, 61, 3, 6);
  ctx.fillStyle = '#d9a432';
  ctx.fillRect(31, 60, 2, 20); // brass center divider

  return toPixelTexture(c);
}

export function createGlassTowerFacadeTexture(): THREE.CanvasTexture {
  // Financial District sleek blue-gray skyscraper curtain wall + granite lobby (64x80)
  const [c, ctx] = makeCanvas(64, 80);

  // Steel mullion grid base
  ctx.fillStyle = '#283645';
  ctx.fillRect(0, 0, 64, 80);

  // Curtain-wall glass panes (6 floors x 5 bays)
  for (let row = 0; row < 6; row++) {
    const wy = 4 + row * 9;
    for (let col = 0; col < 5; col++) {
      const wx = 3 + col * 12;
      const r = hash2(col, row, 97);
      // Mix of reflective sky-blue glass and warm lit trading-floor offices
      const isLit = r > 0.74;
      ctx.fillStyle = isLit ? '#f2d991' : r < 0.3 ? '#4c6d8c' : '#5e83a6';
      ctx.fillRect(wx, wy, 10, 7);

      // Crisp diagonal sky reflection streak
      ctx.fillStyle = isLit ? '#fff4cc' : '#8cb6db';
      ctx.fillRect(wx + 1, wy + 1, 3, 2);
      ctx.fillRect(wx + 3, wy + 3, 3, 2);
      // Darker glass spandrel band
      ctx.fillStyle = isLit ? '#d4b362' : '#3a546e';
      ctx.fillRect(wx, wy + 6, 10, 1);
    }
    // Brushed steel horizontal floor beam
    ctx.fillStyle = '#6f8294';
    ctx.fillRect(0, wy + 7, 64, 1);
  }

  // Sleek steel roof parapet
  ctx.fillStyle = '#7e93a8';
  ctx.fillRect(0, 0, 64, 2);
  ctx.fillStyle = '#a8bdd1';
  ctx.fillRect(0, 0, 64, 1);

  // Polished dark granite Financial District lobby base (y=58..80)
  ctx.fillStyle = '#242930';
  ctx.fillRect(0, 58, 64, 22);
  ctx.fillStyle = '#4c5766';
  ctx.fillRect(0, 58, 64, 2);
  // Vertical granite piers
  for (const px of [0, 18, 44, 60]) {
    ctx.fillStyle = '#363e4a';
    ctx.fillRect(px, 60, 4, 20);
    ctx.fillStyle = '#536073';
    ctx.fillRect(px + 1, 60, 1, 20);
  }
  // Tall glowing glass lobby & revolving door entrance
  ctx.fillStyle = '#9ec7e0';
  ctx.fillRect(6, 62, 10, 16);
  ctx.fillRect(48, 62, 10, 16);
  ctx.fillStyle = '#d4edfc';
  ctx.fillRect(8, 63, 3, 12);
  ctx.fillRect(50, 63, 3, 12);

  // Center gleaming revolving door entry
  ctx.fillStyle = '#1b2026';
  ctx.fillRect(23, 61, 18, 19);
  ctx.fillStyle = '#e8f5fc';
  ctx.fillRect(25, 63, 14, 17);
  ctx.fillStyle = '#87b2cc';
  ctx.fillRect(26, 64, 5, 15);
  ctx.fillRect(33, 64, 5, 15);
  ctx.fillStyle = '#b8c4d1';
  ctx.fillRect(31, 63, 2, 17); // steel revolving door post

  return toPixelTexture(c);
}

export function createLimestoneLuxuryFacadeTexture(): THREE.CanvasTexture {
  // Fifth Avenue pale cream limestone flagship boutique with gold trim & navy awning (64x80)
  const [c, ctx] = makeCanvas(64, 80);

  // Pale Beaux-Arts cream limestone blocks
  ctx.fillStyle = '#ebe2cf';
  ctx.fillRect(0, 0, 64, 80);
  for (let y = 0; y < 80; y += 6) {
    ctx.fillStyle = '#d6cab2';
    ctx.fillRect(0, y, 64, 1);
    ctx.fillStyle = '#f7f1e3';
    ctx.fillRect(0, y + 1, 64, 1);
  }

  // Ornate carved stone cornice with gold trim molding
  ctx.fillStyle = '#cfc2a8';
  ctx.fillRect(0, 0, 64, 7);
  ctx.fillStyle = '#faf5ea';
  ctx.fillRect(0, 0, 64, 2);
  ctx.fillStyle = '#d9ae3b';
  ctx.fillRect(0, 7, 64, 2);
  ctx.fillStyle = '#fff0a8';
  ctx.fillRect(0, 7, 64, 1);

  // Upper floor tall French windows with gilded iron Juliet balconies
  const winXs = [8, 26, 44];
  for (const wy of [14, 33]) {
    for (const wx of winXs) {
      // Carved stone surround
      ctx.fillStyle = '#faf5ea';
      ctx.fillRect(wx - 1, wy - 2, 14, 2);
      ctx.fillStyle = '#d9ae3b';
      ctx.fillRect(wx + 4, wy - 2, 4, 1); // gold crest
      // Dark bronze frame + warm champagne glass
      ctx.fillStyle = '#29241f';
      ctx.fillRect(wx, wy, 12, 13);
      ctx.fillStyle = '#f5e1a8';
      ctx.fillRect(wx + 1, wy + 1, 10, 11);
      ctx.fillStyle = '#fff8de';
      ctx.fillRect(wx + 2, wy + 2, 3, 5);
      // Gold muntins & balcony railing
      ctx.fillStyle = '#b88f28';
      ctx.fillRect(wx + 5, wy + 1, 2, 11);
      ctx.fillRect(wx - 1, wy + 10, 14, 1);
      ctx.fillStyle = '#242733';
      ctx.fillRect(wx - 1, wy + 11, 14, 3);
      for (let bx = wx; bx < wx + 12; bx += 3) {
        ctx.fillStyle = '#e3b946';
        ctx.fillRect(bx, wy + 11, 1, 2);
      }
    }
  }

  // Fifth Ave Flagship Gold Entablature Signboard (y=50..56)
  ctx.fillStyle = '#1b2640';
  ctx.fillRect(4, 50, 56, 7);
  ctx.fillStyle = '#e0b33a';
  ctx.fillRect(4, 50, 56, 1);
  ctx.fillRect(4, 56, 56, 1);
  // Crisp gold boutique lettering bars
  ctx.fillStyle = '#ffe994';
  ctx.fillRect(14, 52, 36, 2);
  ctx.fillStyle = '#1b2640';
  ctx.fillRect(22, 52, 2, 2);
  ctx.fillRect(36, 52, 2, 2);

  // Dark navy & gold scalloped luxury boutique awning (y=57..62)
  ctx.fillStyle = '#1a2747';
  ctx.fillRect(4, 57, 56, 5);
  ctx.fillStyle = '#2a3d6b';
  ctx.fillRect(4, 57, 56, 2);
  ctx.fillStyle = '#e6ba40';
  ctx.fillRect(4, 61, 56, 1); // gold fringe trim

  // Tall arched gold-trimmed flagship display windows + center grand door
  for (const dx of [6, 42]) {
    ctx.fillStyle = '#d9ae3b';
    ctx.fillRect(dx, 63, 16, 16);
    ctx.fillStyle = '#fff5d6';
    ctx.fillRect(dx + 1, 64, 14, 14);
    ctx.fillStyle = '#f2d99b';
    ctx.fillRect(dx + 2, 71, 12, 6);
    // Tiny luxury mannequin/pedestal silhouette inside window
    ctx.fillStyle = '#c4962b';
    ctx.fillRect(dx + 6, 68, 4, 8);
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(dx + 2, 65, 2, 6);
  }

  // Grand center brass & glass flagship entrance
  ctx.fillStyle = '#c99b2a';
  ctx.fillRect(25, 62, 14, 18);
  ctx.fillStyle = '#1f2b47';
  ctx.fillRect(27, 64, 10, 16);
  ctx.fillStyle = '#ffe7a3';
  ctx.fillRect(28, 65, 3, 12);
  ctx.fillRect(33, 65, 3, 12);

  return toPixelTexture(c);
}

// ============================================================================
// LOCATION-SPECIFIC NYC DISTRICT PEDESTRIANS (36x40 Friendly Growtopia Chibis)
// ============================================================================

export type DistrictPedestrianKind =
  | 'park-dog-walker'
  | 'park-jogger'
  | 'columbia-student'
  | 'fidi-suit'
  | 'broadway-theater'
  | 'fifth-shopper'
  | 'village-artist';

interface DistrictPedStyle {
  skin: string;
  skinShade: string;
  skinLight: string;
  hair: string;
  hairShade: string;
  hairLight: string;
  shirt: string;
  shirtShade: string;
  shirtLight: string;
  pants: string;
  shoe: string;
  cheek: string;
}

const DISTRICT_PED_STYLES: Record<DistrictPedestrianKind, DistrictPedStyle> = {
  'park-dog-walker': {
    skin: '#f7c9a2',
    skinShade: '#dfa67c',
    skinLight: '#ffe1c6',
    hair: '#784829',
    hairShade: '#522f18',
    hairLight: '#a36840',
    shirt: '#5a8252',
    shirtShade: '#3d5e37',
    shirtLight: '#7ea876',
    pants: '#456185',
    shoe: '#66432a',
    cheek: '#f6a2a8',
  },
  'park-jogger': {
    skin: '#e8b389',
    skinShade: '#cc9266',
    skinLight: '#facca6',
    hair: '#2e2422',
    hairShade: '#1c1514',
    hairLight: '#4f3e3b',
    shirt: '#2eb0a8',
    shirtShade: '#1e857f',
    shirtLight: '#5cd4cd',
    pants: '#2e384d',
    shoe: '#f05454',
    cheek: '#ed9494',
  },
  'columbia-student': {
    skin: '#f5c69e',
    skinShade: '#dca177',
    skinLight: '#ffe0c4',
    hair: '#4a3123',
    hairShade: '#2e1d14',
    hairLight: '#734f3a',
    shirt: '#9bddff', // Iconic Columbia Light Blue!
    shirtShade: '#6eb8e0',
    shirtLight: '#c7ecff',
    pants: '#3a4a66',
    shoe: '#f2f4f8',
    cheek: '#f59fa8',
  },
  'fidi-suit': {
    skin: '#f6c8a0',
    skinShade: '#dea47a',
    skinLight: '#ffe0c4',
    hair: '#2b282b',
    hairShade: '#1a181c',
    hairLight: '#4d484d',
    shirt: '#2e3340', // Sharp Wall St. charcoal suit
    shirtShade: '#1c2029',
    shirtLight: '#495063',
    pants: '#242833',
    shoe: '#1f1a18',
    cheek: '#f09c9e',
  },
  'broadway-theater': {
    skin: '#f2bf96',
    skinShade: '#d69c72',
    skinLight: '#ffd9ba',
    hair: '#5c2d26',
    hairShade: '#3d1b16',
    hairLight: '#87463c',
    shirt: '#3b2b42', // Stylish evening coat
    shirtShade: '#261a2b',
    shirtLight: '#5c4566',
    pants: '#241e29',
    shoe: '#2e2226',
    cheek: '#f59aa6',
  },
  'fifth-shopper': {
    skin: '#fad0ab',
    skinShade: '#e3ae86',
    skinLight: '#ffe6cf',
    hair: '#d9a441',
    hairShade: '#ad7c24',
    hairLight: '#f5ce73',
    shirt: '#e8c2c8', // Chic Fifth Ave pastel boutique coat
    shirtShade: '#c49aa1',
    shirtLight: '#fae1e5',
    pants: '#3b3742',
    shoe: '#3d2a30',
    cheek: '#f79ead',
  },
  'village-artist': {
    skin: '#f4c39b',
    skinShade: '#dba076',
    skinLight: '#ffddc2',
    hair: '#3b2924',
    hairShade: '#241714',
    hairLight: '#61453d',
    shirt: '#d47f35', // Cozy autumn knit sweater
    shirtShade: '#a65c1e',
    shirtLight: '#f0a35b',
    pants: '#363b47',
    shoe: '#543525',
    cheek: '#f59da6',
  },
};

export function createDistrictPedestrianTexture(
  kind: DistrictPedestrianKind,
  stepPhase: 0 | 1 | 2 = 0,
  facing: 'down' | 'up' | 'left' | 'right' = 'down'
): THREE.CanvasTexture {
  // Consistent 36x40 canvas so dog-walker's puppy & shopping bags fit cleanly without clipping
  const [c, ctx] = makeCanvas(36, 40);
  ctx.clearRect(0, 0, 36, 40);

  const s = DISTRICT_PED_STYLES[kind];
  const outline = '#2b2118';
  const px = (x: number, y: number, w: number, h: number, col: string) => {
    ctx.fillStyle = col;
    ctx.fillRect(Math.round(x), Math.round(y), Math.round(w), Math.round(h));
  };

  const isSide = facing === 'left' || facing === 'right';
  const dir = facing === 'left' ? -1 : 1;
  const faceShift = facing === 'left' ? -1 : facing === 'right' ? 1 : 0;
  const bob = stepPhase === 0 ? 0 : -1;

  // Shift dog walker slightly left so the cute golden dog trots neatly on the right!
  const ox = kind === 'park-dog-walker' ? -2 : 2;

  // --- BACKPACK BEHIND TORSO (Columbia Student on side/front) ---
  if (kind === 'columbia-student' && isSide) {
    const bpX = dir > 0 ? 5 + ox : 20 + ox;
    drawRoundedRect(ctx, bpX, 24 + bob, 6, 9, outline);
    px(bpX + 1, 25 + bob, 4, 7, '#b5743c');
    px(bpX + 1, 25 + bob, 4, 2, '#d49557');
    px(bpX + 2, 29 + bob, 2, 2, '#7d4a22');
  }

  // --- STUBBY BOUNCY FEET (3-frame stride) ---
  const leftFootY = stepPhase === 1 ? 32 : 34;
  const rightFootY = stepPhase === 2 ? 32 : 34;
  if (isSide) {
    const stride = stepPhase === 1 ? 2 : stepPhase === 2 ? -2 : 0;
    drawRoundedRect(ctx, 13 + ox - stride, stepPhase === 2 ? 32 : 34, 6, 4, outline);
    px(14 + ox - stride, (stepPhase === 2 ? 32 : 34) + 1, 4, 2, shadeHex(s.shoe, 0.2));
    drawRoundedRect(ctx, 13 + ox + stride, stepPhase === 1 ? 32 : 34, 6, 4, outline);
    px(14 + ox + stride, (stepPhase === 1 ? 32 : 34) + 1, 4, 2, s.shoe);
  } else {
    drawRoundedRect(ctx, 9 + ox, leftFootY, 6, 4, outline);
    px(10 + ox, leftFootY + 1, 4, 2, s.shoe);
    drawRoundedRect(ctx, 17 + ox, rightFootY, 6, 4, outline);
    px(18 + ox, rightFootY + 1, 4, 2, s.shoe);
  }

  // --- COMPACT CHIBI TORSO ---
  const by = 24 + bob;
  drawRoundedRect(ctx, 9 + ox, by, 14, 11, outline);
  px(10 + ox, by + 1, 12, 7, s.shirt);
  px(10 + ox, by + 1, 12, 1, s.shirtLight);
  px(10 + ox, by + 7, 12, 1, s.shirtShade);
  px(10 + ox, by + 8, 12, 2, s.pants);

  // Outfit-specific torso details
  if (facing === 'up') {
    if (kind === 'columbia-student') {
      // Full chunky student backpack visible on back!
      drawRoundedRect(ctx, 10 + ox, by + 1, 12, 9, outline);
      px(11 + ox, by + 2, 10, 7, '#b5743c');
      px(11 + ox, by + 2, 10, 2, '#d49557');
      px(13 + ox, by + 5, 6, 3, '#8c5528');
      px(15 + ox, by + 5, 2, 1, '#f2c138'); // zipper clasp
    } else if (kind === 'broadway-theater') {
      px(10 + ox, by + 1, 12, 2, '#d93848');
    }
  } else {
    if (kind === 'columbia-student') {
      // White hoodie drawstrings + backpack shoulder straps
      px(11 + ox, by + 1, 2, 6, '#8c5528');
      px(19 + ox, by + 1, 2, 6, '#8c5528');
      px(14 + ox, by + 2, 1, 3, '#ffffff');
      px(17 + ox, by + 2, 1, 3, '#ffffff');
    } else if (kind === 'fidi-suit') {
      // Crisp white dress shirt + Wall St. red/gold tie
      px(13 + ox, by + 1, 6, 6, '#f8f9fc');
      px(15 + ox, by + 2, 2, 5, '#d63644');
      px(15 + ox, by + 3, 2, 1, '#f2c138');
    } else if (kind === 'broadway-theater') {
      // Dramatic crimson theater scarf
      px(10 + ox, by + 1, 12, 2, '#d93848');
      px(17 + ox, by + 3, 3, 4, '#d93848');
      px(18 + ox, by + 3, 1, 4, '#ff6b78');
    } else if (kind === 'park-jogger') {
      // Sporty white racing stripe on tank top
      px(12 + ox, by + 3, 8, 2, '#ffffff');
    } else if (kind === 'park-dog-walker') {
      // Cream sweater center under olive vest
      px(14 + ox, by + 1, 4, 7, '#f7f0dc');
    } else if (kind === 'fifth-shopper') {
      // Gold boutique coat buttons
      px(14 + ox, by + 2, 1, 1, '#f2c138');
      px(14 + ox, by + 5, 1, 1, '#f2c138');
      px(17 + ox, by + 2, 1, 1, '#f2c138');
      px(17 + ox, by + 5, 1, 1, '#f2c138');
    }
  }

  // --- STUBBY ARMS & DISTINCT NYC HAND PROPS ---
  const armSwing = stepPhase === 1 ? 1 : stepPhase === 2 ? -1 : 0;
  if (isSide) {
    const ax = 14 + ox + (stepPhase === 1 ? -1 : stepPhase === 2 ? 1 : 0);
    drawRoundedRect(ctx, ax, by + 2, 5, 6, outline);
    px(ax + 1, by + 3, 3, 2, kind === 'park-jogger' ? s.skin : s.shirtLight);
    px(ax + 1, by + 5, 3, 2, s.skin);
  } else {
    drawRoundedRect(ctx, 6 + ox, by + 2 + armSwing, 4, 6, outline);
    px(7 + ox, by + 3 + armSwing, 2, 2, kind === 'park-jogger' ? s.skin : s.shirt);
    px(7 + ox, by + 5 + armSwing, 2, 2, s.skin);

    drawRoundedRect(ctx, 22 + ox, by + 2 - armSwing, 4, 6, outline);
    px(23 + ox, by + 3 - armSwing, 2, 2, kind === 'park-jogger' ? s.skin : s.shirt);
    px(23 + ox, by + 5 - armSwing, 2, 2, s.skin);
  }

  // Distinct hand-held district props!
  if (kind === 'fidi-suit') {
    // Leather Wall St. briefcase with gleaming brass clasp
    const bx = isSide ? 15 + ox + (dir > 0 ? 1 : -4) : 23 + ox;
    const byOff = by + 7 - armSwing;
    drawRoundedRect(ctx, bx, byOff, 8, 6, outline);
    px(bx + 1, byOff + 1, 6, 4, '#5e3922');
    px(bx + 1, byOff + 1, 6, 1, '#855334');
    px(bx + 3, byOff + 2, 2, 1, '#f2c138');
  } else if (kind === 'fifth-shopper') {
    // Two bright Fifth Ave luxury shopping bags!
    // Left Tiffany-blue bag
    const lx = isSide ? 11 + ox : 2 + ox;
    px(lx + 1, by + 6 + armSwing, 4, 2, outline); // handle
    drawRoundedRect(ctx, lx, by + 7 + armSwing, 6, 7, outline);
    px(lx + 1, by + 8 + armSwing, 4, 5, '#64d2d6');
    px(lx + 1, by + 8 + armSwing, 4, 1, '#a6f0f2');
    // Right orange-gold boutique bag
    const rx = isSide ? 17 + ox : 24 + ox;
    px(rx + 1, by + 6 - armSwing, 4, 2, outline);
    drawRoundedRect(ctx, rx, by + 7 - armSwing, 6, 7, outline);
    px(rx + 1, by + 8 - armSwing, 4, 5, '#f08a38');
    px(rx + 1, by + 8 - armSwing, 4, 1, '#ffba75');
  } else if (kind === 'broadway-theater') {
    // Bright yellow Broadway Playbill program in right hand
    const pxX = isSide ? 16 + ox : 23 + ox;
    px(pxX, by + 5 - armSwing, 5, 6, outline);
    px(pxX + 1, by + 6 - armSwing, 3, 2, '#ffd43b');
    px(pxX + 1, by + 8 - armSwing, 3, 2, '#22202b');
  } else if (kind === 'village-artist') {
    // Cozy NYC takeaway coffee cup in left hand
    const cx = isSide ? 16 + ox : 3 + ox;
    px(cx, by + 5 + armSwing, 4, 6, outline);
    px(cx + 1, by + 6 + armSwing, 2, 4, '#f7f5ef');
    px(cx + 1, by + 7 + armSwing, 2, 2, '#c88c50');
    px(cx, by + 5 + armSwing, 4, 1, '#ffffff');
  } else if (kind === 'park-dog-walker') {
    // Red leash + CUTE LITTLE GOLDEN DOG trotting happily beside the walker!
    const dogBob = stepPhase === 1 ? -1 : 0;
    const dx = 24;
    const dy = 28 + dogBob;

    // Red diagonal leash from walker's hand to dog collar
    ctx.fillStyle = '#d94848';
    px(22, by + 6, 2, 1, '#d94848');
    px(23, by + 7, 2, 1, '#d94848');
    px(25, by + 8, 2, 1, '#d94848');

    // Tiny ground shadow under dog
    px(dx + 1, 37, 9, 2, 'rgba(30, 24, 22, 0.24)');

    // Wagging golden tail
    px(dx + 9, dy + 1 + (stepPhase === 2 ? -1 : 0), 2, 3, outline);
    px(dx + 9, dy + 2 + (stepPhase === 2 ? -1 : 0), 1, 2, '#f2b84b');

    // Plump little golden dog body
    drawRoundedRect(ctx, dx + 2, dy + 3, 8, 5, outline);
    px(dx + 3, dy + 4, 6, 3, '#e8a83e');
    px(dx + 3, dy + 4, 5, 1, '#ffd073');

    // Bouncy tiny dog paws
    const paw1 = stepPhase === 1 ? 0 : 1;
    const paw2 = stepPhase === 2 ? 0 : 1;
    px(dx + 3, dy + 7 + paw1, 2, 2, outline);
    px(dx + 7, dy + 7 + paw2, 2, 2, outline);

    // Cute round golden puppy head + floppy ear + button nose
    drawRoundedRect(ctx, dx, dy, 6, 6, outline);
    px(dx + 1, dy + 1, 4, 4, '#f2b84b');
    px(dx + 1, dy + 1, 3, 1, '#ffe094');
    // Floppy darker-golden ear
    px(dx + 4, dy + 2, 2, 3, '#b8761d');
    // Tiny eye & nose + red collar
    px(dx + 2, dy + 2, 1, 1, outline);
    px(dx + 1, dy + 3, 1, 1, outline);
    px(dx + 2, dy + 5, 4, 1, '#d94848');
  }

  // --- FRIENDLY CHIBI HEAD (18w x 16h, identical friendly style to founders!) ---
  const hx = 7 + ox;
  const hy = 9 + bob;

  px(hx + 2, hy, 14, 16, outline);
  px(hx + 1, hy + 1, 16, 14, outline);
  px(hx, hy + 3, 18, 10, outline);
  px(hx + 2, hy + 1, 14, 14, s.skin);
  px(hx + 1, hy + 3, 16, 10, s.skin);
  px(hx + 4, hy + 2, 10, 2, s.skinLight);
  px(hx + 2, hy + 13, 14, 2, s.skinShade);

  if (facing === 'up') {
    px(hx + 1, hy + 1, 16, 13, s.hair);
    px(hx + 2, hy + 11, 14, 3, s.hairShade);
    px(hx + 4, hy + 3, 10, 2, s.hairLight);
    if (kind === 'park-jogger') {
      px(hx + 1, hy + 3, 16, 2, '#f05454');
    } else if (kind === 'village-artist') {
      drawRoundedRect(ctx, hx + 1, hy - 3, 16, 6, outline);
      px(hx + 2, hy - 2, 14, 4, '#8c2d4b');
    }
    return toPixelTexture(c);
  }

  // Two symmetrical friendly eyes (ALWAYS both visible on front/left/right!)
  const drawEye = (ex: number, ey: number, pupilDx: number) => {
    px(ex, ey - 1, 3, 1, outline);
    px(ex, ey, 3, 4, '#ffffff');
    px(ex + pupilDx, ey + 1, 2, 3, '#261e1c');
    px(ex + pupilDx, ey + 1, 1, 1, '#ffffff');
  };
  drawEye(hx + 3 + faceShift, hy + 7, facing === 'left' ? 0 : 1);
  drawEye(hx + 12 + faceShift, hy + 7, facing === 'right' ? 1 : 0);

  // Soft rosy blush & warm smile
  px(hx + 2 + faceShift, hy + 11, 2, 1, s.cheek);
  px(hx + 14 + faceShift, hy + 11, 2, 1, s.cheek);
  px(hx + 7 + faceShift, hy + 12, 4, 1, '#8c5342');
  px(hx + 8 + faceShift, hy + 13, 2, 1, '#b57360');

  // --- HAIR & DISTINCT HEADWEAR ---
  px(hx + 1, hy - 2, 16, 7, outline);
  px(hx, hy + 1, 18, 5, outline);
  px(hx + 2, hy - 1, 14, 6, s.hair);
  px(hx + 1, hy + 1, 16, 4, s.hair);
  px(hx + 4, hy, 10, 2, s.hairLight);
  px(hx + 3, hy + 4, 4, 2, s.hair);
  px(hx + 11, hy + 4, 4, 2, s.hair);
  px(hx + 1, hy + 5, 2, 3, s.hairShade);
  px(hx + 15, hy + 5, 2, 3, s.hairShade);

  if (kind === 'park-jogger') {
    // Vibrant sporty coral-red headband
    px(hx, hy + 2, 18, 3, outline);
    px(hx + 1, hy + 3, 16, 2, '#f05454');
    px(hx + 4, hy + 3, 10, 1, '#ff8787');
  } else if (kind === 'village-artist') {
    // Cozy burgundy French artist beret tilted on top
    drawRoundedRect(ctx, hx, hy - 4, 18, 6, outline);
    px(hx + 1, hy - 3, 16, 4, '#8c2d4b');
    px(hx + 3, hy - 3, 11, 2, '#b54567');
    px(hx + 8, hy - 5, 2, 2, outline); // beret stem
  } else if (kind === 'fifth-shopper') {
    // Longer chic blonde bob framing face
    px(hx - 1, hy + 3, 3, 9, outline);
    px(hx + 16, hy + 3, 3, 9, outline);
    px(hx, hy + 4, 2, 7, s.hair);
    px(hx + 16, hy + 4, 2, 7, s.hair);
  }

  return toPixelTexture(c);
}





// ============================================================================
// WORLD MARKERS: the player's chevron + ground ring, and queue mood faces
// ============================================================================

/** The one outline colour used by every character and marker sprite. */
const WORLD_OUTLINE = '#2b2118';
/** The UI's "control blue" (--accent in tokens.css), so the 3D marker matches the HUD. */
const MARKER_BLUE = '#5aa9e6';
const MARKER_BLUE_LIGHT = '#a9d6f5';

/**
 * A small down-pointing chevron that floats above the player's head ("this one is you").
 *
 * Built from a bit mask instead of hand-placed rectangles: we describe only the blue
 * shape, then paint a 1px outline on every empty pixel that touches it (including
 * diagonals). That guarantees an even, gap-free outline whatever the shape is.
 */
export function createPlayerChevronTexture(): THREE.CanvasTexture {
  const W = 9;
  const H = 5;
  // Two 2px-thick strokes forming a V: row r puts a stroke at x = r..r+1 and its mirror.
  const blue: boolean[][] = Array.from({ length: H }, () => Array<boolean>(W).fill(false));
  for (let r = 0; r < H; r++) {
    for (const x of [r, r + 1, W - 1 - r, W - 2 - r]) {
      if (x >= 0 && x < W) blue[r][x] = true;
    }
  }
  const PAD = 1;
  const [c, ctx] = makeCanvas(W + PAD * 2, H + PAD * 2);
  const isBlue = (x: number, y: number) => y >= 0 && y < H && x >= 0 && x < W && blue[y][x];
  for (let y = -PAD; y < H + PAD; y++) {
    for (let x = -PAD; x < W + PAD; x++) {
      if (isBlue(x, y)) {
        ctx.fillStyle = y === 0 ? MARKER_BLUE_LIGHT : MARKER_BLUE;
        ctx.fillRect(x + PAD, y + PAD, 1, 1);
        continue;
      }
      let touches = false;
      for (let dy = -1; dy <= 1 && !touches; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (isBlue(x + dx, y + dy)) {
            touches = true;
            break;
          }
        }
      }
      if (touches) {
        ctx.fillStyle = WORLD_OUTLINE;
        ctx.fillRect(x + PAD, y + PAD, 1, 1);
      }
    }
  }
  return toPixelTexture(c);
}

/**
 * A soft blue ring drawn on the ground around the player's feet. Smooth (not pixel
 * art) on purpose: it is a light-on-the-floor effect, like the contact shadows.
 */
export function createPlayerRingTexture(): THREE.CanvasTexture {
  const SIZE = 64;
  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d')!;
  const cx = SIZE / 2;
  // Faint inner fill so the ring reads as a pad, then a crisp ring with a soft glow.
  const fill = ctx.createRadialGradient(cx, cx, 0, cx, cx, 26);
  fill.addColorStop(0, 'rgba(90, 169, 230, 0.18)');
  fill.addColorStop(1, 'rgba(90, 169, 230, 0.05)');
  ctx.fillStyle = fill;
  ctx.beginPath();
  ctx.arc(cx, cx, 26, 0, Math.PI * 2);
  ctx.fill();
  ctx.lineWidth = 6;
  ctx.strokeStyle = 'rgba(90, 169, 230, 0.35)';
  ctx.beginPath();
  ctx.arc(cx, cx, 26, 0, Math.PI * 2);
  ctx.stroke();
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(169, 214, 245, 0.95)';
  ctx.beginPath();
  ctx.arc(cx, cx, 26, 0, Math.PI * 2);
  ctx.stroke();
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * The 7x7 face floating over a queued customer. The fill colour repeats the patience
 * bar's traffic-light colours (green / amber / red) so the mood is readable even when
 * the sprite is only a few screen pixels wide.
 */
export function createMoodFaceTexture(mood: QueueMood): THREE.CanvasTexture {
  const [c, ctx] = makeCanvas(7, 7);
  const fill = mood === 'happy' ? '#9be37a' : mood === 'neutral' ? '#ffd84d' : '#f26b5b';
  const px = (x: number, y: number, w: number, h: number, col: string) => {
    ctx.fillStyle = col;
    ctx.fillRect(x, y, w, h);
  };
  // Round-ish head: 5x5 fill inside a 1px outline with clipped corners.
  px(1, 0, 5, 7, WORLD_OUTLINE);
  px(0, 1, 7, 5, WORLD_OUTLINE);
  px(1, 1, 5, 5, fill);
  // Eyes
  px(2, 2, 1, 1, WORLD_OUTLINE);
  px(4, 2, 1, 1, WORLD_OUTLINE);
  // Mouth: corners up (happy), a straight line (neutral), corners down (angry).
  if (mood === 'happy') {
    px(1, 3, 1, 1, WORLD_OUTLINE);
    px(5, 3, 1, 1, WORLD_OUTLINE);
    px(2, 4, 3, 1, WORLD_OUTLINE);
  } else if (mood === 'neutral') {
    px(2, 4, 3, 1, WORLD_OUTLINE);
  } else {
    px(2, 4, 3, 1, WORLD_OUTLINE);
    px(1, 5, 1, 1, WORLD_OUTLINE);
    px(5, 5, 1, 1, WORLD_OUTLINE);
  }
  return toPixelTexture(c);
}
