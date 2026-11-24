// Seeded randomness for the whole game.
//
// WHY SEEDS?
// A computer cannot produce "true" randomness; a pseudo-random number generator
// (PRNG) is a formula that turns a hidden number (its state) into a long,
// random-looking sequence. Start two generators from the same starting number
// (the SEED) and they produce the exact same sequence. So if a playtester says
// "seed 123456789 felt unfair on day 3", we can replay the same customers and
// the same minigame targets. Math.random() cannot do this: it has no seed.
//
// WHY SEPARATE STREAMS?
// Imagine one shared generator. A sparkle particle asks it for a number, and now
// every later number shifts by one: the next customer arrives at a different
// moment. Replays would drift apart just because the player's frame rate
// changed how many sparkles were drawn. So each category of randomness gets its
// OWN generator ("stream"):
//   - deal:     the deal / market rolls (reserved for the deal system)
//   - gameplay: anything that changes game outcomes (customer flow, minigames)
//   - cosmetic: visuals and audio only (sparkles, footstep pitch)
// Cosmetic draws can then happen any number of times without disturbing gameplay.
//
// HOW THE STREAMS ARE DERIVED
// All three come from one seed using xoroshiro128+ and its jump() function.
// jump() moves a generator 2^64 steps ahead in its 2^128-long cycle. Stream N is
// the seed's generator jumped N times, so the streams are guaranteed not to
// overlap for any realistic run length. (Seeding three generators with three
// different numbers only makes overlap unlikely, not impossible.)
//
// This file is pure: no DOM, no React. `newRandomSeed` uses `crypto`, which
// exists in both browsers and Node. It is the only place allowed to name the
// non-seedable built-in generator (see noMathRandom.test.ts).

import { uniformFloat64 } from 'pure-rand/distribution/uniformFloat64';
import { xoroshiro128plus } from 'pure-rand/generator/xoroshiro128plus';

/** A function returning a float in [0, 1), the same contract as Math.random. */
export type Random = () => number;

export interface RunStreams {
  deal: Random;
  gameplay: Random;
  cosmetic: Random;
}

const MAX_SEED = 0xffffffff; // largest unsigned 32-bit integer

export function createRunStreams(seed: number): RunStreams {
  // pure-rand's generators mutate themselves in place, so each closure below
  // owns its generator and every call advances it.
  const base = xoroshiro128plus(seed | 0); // pure-rand wants a signed 32-bit int
  const dealGen = base.clone();
  base.jump();
  const gameplayGen = base.clone();
  base.jump();
  const cosmeticGen = base.clone();
  return {
    deal: () => uniformFloat64(dealGen),
    gameplay: () => uniformFloat64(gameplayGen),
    cosmetic: () => uniformFloat64(cosmeticGen),
  };
}

/**
 * Parse a seed from user input such as a `?seed=` URL parameter.
 * Accepts only plain base-10 digits that fit in an unsigned 32-bit integer.
 * Returns null for anything else (including null input) so the caller can
 * decide whether that is an error; we never guess what the user meant.
 */
export function parseSeed(raw: string | null): number | null {
  if (raw === null || !/^[0-9]+$/.test(raw)) return null;
  const n = Number(raw);
  return Number.isSafeInteger(n) && n <= MAX_SEED ? n : null;
}

/** A fresh unpredictable seed (cryptographic source, so two tabs never collide). */
export function newRandomSeed(): number {
  return crypto.getRandomValues(new Uint32Array(1))[0];
}
