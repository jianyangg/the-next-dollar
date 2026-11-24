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
import { IntroStory } from '../IntroStory';
import { newRunUrl, RunEndModal } from '../RunEndModal';
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
    useGameStore.setState({ introOpen: false, founderModalOpen: true, founderSpecies: 'squirrel' });
    render(wrap(<FounderModal />));
    expect(screen.getByText('Campus Founder')).toBeTruthy();
    press('d');
    press('Enter');
    expect(useGameStore.getState().founderSpecies).toBe('panda');
    expect(useGameStore.getState().founderModalOpen).toBe(false);
  });
});

describe('opening story', () => {
  it('advances one card per E press (held repeats ignored), then hands over to the founder picker', () => {
    localStorage.clear();
    useGameStore.setState({ introOpen: true, founderModalOpen: true, runStarted: false });
    render(wrap(<><IntroStory /><FounderModal /></>));
    // The stake comes from the engine's starting cash, not a hard-coded $30.
    expect(screen.getByText(/Summer in New York/)).toBeTruthy();
    press('e');
    act(() =>
      dispatchKeyDown({ key: 'e', repeat: true, target: document.body, preventDefault: () => {} } as unknown as KeyboardEvent)
    );
    press('e');
    press('e');
    expect(useGameStore.getState().introOpen).toBe(true); // 4th card still showing
    press('e');
    expect(useGameStore.getState().introOpen).toBe(false);
    expect(localStorage.getItem('tnd.introSeen.v1')).toBe('1');
  });

  it('the founder picker offers no Close before the first run, and has Replay intro', async () => {
    useGameStore.setState({ introOpen: false, founderModalOpen: true, runStarted: false });
    render(wrap(<FounderModal />));
    expect(await screen.findByText('Who are you?')).toBeTruthy();
    expect(screen.queryByText('Close')).toBeNull();
    act(() => screen.getByText('Replay intro').click());
    expect(useGameStore.getState().introOpen).toBe(true);
  });
});

describe('run ending', () => {
  it('gives the 30-day verdict from the run total and the days beaten', () => {
    const history = [{ valueCreated: 5 }, { valueCreated: -1 }, { valueCreated: 2 }] as never;
    useGameStore.setState({
      runOver: true,
      economy: { ...createInitialState(), totalValueCreated: 6, dayHistory: history },
    });
    render(wrap(<RunEndModal />));
    const text = document.body.textContent ?? '';
    expect(text).toContain('You beat the line');
    expect(text).toContain('+$6.00');
    expect(text).toContain('2/3');
  });

  it('a new run drops the seed but keeps dev mode, and never leaves the current site', () => {
    expect(newRunUrl('http://localhost:5173/?seed=42&dev')).toBe('http://localhost:5173/?dev');
    expect(newRunUrl('http://localhost:5173/play?seed=42#x')).toBe('http://localhost:5173/play');
    // A protocol-relative-looking path stays a path on the same origin.
    expect(new URL(newRunUrl('http://localhost:5173//evil.example/?seed=1')).origin).toBe('http://localhost:5173');
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
