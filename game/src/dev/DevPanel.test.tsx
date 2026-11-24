// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { domAnimation, LazyMotion } from 'motion/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../world/pixelArt', () => ({
  FOUNDER_CATALOG: [{ id: 'squirrel', name: 'Sam', title: 'Founder', tagline: 'Nutty' }],
  createMascotPortraitDataUrl: () => 'data:image/png;base64,AA==',
  createMascotSpriteTexture: () => ({ image: null }),
  createUiIconDataUrl: () => 'data:image/png;base64,AA==',
}));
vi.mock('../audio/soundEngine', () => ({ soundEngine: new Proxy({}, { get: () => () => {} }) }));

import { initRunRandom } from '../core/runRandom';
import { resetAnchorStore } from '../state/anchorStore';
import { resetGameStore, useGameStore } from '../state/gameStore';
import { dispatchKeyDown, resetInputRouterForTests } from '../state/input';
import { DevPanelHost } from './DevPanel';
import { resetDevClockForTests } from './devTools';

const press = (key: string, code = '') =>
  act(() => dispatchKeyDown({ key, code, target: document.body, preventDefault: () => {} } as unknown as KeyboardEvent));

const renderHost = () =>
  render(
    <LazyMotion features={domAnimation} strict>
      <DevPanelHost />
    </LazyMotion>
  );

beforeEach(() => {
  resetGameStore();
  resetAnchorStore();
  initRunRandom(777);
  vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterEach(() => {
  cleanup();
  resetInputRouterForTests();
  resetDevClockForTests();
  vi.restoreAllMocks();
  window.history.replaceState(null, '', '/');
  resetGameStore();
});

describe('DevPanelHost', () => {
  it('renders nothing without ?dev', () => {
    renderHost();
    expect(screen.queryByLabelText('Developer tools')).toBeNull();
  });

  it('with ?dev shows the DEV bar and seed, runs a cheat on click, and toggles with backquote', () => {
    window.history.replaceState(null, '', '/?dev');
    renderHost();
    expect(screen.getByText('DEV')).toBeTruthy();
    expect(screen.getByText('777')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Cash +$100' }));
    expect(useGameStore.getState().economy.cash).toBe(130);
    expect(screen.getByRole('status').textContent).toContain('done');

    press('`', 'Backquote');
    expect(screen.queryByLabelText('Developer tools')).toBeNull();
    press('`', 'Backquote');
    expect(screen.getByLabelText('Developer tools')).toBeTruthy();
  });

  it('shows a refusal in the status line instead of failing silently', () => {
    window.history.replaceState(null, '', '/?dev');
    renderHost();
    act(() => useGameStore.setState({ neighborhoodId: 'market' }));
    fireEvent.click(screen.getByRole('button', { name: 'Build stand here' }));
    expect(screen.getByRole('status').textContent).toContain('refused');
  });
});
