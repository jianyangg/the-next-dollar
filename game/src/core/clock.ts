/**
 * The in-game day clock: 8:00 AM → 8:00 PM, as a progress value from 0 to 1.
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

/** "8:00 AM" … "8:00 PM", in 5-minute steps. */
export function formatClockTime(progress: number): string {
  const clamped = Math.max(0, Math.min(1, progress));
  const totalMinutes = Math.floor((clamped * 720) / 5) * 5;
  const hour24 = 8 + Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  const period = hour24 >= 12 ? 'PM' : 'AM';
  const hour12 = hour24 > 12 ? hour24 - 12 : hour24;
  return `${hour12}:${mins.toString().padStart(2, '0')} ${period}`;
}
