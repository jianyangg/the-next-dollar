import type { CentralParkScene } from '../world/CentralParkScene';

/**
 * A one-slot "mailbox" holding the live 3D scene.
 *
 * Why it exists: store actions (e.g. "serve the front customer") must ask the
 * 3D world a question, but the store must not import the scene's code (that would
 * pull Three.js into every unit test, and tie game rules to rendering).
 * Instead the scene registers itself here when it is created and removes itself
 * when it is disposed; actions call `getScene()?.method()`.
 *
 * `import type` above is erased at build time, so this file never loads Three.js.
 * `getScene()` is `null` before the scene exists and after it is disposed, which is
 * why every caller uses `?.`.
 */
let currentScene: CentralParkScene | null = null;

export function registerScene(scene: CentralParkScene | null): void {
  currentScene = scene;
}

export function getScene(): CentralParkScene | null {
  return currentScene;
}
