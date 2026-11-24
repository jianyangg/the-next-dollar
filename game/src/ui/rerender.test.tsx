// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { Profiler } from 'react';
import { domAnimation, LazyMotion } from 'motion/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Render-count guard for the split UI.
 *
 * `brewGame` (and `serveProgress`) are replaced about 60 times a second while a mini-game
 * runs. The point of splitting App into components is that ONLY the components drawing
 * those values re-render. React's <Profiler> calls `onRender` once per commit that touched
 * anything inside it, so counting those calls per component id tells us who re-rendered.
 */

// jsdom has no 2D canvas, so the pixel-art helpers are replaced by trivial fakes.
vi.mock('../world/pixelArt', () => ({
  FOUNDER_CATALOG: [
    { id: 'squirrel', name: 'Sam', title: 'Founder', tagline: 'Nutty' },
    { id: 'panda', name: 'Pan', title: 'Founder', tagline: 'Chill' },
  ],
  createMascotPortraitDataUrl: () => 'data:image/png;base64,AA==',
  createMascotSpriteTexture: () => ({ image: null }),
  createUiIconDataUrl: () => 'data:image/png;base64,AA==',
}));

vi.mock('../audio/soundEngine', () => {
  const noop = () => {};
  return {
    soundEngine: {
      isMuted: () => false,
      toggleMute: () => false,
      initOnGesture: noop,
      startMusic: noop,
      stopMusic: noop,
      playClick: noop,
      playReject: noop,
      playBuy: noop,
      playCoin: noop,
      playBrew: noop,
      playPerfect: noop,
      playDayEnd: noop,
      playDayLost: noop,
      playLineCrossed: noop,
      playTravel: noop,
      setMusicTheme: noop,
      setMusicHushed: noop,
      playSubwayDepart: noop,
      playSubwayArrive: noop,
      playMapStation: noop,
      playMapSelect: noop,
      playHonkKo: noop,
    },
  };
});

import { initGame } from '../core/minigames';
import { initRunRandom } from '../core/runRandom';
import { resetAnchorStore } from '../state/anchorStore';
import { resetGameStore, useGameStore } from '../state/gameStore';
import { BooksDrawer } from './BooksDrawer';
import { BrewStep } from './BrewMinigame';
import { Hud } from './Hud';
import { ServeStep } from './StandWorkbench';
import { TutorialBar } from './TutorialBar';

beforeAll(() => initRunRandom(12345));
beforeEach(() => {
  resetGameStore();
  resetAnchorStore();
});
afterEach(() => {
  cleanup();
  resetGameStore();
});

describe('per-frame brew mini-game state', () => {
  it('keeps BrewStep, Hud, BooksDrawer and TutorialBar from re-rendering per frame', async () => {
    // Put the store in "behind the counter, mini-game running, books open".
    act(() => {
      const s = useGameStore.getState();
      useGameStore.setState({
        introOpen: false,
        founderModalOpen: false,
        workingAtStand: true,
        booksOpen: true,
        economy: { ...s.economy, pitchers: 1, cupsInStock: 10 },
        brewGame: initGame('moving-bullseye', () => 0.5),
      });
    });

    const renders: Record<string, number> = { hud: 0, books: 0, tutorial: 0, brew: 0 };
    const count = (id: string) => () => {
      renders[id] += 1;
    };

    const { container } = render(
      <LazyMotion features={domAnimation} strict>
        <Profiler id="hud" onRender={count('hud')}>
          <Hud />
        </Profiler>
        <Profiler id="tutorial" onRender={count('tutorial')}>
          <TutorialBar />
        </Profiler>
        <Profiler id="books" onRender={count('books')}>
          <BooksDrawer />
        </Profiler>
        <Profiler id="brew" onRender={count('brew')}>
          <BrewStep />
        </Profiler>
      </LazyMotion>
    );

    // Sanity: all four really are on screen (a component that renders nothing could
    // trivially "not re-render" and make this test meaningless).
    expect(container.querySelector('.hud')).not.toBeNull();
    expect(container.querySelector('.world-goal')).not.toBeNull();
    expect(container.querySelector('.books-sheet')).not.toBeNull();
    expect(container.querySelector('.stand-needle')).not.toBeNull();

    const before = { ...renders };

    // Step the mini-game 30 frames: the needle sweeps across the gauge.
    act(() => {
      for (let i = 1; i <= 30; i++) {
        const game = useGameStore.getState().brewGame;
        if (!game || game.kind !== 'moving-bullseye') throw new Error('expected a running bullseye game');
        useGameStore.setState({ brewGame: { ...game, needle: i / 30, bullseye: 0.5 + i / 100 } });
      }
    });

    // The needle really moved. Motion writes motion values to the DOM on its own frame
    // loop (outside React), so wait for that flush instead of expecting it synchronously.
    const needle = container.querySelector<HTMLElement>('.stand-needle');
    await vi.waitFor(() => expect(needle?.style.left).toBe('100%'));
    await vi.waitFor(() =>
      expect(container.querySelector<HTMLElement>('.stand-zone-perfect')?.style.left).toBe('80%')
    );
    // 30 continuous frames cost the brew component NO React renders at all (only discrete
    // changes like a new challenge or a landed step may re-render it)...
    expect(renders.brew - before.brew).toBeLessThanOrEqual(2);
    // ...and nothing else re-rendered either.
    expect(renders.hud).toBe(before.hud);
    expect(renders.books).toBe(before.books);
    expect(renders.tutorial).toBe(before.tutorial);
  });

  it('keeps ServeStep, Hud, BooksDrawer and TutorialBar from re-rendering while the pour bar animates', async () => {
    act(() => {
      useGameStore.setState({ founderModalOpen: false, booksOpen: true, workingAtStand: true });
    });
    const renders: Record<string, number> = { hud: 0, books: 0, tutorial: 0, serve: 0 };
    const count = (id: string) => () => {
      renders[id] += 1;
    };
    const { container } = render(
      <LazyMotion features={domAnimation} strict>
        <Profiler id="hud" onRender={count('hud')}>
          <Hud />
        </Profiler>
        <Profiler id="tutorial" onRender={count('tutorial')}>
          <TutorialBar />
        </Profiler>
        <Profiler id="books" onRender={count('books')}>
          <BooksDrawer />
        </Profiler>
        <Profiler id="serve" onRender={count('serve')}>
          <ServeStep />
        </Profiler>
      </LazyMotion>
    );
    const fill = container.querySelector<HTMLElement>('.stand-pour-fill');
    expect(fill).not.toBeNull();
    const before = { ...renders };

    // The pour starts (serveProgress null -> a number is ONE discrete change, so ServeStep may
    // re-render once to say "Pouring..."), then the remaining frames are pure progress.
    act(() => {
      for (let i = 1; i <= 30; i++) useGameStore.setState({ serveProgress: i / 31 });
    });

    // The bar visibly filled (30/31 = 96.8% -> "97%"), written by Motion, not by React.
    await vi.waitFor(() => expect(fill?.style.width).toBe('97%'));
    // 30 frames cost at most the single "pour started" re-render, not 30.
    expect(renders.serve - before.serve).toBeLessThanOrEqual(1);
    expect(renders.hud).toBe(before.hud);
    expect(renders.books).toBe(before.books);
    expect(renders.tutorial).toBe(before.tutorial);
  });
});
