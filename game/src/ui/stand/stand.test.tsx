// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { domAnimation, LazyMotion } from 'motion/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// jsdom has no 2D canvas, so the pixel-art helpers are replaced by trivial fakes.
vi.mock('../../world/pixelArt', () => ({
  FOUNDER_CATALOG: [{ id: 'squirrel', name: 'Sam', title: 'Founder', tagline: 'Nutty' }],
  createMascotPortraitDataUrl: () => 'data:image/png;base64,AA==',
  createMascotSpriteTexture: () => ({ image: null }),
  createUiIconDataUrl: () => 'data:image/png;base64,AA==',
}));
vi.mock('../../audio/soundEngine', () => ({ soundEngine: new Proxy({}, { get: () => () => {} }) }));

import { dispatchKeyDown, INPUT_PRIORITY, pushInputLayer, resetInputRouterForTests } from '../../state/input';
import { resetAnchorStore } from '../../state/anchorStore';
import { resetGameStore, useGameStore } from '../../state/gameStore';
import { getNeighborhood } from '../../core/neighborhoods';
import { getConversionProb } from '../../core/demand';
import { StandWorkbench } from '../StandWorkbench';
import { litCustomers } from './PriceCustomers';
import { countOwnedStands } from '../../core/sliceModel';

const press = (key: string) =>
  act(() => dispatchKeyDown({ key, target: document.body, preventDefault: () => {} } as unknown as KeyboardEvent));

const renderStand = () =>
  render(
    <LazyMotion features={domAnimation} strict>
      <StandWorkbench />
    </LazyMotion>
  );

beforeEach(() => {
  resetGameStore();
  resetAnchorStore();
  act(() => useGameStore.setState({ founderModalOpen: false, workingAtStand: true }));
});
afterEach(() => {
  cleanup();
  resetInputRouterForTests();
  resetGameStore();
});

describe('litCustomers', () => {
  it('rounds the buy chance to tenths and stays within 0..10', () => {
    expect(litCustomers(0.72)).toBe(7);
    expect(litCustomers(0.95)).toBe(10);
    expect(litCustomers(0.12)).toBe(1);
    expect(litCustomers(-1)).toBe(0);
    expect(litCustomers(3)).toBe(10);
  });
});

describe('StandWorkbench menu', () => {
  it('lists every action the old workbench offered', () => {
    renderStand();
    for (const name of ['Brew', 'Serve', 'Price', 'Staff', 'Market', 'Sell stand', 'Leave']) {
      expect(screen.getByRole('menuitem', { name: new RegExp(name) })).toBeTruthy();
    }
  });

  it('keeps Serve disabled with no brewed cups and no customers', () => {
    renderStand();
    expect((screen.getByRole('menuitem', { name: /Serve/ }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('does not block F / Space / Esc: they reach the shortcut layer below', () => {
    const seen: string[] = [];
    pushInputLayer({
      priority: INPUT_PRIORITY.shortcuts,
      onKeyDown: (e) => {
        seen.push(e.key);
        return true;
      },
    });
    renderStand();
    press('f');
    press(' ');
    press('Escape');
    expect(seen).toEqual(['f', ' ', 'Escape']);
  });

  it('opens the price row and draws the existing buy chance as lit customers', () => {
    renderStand();
    fireEvent.click(screen.getByRole('menuitem', { name: /Price/ }));
    fireEvent.click(screen.getByRole('menuitem', { name: '$4' }));
    const s = useGameStore.getState();
    expect(s.economy.pricePerCup).toBe(4);
    const figure = screen.getByRole('img', { name: /of 10 customers buy/ });
    expect(figure.querySelectorAll('.is-lit').length).toBe(
      litCustomers(getConversionProb(4, getNeighborhood(useGameStore.getState().neighborhoodId).priceSensitivity))
    );
  });
});

describe('stand menu keys', () => {
  const cursorLabel = () => document.querySelector('.pt-menu-item.is-cursor')?.textContent ?? '';
  const openRow = (id: string) =>
    fireEvent.click(screen.getByRole('menuitem', { name: new RegExp(`^${id}`) }));

  it('the Price row starts on the price in force, and Escape closes the row (not the stand)', () => {
    act(() => useGameStore.setState((s) => ({ economy: { ...s.economy, pricePerCup: 4 } })));
    renderStand();
    openRow('Price');
    const row = screen.getByRole('menu', { name: 'Cup price' });
    expect(row.querySelector('.is-cursor')?.textContent).toBe('$4');
    press('Escape');
    expect(screen.queryByRole('menu', { name: 'Cup price' })).toBeNull();
    expect(useGameStore.getState().workingAtStand).toBe(true);
  });

  it('Sell stand asks first: one E opens Keep/Sell with Keep under the cursor', () => {
    renderStand();
    openRow('Sell stand');
    const owned = countOwnedStands(useGameStore.getState().economy);
    expect(screen.getByRole('menu', { name: 'Sell stand?' }).querySelector('.is-cursor')?.textContent).toBe('Keep');
    press('e');
    expect(countOwnedStands(useGameStore.getState().economy)).toBe(owned);
    expect(screen.queryByRole('menu', { name: 'Sell stand?' })).toBeNull();
  });

  it('with Books open over the stand, W/S do not move the stand cursor', () => {
    renderStand();
    const before = cursorLabel();
    act(() => useGameStore.setState({ booksOpen: true }));
    press('s');
    expect(cursorLabel()).toBe(before);
  });

  it('a sub-row replaces the main menu (so the sign stays short), and Done brings it back', () => {
    renderStand();
    openRow('Price');
    expect(screen.queryByRole('menu', { name: 'Stand' })).toBeNull();
    fireEvent.click(screen.getByRole('menuitem', { name: 'Done' }));
    expect(screen.getByRole('menu', { name: 'Stand' })).toBeTruthy();
  });
});
