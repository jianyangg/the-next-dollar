/**
 * The ONE keyboard listener for the whole game: a stack of input layers.
 *
 * THE PROBLEM IT SOLVES
 *   The scene (WASD walking), the global shortcuts (B, M, F, Space) and the map each
 *   used to add their own `window` keydown listener. All of them saw every key. That
 *   was fine while menus were mouse-only, but a JRPG-style ▶ cursor moves with
 *   arrows/WASD, so pressing S in a shop menu would ALSO walk the player behind it.
 *
 * HOW IT WORKS (like a stack of transparent sheets)
 *   Each layer is a key handler. A key press goes to the TOP layer first.
 *     - If the layer handled it (returned true), it stops there.
 *     - If not, it falls through to the layer below...
 *     - ...unless the layer is `blocking` (a modal window): then it stops anyway, so
 *       nothing behind a modal reacts. A blocking layer can still let a few keys
 *       through (`passKeys`; by default only Escape, so "close the top-most panel"
 *       keeps working from anywhere).
 *   Key-UPs go to every layer: releasing a key is always safe and stops a held key
 *   from getting "stuck" when a layer opens on top of it.
 *
 * Layers are plain objects (no React), so the scene, the store loops and React
 * components all use the same router. React components use `useInputLayer`.
 */

export interface InputLayerOptions {
  /** Return true when the key was used, so lower layers never see it. */
  onKeyDown: (e: KeyboardEvent) => boolean;
  onKeyUp?: (e: KeyboardEvent) => void;
  /** A modal: unhandled keys stop here instead of reaching layers below. */
  blocking?: boolean;
  /** For blocking layers: `e.key` values that may still fall through. */
  passKeys?: readonly string[];
  /**
   * Where the layer sits. Higher = nearer the top. Using fixed bands instead of "last
   * pushed is on top" means the result never depends on which React effect ran first
   * (React runs sibling effects in an order that is easy to change by accident).
   * Equal priorities: the most recently pushed is on top (a modal opened over a modal).
   */
  priority?: number;
}

/** Priority bands. */
export const INPUT_PRIORITY = {
  world: 0, // the scene: walking and [E] interact
  shortcuts: 10, // global game keys: B, M, F, Space, Escape
  menu: 100, // a cursor menu in the HUD or at the stand
  modal: 200, // a window over the world
} as const;

interface Layer extends InputLayerOptions {
  id: number;
}

const DEFAULT_PASS_KEYS: readonly string[] = ['Escape'];

let layers: Layer[] = []; // index 0 = bottom
let nextId = 1;
const pushListeners = new Set<() => void>();

/**
 * Put a layer on top of the stack. Returns a function that removes it (call it on
 * unmount). Removing is by id, so layers may be removed in any order.
 */
export function pushInputLayer(options: InputLayerOptions): () => void {
  const layer: Layer = { ...options, id: nextId++ };
  // Stable sort by priority: equal priorities keep push order, so the newest is on top.
  layers = [...layers, layer].sort(
    (a, b) => (a.priority ?? INPUT_PRIORITY.menu) - (b.priority ?? INPUT_PRIORITY.menu)
  );
  for (const listener of pushListeners) listener();
  return () => {
    layers = layers.filter((l) => l.id !== layer.id);
  };
}

/**
 * Be told whenever a layer is pushed. The scene uses this to drop held movement keys:
 * without it, holding W while a shop opens keeps the player walking (the key-up still
 * arrives, but the scene would walk until then).
 */
export function onInputLayerPushed(listener: () => void): () => void {
  pushListeners.add(listener);
  return () => pushListeners.delete(listener);
}

/** True when focus is in a text field: typing must not trigger game keys. */
function isTyping(e: KeyboardEvent): boolean {
  const target = e.target as HTMLElement | null;
  return target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable === true;
}

export function dispatchKeyDown(e: KeyboardEvent): void {
  // Typing in a text box: only Escape reaches the game (to close the panel).
  if (isTyping(e) && e.key !== 'Escape') return;
  // Browser shortcuts (Cmd+R, Ctrl+F...) are never game keys.
  if (e.metaKey || e.ctrlKey || e.altKey) return;

  for (let i = layers.length - 1; i >= 0; i--) {
    const layer = layers[i];
    if (layer.onKeyDown(e)) return;
    if (layer.blocking && !(layer.passKeys ?? DEFAULT_PASS_KEYS).includes(e.key)) return;
  }
}

export function dispatchKeyUp(e: KeyboardEvent): void {
  for (const layer of layers) layer.onKeyUp?.(e);
}

/** Install the single window listener. Returns the cleanup. */
export function startInputRouter(): () => void {
  window.addEventListener('keydown', dispatchKeyDown);
  window.addEventListener('keyup', dispatchKeyUp);
  return () => {
    window.removeEventListener('keydown', dispatchKeyDown);
    window.removeEventListener('keyup', dispatchKeyUp);
  };
}

/** Tests only: forget every layer and listener. */
export function resetInputRouterForTests(): void {
  layers = [];
  pushListeners.clear();
}
