/**
 * Remembers (in localStorage) that this browser has already watched the opening story,
 * so it plays once per player instead of on every page load. "Replay intro" on the
 * founder screen brings it back on demand.
 *
 * localStorage can throw (Safari private mode, storage disabled by policy). When it
 * does we cannot know whether the intro was seen, so we treat it as NOT seen and show
 * it: showing a 4-card intro again is harmless, hiding it from a new player is not.
 */
const KEY = 'tnd.introSeen.v1';

export function hasSeenIntro(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function markIntroSeen(): void {
  try {
    localStorage.setItem(KEY, '1');
  } catch {
    // Storage unavailable: the intro will simply show again next visit (see above).
  }
}
