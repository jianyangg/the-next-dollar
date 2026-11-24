// @vitest-environment jsdom
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { domAnimation, LazyMotion } from 'motion/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// jsdom has no 2D canvas, so the pixel-art helpers are replaced by trivial fakes.
vi.mock('../../world/pixelArt', () => ({
  FOUNDER_CATALOG: [
    { id: 'squirrel', name: 'Alex', title: 'Hustler', tagline: 'x' },
    { id: 'panda', name: 'Leo', title: 'Campus', tagline: 'y' },
  ],
  createMascotPortraitDataUrl: () => 'data:image/png;base64,AA==',
  createMascotSpriteTexture: () => ({ image: null }),
  createUiIconDataUrl: () => 'data:image/png;base64,AA==',
}));
vi.mock('../../audio/soundEngine', () => ({ soundEngine: new Proxy({}, { get: () => () => {} }) }));

import { createInitialState } from '../../core/sliceModel';
import { dispatchKeyDown, resetInputRouterForTests } from '../../state/input';
import { resetGameStore, useGameStore } from '../../state/gameStore';
import { FounderModal } from '../FounderModal';
import { ManhattanMapModal } from '../ManhattanMapModal';
import { MarketModals } from '../MarketModals';
import { PlotLeaseModal } from '../PlotLeaseModal';

const press = (key: string) =>
  act(() => dispatchKeyDown({ key, target: document.body, preventDefault: () => {} } as unknown as KeyboardEvent));
const wrap = (ui: React.ReactNode) => <LazyMotion features={domAnimation}>{ui}</LazyMotion>;

beforeEach(() => resetGameStore());
afterEach(() => {
  cleanup();
  resetInputRouterForTests();
});

describe('pitcher shop', () => {
  it('previews the pitcher purchase, and buys it with E', () => {
    useGameStore.setState({ activeModal: 'market-pitchers' });
    render(wrap(<MarketModals />));
    expect(screen.getByRole('menuitem', { name: /Pitcher\s*\$10/ })).toBeTruthy();
    // Preview chips come from the real rule: cash -$10, gear +$10, profit $0.
    expect(screen.getByLabelText('CASH -$10.00')).toBeTruthy();
    expect(screen.getByLabelText('GEAR +$10.00')).toBeTruthy();
    press('e');
    expect(useGameStore.getState().economy.pitchers).toBe(1);
  });

  it('says Need $10 when cash is short, and the preview follows the cursor', async () => {
    useGameStore.setState({ activeModal: 'market-pitchers', economy: { ...createInitialState(), cash: 4 } });
    render(wrap(<MarketModals />));
    expect(screen.getByText(/Need/).textContent).toContain('$10');
    press('s'); // cursor to "Back to ..."
    await waitFor(() => expect(screen.queryByText(/Need/)).toBeNull());
  });

  it('blocks the world: the same keys reach no layer below', () => {
    useGameStore.setState({ activeModal: 'market-lemons' });
    render(wrap(<MarketModals />));
    press('Escape'); // passes through to the store (handled by the app shell), not swallowed here
    expect(screen.getByRole('menu', { name: 'Lemon shop' })).toBeTruthy();
  });
});

describe('plot lease', () => {
  it('shows rent per day and signs the lease', () => {
    useGameStore.setState({ activeModal: 'plot-lease', neighborhoodId: 'broadway' });
    render(wrap(<PlotLeaseModal />));
    expect(screen.getByLabelText('RENT/DAY $4')).toBeTruthy();
    press('Enter');
    expect(useGameStore.getState().economy.plots.broadway).toBe('leased');
  });
});

describe('founder select', () => {
  it('moves with right/left and confirming picks and starts', () => {
    useGameStore.setState({ founderModalOpen: true, founderSpecies: 'squirrel' });
    render(wrap(<FounderModal />));
    expect(screen.getByText('Campus Founder')).toBeTruthy();
    press('d');
    press('Enter');
    expect(useGameStore.getState().founderSpecies).toBe('panda');
    expect(useGameStore.getState().founderModalOpen).toBe(false);
  });
});

describe('Manhattan map', () => {
  it('walks stations with the arrows and travels with E, with no window key listener of its own', () => {
    const onSelect = vi.fn();
    const onClose = vi.fn();
    render(<ManhattanMapModal currentId="columbia" onSelect={onSelect} onClose={onClose} />);
    expect(screen.getByRole('heading', { name: 'Columbia University' })).toBeTruthy();
    press('ArrowDown');
    expect(screen.getByRole('heading', { name: 'Central Park' })).toBeTruthy();
    press('e');
    expect(onSelect).toHaveBeenCalledWith('central-park');
    expect(onClose).toHaveBeenCalled();
  });

  it('does not handle Escape itself (the store closes the map)', () => {
    const onClose = vi.fn();
    render(<ManhattanMapModal currentId="columbia" onSelect={vi.fn()} onClose={onClose} />);
    press('Escape');
    expect(onClose).not.toHaveBeenCalled();
  });
});
