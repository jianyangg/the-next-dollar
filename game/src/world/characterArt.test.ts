import { describe, expect, it } from 'vitest';
import {
  CHARACTER_IDS,
  CHARACTER_PALETTE,
  characterPixels,
  characterWidth,
  knockedOutPixels,
  portraitPixels,
  type CharacterFrame,
  type CharacterId,
  type CharacterPixels,
  type Facing,
} from './characterArt';
import { FOUNDER_CATALOG } from './pixelArt';

/**
 * The character art is data (a palette key per pixel), so its rules are checked here in plain
 * Node, without a canvas. These are the promises the scene relies on:
 *   - every frame the scene can request exists, at the canvas size the sprite scale assumes;
 *   - the 1px outline is unbroken and never touches the canvas border (a sprite drawn to the
 *     edge would be cut off, and texture filtering would smear the edge);
 *   - control blue (the "works for you" colour) is worn only by the player's staff;
 *   - each founder wears their exact FOUNDER_CATALOG accent.
 */

const FACINGS: Facing[] = ['down', 'up', 'left', 'right'];
const FRAMES: CharacterFrame[] = [
  { stepPhase: 0 },
  { stepPhase: 1 },
  { stepPhase: 2 },
  { stepPhase: 0, breathe: true },
  { stepPhase: 0, blink: true },
  { stepPhase: 0, breathe: true, blink: true },
];

const at = (p: CharacterPixels, x: number, y: number) =>
  x < 0 || y < 0 || x >= p.w || y >= p.h ? null : p.keys[y * p.w + x];

/** Filled pixels (not outline) that have an empty 4-neighbour: a hole in the outline. */
function outlineGaps(p: CharacterPixels): number {
  let gaps = 0;
  for (let y = 0; y < p.h; y++)
    for (let x = 0; x < p.w; x++) {
      const k = at(p, x, y);
      if (!k || k === 'out') continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (!at(p, x + dx, y + dy)) gaps++;
    }
  return gaps;
}

/**
 * Body pixels on the canvas border. The outline itself may sit on the border (Alex's tallest
 * spike reaches row 0 mid-stride), but a body pixel there means its outline was cut off.
 */
function edgePixels(p: CharacterPixels): number {
  let n = 0;
  for (let y = 0; y < p.h; y++)
    for (let x = 0; x < p.w; x++) {
      const k = at(p, x, y);
      if ((x === 0 || y === 0 || x === p.w - 1 || y === p.h - 1) && k && k !== 'out') n++;
    }
  return n;
}

const uses = (p: CharacterPixels, key: keyof typeof CHARACTER_PALETTE) => p.keys.some((k) => k === key);

describe('characterArt', () => {
  it('draws every role in every facing and frame the scene requests, cleanly outlined', () => {
    for (const id of CHARACTER_IDS) {
      for (const facing of FACINGS) {
        for (const f of FRAMES) {
          const p = characterPixels(id, { ...f, facing });
          const where = `${id} ${facing} ${JSON.stringify(f)}`;
          expect([p.w, p.h], where).toEqual([characterWidth(id), 40]);
          expect(p.keys.filter(Boolean).length, where).toBeGreaterThan(200);
          expect(p.clipped, where).toBe(0);
          expect(outlineGaps(p), where).toBe(0);
          expect(edgePixels(p), where).toBe(0);
        }
      }
    }
  });

  it('keeps the outline baseline on row 37 for standing frames (the scene placed sprites on it)', () => {
    for (const id of CHARACTER_IDS) {
      const p = characterPixels(id, { facing: 'down' });
      let lowest = -1;
      for (let y = 0; y < p.h; y++) if (p.keys.slice(y * p.w, (y + 1) * p.w).some(Boolean)) lowest = y;
      expect(lowest, id).toBe(37);
    }
  });

  it('draws the player apron and the knocked-out frames, also cleanly outlined', () => {
    const founders = FOUNDER_CATALOG.map((f) => f.id);
    for (const id of founders)
      for (const facing of FACINGS) {
        const p = characterPixels(id, { facing, accessory: 'apron', stepPhase: 1 });
        expect(outlineGaps(p), `${id} apron ${facing}`).toBe(0);
        expect(edgePixels(p), `${id} apron ${facing}`).toBe(0);
      }
    for (const id of CHARACTER_IDS) {
      const ko = knockedOutPixels(id);
      expect(ko.w, id).toBe(characterWidth(id));
      expect(outlineGaps(ko), id).toBe(0);
      expect(edgePixels(ko), id).toBe(0);
      expect(ko.clipped, id).toBe(0);
      expect(uses(ko, 'ko_1'), id).toBe(true);
    }
  });

  it('gives portraits a 32x32 face crop for founders and shopkeepers', () => {
    const ids: CharacterId[] = ['squirrel', 'shiba', 'panda', 'penguin', 'bunny', 'broker', 'grower', 'carpenter', 'glazier'];
    for (const id of ids) {
      const p = portraitPixels(id);
      expect([p.w, p.h], id).toEqual([32, 32]);
      expect(p.keys.filter(Boolean).length, id).toBeGreaterThan(300);
    }
  });

  it('reserves control blue for the player staff (worker and manager)', () => {
    for (const id of CHARACTER_IDS) {
      const wears = FACINGS.some((facing) => uses(characterPixels(id, { facing }), 'ctrl_1'));
      expect(wears, id).toBe(id === 'helper' || id === 'manager');
    }
  });

  it("dresses each founder in their exact catalog accent, and no passer-by in Alex's lemon", () => {
    const byHex = new Map(Object.entries(CHARACTER_PALETTE).map(([k, hex]) => [hex.toLowerCase(), k]));
    for (const f of FOUNDER_CATALOG) {
      const key = byHex.get(f.accent.toLowerCase());
      expect(key, f.name).toBeDefined();
      const p = characterPixels(f.id, { facing: 'down' });
      expect(p.keys.filter((k) => k === key).length, f.name).toBeGreaterThanOrEqual(10);
    }
    const peds = CHARACTER_IDS.filter((id) => characterWidth(id) === 36);
    expect(peds).toHaveLength(7);
    for (const id of peds) expect(uses(characterPixels(id, { facing: 'down' }), 'lemon_1'), id).toBe(false);
  });

  it('only ever uses palette colours', () => {
    const keys = new Set(Object.keys(CHARACTER_PALETTE));
    for (const id of CHARACTER_IDS)
      for (const facing of FACINGS)
        for (const k of characterPixels(id, { facing, stepPhase: 1 }).keys) if (k) expect(keys.has(k)).toBe(true);
  });
});
