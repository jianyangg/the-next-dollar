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
import { getPlot, plotsIn, SELLER_PLOT_ID } from '../core/plots';
import { resetGameStore, useGameStore } from '../state/gameStore';
import type { NearbyTarget, ProjectedAnchors } from '../world/CentralParkScene';
import { plotSignWord, WorldPrompts } from './WorldPrompts';

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

const nearby = (target: NearbyTarget, nearbyPlotId: string | null = null) =>
  act(() => publishAnchors(withAnchors({ nearby: target, nearbyPlotId })));

/** Screen positions for every plot of a district, as the scene would publish them. */
const plotAnchorsFor = (district: 'central-park' | 'fidi') =>
  Object.fromEntries(plotsIn(district).map((p, i) => [p.id, { x: 200 + i * 300, y: 300 }]));

/** Publish plot positions for the store's current district (Central Park after a reset). */
const publishPlots = () => act(() => publishAnchors(withAnchors({ plots: plotAnchorsFor('central-park') })));

/** Set one plot's status in the store's economy. */
const setPlot = (id: string, status: 'empty' | 'leased' | 'built') =>
  act(() =>
    useGameStore.setState((s) => ({ economy: { ...s.economy, plots: { ...s.economy.plots, [id]: status } } }))
  );

describe('plotSignWord', () => {
  const corner = getPlot('fidi/corner');
  it('names an empty plot from afar and says "Lease" up close', () => {
    expect(plotSignWord({ ...corner, status: 'empty' }, false)).toBe(corner.label);
    expect(plotSignWord({ ...corner, status: 'empty' }, true)).toBe('Lease');
  });
  it('says "Build" on a leased plot, near or far', () => {
    expect(plotSignWord({ ...corner, status: 'leased' }, false)).toBe('Build');
    expect(plotSignWord({ ...corner, status: 'leased' }, true)).toBe('Build');
  });
  it('says "Stand" from afar and "Open" up close on a built plot', () => {
    expect(plotSignWord({ ...corner, status: 'built' }, false)).toBe('Stand');
    expect(plotSignWord({ ...corner, status: 'built' }, true)).toBe('Open');
  });
});

describe('<WorldPrompts /> destination signs', () => {
  it('draws no plot sign until the scene has published where the plots are', () => {
    render(<WorldPrompts />);
    expect(screen.queryByText('Corner')).toBeNull();
    // The seller is still in business in Central Park, so its sign shows.
    expect(screen.getByText('Seller')).not.toBeNull();
  });

  it('shows one quiet sign per plot (by name) plus the seller when far away, with no [E] key', () => {
    const { container } = render(<WorldPrompts />);
    publishPlots();
    // Central Park: corner and side plots; the seller's plot is the seller's stand, not a plot sign.
    expect(screen.getByText('Corner')).not.toBeNull();
    expect(screen.getByText('Side')).not.toBeNull();
    expect(container.querySelector(`[data-plot="${SELLER_PLOT_ID}"]`)).toBeNull();
    expect(screen.getByText('Seller')).not.toBeNull();
    const signs = container.querySelectorAll<HTMLButtonElement>('.world-sign');
    expect(signs).toHaveLength(3);
    for (const sign of signs) {
      expect(sign.classList.contains('is-idle')).toBe(true);
      expect(sign.disabled).toBe(true);
      expect(sign.textContent).not.toMatch(/\bE\b/);
    }
  });

  it('places each plot sign at its own published anchor', () => {
    const { container } = render(<WorldPrompts />);
    publishPlots();
    const anchors = plotAnchorsFor('central-park');
    for (const p of plotsIn('central-park').filter((q) => q.kind !== 'seller')) {
      const sign = container.querySelector<HTMLButtonElement>(`[data-plot="${p.id}"]`)!;
      expect(sign.style.left).toBe(`${anchors[p.id].x}px`);
      expect(sign.style.top).toBe(`${anchors[p.id].y - 12}px`);
    }
  });

  it('emphasises only the plot the player stands at, and says what E will do there', () => {
    const { container } = render(<WorldPrompts />);
    publishPlots();
    nearby('plot-lease', 'central-park/side');
    const side = container.querySelector<HTMLButtonElement>('[data-plot="central-park/side"]')!;
    expect(side.classList.contains('is-nearby')).toBe(true);
    expect(side.disabled).toBe(false);
    expect(side.textContent).toMatch(/E/);
    expect(side.textContent).toMatch(/Lease/);
    const corner = container.querySelector<HTMLButtonElement>('[data-plot="central-park/corner"]')!;
    expect(corner.classList.contains('is-idle')).toBe(true);
    expect(corner.textContent).toBe('Corner');
  });

  it('clicking the near plot sign interacts with THAT plot', () => {
    const interact = vi.fn();
    useGameStore.setState((s) => ({ actions: { ...s.actions, interact } }));
    const { container } = render(<WorldPrompts />);
    publishPlots();
    setPlot('central-park/side', 'built');
    nearby('own-stand', 'central-park/side');
    const side = container.querySelector<HTMLButtonElement>('[data-plot="central-park/side"]')!;
    expect(side.textContent).toMatch(/Open/);
    act(() => side.click());
    expect(interact).toHaveBeenCalledWith('own-stand', 'central-park/side');
  });

  it('labels leased plots "Build" and built ones "Stand" from afar', () => {
    render(<WorldPrompts />);
    publishPlots();
    setPlot('central-park/corner', 'leased');
    setPlot('central-park/side', 'built');
    expect(screen.getByText('Build')).not.toBeNull();
    expect(screen.getByText('Stand')).not.toBeNull();
  });

  it('gives the seller sign full emphasis and the [E] key when next to it', () => {
    render(<WorldPrompts />);
    nearby('seller-stand');
    const talk = screen.getByText('Talk').closest('button')!;
    expect(talk.classList.contains('is-nearby')).toBe(true);
    expect(talk.disabled).toBe(false);
    expect(talk.textContent).toMatch(/E/);
  });

  it('draws no seller sign outside Central Park', () => {
    act(() => useGameStore.setState({ neighborhoodId: 'fidi' }));
    render(<WorldPrompts />);
    act(() => publishAnchors(withAnchors({ plots: plotAnchorsFor('fidi') })));
    expect(screen.queryByText('Seller')).toBeNull();
    expect(screen.getByText('Plaza')).not.toBeNull();
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
    publishPlots();
    act(() => publishAnchors(withAnchors({ subway: { x: 800, y: 300 } })));
    act(() => useGameStore.setState({ mapOpen: true }));
    expect(screen.queryByText('Subway')).toBeNull();
    expect(screen.queryByText('Seller')).toBeNull();
    expect(screen.queryByText('Corner')).toBeNull();
  });
});
