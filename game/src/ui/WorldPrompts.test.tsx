// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../audio/soundEngine', () => ({ soundEngine: new Proxy({}, { get: () => () => {} }) }));
// The icon helpers draw on a canvas, which jsdom does not provide.
vi.mock('../world/pixelArt', () => ({
  FOUNDER_CATALOG: [{ id: 'squirrel', name: 'Sam', title: 'Founder', tagline: 'Nutty' }],
  createMascotPortraitDataUrl: () => 'data:image/png;base64,AA==',
  createMascotSpriteTexture: () => ({ image: null }),
  createUiIconDataUrl: () => 'data:image/png;base64,AA==',
}));

import { anchorStore, publishAnchors, resetAnchorStore } from '../state/anchorStore';
import { resetGameStore, useGameStore } from '../state/gameStore';
import type { NearbyTarget, ProjectedAnchors } from '../world/CentralParkScene';
import { WorldPrompts } from './WorldPrompts';

const withAnchors = (override: Partial<ProjectedAnchors>): ProjectedAnchors => ({
  ...anchorStore.getState(),
  ...override,
});

beforeEach(() => {
  resetGameStore();
  resetAnchorStore();
  // Nothing covers the world: no picker, window or scorecard.
  useGameStore.setState({ founderModalOpen: false, activeModal: null, mapOpen: false, workingAtStand: false });
});
afterEach(() => cleanup());

const nearby = (target: NearbyTarget) => act(() => publishAnchors(withAnchors({ nearby: target })));

describe('<WorldPrompts /> destination signs', () => {
  it('keeps the stand-plot and seller signs visible when far away, with no [E] key', () => {
    const { container } = render(<WorldPrompts />);
    expect(screen.getByText('Lease')).not.toBeNull();
    expect(screen.getByText('Seller')).not.toBeNull();
    // Far from everything: both are quiet (is-idle), disabled so they cannot be used from afar.
    const signs = container.querySelectorAll<HTMLButtonElement>('.world-sign');
    expect(signs).toHaveLength(2);
    for (const sign of signs) {
      expect(sign.classList.contains('is-idle')).toBe(true);
      expect(sign.disabled).toBe(true);
      expect(sign.textContent).not.toMatch(/\bE\b/);
    }
  });

  it('gives the sign you stand next to full emphasis and the [E] key', () => {
    const { container } = render(<WorldPrompts />);
    nearby('seller-stand');
    const talk = screen.getByText('Talk').closest('button')!;
    expect(talk.classList.contains('is-nearby')).toBe(true);
    expect(talk.disabled).toBe(false);
    expect(talk.textContent).toMatch(/E/);
    // The other sign stays quiet.
    const idle = container.querySelectorAll('.world-sign.is-idle');
    expect(idle).toHaveLength(1);
  });

  it('draws no subway sign until the scene has published where the entrance is', () => {
    render(<WorldPrompts />);
    expect(screen.queryByText('Subway')).toBeNull();
  });

  it('shows "Subway" quietly when far and with the [E] key when the player is next to it', () => {
    render(<WorldPrompts />);
    act(() => publishAnchors(withAnchors({ subway: { x: 800, y: 300 } })));
    const far = screen.getByText('Subway').closest('button')!;
    expect(far.classList.contains('is-idle')).toBe(true);
    expect(far.textContent).toBe('Subway');
    expect(far.style.left).toBe('800px');

    nearby('subway');
    const close = screen.getByText('Subway').closest('button')!;
    expect(close.classList.contains('is-nearby')).toBe(true);
    expect(close.textContent).toMatch(/E/);
  });

  it('opens the map when the nearby subway sign is clicked', () => {
    render(<WorldPrompts />);
    act(() => publishAnchors(withAnchors({ subway: { x: 800, y: 300 }, nearby: 'subway' })));
    act(() => screen.getByText('Subway').closest('button')!.click());
    expect(useGameStore.getState().mapOpen).toBe(true);
  });

  it('hides every sign while a window covers the world', () => {
    render(<WorldPrompts />);
    act(() => publishAnchors(withAnchors({ subway: { x: 800, y: 300 } })));
    act(() => useGameStore.setState({ mapOpen: true }));
    expect(screen.queryByText('Subway')).toBeNull();
    expect(screen.queryByText('Seller')).toBeNull();
  });
});
