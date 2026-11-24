// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../audio/soundEngine', () => ({ soundEngine: new Proxy({}, { get: () => () => {} }) }));
// jsdom has no canvas, so the generated pixel icons are stubbed.
vi.mock('../assets', () => ({ getIcons: () => new Proxy({}, { get: () => '' }) }));

import { initRunRandom } from '../../core/runRandom';
import { createInitialState, type DayRecord } from '../../core/sliceModel';
import { dispatchKeyDown, resetInputRouterForTests } from '../../state/input';
import { resetGameStore, useGameStore } from '../../state/gameStore';
import { stageAt, buildRevealSchedule } from './eodReveal';
import { EndOfDayModal } from '../EndOfDayModal';

const record: DayRecord = {
  day: 4,
  cupsSold: 8,
  revenue: 24,
  cogs: 4,
  rentAndWages: 2,
  nopat: 18,
  hurdleCharge: 1.15,
  valueCreated: 16.85,
  cumulativeValue: 41.2,
  roicPct: 78.3,
  grade: 'S',
};

const press = (key: string) =>
  act(() => dispatchKeyDown({ key, target: document.body, repeat: false, preventDefault: () => {} } as unknown as KeyboardEvent));

beforeAll(() => initRunRandom(1));
beforeEach(() => {
  vi.useFakeTimers();
  resetGameStore();
  useGameStore.setState({ eodRecord: record, economy: { ...createInitialState(), day: 4, inventoryValue: 3, equipmentValue: 20, plots: { ...createInitialState().plots, 'central-park': 'leased' } } });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  resetInputRouterForTests();
  resetGameStore();
});

describe('EndOfDayModal', () => {
  // Real timers: the VALUE CREATED number counts up with Motion's own frame loop, which
  // fake timers do not drive. This pins the screen's most important figure.
  it("counts the day's value created up to the record's figure", async () => {
    vi.useRealTimers();
    render(<EndOfDayModal />);
    await vi.waitFor(() => expect(document.querySelector('.eodr-final-num')?.textContent).toBe('+$16.85'), {
      timeout: 5000,
    });
  });

  it('prints rows one by one and stamps last', () => {
    render(<EndOfDayModal />);
    const hidden = () => document.querySelectorAll('.eodr-row.is-hidden').length;
    const total = document.querySelectorAll('.eodr-row').length;
    expect(hidden()).toBe(total);
    act(() => void vi.advanceTimersByTime(280));
    expect(hidden()).toBe(total - 1);
    expect(document.querySelector('.eodr-stamp')?.className).toContain('is-pre');
    const s = buildRevealSchedule(total);
    act(() => void vi.advanceTimersByTime(s.stampAtMs));
    expect(hidden()).toBe(0);
    expect(document.querySelector('.eodr-stamp')?.className).not.toContain('is-pre');
    expect(stageAt(s, s.stampAtMs).stamped).toBe(true);
  });

  it('E during the reveal skips to the end without starting the next day; E again starts it', () => {
    const startNextDay = vi.fn();
    useGameStore.setState({ actions: { ...useGameStore.getState().actions, startNextDay } });
    render(<EndOfDayModal />);
    press('e');
    expect(document.querySelectorAll('.eodr-row.is-hidden').length).toBe(0);
    expect(startNextDay).not.toHaveBeenCalled();
    press('Enter');
    expect(startNextDay).toHaveBeenCalledTimes(1);
    press('e');
    expect(startNextDay).toHaveBeenCalledTimes(1); // never twice
  });

  it('shows every figure in plain words, no formal terms', () => {
    render(<EndOfDayModal />);
    act(() => void vi.advanceTimersByTime(5000));
    const text = document.body.textContent ?? '';
    for (const needle of ['8 cups × $3.00', '+$24.00', '-$4.00', '-$2.00', '+$18.00', '-$1.15', '$23.00 × 5%', '78.3%', '+$41.20', 'Day 4 of 30']) {
      expect(text).toContain(needle);
    }
    expect(text).toContain('Money tied up');
    expect(text).not.toMatch(/NOPAT|EVA|ROIC/);
    // The verdict leads: this record's +$16.85 beat the line.
    expect(text).toContain('BEAT THE LINE');
    expect(screen.getByLabelText('Day won')).toBeTruthy();
    expect(text).not.toContain('Run seed'); // a testing tool, not shown to players
    fireEvent.click(screen.getByRole('button', { name: /next day/i }));
  });

  it('a day below the line says so in red, with the missed stamp', () => {
    useGameStore.setState({ eodRecord: { ...useGameStore.getState().eodRecord!, valueCreated: -1.4 } });
    render(<EndOfDayModal />);
    act(() => void vi.advanceTimersByTime(5000));
    expect(document.body.textContent).toContain('MISSED THE LINE');
    expect(screen.getByLabelText('Day missed')).toBeTruthy();
  });

  it('on the last day the button opens the final results instead of a next day', () => {
    const finishRun = vi.fn();
    const startNextDay = vi.fn();
    const s = useGameStore.getState();
    useGameStore.setState({
      eodRecord: { ...s.eodRecord!, day: s.economy.maxDays },
      actions: { ...s.actions, finishRun, startNextDay },
    });
    render(<EndOfDayModal />);
    press('e'); // skip the printing
    press('e');
    expect(finishRun).toHaveBeenCalledTimes(1);
    expect(startNextDay).not.toHaveBeenCalled();
  });
});
