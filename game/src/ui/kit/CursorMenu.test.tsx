// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AnimatePresence, domAnimation, LazyMotion } from 'motion/react';
import * as m from 'motion/react-m';

vi.mock('../../audio/soundEngine', () => ({ soundEngine: new Proxy({}, { get: () => () => {} }) }));

import { dispatchKeyDown, INPUT_PRIORITY, pushInputLayer, resetInputRouterForTests } from '../../state/input';
import { CursorMenu, nextEnabledIndex } from './CursorMenu';

const press = (key: string) =>
  act(() => dispatchKeyDown({ key, target: document.body, preventDefault: () => {} } as unknown as KeyboardEvent));

afterEach(() => {
  cleanup();
  resetInputRouterForTests();
});

describe('nextEnabledIndex', () => {
  it('skips disabled items and wraps around', () => {
    const items = [{}, { disabled: true }, {}];
    expect(nextEnabledIndex(items, 0, 1)).toBe(2);
    expect(nextEnabledIndex(items, 2, 1)).toBe(0);
    expect(nextEnabledIndex(items, 0, -1)).toBe(2);
  });
});

describe('CursorMenu', () => {
  const setup = (blocking = false) => {
    const brew = vi.fn();
    const serve = vi.fn();
    const world = vi.fn(() => true);
    pushInputLayer({ priority: INPUT_PRIORITY.world, onKeyDown: world });
    render(
      <CursorMenu
        label="Stand"
        blocking={blocking}
        items={[
          { id: 'brew', label: 'Brew', onSelect: brew },
          { id: 'serve', label: 'Serve', onSelect: serve },
        ]}
      />
    );
    return { brew, serve, world };
  };

  it('S moves the cursor down and E confirms, without walking the player', () => {
    const { serve, world } = setup();
    press('s');
    press('e');
    expect(serve).toHaveBeenCalledTimes(1);
    expect(world).not.toHaveBeenCalled();
    expect(screen.getByRole('menuitem', { name: 'Serve' }).className).toContain('is-cursor');
  });

  it('a non-blocking menu lets unrelated keys fall through to the world', () => {
    const { world } = setup(false);
    press('f');
    expect(world).toHaveBeenCalledTimes(1);
  });

  it('a blocking menu keeps unrelated keys from the world', () => {
    const { world } = setup(true);
    press('f');
    expect(world).not.toHaveBeenCalled();
  });

  it('a held E (browser key repeat) confirms once, and the repeats do not reach the world', () => {
    const { brew, world } = setup();
    press('e');
    for (let i = 0; i < 3; i++) {
      act(() =>
        dispatchKeyDown({ key: 'e', repeat: true, target: document.body, preventDefault: () => {} } as unknown as KeyboardEvent)
      );
    }
    expect(brew).toHaveBeenCalledTimes(1);
    expect(world).not.toHaveBeenCalled();
  });

  it('a menu inside a window that is animating out stops taking keys at once', () => {
    const buy = vi.fn();
    const Window = ({ open }: { open: boolean }) => (
      <AnimatePresence>
        {open && (
          <m.div key="w" exit={{ opacity: 0, transition: { duration: 10 } }}>
            <CursorMenu label="Shop" blocking items={[{ id: 'buy', label: 'Buy', onSelect: buy }]} />
          </m.div>
        )}
      </AnimatePresence>
    );
    const view = render(
      <LazyMotion features={domAnimation}>
        <Window open />
      </LazyMotion>
    );
    view.rerender(
      <LazyMotion features={domAnimation}>
        <Window open={false} />
      </LazyMotion>
    );
    // Still on screen (fading out for 10 s), but E must no longer buy.
    expect(screen.getByRole('menuitem', { name: 'Buy' })).toBeTruthy();
    press('e');
    expect(buy).not.toHaveBeenCalled();
  });

  it('Escape calls onBack when the menu has one', () => {
    const back = vi.fn();
    render(<CursorMenu label="Row" onBack={back} items={[{ id: 'a', label: 'A', onSelect: () => {} }]} />);
    press('Escape');
    expect(back).toHaveBeenCalledTimes(1);
  });

  it('the mouse works too: hover moves the cursor, click selects', () => {
    const { brew } = setup();
    const brewBtn = screen.getByRole('menuitem', { name: 'Brew' });
    fireEvent.mouseEnter(brewBtn);
    fireEvent.click(brewBtn);
    expect(brew).toHaveBeenCalledTimes(1);
  });
});
