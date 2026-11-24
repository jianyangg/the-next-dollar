// Holds the random streams for the CURRENT run (one page load = one run).
//
// main.tsx calls initRunRandom(seed) once before React renders. Everything else
// asks for a stream through the accessors below. Calling an accessor before
// init throws: silently falling back to an unseeded generator would make a run
// unreproducible without anyone noticing, which defeats the whole point.

import { createRunStreams, type Random, type RunStreams } from './rng';

let currentSeed: number | null = null;
let streams: RunStreams | null = null;

export function initRunRandom(seed: number): void {
  currentSeed = seed;
  streams = createRunStreams(seed);
}

function requireStreams(): RunStreams {
  if (streams === null) {
    throw new Error('Run randomness used before initRunRandom(seed) was called (see src/main.tsx).');
  }
  return streams;
}

export function getRunSeed(): number {
  if (currentSeed === null) {
    throw new Error('getRunSeed() called before initRunRandom(seed) was called (see src/main.tsx).');
  }
  return currentSeed;
}

// Each accessor returns a function that looks the stream up on every call, so
// callers can hold on to the function safely.
export const gameplayRandom: Random = () => requireStreams().gameplay();
export const cosmeticRandom: Random = () => requireStreams().cosmetic();
export const dealRandom: Random = () => requireStreams().deal();
