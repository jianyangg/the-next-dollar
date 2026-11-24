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
import { anchorStore, resetAnchorStore } from './anchorStore';
import { registerScene } from './sceneBridge';
import type { SellerClient } from '../deal/sellerClient';
import { resetGameStore, setSellerClientForTests, TRAVEL_COVER_MS, TRAVEL_REVEAL_MS, useGameStore } from './gameStore';

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
    // Tutorial off: this test is about the plain affordability rule, not the starter guard.
    useGameStore.setState({ tutorialActive: false });
    setEconomy({ cash: 4.99 });
    const before = store().economy;

    actions().buyLemons();

    expect(store().economy).toBe(before); // same object: nothing was written
    expect(soundEngine.playReject).toHaveBeenCalledTimes(1);
    expect(soundEngine.playBuy).not.toHaveBeenCalled();
    const toast = store().toasts.at(-1);
    expect(toast?.tone).toBe('negative');
    expect(toast?.text).toBe('Need $5');
    expect(toast?.chips).toEqual([]);
  });

  it('a purchase floats the money that moved, computed from the economy', () => {
    setEconomy({ cash: 30 });
    actions().buyLemons();
    const toast = store().toasts.at(-1);
    expect(toast?.text).toBe('+10 cups');
    expect(toast?.chips).toEqual([
      { kind: 'cash', delta: -5 },
      { kind: 'stock', delta: 5 },
      { kind: 'profit', delta: 0 },
      { kind: 'line', delta: 0.25 },
    ]);
  });

  it('two rapid buyPitcher calls with $15 buy exactly one pitcher', () => {
    useGameStore.setState({ tutorialActive: false });
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

  it('a sale no longer ends the tutorial; closing the first day with a sale does (once)', () => {
    useGameStore.setState({ economy: applySale({ ...createInitialState(), cupsInStock: 5 }, 1, 1) });
    actions().hireWorker(); // an economy commit must NOT end the tutorial any more
    expect(store().tutorialActive).toBe(true);
    actions().startNextDay(); // the player closes the first end-of-day screen
    expect(store().tutorialActive).toBe(false);
    expect(soundEngine.playPerfect).toHaveBeenCalledTimes(1);
    expect(store().toasts.some((t) => t.text === 'Tutorial done')).toBe(true);
    actions().startNextDay();
    expect(soundEngine.playPerfect).toHaveBeenCalledTimes(1);
  });

  it('a day 1 with no sales keeps the tutorial running', () => {
    actions().startNextDay();
    expect(store().tutorialActive).toBe(true);
  });

  it('tutorial guard: refuses the second crate that would leave no money for the pitcher', () => {
    actions().buyStallKit(); // $30 -> $18
    actions().buyLemons(); // -> $13
    actions().buyLemons(); // would leave $8 < $10 pitcher: refused
    expect(store().economy.cash).toBe(13);
    expect(store().economy.cupsInStock).toBe(10);
    expect(store().toasts.at(-1)?.text).toBe('Keep $10 for pitcher');
    expect(soundEngine.playReject).toHaveBeenCalledTimes(1);
    actions().buyPitcher(); // the essentials still go through
    expect(store().economy.pitchers).toBe(1);
  });

  it('tutorial guard steps aside once the tutorial is skipped', () => {
    actions().skipTutorial();
    actions().buyStallKit();
    actions().buyLemons();
    actions().buyLemons();
    expect(store().economy.cupsInStock).toBe(20);
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

describe('seller deal (deal machine + seller server client)', () => {
  const reservation = CENTRAL_PARK_DEAL.reservationPrice;

  /** A fake seller server with the real contract (see shared/sellerReply.ts). */
  function fakeSeller() {
    let remaining = 3;
    const client: SellerClient = {
      pitch: vi.fn(async () => ({ text: 'Fine stand.', source: 'model' as const, questionsEnabled: true, questionsRemaining: 3 })),
      ask: vi.fn(async (_id: string, q: string) => {
        remaining -= 1;
        return { text: `About ${q}`, source: 'model' as const, questionsRemaining: remaining, refunded: false };
      }),
      close: vi.fn(async () => {}),
    };
    setSellerClientForTests(client);
    return client;
  }

  /** Open the seller panel and wait for the pitch. */
  async function openDeal() {
    actions().openModal('seller-stand');
    await vi.waitFor(() => expect(store().deal?.phase).toBe('idle'));
  }

  afterEach(() => setSellerClientForTests(null));

  it('opening the panel fetches the pitch once; reopening keeps the same deal', async () => {
    const client = fakeSeller();
    await openDeal();
    expect(store().deal?.pitch).toBe('Fine stand.');
    actions().closeModal();
    actions().openModal('seller-stand');
    expect(client.pitch).toHaveBeenCalledTimes(1);
  });

  it('a bid at or above the hidden minimum wins the stand and closes the conversation', async () => {
    const client = fakeSeller();
    setEconomy({ cash: reservation + 20 });
    await openDeal();
    actions().submitBid(reservation);
    await vi.waitFor(() => expect(store().deal?.phase).toBe('won'));
    expect(store().economy.dealStatus).toBe('won');
    expect(store().economy.ownedStands).toBe(1);
    expect(store().economy.cash).toBe(20);
    expect(client.close).toHaveBeenCalledTimes(1);
  });

  it('a bid below the minimum is rejected and closes the deal without spending cash', async () => {
    fakeSeller();
    setEconomy({ cash: reservation + 20 });
    await openDeal();
    actions().submitBid(reservation - 1);
    await vi.waitFor(() => expect(store().deal?.phase).toBe('rejected'));
    expect(store().economy.dealStatus).toBe('rejected');
    expect(store().economy.cash).toBe(reservation + 20);
  });

  it('a bid above the cash on hand is refused and the deal stays open', async () => {
    fakeSeller();
    setEconomy({ cash: 30 });
    await openDeal();
    actions().submitBid(45);
    await vi.waitFor(() => expect(store().deal?.bidError).toEqual({ kind: 'insufficient-cash', cash: 30 }));
    expect(store().deal?.phase).toBe('idle');
    expect(store().economy.dealStatus).toBe('open');
    expect(soundEngine.playReject).toHaveBeenCalled();
  });

  it('asks go to the server; the server count decides when asking ends', async () => {
    const client = fakeSeller();
    await openDeal();
    for (const q of ['a?', 'b?', 'c?']) {
      actions().askSeller(q);
      await vi.waitFor(() => expect(store().deal?.phase).toBe('idle'));
    }
    actions().askSeller('d?');
    expect(client.ask).toHaveBeenCalledTimes(3);
    expect(store().deal?.qa.map((e) => e.a)).toEqual(['About a?', 'About b?', 'About c?']);
    expect(store().deal?.canAsk).toBe(false);
  });

  it('walking away is final for the career', async () => {
    const client = fakeSeller();
    await openDeal();
    actions().walkAwayFromDeal();
    await vi.waitFor(() => expect(store().economy.dealStatus).toBe('walked-away'));
    expect(store().activeModal).toBeNull();
    expect(client.close).toHaveBeenCalledTimes(1);
    actions().submitBid(100);
    expect(store().deal?.phase).toBe('walkedAway');
  });
});

describe('navigation', () => {
  /** Run a whole subway ride: doors close, district swaps, doors open. */
  const ride = (id: Parameters<ReturnType<typeof actions>['selectNeighborhood']>[0]) => {
    actions().selectNeighborhood(id);
    vi.advanceTimersByTime(TRAVEL_COVER_MS + TRAVEL_REVEAL_MS);
  };

  it('a subway ride covers the screen, swaps the district while covered, then reveals', () => {
    actions().selectNeighborhood('market');
    // Doors closing: the old district is still loaded and the clock is paused.
    expect(store().travel).toEqual({ to: 'market', phase: 'cover' });
    expect(store().neighborhoodId).toBe('central-park');
    actions().selectNeighborhood('fidi'); // a second ride request mid-ride is ignored
    vi.advanceTimersByTime(TRAVEL_COVER_MS);
    expect(store().travel).toEqual({ to: 'market', phase: 'reveal' });
    expect(store().neighborhoodId).toBe('market');
    vi.advanceTimersByTime(TRAVEL_REVEAL_MS);
    expect(store().travel).toBeNull();
    expect(store().toasts.at(-1)?.text).toBe('Supply Market');
  });

  it('selectNeighborhood remembers the last business district and closes panels', () => {
    useGameStore.setState({ mapOpen: true, workingAtStand: true });
    ride('market');
    expect(store().neighborhoodId).toBe('market');
    expect(store().lastBusinessNeighborhood).toBe('central-park');
    expect(store().mapOpen).toBe(false);
    expect(store().workingAtStand).toBe(false);
    ride('columbia');
    expect(store().lastBusinessNeighborhood).toBe('columbia');
  });

  it('Escape skips the intro first, and cannot close the founder picker before the run starts', () => {
    useGameStore.setState({ introOpen: true, founderModalOpen: true, runStarted: false });
    actions().handleEscape();
    expect(store().introOpen).toBe(false);
    actions().handleEscape();
    expect(store().founderModalOpen).toBe(true); // nothing behind it yet
    actions().closeFounderModal();
    expect(store().founderModalOpen).toBe(true);
    actions().startFromFounderModal();
    expect(store().runStarted).toBe(true);
    actions().openFounderModal();
    actions().handleEscape();
    expect(store().founderModalOpen).toBe(false); // mid-run it closes normally
  });

  it('Escape closes the top-most layer first', () => {
    useGameStore.setState({ introOpen: false, runStarted: true, founderModalOpen: true, mapOpen: true, booksOpen: true });
    actions().handleEscape();
    expect(store().founderModalOpen).toBe(false);
    expect(store().mapOpen).toBe(true);
    actions().handleEscape();
    expect(store().mapOpen).toBe(false);
    actions().handleEscape();
    expect(store().booksOpen).toBe(false);
  });

  it('Escape closes Books opened over the stand, and only then leaves the stand', () => {
    useGameStore.setState({ introOpen: false, founderModalOpen: false, workingAtStand: true, booksOpen: true });
    actions().handleEscape();
    expect(store().booksOpen).toBe(false);
    expect(store().workingAtStand).toBe(true);
    actions().handleEscape();
    expect(store().workingAtStand).toBe(false);
  });
});

describe('hold to serve', () => {
  // Node has no requestAnimationFrame. This stub finishes each 450 ms pour on the next
  // fake-timer tick by reporting a frame time far in the future, so a test can count
  // pours by advancing the fake clock.
  beforeEach(() => {
    vi.stubGlobal('requestAnimationFrame', (cb: (t: number) => void) =>
      setTimeout(() => cb(performance.now() + 10_000), 16)
    );
    vi.stubGlobal('cancelAnimationFrame', (id: ReturnType<typeof setTimeout>) => clearTimeout(id));
    // A fake scene that always has a customer to hand over, and a 4-person line.
    registerScene({ serveFrontCustomer: () => ({ patienceRatio: 1 }), burstSaleSparkles: () => {} } as unknown as Parameters<typeof registerScene>[0]);
    anchorStore.setState({ queue: [1, 2, 3, 4].map((id) => ({ id })) } as never);
    useGameStore.setState({ workingAtStand: true, brewedCups: 3 });
    setEconomy({ cupsInStock: 10, pitchers: 1 });
  });
  afterEach(() => {
    registerScene(null);
    vi.unstubAllGlobals();
  });

  it('a tap (released before the pour ends) serves exactly one cup', () => {
    actions().startServeFrontCustomer();
    vi.advanceTimersByTime(500);
    expect(store().economy.dayCupsSold).toBe(1);
  });

  it('holding keeps pouring until the pitcher is empty, then stops quietly', () => {
    actions().setSpaceHeld(true);
    actions().startServeFrontCustomer();
    vi.advanceTimersByTime(500);
    expect(store().economy.dayCupsSold).toBe(3); // all 3 brewed cups
    expect(store().brewedCups).toBe(0);
    expect(store().toasts.some((t) => t.text === 'Brew first')).toBe(false);
  });

  it('letting go mid-chain stops after the current pour', () => {
    actions().setSpaceHeld(true);
    actions().startServeFrontCustomer();
    vi.advanceTimersByTime(20); // first pour done, second started
    actions().setSpaceHeld(false);
    vi.advanceTimersByTime(500);
    expect(store().economy.dayCupsSold).toBe(2);
  });
});
