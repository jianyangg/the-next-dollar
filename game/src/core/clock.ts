/**
 * The in-game day clock: 5:00 AM → 9:00 PM, as a progress value from 0 to 1.
 *
 * WHY THESE HOURS: the 3D sky goes dark -> bright -> dark (pre-dawn, sunrise, noon,
 * sunset, night). The clock label must tell the same story as the sky, so the hours
 * are chosen so that the scene's sunrise (progress 0.12) reads about 7 AM and its
 * sunset (progress 0.9) about 7:30 PM, a stylised summer day. SUNRISE_PROGRESS and
 * SUNSET_PROGRESS below are the single source for both the sky and the HUD sun arc.
 *
 * A full day takes 120 real seconds at 1× speed and 60 at 2×. Each tick's real
 * time is capped at 0.25 s so that a backgrounded browser tab (which pauses timers)
 * cannot skip half the day the moment the player returns.
 */
export type ClockSpeed = 1 | 2;

export const DAY_SECONDS: Record<ClockSpeed, number> = { 1: 120, 2: 60 };
export const MAX_CLOCK_TICK_SECONDS = 0.25;

export function advanceClock(progress: number, realDtSeconds: number, speed: ClockSpeed): number {
  const dt = Math.min(MAX_CLOCK_TICK_SECONDS, realDtSeconds);
  return Math.min(1, progress + dt / DAY_SECONDS[speed]);
}

/**
 * The clock stops while the player is reading or deciding (any panel open), before
 * their first stand exists on day 1, and after the career ends.
 */
export function isClockPaused(p: {
  overlayOpen: boolean;
  day: number;
  maxDays: number;
  ownedStands: number;
}): boolean {
  return p.overlayOpen || (p.day === 1 && p.ownedStands < 1) || p.day > p.maxDays;
}

/** Opening and closing time, in minutes after midnight. */
export const DAY_START_MINUTE = 5 * 60; // 5:00 AM, pre-dawn
export const DAY_END_MINUTE = 21 * 60; // 9:00 PM, the closing bell
const DAY_LENGTH_MINUTES = DAY_END_MINUTE - DAY_START_MINUTE;

/** Where in the day (0..1) the sun clears the horizon and where it sets. */
export const SUNRISE_PROGRESS = 0.12;
export const SUNSET_PROGRESS = 0.9;

function minuteToLabel(minuteOfDay: number, withMinutes: boolean): string {
  const hour24 = Math.floor(minuteOfDay / 60);
  const mins = minuteOfDay % 60;
  const period = hour24 >= 12 ? 'PM' : 'AM';
  const hour12 = hour24 % 12 === 0 ? 12 : hour24 % 12;
  return withMinutes ? `${hour12}:${mins.toString().padStart(2, '0')} ${period}` : `${hour12} ${period}`;
}

/** "5:00 AM" … "9:00 PM", in 5-minute steps. */
export function formatClockTime(progress: number): string {
  const clamped = Math.max(0, Math.min(1, progress));
  const minutes = Math.floor((clamped * DAY_LENGTH_MINUTES) / 5) * 5;
  return minuteToLabel(DAY_START_MINUTE + minutes, true);
}

/** The closing bell as short copy ("9 PM"), so no screen hard-codes the hour. */
export const CLOSING_TIME_SHORT = minuteToLabel(DAY_END_MINUTE, false);

/**
 * Where to draw the sun on the HUD's day arc (an upside-down U from the left horizon
 * to the right horizon).
 *   - x runs 0..1 across the WHOLE day, so the sun's sideways position is the clock.
 *   - height is sin(pi * f), where f is how far the sun is between sunrise and sunset:
 *     0 on the horizon at sunrise, 1 at the top at midday, 0 again at sunset. Before
 *     sunrise and after sunset f is outside 0..1, the sine goes negative and the sun
 *     sits below the horizon, exactly like the dark sky in the scene at those times.
 */
export function sunArcPosition(progress: number): { x: number; height: number; up: boolean } {
  const x = Math.max(0, Math.min(1, progress));
  const f = (x - SUNRISE_PROGRESS) / (SUNSET_PROGRESS - SUNRISE_PROGRESS);
  const up = f >= 0 && f <= 1;
  // Below the horizon, sink at most a little (-0.35) so the sun stays visible as "not up yet".
  const height = up ? Math.sin(Math.PI * f) : -Math.min(0.35, Math.abs(f < 0 ? f : f - 1) * 2);
  return { x, height, up };
}
