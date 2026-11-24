// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/soundEngine', () => ({ soundEngine: new Proxy({}, { get: () => () => {} }) }));
vi.mock('../assets', () => ({ getIcons: () => new Proxy({}, { get: () => '' }) }));

import { initRunRandom } from '../../core/runRandom';
import { createInitialState } from '../../core/sliceModel';
import { dispatchKeyDown, INPUT_PRIORITY, pushInputLayer, resetInputRouterForTests } from '../../state/input';
import { resetGameStore, useGameStore } from '../../state/gameStore';
import { BooksDrawer } from '../BooksDrawer';

const press = (key: string) =>
  act(() => dispatchKeyDown({ key, target: document.body, preventDefault: () => {} } as unknown as KeyboardEvent));

beforeAll(() => initRunRandom(1));
beforeEach(() => {
  resetGameStore();
  useGameStore.setState({
    booksOpen: true,
    economy: { ...createInitialState(), pitchers: 1, equipmentValue: 10, inventoryValue: 4, dayRevenue: 9, dayCogs: 2 },
  });
});
afterEach(() => {
  cleanup();
  resetInputRouterForTests();
  resetGameStore();
});

describe('BooksDrawer', () => {
  it('shows income figures first, with formal terms in brackets', () => {
    render(<BooksDrawer />);
    expect(screen.getByText('Sales')).toBeTruthy();
    expect(document.body.textContent).toContain('(NOPAT)');
    expect(document.body.textContent).toContain('$9.00');
  });

  it('switches tabs with the mouse and shows balance, value and reviews figures', () => {
    render(<BooksDrawer />);
    fireEvent.click(screen.getByRole('menuitem', { name: 'Balance' }));
    expect(document.body.textContent).toContain('Balanced');
    fireEvent.click(screen.getByRole('menuitem', { name: 'Value' }));
    expect(document.body.textContent).toContain('Money tied up');
    expect(document.querySelector('.books-line-row.pt-line-row')).toBeTruthy(); // THE LINE row
    expect(document.querySelector('.books-meter .pt-line-fill')).toBeTruthy(); // the meter's 5% bar
    expect(screen.getByRole('button', { name: /Sell Pitcher/ })).toBeTruthy(); // sell button kept
    fireEvent.click(screen.getByRole('menuitem', { name: 'Reviews' }));
    expect(document.body.textContent).toContain('No reviews yet');
  });

  it('moves with D and opens with E; W/S never reach the world behind', () => {
    const world = vi.fn(() => true);
    pushInputLayer({ priority: INPUT_PRIORITY.world, onKeyDown: world });
    render(<BooksDrawer />);
    press('d');
    press('e');
    expect(screen.getByLabelText('Balance')).toBeTruthy();
    press('s');
    expect(world).not.toHaveBeenCalled();
  });

  it('lets Escape and B fall through to the shortcut layer', () => {
    const shortcuts = vi.fn(() => true);
    pushInputLayer({ priority: INPUT_PRIORITY.shortcuts, onKeyDown: shortcuts });
    render(<BooksDrawer />);
    press('b');
    press('Escape');
    expect(shortcuts).toHaveBeenCalledTimes(2);
  });
});
