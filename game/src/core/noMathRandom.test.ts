// Guard: the unseeded built-in random function must never creep back into the game.
// Every draw has to come from the seeded streams in rng.ts, otherwise a reported
// seed would no longer replay the same run. There is no ESLint in this project,
// so this test plays the role of a lint rule by scanning the source text.

import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const SRC_DIR = join(__dirname, '..');
const ALLOWED = join('core', 'rng.ts'); // the one file allowed to mention it (docs)
const FORBIDDEN = 'Math.' + 'random'; // split so this file does not match itself

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

describe('seeded randomness guard', () => {
  it('no source file outside core/rng.ts uses the unseeded generator', () => {
    const offenders = sourceFiles(SRC_DIR)
      .map((f) => relative(SRC_DIR, f))
      .filter((rel) => rel !== ALLOWED)
      .filter((rel) => readFileSync(join(SRC_DIR, rel), 'utf8').includes(FORBIDDEN));
    expect(offenders).toEqual([]);
  });
});
