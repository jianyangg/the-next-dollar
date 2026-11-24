import React from 'react';
import ReactDOM from 'react-dom/client';
import { App } from './App';
import { newRandomSeed, parseSeed } from './core/rng';
import { initRunRandom } from './core/runRandom';
// Paper Trail design system: tokens first (every other sheet reads them), then base, then the kit.
import './styles/fonts';
import './styles/tokens.css';
import './styles/base.css';
import './styles/kit.css';

// Pick the run seed BEFORE anything renders, so every random draw is reproducible.
// `?seed=123` replays a run; a malformed seed is an error rather than being
// quietly replaced, because a tester who typed a seed expects exactly that run.
const rawSeed = new URLSearchParams(window.location.search).get('seed');
let seed: number;
if (rawSeed === null) {
  seed = newRandomSeed();
} else {
  const parsed = parseSeed(rawSeed);
  if (parsed === null) {
    throw new Error(
      `Invalid ?seed=${JSON.stringify(rawSeed)}: expected a whole number from 0 to 4294967295 (digits only).`
    );
  }
  seed = parsed;
}
initRunRandom(seed);
console.info('[the-next-dollar] run seed', seed, '— reproduce with ?seed=' + seed);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
