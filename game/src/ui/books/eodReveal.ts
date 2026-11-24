/**
 * The end-of-day "receipt printing" timeline, as plain numbers.
 *
 * WHY A PURE FUNCTION: the component only has to ask "at time t, what is on screen?".
 * Keeping the timing here (no React, no timers) means it can be unit-tested instantly and
 * the same schedule drives both the real timeouts and the "skip to the end" jump.
 *
 * The gaps mirror the design tokens --dur-tally-row (280ms) and --dur-count (600ms) in
 * styles/tokens.css. CSS variables cannot be read by a timer, so the numbers are repeated
 * here on purpose; the test below pins them.
 */
export const ROW_GAP_MS = 280; // --dur-tally-row: gap between two rows printing
export const COUNT_MS = 600; // --dur-count: how long the final number counts up
export const STAMP_PAUSE_MS = 150; // beat between the count finishing and the grade landing

export interface RevealSchedule {
  /** When row i appears, in ms since the modal opened. */
  rowAtMs: number[];
  /** The last row is the "Value created" total; its number starts counting as it appears. */
  countStartMs: number;
  /** The grade stamp lands last. */
  stampAtMs: number;
}

export interface RevealStage {
  /** How many rows (from the top) are visible. */
  rowsShown: number;
  /** True once the final number may count up. */
  counting: boolean;
  /** True once the grade stamp has landed. This is also "everything is finished". */
  stamped: boolean;
}

export function buildRevealSchedule(rowCount: number): RevealSchedule {
  const rowAtMs = Array.from({ length: rowCount }, (_, i) => ROW_GAP_MS * (i + 1));
  const countStartMs = rowAtMs.length > 0 ? rowAtMs[rowAtMs.length - 1] : 0;
  return { rowAtMs, countStartMs, stampAtMs: countStartMs + COUNT_MS + STAMP_PAUSE_MS };
}

/** What is on screen `elapsedMs` after the modal opened. Monotonic: later never shows less. */
export function stageAt(schedule: RevealSchedule, elapsedMs: number): RevealStage {
  return {
    rowsShown: schedule.rowAtMs.filter((t) => t <= elapsedMs).length,
    counting: elapsedMs >= schedule.countStartMs,
    stamped: elapsedMs >= schedule.stampAtMs,
  };
}

/** Everything visible: used for "skip" and for reduced-motion players. */
export function finalStage(schedule: RevealSchedule): RevealStage {
  return { rowsShown: schedule.rowAtMs.length, counting: true, stamped: true };
}

/** Every moment at which the picture changes, in order, so a timer can be set for each. */
export function milestones(schedule: RevealSchedule): number[] {
  return [...new Set([...schedule.rowAtMs, schedule.countStartMs, schedule.stampAtMs])].sort((a, b) => a - b);
}
