import { type ReactNode, useEffect, useState } from 'react';
import { soundEngine } from '../../audio/soundEngine';
import { INPUT_PRIORITY } from '../../state/input';
import { useInputLayer } from './useInputLayer';

/**
 * A JRPG-style menu: an arrow cursor moved with arrows/WASD, confirmed with E or Enter, and
 * fully usable with the mouse (hover moves the cursor, click confirms).
 *
 * Every item is a real <button>, so Tab, screen readers and click all keep working;
 * the arrow-row highlight is just the visible "focus" for keyboard play.
 *
 * Keys come through the game's input router. A menu inside a modal window passes
 * `blocking`, so nothing behind the window reacts; a menu at the stand does not block,
 * so F (brew), Space (serve), B and M still reach the shortcut layer below it.
 */

export interface CursorMenuItem {
  id: string;
  label: ReactNode;
  /** Shown right-aligned in the line colour, e.g. a price. */
  value?: ReactNode;
  disabled?: boolean;
  onSelect: () => void;
}

interface CursorMenuProps {
  items: CursorMenuItem[];
  /** Keyboard control is on (e.g. false while a mini-game owns the keys). Mouse always works. */
  active?: boolean;
  blocking?: boolean;
  /** 'column' moves with up/down (W/S); 'row' with left/right (A/D). */
  orientation?: 'column' | 'row';
  /** Accessible name for the menu. */
  label: string;
  className?: string;
  /** Item the cursor starts on (e.g. the founder already playing). Falls back to the first enabled item. */
  initialId?: string;
  /**
   * Called with the item id whenever the cursor lands on a new item (keys, hover or focus),
   * and once on mount. Lets a screen show a preview for the row under the cursor.
   */
  onCursorChange?: (id: string) => void;
  /**
   * Escape means "back" for this menu (e.g. close a sub-row) instead of falling through
   * to the global Escape (leave the stand, close the window).
   */
  onBack?: () => void;
}

const PREV_KEYS = { column: ['ArrowUp', 'w', 'W'], row: ['ArrowLeft', 'a', 'A'] } as const;
const NEXT_KEYS = { column: ['ArrowDown', 's', 'S'], row: ['ArrowRight', 'd', 'D'] } as const;
const CONFIRM_KEYS = ['Enter', 'e', 'E'];

/** Index of the next enabled item in direction `step` (+1 / -1), wrapping around. */
export function nextEnabledIndex(items: Pick<CursorMenuItem, 'disabled'>[], from: number, step: 1 | -1): number {
  const n = items.length;
  for (let i = 1; i <= n; i++) {
    const candidate = (((from + step * i) % n) + n) % n;
    if (!items[candidate].disabled) return candidate;
  }
  return from; // every item disabled: stay put
}

export function CursorMenu({
  items,
  active = true,
  blocking = false,
  orientation = 'column',
  label,
  className = '',
  initialId,
  onCursorChange,
  onBack,
}: CursorMenuProps) {
  const [cursor, setCursor] = useState(() => {
    const wanted = initialId === undefined ? -1 : items.findIndex((it) => it.id === initialId && !it.disabled);
    return wanted >= 0 ? wanted : Math.max(0, items.findIndex((it) => !it.disabled));
  });

  // Report the id under the cursor. Keyed on the id (not the index) so a list that
  // re-renders with the same rows does not re-fire it.
  const cursorId = items[cursor]?.id;
  useEffect(() => {
    if (cursorId !== undefined) onCursorChange?.(cursorId);
    // onCursorChange is deliberately left out: callers pass inline arrows, and the
    // callback only needs to run when the highlighted item actually changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursorId]);

  // Items can change under the cursor (a row disables, the list shrinks): keep it valid.
  useEffect(() => {
    if (items.length === 0) return;
    if (cursor >= items.length || items[cursor]?.disabled) {
      setCursor(nextEnabledIndex(items, Math.min(cursor, items.length - 1), 1));
    }
  }, [items, cursor]);

  const move = (step: 1 | -1) => {
    const next = nextEnabledIndex(items, cursor, step);
    if (next !== cursor) {
      soundEngine.playClick();
      setCursor(next);
    }
  };

  useInputLayer(
    (e) => {
      if ((PREV_KEYS[orientation] as readonly string[]).includes(e.key)) {
        e.preventDefault();
        move(-1);
        return true;
      }
      if ((NEXT_KEYS[orientation] as readonly string[]).includes(e.key)) {
        e.preventDefault();
        move(1);
        return true;
      }
      if (e.key === 'Escape' && onBack) {
        e.preventDefault();
        onBack();
        return true;
      }
      if (CONFIRM_KEYS.includes(e.key)) {
        // A held key makes the browser repeat key-down events. Confirming is a deliberate
        // act (it can spend money), so only a fresh press counts; the repeats are swallowed
        // so they don't leak to the world either (E there means "open").
        if (e.repeat) return true;
        const item = items[cursor];
        if (!item || item.disabled) return false;
        e.preventDefault();
        item.onSelect();
        return true;
      }
      return false;
    },
    { active: active && items.length > 0, blocking, priority: blocking ? INPUT_PRIORITY.modal : INPUT_PRIORITY.menu }
  );

  return (
    <ul className={`pt-menu ${orientation === 'row' ? 'is-row' : ''} ${className}`} role="menu" aria-label={label}>
      {items.map((item, i) => (
        <li key={item.id} role="none">
          <button
            type="button"
            role="menuitem"
            className={`pt-menu-item ${i === cursor ? 'is-cursor' : ''}`}
            disabled={item.disabled}
            onMouseEnter={() => !item.disabled && setCursor(i)}
            onFocus={() => setCursor(i)}
            onClick={item.onSelect}
          >
            <span>{item.label}</span>
            {item.value !== undefined && <span className="pt-menu-value">{item.value}</span>}
          </button>
        </li>
      ))}
    </ul>
  );
}
