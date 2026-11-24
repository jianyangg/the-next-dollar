// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { Profiler } from 'react';
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
      playTravel: noop,
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
  it('re-renders the brew component but not Hud, BooksDrawer or TutorialBar', () => {
    // Put the store in "behind the counter, mini-game running, books open".
    act(() => {
      const s = useGameStore.getState();
      useGameStore.setState({
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
      <>
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
      </>
    );

    // Sanity: all four really are on screen (a component that renders nothing could
    // trivially "not re-render" and make this test meaningless).
    expect(container.querySelector('.top-hud')).not.toBeNull();
    expect(container.querySelector('.tutorial-banner')).not.toBeNull();
    expect(container.querySelector('.books-drawer')).not.toBeNull();
    expect(container.querySelector('.wb-skill-needle')).not.toBeNull();

    const before = { ...renders };

    // Step the mini-game 30 frames: the needle sweeps across the gauge.
    act(() => {
      for (let i = 1; i <= 30; i++) {
        const game = useGameStore.getState().brewGame;
        if (!game || game.kind !== 'moving-bullseye') throw new Error('expected a running bullseye game');
        useGameStore.setState({ brewGame: { ...game, needle: i / 30 } });
      }
    });

    // The needle really moved...
    const needle = container.querySelector<HTMLElement>('.wb-skill-needle');
    expect(needle?.style.left).toBe('100%');
    // ...the brew component re-rendered, and nothing else did.
    expect(renders.brew).toBeGreaterThan(before.brew);
    expect(renders.hud).toBe(before.hud);
    expect(renders.books).toBe(before.books);
    expect(renders.tutorial).toBe(before.tutorial);
  });

  it('does not re-render Hud, BooksDrawer or TutorialBar while the pour bar (serveProgress) animates', () => {
    act(() => {
      useGameStore.setState({ founderModalOpen: false, booksOpen: true });
    });
    const renders: Record<string, number> = { hud: 0, books: 0, tutorial: 0 };
    const count = (id: string) => () => {
      renders[id] += 1;
    };
    render(
      <>
        <Profiler id="hud" onRender={count('hud')}>
          <Hud />
        </Profiler>
        <Profiler id="tutorial" onRender={count('tutorial')}>
          <TutorialBar />
        </Profiler>
        <Profiler id="books" onRender={count('books')}>
          <BooksDrawer />
        </Profiler>
      </>
    );
    const before = { ...renders };
    act(() => {
      for (let i = 1; i <= 30; i++) useGameStore.setState({ serveProgress: i / 31 });
    });
    expect(renders).toEqual(before);
  });
});
