import { describe, expect, it } from 'vitest';
import { buildRevealSchedule, COUNT_MS, finalStage, milestones, ROW_GAP_MS, stageAt, STAMP_PAUSE_MS } from './eodReveal';

describe('end-of-day reveal schedule', () => {
  it('matches the design tokens (--dur-tally-row 280ms, --dur-count 600ms)', () => {
    expect(ROW_GAP_MS).toBe(280);
    expect(COUNT_MS).toBe(600);
  });

  it('prints one row every 280ms, counts when the last row appears, stamps last', () => {
    const s = buildRevealSchedule(7);
    expect(s.rowAtMs).toEqual([280, 560, 840, 1120, 1400, 1680, 1960]);
    expect(s.countStartMs).toBe(1960);
    expect(s.stampAtMs).toBe(1960 + COUNT_MS + STAMP_PAUSE_MS);
  });

  it('shows nothing at t=0 and grows monotonically', () => {
    const s = buildRevealSchedule(6);
    expect(stageAt(s, 0)).toEqual({ rowsShown: 0, counting: false, stamped: false });
    expect(stageAt(s, 280).rowsShown).toBe(1);
    expect(stageAt(s, 279).rowsShown).toBe(0);
    let prev = 0;
    for (let t = 0; t <= s.stampAtMs + 100; t += 50) {
      const shown = stageAt(s, t).rowsShown;
      expect(shown).toBeGreaterThanOrEqual(prev);
      prev = shown;
    }
  });

  it('only stamps after the count-up has had time to finish', () => {
    const s = buildRevealSchedule(6);
    expect(stageAt(s, s.countStartMs).stamped).toBe(false);
    expect(stageAt(s, s.countStartMs + COUNT_MS).stamped).toBe(false);
    expect(stageAt(s, s.stampAtMs).stamped).toBe(true);
  });

  it('finalStage equals the state at the very end', () => {
    const s = buildRevealSchedule(6);
    expect(finalStage(s)).toEqual(stageAt(s, s.stampAtMs));
  });

  it('lists each change moment once, in order', () => {
    const s = buildRevealSchedule(3);
    expect(milestones(s)).toEqual([280, 560, 840, s.stampAtMs]);
  });
});
