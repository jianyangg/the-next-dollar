// @vitest-environment jsdom
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { Profiler } from 'react';
import { domAnimation, LazyMotion } from 'motion/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The lemonade brew sign: each step draws its scene, per-frame state changes do not
 * re-render React (they go through motion values), and pointer input reaches the
 * store's existing actions (setSpaceHeld for holds, stirKey for mouse circles).
 */

// jsdom has no 2D canvas, so the pixel-art helpers are replaced by trivial fakes.
vi.mock('../world/pixelArt', () => ({
  FOUNDER_CATALOG: [{ id: 'squirrel', name: 'Sam', title: 'Founder', tagline: 'Nutty' }],
  createMascotPortraitDataUrl: () => 'data:image/png;base64,AA==',
  createMascotSpriteTexture: () => ({ image: null }),
  createUiIconDataUrl: () => 'data:image/png;base64,AA==',
}));
// No audio in tests: every soundEngine method becomes a no-op.
vi.mock('../audio/soundEngine', () => ({
  soundEngine: new Proxy({}, { get: () => () => undefined }),
}));

import { lemonadeBrew } from '../core/minigames';
import type { LemonadeBrewState } from '../core/minigames';
import { createRunStreams } from '../core/rng';
import { initRunRandom } from '../core/runRandom';
import { resetGameStore, useGameStore } from '../state/gameStore';
import { BrewStep } from './BrewMinigame';

const fresh = (): LemonadeBrewState =>
  lemonadeBrew.init(createRunStreams(9).gameplay, { difficulty: 0.5, targetSweetness: 0.5, workerSqueezes: false });

function mount() {
  let renders = 0;
  const utils = render(
    <LazyMotion features={domAnimation} strict>
      <Profiler id="brew" onRender={() => (renders += 1)}>
        <BrewStep />
      </Profiler>
    </LazyMotion>
  );
  return { ...utils, renders: () => renders };
}

const setBrew = (brewGame: LemonadeBrewState) => act(() => useGameStore.setState({ brewGame }));

beforeAll(() => initRunRandom(12345));
beforeEach(() => resetGameStore());
afterEach(() => {
  cleanup();
  resetGameStore();
});

describe('lemonade brew sign', () => {
  it('renders nothing without a brew', () => {
    const { container } = mount();
    expect(container.querySelector('.brew-sign')).toBeNull();
  });

  it('draws the squeeze scene, and pressure frames cost no React renders', async () => {
    setBrew(fresh());
    const { container, renders } = mount();
    expect(container.querySelector('.brew-juicer')).not.toBeNull();
    expect(container.querySelector('.brew-vgauge-zone')).not.toBeNull();
    expect(container.querySelector('.brew-step.is-now')?.textContent).toContain('Squeeze');

    const before = renders();
    act(() => {
      for (let i = 1; i <= 30; i++) {
        const g = useGameStore.getState().brewGame as LemonadeBrewState;
        useGameStore.setState({ brewGame: { ...g, squeeze: { ...g.squeeze, pressure: i / 60 } } });
      }
    });
    const needle = container.querySelector<HTMLElement>('.brew-vgauge-needle');
    await vi.waitFor(() => expect(needle?.style.bottom).toBe('50%'));
    expect(renders() - before).toBe(0);
  });

  it('holding the pointer on the scene holds Space; letting go releases it', () => {
    setBrew(fresh());
    const { container } = mount();
    const stage = container.querySelector<HTMLElement>('.brew-stage');
    if (!stage) throw new Error('no stage');
    // jsdom lacks pointer capture; the handler calls it, so stub it on this element.
    stage.setPointerCapture = () => {};
    fireEvent.pointerDown(stage, { pointerId: 1 });
    expect(useGameStore.getState().spaceHeld).toBe(true);
    fireEvent.pointerUp(stage, { pointerId: 1 });
    expect(useGameStore.getState().spaceHeld).toBe(false);
  });

  it('draws the taste meter with three faces, and the fix prompt after an over-pour', () => {
    const s = fresh();
    setBrew({ ...s, phase: 'sweeten' });
    const { container } = mount();
    expect(container.querySelectorAll('.brew-face')).toHaveLength(3);
    expect(container.querySelector('.brew-offer')).toBeNull();
    setBrew({ ...s, phase: 'sweeten', sweeten: { ...s.sweeten, phase: 'offer', sweetness: 0.9 } });
    expect(container.querySelector('.brew-offer')?.textContent).toContain('Too sweet');
    expect(container.querySelector('.brew-action')?.textContent).toContain('Water + lemon');
  });

  it('turns pointer circles over the pitcher into stir quadrants', () => {
    setBrew({ ...fresh(), phase: 'stir' });
    const stirKey = vi.fn();
    act(() => useGameStore.setState({ actions: { ...useGameStore.getState().actions, stirKey } }));
    const { container } = mount();
    const bowl = container.querySelector<HTMLElement>('.brew-bowl');
    if (!bowl) throw new Error('no bowl');
    bowl.getBoundingClientRect = () => ({ left: 0, top: 0, width: 100, height: 100, right: 100, bottom: 100, x: 0, y: 0, toJSON: () => ({}) });
    // Top, top again (ignored: same quadrant), right, bottom, left, and the dead centre.
    for (const [x, y] of [[50, 5], [52, 8], [95, 50], [50, 95], [5, 50], [50, 50]]) {
      fireEvent.pointerMove(bowl, { clientX: x, clientY: y });
    }
    expect(stirKey.mock.calls.map((c) => c[0])).toEqual(['W', 'D', 'S', 'A']);
  });

  it('labels step 1 as the worker when a worker squeezes', () => {
    setBrew(lemonadeBrew.init(createRunStreams(9).gameplay, { difficulty: 0, targetSweetness: 0.5, workerSqueezes: true }));
    const { container } = mount();
    expect(container.querySelector('.brew-step.is-done')?.textContent).toContain('Worker');
    expect(container.querySelector('.brew-taste')).not.toBeNull();
  });
});
