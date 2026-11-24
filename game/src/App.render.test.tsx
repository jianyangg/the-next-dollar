// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import React, { Profiler } from 'react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Tests the real <App /> with the two things jsdom cannot run replaced by fakes:
 *   - the WebGL scene (a stub class that records how many were built / disposed and
 *     which store-driven methods were called on it), and
 *   - the pixel-art canvas helpers (jsdom has no 2D canvas).
 * Everything else (React, both stores, hooks, subscriptions) is the real code.
 */

// vi.hoisted runs before the (hoisted) vi.mock factories, so the factory can use `sceneLog`.
const sceneLog = vi.hoisted(() => ({
  instances: [] as Array<{ disposed: boolean; calls: Record<string, unknown[][]> }>,
}));

vi.mock('./world/CentralParkScene', () => {
  const METHODS = [
    'setPlayerSpecies',
    'setWorkingAtStand',
    'setNeighborhood',
    'setPlotState',
    'setPitcherCount',
    'setStandOpen',
    'setTimeOfDay',
    'burstSaleSparkles',
    'releaseKeys',
    'handleKeyUp',
  ];
  class FakeScene {
    record = { disposed: false, calls: {} as Record<string, unknown[][]> };
    constructor() {
      sceneLog.instances.push(this.record);
      for (const name of METHODS) {
        (this as unknown as Record<string, unknown>)[name] = (...args: unknown[]) => {
          (this.record.calls[name] ??= []).push(args);
        };
      }
    }
    serveFrontCustomer() {
      return null;
    }
    handleKeyDown() {
      return false;
    }
    dispose() {
      this.record.disposed = true;
    }
  }
  return { CentralParkScene: FakeScene };
});

vi.mock('./world/pixelArt', () => ({
  FOUNDER_CATALOG: [
    { id: 'squirrel', name: 'Sam', title: 'Founder', tagline: 'Nutty' },
    { id: 'panda', name: 'Pan', title: 'Founder', tagline: 'Chill' },
  ],
  createMascotPortraitDataUrl: () => 'data:image/png;base64,AA==',
  createMascotSpriteTexture: () => ({ image: null }),
  createUiIconDataUrl: () => 'data:image/png;base64,AA==',
}));

vi.mock('./audio/soundEngine', () => {
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

import { App } from './App';
import { initRunRandom } from './core/runRandom';
import { anchorStore, publishAnchors, resetAnchorStore } from './state/anchorStore';
import { resetGameStore, useGameStore } from './state/gameStore';
import type { ProjectedAnchors } from './world/CentralParkScene';

beforeAll(() => initRunRandom(12345));

beforeEach(() => {
  resetGameStore();
  resetAnchorStore();
  sceneLog.instances.length = 0;
});

afterEach(() => cleanup());

const snapshot = (override: Partial<ProjectedAnchors>): ProjectedAnchors => ({
  ...anchorStore.getState(),
  ...override,
});

const customer = (id: number, x: number, patienceRatio: number) => ({
  id,
  x,
  y: 120,
  patienceRatio,
  isFront: id === 1,
});

describe('<App /> and the per-frame anchor store', () => {
  it('does not re-render anything when anchors move 100 times', () => {
    let commits = 0;
    const { container } = render(
      <Profiler id="app" onRender={() => (commits += 1)}>
        <App />
      </Profiler>
    );

    // Put two customers in line (this legitimately renders two patience bars).
    act(() => publishAnchors(snapshot({ queue: [customer(1, 100, 1), customer(2, 140, 1)] })));
    const bars = container.querySelectorAll<HTMLElement>('.world-patience');
    expect(bars).toHaveLength(2);

    const commitsBefore = commits;
    act(() => {
      for (let i = 1; i <= 100; i++) {
        publishAnchors(
          snapshot({
            ownStand: { x: 640 + i, y: 360 },
            player: { x: 500 + i, y: 400 },
            queue: [customer(1, 100 + i, 1 - i / 200), customer(2, 140 + i, 0.5)],
          })
        );
      }
    });

    // Not App, not any child: React committed nothing for 100 frames of motion...
    expect(commits).toBe(commitsBefore);
    // ...yet the patience bars really moved (written straight to the DOM).
    expect(bars[0].style.left).toBe('200px');
    expect(bars[0].querySelector<HTMLElement>('.world-patience-track > i')?.style.width).toBe('50%');
  });

  it('does re-render when a discrete anchor value (nearby) changes', () => {
    let commits = 0;
    render(
      <Profiler id="app" onRender={() => (commits += 1)}>
        <App />
      </Profiler>
    );
    const before = commits;
    act(() => publishAnchors(snapshot({ nearby: 'own-stand' })));
    expect(commits).toBeGreaterThan(before);
  });
});

describe('scene lifecycle', () => {
  it('builds the scene once and does not rebuild it when game state changes', () => {
    render(<App />);
    expect(sceneLog.instances).toHaveLength(1);

    act(() => {
      useGameStore.getState().actions.pickFounder('panda');
      useGameStore.getState().actions.taxiHit();
      useGameStore.setState({ timeProgress: 0.5 });
    });
    expect(sceneLog.instances).toHaveLength(1);
  });

  it('under StrictMode (mount, unmount, mount) leaves exactly one live scene with one set of subscriptions', () => {
    render(
      <React.StrictMode>
        <App />
      </React.StrictMode>
    );
    const live = sceneLog.instances.filter((s) => !s.disposed);
    expect(sceneLog.instances).toHaveLength(2); // StrictMode builds, disposes, builds again
    expect(live).toHaveLength(1);

    const dead = sceneLog.instances.find((s) => s.disposed)!;
    const deadCallsBefore = JSON.stringify(dead.calls);
    const liveSpeciesCallsBefore = (live[0].calls.setPlayerSpecies ?? []).length;

    act(() => useGameStore.getState().actions.pickFounder('panda'));

    // The live scene heard the change exactly once (one subscription, not two)...
    expect(live[0].calls.setPlayerSpecies).toHaveLength(liveSpeciesCallsBefore + 1);
    expect(live[0].calls.setPlayerSpecies.at(-1)).toEqual(['panda']);
    // ...and the disposed scene heard nothing (its subscriptions were removed).
    expect(JSON.stringify(dead.calls)).toBe(deadCallsBefore);
  });

  it('disposes the scene when the app unmounts', () => {
    const { unmount } = render(<App />);
    unmount();
    expect(sceneLog.instances.every((s) => s.disposed)).toBe(true);
  });
});
