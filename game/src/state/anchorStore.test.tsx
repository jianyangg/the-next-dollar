// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { useRef } from 'react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { ProjectedAnchors } from '../world/CentralParkScene';
import {
  anchorStore,
  publishAnchors,
  resetAnchorStore,
  selectOwnStand,
  useAnchorPoint,
  useNearbyTarget,
  useQueueIds,
} from './anchorStore';

/** A full anchors snapshot, overriding only what a test cares about. */
const snapshot = (override: Partial<ProjectedAnchors>): ProjectedAnchors => ({
  ...anchorStore.getState(),
  ...override,
});

beforeEach(() => resetAnchorStore());
afterEach(() => cleanup());

describe('useAnchorPoint', () => {
  it('moves the element on every update without re-rendering the component', () => {
    let renders = 0;
    function Label() {
      renders += 1; // runs once per React render of this component
      const ref = useRef<HTMLDivElement>(null);
      useAnchorPoint(selectOwnStand, ref, { x: 0, y: -10 });
      return <div ref={ref} data-testid="label" />;
    }

    const { getByTestId } = render(<Label />);
    const el = getByTestId('label');

    // Initial position comes from the store before the first paint (640,360 - 10).
    expect(el.style.left).toBe('640px');
    expect(el.style.top).toBe('350px');
    expect(renders).toBe(1);

    act(() => {
      for (let i = 0; i < 100; i++) {
        publishAnchors(snapshot({ ownStand: { x: 100 + i, y: 200 + i } }));
      }
    });

    expect(el.style.left).toBe('199px');
    expect(el.style.top).toBe('289px'); // (200 + 99) - 10
    expect(renders).toBe(1); // 100 position updates, zero React renders
  });

  it('stops following the store after unmount (no leaked subscription)', () => {
    function Label() {
      const ref = useRef<HTMLDivElement>(null);
      useAnchorPoint(selectOwnStand, ref);
      return <div ref={ref} />;
    }
    const { unmount } = render(<Label />);
    unmount();
    // zustand exposes no listener count, so the observable check is "publishing is safe".
    expect(() => publishAnchors(snapshot({ ownStand: { x: 1, y: 2 } }))).not.toThrow();
  });
});

describe('discrete-value hooks', () => {
  it('useNearbyTarget re-renders only when the target changes, not on position updates', () => {
    let renders = 0;
    function Probe() {
      renders += 1;
      return <span data-testid="nearby">{String(useNearbyTarget())}</span>;
    }
    const { getByTestId } = render(<Probe />);
    expect(renders).toBe(1);

    act(() => {
      for (let i = 0; i < 100; i++) publishAnchors(snapshot({ player: { x: i, y: i } }));
    });
    expect(renders).toBe(1);

    act(() => publishAnchors(snapshot({ nearby: 'own-stand' })));
    expect(renders).toBe(2);
    expect(getByTestId('nearby').textContent).toBe('own-stand');
  });

  it('useQueueIds re-renders when someone joins the line, not when bars move', () => {
    let renders = 0;
    function Probe() {
      renders += 1;
      return <span data-testid="ids">{useQueueIds().join(',')}</span>;
    }
    const { getByTestId } = render(<Probe />);
    const customer = (id: number, x: number, patienceRatio: number) => ({
      id,
      x,
      y: 50,
      patienceRatio,
      isFront: id === 1,
    });

    act(() => publishAnchors(snapshot({ queue: [customer(1, 10, 1), customer(2, 30, 1)] })));
    expect(getByTestId('ids').textContent).toBe('1,2');
    const afterJoin = renders;

    act(() => {
      for (let i = 0; i < 100; i++) {
        publishAnchors(snapshot({ queue: [customer(1, 10 + i, 0.9), customer(2, 30 + i, 0.8)] }));
      }
    });
    expect(renders).toBe(afterJoin); // positions/patience moved; the id list did not

    act(() => publishAnchors(snapshot({ queue: [customer(2, 30, 0.8)] })));
    expect(getByTestId('ids').textContent).toBe('2');
    expect(renders).toBe(afterJoin + 1);
  });
});
