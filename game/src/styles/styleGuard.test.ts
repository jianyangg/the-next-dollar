import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Guard tests for the "Paper Trail" UI rules. They read the source files (no browser)
 * and fail when a banned pattern comes back, so the design holds after this redesign:
 *
 *   1. No fine print: every CSS / inline font size is at least 16px.
 *   2. Colours come only from tokens.css (no raw hex / rgb outside it), so every screen
 *      stays on one palette.
 *   3. No emoji in UI code or in the notes the store floats over the world.
 *   4. One keyboard listener: only the input router (state/input.ts) listens for game
 *      keys; App.tsx's one-time "unlock audio on first key" listener is the exception.
 */

const SRC = join(__dirname, '..');
const MIN_FONT_PX = 16;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else out.push(path);
  }
  return out;
}

const files = walk(SRC).filter((f) => !f.includes('.test.'));
const cssFiles = files.filter((f) => f.endsWith('.css'));
const uiTsx = files.filter((f) => f.endsWith('.tsx'));
const rel = (f: string) => relative(SRC, f);

/** Every `font-size: Npx` (CSS) or `fontSize: N` / `fontSize: 'Npx'` (inline) under 16px. */
function smallFonts(file: string): string[] {
  const text = readFileSync(file, 'utf8');
  const hits: string[] = [];
  const patterns = [/font-size:\s*([\d.]+)px/g, /fontSize:\s*['"]?([\d.]+)(?:px)?['"]?/g];
  for (const re of patterns) {
    for (const m of text.matchAll(re)) {
      if (Number(m[1]) < MIN_FONT_PX) hits.push(`${rel(file)}: ${m[0]}`);
    }
  }
  return hits;
}

describe('Paper Trail style guard', () => {
  it(`has no font size under ${MIN_FONT_PX}px anywhere in the UI`, () => {
    const hits = [...cssFiles, ...uiTsx].flatMap(smallFonts);
    expect(hits).toEqual([]);
  });

  it('types colours only in tokens.css', () => {
    const hits = cssFiles
      .filter((f) => !f.endsWith(join('styles', 'tokens.css')))
      .flatMap((f) =>
        [...readFileSync(f, 'utf8').matchAll(/#[0-9a-fA-F]{3,8}\b|rgba?\(/g)].map((m) => `${rel(f)}: ${m[0]}`)
      );
    expect(hits).toEqual([]);
  });

  it('shows no emoji in UI code or floating notes', () => {
    const emoji = /\p{Extended_Pictographic}/u;
    const allowed = new Set(['★', '©', '®', '™']); // ★ is the rating star, a text symbol
    const sources = [...uiTsx, join(SRC, 'state', 'gameStore.ts')];
    const hits = sources.flatMap((f) =>
      readFileSync(f, 'utf8')
        .split('\n')
        .filter((line) => [...line].some((ch) => emoji.test(ch) && !allowed.has(ch)))
        .map((line) => `${rel(f)}: ${line.trim()}`)
    );
    expect(hits).toEqual([]);
  });

  it('listens for keys only through the input router', () => {
    const allowed = new Set([join('state', 'input.ts'), 'App.tsx']);
    const hits = files
      .filter((f) => /\.(ts|tsx)$/.test(f) && !allowed.has(rel(f)))
      .filter((f) => /addEventListener\(\s*['"]key(down|up)['"]/.test(readFileSync(f, 'utf8')))
      .map(rel);
    expect(hits).toEqual([]);
  });
});
