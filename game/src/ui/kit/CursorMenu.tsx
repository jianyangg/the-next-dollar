import { type ReactNode, useEffect, useRef, useState } from 'react';
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
  /**
   * Press-and-hold support for the mouse. When set, pressing the button selects at once
   * (on pointer-down, not on click) and reports held=true; releasing ANYWHERE reports
   * held=false. The release is caught on the window, not the button, because the
   * button may become disabled mid-hold (e.g. Serve while pouring), and a disabled
   * button receives no pointer-up: listening on it would leave the hold stuck on.
   */
  onHoldChange?: (held: boolean) => void;
}

/** Start a mouse hold on a menu item: select now, report held until the pointer is released. */
function startPointerHold(e: React.PointerEvent, item: CursorMenuItem): void {
  if (e.button !== 0 || !item.onHoldChange) return;
  const report = item.onHoldChange;
  const release = (): void => {
    report(false);
    window.removeEventListener('pointerup', release);
    window.removeEventListener('pointercancel', release);
    window.removeEventListener('blur', release);
  };
  window.addEventListener('pointerup', release);
  window.addEventListener('pointercancel', release);
  window.addEventListener('blur', release);
  report(true);
  item.onSelect();
}

interface CursorMenuProps {
  items: CursorMenuItem[];
  /** Keyboard control is on (e.g. false while a mini-game owns the keys). Mouse always works. */
  active?: boolean;
  blocking?: boolean;
  /**
   * 'column' moves with up/down (W/S); 'row' with left/right (A/D). A row that wraps onto
   * more lines also hops between them with up/down (see `lineHopIndex`).
   */
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

/** Where an item's button sits on screen; only the parts line-hopping needs. */
export interface ItemBox {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/**
 * Index of the closest enabled item on the visual line above (step -1) or below (+1).
 *
 * Why geometry: a 'row' menu wraps when it runs out of width (the price row puts "Done"
 * under "$2"). The list is one-dimensional, but the player sees a grid, so S/Down must
 * go to what is drawn below, not to the next item in the list. We read where each
 * button actually landed and pick, among items on a different line in that direction,
 * the nearest line first, then the one closest horizontally to the cursor.
 *
 * Returns `from` when nothing is above/below (a row that fits on one line): the key
 * then does nothing, which is what a single line looks like it should do.
 */
export function lineHopIndex(
  boxes: readonly (ItemBox | null)[],
  items: Pick<CursorMenuItem, 'disabled'>[],
  from: number,
  step: 1 | -1
): number {
  const here = boxes[from];
  if (!here) return from;
  const centreX = (here.left + here.right) / 2;
  let best = from;
  let bestLineGap = Infinity;
  let bestXGap = Infinity;
  boxes.forEach((box, i) => {
    if (!box || i === from || items[i]?.disabled) return;
    // "On another line" = no vertical overlap with the cursor's box, in the right direction.
    const lineGap = step === 1 ? box.top - here.bottom : here.top - box.bottom;
    if (lineGap < -1) return; // 1px slack for borders that touch
    const xGap = Math.abs((box.left + box.right) / 2 - centreX);
    if (lineGap < bestLineGap - 1 || (Math.abs(lineGap - bestLineGap) <= 1 && xGap < bestXGap)) {
      best = i;
      bestLineGap = lineGap;
      bestXGap = xGap;
    }
  });
  return best;
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

  // The rendered buttons, so a wrapped row can move up/down by where items really sit.
  const buttonRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const move = (step: 1 | -1, across = false) => {
    const next = across
      ? lineHopIndex(
          items.map((_, i) => buttonRefs.current[i]?.getBoundingClientRect() ?? null),
          items,
          cursor,
          step
        )
      : nextEnabledIndex(items, cursor, step);
    if (next !== cursor) {
      soundEngine.playClick();
      setCursor(next);
    }
  };

  // A keyboard hold in progress: which key started it and which item it reports to.
  // E/Enter on a hold item reports held=true and selects; releasing THAT key reports
  // held=false. The key-up arrives through the input router like every other key (one
  // window listener for the whole game), not through a listener of our own.
  const keyHold = useRef<{ key: string; item: CursorMenuItem } | null>(null);
  const endKeyHold = (): void => {
    const hold = keyHold.current;
    keyHold.current = null;
    hold?.item.onHoldChange?.(false);
  };
  // Losing window focus swallows the key-up, and unmounting mid-hold would never see it:
  // both count as letting go, so a hold can never stick on.
  useEffect(() => {
    window.addEventListener('blur', endKeyHold);
    return () => {
      window.removeEventListener('blur', endKeyHold);
      endKeyHold();
    };
  }, []);

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
      // A row menu can wrap onto several lines, so W/S and Up/Down hop between them.
      if (orientation === 'row') {
        const vertical = (PREV_KEYS.column as readonly string[]).includes(e.key)
          ? -1
          : (NEXT_KEYS.column as readonly string[]).includes(e.key)
            ? 1
            : 0;
        if (vertical !== 0) {
          e.preventDefault();
          move(vertical, true);
          return true;
        }
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
        if (item.onHoldChange) {
          endKeyHold(); // a second confirm key while one is held replaces that hold
          keyHold.current = { key: e.key.toLowerCase(), item };
          item.onHoldChange(true);
        }
        item.onSelect();
        return true;
      }
      return false;
    },
    {
      active: active && items.length > 0,
      blocking,
      priority: blocking ? INPUT_PRIORITY.modal : INPUT_PRIORITY.menu,
      onKeyUp: (e) => {
        if (keyHold.current && e.key.toLowerCase() === keyHold.current.key) endKeyHold();
      },
    }
  );

  return (
    <ul className={`pt-menu ${orientation === 'row' ? 'is-row' : ''} ${className}`} role="menu" aria-label={label}>
      {items.map((item, i) => (
        <li key={item.id} role="none">
          <button
            ref={(el) => {
              buttonRefs.current[i] = el;
            }}
            type="button"
            role="menuitem"
            className={`pt-menu-item ${i === cursor ? 'is-cursor' : ''}`}
            disabled={item.disabled}
            onMouseEnter={() => !item.disabled && setCursor(i)}
            onFocus={() => setCursor(i)}
            onPointerDown={item.onHoldChange ? (e) => startPointerHold(e, item) : undefined}
            // A hold item already selected on pointer-down; a mouse click (detail > 0)
            // must not select it a second time. Keyboard "clicks" have detail 0.
            onClick={item.onHoldChange ? (e) => e.detail === 0 && item.onSelect() : item.onSelect}
          >
            <span>{item.label}</span>
            {item.value !== undefined && <span className="pt-menu-value">{item.value}</span>}
          </button>
        </li>
      ))}
    </ul>
  );
}
