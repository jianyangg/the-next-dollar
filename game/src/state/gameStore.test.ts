import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The real sound engine needs Web Audio. A recording stub lets tests also assert
// WHICH sound an action chose (e.g. a refused purchase must buzz, not chime).
vi.mock('../audio/soundEngine', () => {
  const noop = () => {};
  return {
    soundEngine: {
      isMuted: () => false,
      toggleMute: () => true,
      initOnGesture: noop,
      startMusic: noop,
      stopMusic: noop,
      playClick: vi.fn(),
      playReject: vi.fn(),
      playBuy: vi.fn(),
      playCoin: vi.fn(),
      playBrew: vi.fn(),
      playPerfect: vi.fn(),
      playDayEnd: vi.fn(),
      playTravel: vi.fn(),
      playHonkKo: vi.fn(),
    },
  };
});

import { soundEngine } from '../audio/soundEngine';
import { closeDay as closeBooks } from '../core/dayEnd';
import { CENTRAL_PARK_DEAL } from '../core/deal';
import * as P from '../core/purchases';
import { applySale } from '../core/sales';
import { createInitialState, type SliceState } from '../core/sliceModel';
import { resetAnchorStore } from './anchorStore';
import { resetGameStore, useGameStore } from './gameStore';

const store = () => useGameStore.getState();
const actions = () => useGameStore.getState().actions;

/** Unwrap a purchase result that must succeed (mirrors core/economy.test.ts). */
const ok = (r: P.PurchaseResult): SliceState => {
  if (!r.ok) throw new Error(`expected success, got ${r.reason}`);
  return r.state;
};

/** The same tutorial path as core/economy.test.ts, computed with the pure rules only. */
function tutorialEconomyFromCore(): SliceState {
  let s = createInitialState();
  s = ok(P.signLease(s, 'central-park'));
  s = ok(P.buyStallKit(s));
  s = ok(P.buyPitcher(s));
  s = ok(P.buyLemons(s));
  return ok(P.buildStand(s, 'central-park'));
}

/** Overwrite part of the economy directly (test setup only). */
const setEconomy = (patch: Partial<SliceState>) =>
  useGameStore.setState({ economy: { ...store().economy, ...patch } });

beforeEach(() => {
  vi.useFakeTimers();
  resetGameStore();
  resetAnchorStore();
  vi.clearAllMocks();
});

afterEach(() => {
  resetGameStore(); // also cancels any pending toast timers
  vi.useRealTimers();
});

describe('shopping actions match the pure core rules', () => {
  it('walks the tutorial path to exactly the economy core/economy.test.ts expects', () => {
    actions().signLease();
    actions().buyStallKit();
    actions().buyPitcher();
    actions().buyLemons();
    actions().buildStandOnPlot();

    expect(store().economy).toEqual(tutorialEconomyFromCore());
    expect(store().economy.cash).toBe(3);
    expect(store().economy.plots['central-park']).toBe('built');
  });

  it('refuses an unaffordable purchase: economy untouched, buzz sound, negative toast', () => {
    setEconomy({ cash: 4.99 });
    const before = store().economy;

    actions().buyLemons();

    expect(store().economy).toBe(before); // same object: nothing was written
    expect(soundEngine.playReject).toHaveBeenCalledTimes(1);
    expect(soundEngine.playBuy).not.toHaveBeenCalled();
    const toast = store().toasts.at(-1);
    expect(toast?.tone).toBe('negative');
    expect(toast?.text).toBe('Not enough cash ($5 needed)');
  });

  it('two rapid buyPitcher calls with $15 buy exactly one pitcher', () => {
    setEconomy({ cash: 15 });

    actions().buyPitcher();
    actions().buyPitcher(); // a second click before anything "re-renders"

    expect(store().economy.pitchers).toBe(1);
    expect(store().economy.cash).toBe(5);
    expect(store().economy.equipmentValue).toBe(10);
    expect(store().toasts.map((t) => t.tone)).toEqual(['neutral', 'negative']);
  });

  it('clamps brewedCups to the cups in stock when the economy changes', () => {
    useGameStore.setState({ economy: { ...store().economy, cupsInStock: 2, pitchers: 1 }, brewedCups: 6 });
    actions().hireWorker(); // any economy commit re-applies the clamp
    expect(store().brewedCups).toBe(2);
  });

  it('completes the tutorial (once) when the first revenue lands', () => {
    useGameStore.setState({ economy: applySale({ ...createInitialState(), cupsInStock: 5 }, 1, 1) });
    actions().hireWorker(); // any economy commit re-checks the tutorial rule
    expect(store().tutorialActive).toBe(false);
    expect(soundEngine.playPerfect).toHaveBeenCalledTimes(1);
    expect(store().toasts.some((t) => t.text.startsWith('Tutorial complete!'))).toBe(true);
    actions().hireWorker();
    expect(soundEngine.playPerfect).toHaveBeenCalledTimes(1);
  });
});

describe('toast timers', () => {
  it('expires a toast after 2.2 s and numbers toasts with the store counter', () => {
    actions().taxiHit();
    actions().taxiHit();
    expect(store().toasts.map((t) => t.id)).toEqual([1, 2]);
    vi.advanceTimersByTime(2200);
    expect(store().toasts).toEqual([]);
  });

  it('resetGameStore cancels pending expiry timers so nothing leaks into the next run', () => {
    actions().taxiHit();
    expect(vi.getTimerCount()).toBe(1);
    resetGameStore();
    expect(vi.getTimerCount()).toBe(0);
    expect(store().toasts).toEqual([]);
    expect(store().nextToastId).toBe(1);
  });
});

describe('day end', () => {
  it('closeDay produces exactly the DayRecord and books that core/dayEnd computes', () => {
    // A day with a built stand, a few sales and a hired worker.
    let econ = tutorialEconomyFromCore();
    econ = applySale(applySale(applySale(econ, 1, 1), 0.5, 2), 0.2, 3);
    econ = P.hireWorker(econ);
    useGameStore.setState({ economy: econ, brewedCups: 4, workingAtStand: true });

    const expected = closeBooks(econ);
    expect(expected).not.toBeNull();

    actions().closeDay();

    expect(store().eodRecord).toEqual(expected!.record);
    expect(store().economy).toEqual(expected!.state);
    expect(store().workingAtStand).toBe(false);
    expect(store().brewedCups).toBe(0); // unserved lemonade spoils overnight
    expect(soundEngine.playDayEnd).toHaveBeenCalledTimes(1);
  });

  it('startNextDay advances the day, clears the scorecard and rewinds the clock', () => {
    useGameStore.setState({ economy: tutorialEconomyFromCore() });
    actions().closeDay();
    useGameStore.setState({ timeProgress: 1 });
    actions().startNextDay();
    expect(store().eodRecord).toBeNull();
    expect(store().timeProgress).toBe(0);
    expect(store().economy.day).toBe(2);
  });

  it('tickClock closes the day when progress reaches 1', () => {
    useGameStore.setState({ economy: tutorialEconomyFromCore(), timeProgress: 0.999 });
    actions().tickClock(0.25);
    expect(store().timeProgress).toBe(1);
    expect(store().eodRecord).not.toBeNull();
  });
});

describe('sealed bid', () => {
  const reservation = CENTRAL_PARK_DEAL.reservationPrice;

  it('a bid at or above the hidden minimum wins the stand', () => {
    setEconomy({ cash: reservation + 20 });
    actions().submitSealedBid(String(reservation));
    expect(store().economy.dealStatus).toBe('won');
    expect(store().economy.ownedStands).toBe(1);
    expect(store().economy.cash).toBe(20);
    expect(store().bidMessage).toBe(`Accepted! Stand joined your chain at $${reservation}.`);
  });

  it('a bid below the minimum is rejected and closes the deal without spending cash', () => {
    setEconomy({ cash: reservation + 20 });
    actions().submitSealedBid(String(reservation - 1));
    expect(store().economy.dealStatus).toBe('rejected');
    expect(store().economy.cash).toBe(reservation + 20);
    expect(store().bidMessage).toContain('declined');
  });

  it('a bid above the cash on hand is refused and the deal stays open', () => {
    setEconomy({ cash: 30 });
    actions().submitSealedBid('45');
    expect(store().economy.dealStatus).toBe('open');
    expect(store().economy.cash).toBe(30);
    expect(store().bidMessage).toBe('Insufficient cash: you have $30.00.');
    expect(soundEngine.playReject).toHaveBeenCalled();
  });

  it('ignores a non-numeric bid', () => {
    actions().submitSealedBid('abc');
    expect(store().bidMessage).toBeNull();
    expect(store().economy.dealStatus).toBe('open');
  });
});

describe('seller questions', () => {
  it('allows at most three questions and ignores blanks', () => {
    actions().askQuestion('   ');
    expect(store().qaLog).toHaveLength(0);
    for (const q of ['a?', 'b?', 'c?', 'd?']) actions().askQuestion(q);
    expect(store().qaLog.map((e) => e.q)).toEqual(['a?', 'b?', 'c?']);
  });
});

describe('navigation', () => {
  it('selectNeighborhood remembers the last business district and closes panels', () => {
    useGameStore.setState({ mapOpen: true, workingAtStand: true });
    actions().selectNeighborhood('market');
    expect(store().neighborhoodId).toBe('market');
    expect(store().lastBusinessNeighborhood).toBe('central-park');
    expect(store().mapOpen).toBe(false);
    expect(store().workingAtStand).toBe(false);
    actions().selectNeighborhood('columbia');
    expect(store().lastBusinessNeighborhood).toBe('columbia');
  });

  it('Escape closes the top-most layer first', () => {
    useGameStore.setState({ founderModalOpen: true, mapOpen: true, booksOpen: true });
    actions().handleEscape();
    expect(store().founderModalOpen).toBe(false);
    expect(store().mapOpen).toBe(true);
    actions().handleEscape();
    expect(store().mapOpen).toBe(false);
    actions().handleEscape();
    expect(store().booksOpen).toBe(false);
  });
});
