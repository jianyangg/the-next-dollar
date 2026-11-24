// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { domAnimation, LazyMotion, MotionConfig } from 'motion/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../audio/soundEngine', () => ({ soundEngine: new Proxy({}, { get: () => () => {} }) }));

import { resetAnchorStore } from '../state/anchorStore';
import { resetGameStore, useGameStore } from '../state/gameStore';
import { SalePopLayer, ToastLayer } from './WorldOverlays';

beforeEach(() => {
  resetGameStore();
  resetAnchorStore();
});
afterEach(() => {
  cleanup();
  resetGameStore();
});

/**
 * Toasts and sale pops are drawn with Motion's AnimatePresence: when the STORE removes one,
 * the element is NOT unmounted at once; it stays until its exit animation finishes, then
 * disappears. The store (not Motion) still decides when it is removed.
 */
describe('ToastLayer / SalePopLayer enter and exit', () => {
  it('shows a pushed toast, then removes it from the DOM after its exit animation', async () => {
    render(
      // reducedMotion="always" drops transform animations; the opacity fade-out still runs,
      // so AnimatePresence still has a real exit to wait for.
      <MotionConfig reducedMotion="always">
        <LazyMotion features={domAnimation} strict>
          <ToastLayer />
        </LazyMotion>
      </MotionConfig>
    );
    expect(screen.queryByText('+$2.00 Sale')).toBeNull();

    act(() => {
      useGameStore.setState({ toasts: [{ id: 1, text: '+$2.00 Sale', tone: 'positive', anchor: 'own-stand' }] });
    });
    expect(screen.getByText('+$2.00 Sale')).not.toBeNull();

    // The store expires the toast (what its 2.2 s timer does in the real game).
    act(() => {
      useGameStore.setState({ toasts: [] });
    });
    // Gone once AnimatePresence has finished the exit fade.
    await vi.waitFor(() => expect(screen.queryByText('+$2.00 Sale')).toBeNull(), { timeout: 3000 });
  });

  it('shows and then removes a sale pop the same way', async () => {
    render(
      <MotionConfig reducedMotion="always">
        <LazyMotion features={domAnimation} strict>
          <SalePopLayer />
        </LazyMotion>
      </MotionConfig>
    );
    act(() => {
      useGameStore.setState({ salePops: [{ id: 7, text: '+$3 x4', combo: 4, isPerfect: false }] });
    });
    expect(screen.getByText('+$3 x4')).not.toBeNull();
    act(() => {
      useGameStore.setState({ salePops: [] });
    });
    await vi.waitFor(() => expect(screen.queryByText('+$3 x4')).toBeNull(), { timeout: 3000 });
  });
});
