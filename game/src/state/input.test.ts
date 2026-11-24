import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  dispatchKeyDown,
  dispatchKeyUp,
  INPUT_PRIORITY,
  onInputLayerPushed,
  pushInputLayer,
  resetInputRouterForTests,
} from './input';

/** A minimal stand-in for a browser KeyboardEvent. */
const key = (k: string, target: Partial<HTMLElement> = { tagName: 'BODY' }): KeyboardEvent =>
  ({ key: k, target, metaKey: false, ctrlKey: false, altKey: false }) as unknown as KeyboardEvent;

afterEach(resetInputRouterForTests);

describe('input router', () => {
  it('a menu above the world takes WASD, so the player does not also walk', () => {
    const world = vi.fn(() => true);
    const menu = vi.fn((e: KeyboardEvent) => e.key === 's');
    pushInputLayer({ priority: INPUT_PRIORITY.world, onKeyDown: world });
    pushInputLayer({ priority: INPUT_PRIORITY.menu, onKeyDown: menu });

    dispatchKeyDown(key('s'));
    expect(menu).toHaveBeenCalledTimes(1);
    expect(world).not.toHaveBeenCalled();

    dispatchKeyDown(key('x')); // unused by the menu: falls through
    expect(world).toHaveBeenCalledTimes(1);
  });

  it('priority decides the order, not which layer was pushed first', () => {
    const calls: string[] = [];
    pushInputLayer({ priority: INPUT_PRIORITY.menu, onKeyDown: () => (calls.push('menu'), false) });
    pushInputLayer({ priority: INPUT_PRIORITY.world, onKeyDown: () => (calls.push('world'), false) });
    dispatchKeyDown(key('q'));
    expect(calls).toEqual(['menu', 'world']);
  });

  it('a blocking modal stops unhandled keys but lets Escape through', () => {
    const below = vi.fn(() => true);
    pushInputLayer({ priority: INPUT_PRIORITY.shortcuts, onKeyDown: below });
    pushInputLayer({ priority: INPUT_PRIORITY.modal, blocking: true, onKeyDown: () => false });

    dispatchKeyDown(key('b'));
    expect(below).not.toHaveBeenCalled();
    dispatchKeyDown(key('Escape'));
    expect(below).toHaveBeenCalledTimes(1);
  });

  it('typing in a text field reaches no layer except for Escape', () => {
    const layer = vi.fn(() => true);
    pushInputLayer({ onKeyDown: layer });
    dispatchKeyDown(key('w', { tagName: 'INPUT' }));
    expect(layer).not.toHaveBeenCalled();
    dispatchKeyDown(key('Escape', { tagName: 'TEXTAREA' }));
    expect(layer).toHaveBeenCalledTimes(1);
  });

  it('key-ups reach every layer, and pushing a layer notifies listeners (to drop held keys)', () => {
    const upA = vi.fn();
    const upB = vi.fn();
    const pushed = vi.fn();
    onInputLayerPushed(pushed);
    pushInputLayer({ onKeyDown: () => false, onKeyUp: upA });
    const remove = pushInputLayer({ onKeyDown: () => true, onKeyUp: upB });
    expect(pushed).toHaveBeenCalledTimes(2);
    dispatchKeyUp(key('w'));
    expect(upA).toHaveBeenCalledTimes(1);
    expect(upB).toHaveBeenCalledTimes(1);
    remove();
    dispatchKeyUp(key('w'));
    expect(upB).toHaveBeenCalledTimes(1);
  });
});
