import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The real sound engine needs Web Audio; closeDay / skipTutorial play sounds.
vi.mock('../audio/soundEngine', () => {
  const noop = () => {};
  return {
    soundEngine: {
      isMuted: () => false,
      toggleMute: () => true,
      initOnGesture: noop,
      startMusic: noop,
      stopMusic: noop,
      playClick: noop,
      playReject: noop,
      playBuy: noop,
      playCoin: noop,
      playBrew: noop,
      playPerfect: noop,
      playDayEnd: noop,
      playTravel: noop,
      playHonkKo: noop,
    },
  };
});

import { initRunRandom } from '../core/runRandom';
import { resetAnchorStore } from '../state/anchorStore';
import { resetGameStore, useGameStore } from '../state/gameStore';
import * as dev from './devTools';

const eco = () => useGameStore.getState().economy;

beforeEach(() => {
  resetGameStore();
  resetAnchorStore();
  dev.resetDevClockForTests();
  initRunRandom(4242);
  vi.spyOn(console, 'info').mockImplementation(() => {});
});
afterEach(() => {
  dev.resetDevClockForTests();
  vi.restoreAllMocks();
  resetGameStore();
});

describe('money and stock cheats', () => {
  it('addCash adds $100 and logs one [dev] line', () => {
    dev.addCash();
    expect(eco().cash).toBe(130);
    expect(console.info).toHaveBeenCalledWith('[dev]', 'addCash', expect.anything());
  });

  it('zeroCash sets cash to 0', () => {
    dev.zeroCash();
    expect(eco().cash).toBe(0);
  });

  it('addLemons adds 10 cups worth $5 and leaves cash unchanged ($0.50/cup)', () => {
    dev.addLemons();
    expect(eco().cupsInStock).toBe(10);
    expect(eco().inventoryValue).toBe(5);
    expect(eco().cash).toBe(30);
    expect(eco().inventoryValue / eco().cupsInStock).toBe(0.5);
  });

  it('addPitcher adds one pitcher and $10 equipment, cash unchanged', () => {
    dev.addPitcher();
    expect(eco().pitchers).toBe(1);
    expect(eco().equipmentValue).toBe(10);
    expect(eco().cash).toBe(30);
  });

  it('addStallKit adds one kit and $12 equipment, cash unchanged', () => {
    dev.addStallKit();
    expect(eco().stallKits).toBe(1);
    expect(eco().equipmentValue).toBe(12);
    expect(eco().cash).toBe(30);
  });

  it('works from $0 cash too (the cheat funds its own purchase)', () => {
    dev.zeroCash();
    dev.addPitcher();
    expect(eco().cash).toBe(0);
    expect(eco().pitchers).toBe(1);
  });
});

describe('time cheats', () => {
  it('skipToEvening closes the day through the store: scorecard opens at 8 PM', () => {
    expect(dev.skipToEvening()).toEqual({ ok: true });
    expect(useGameStore.getState().eodRecord).not.toBeNull();
    expect(useGameStore.getState().timeProgress).toBe(1);
  });

  it('skipToEvening refuses to close the same day twice', () => {
    dev.skipToEvening();
    const history = eco().dayHistory.length;
    expect(dev.skipToEvening()).toEqual({ ok: false, reason: 'day-already-closed' });
    expect(eco().dayHistory.length).toBe(history);
  });

  it('jumpToDay sets the day, resets the clock and clears the scorecard', () => {
    dev.skipToEvening();
    dev.jumpToDay(12);
    expect(eco().day).toBe(12);
    expect(useGameStore.getState().timeProgress).toBe(0);
    expect(useGameStore.getState().eodRecord).toBeNull();
    expect(eco().dayRevenue).toBe(0);
  });

  it('jumpToDay rejects days outside 1..30 and non-integers', () => {
    expect(() => dev.jumpToDay(0)).toThrow(RangeError);
    expect(() => dev.jumpToDay(31)).toThrow(RangeError);
    expect(() => dev.jumpToDay(2.5)).toThrow(RangeError);
    expect(() => dev.jumpToDay(Number.NaN)).toThrow(RangeError);
    expect(eco().day).toBe(1);
  });

  describe('clock modes', () => {
    // The real loop only ticks when the clock is not paused: no founder window, and (on
    // day 1) at least one stand. Mirror that so the wrapper's own pause check passes.
    const openClock = () => {
      useGameStore.setState({ introOpen: false, founderModalOpen: false });
      dev.buildStandHere();
    };
    const tick = (dt: number) => useGameStore.getState().actions.tickClock(dt);

    it('x10 advances ten times as far per beat', () => {
      openClock();
      tick(0.1);
      const normal = useGameStore.getState().timeProgress;
      useGameStore.setState({ timeProgress: 0 });
      dev.setDevClockMode('x10');
      tick(0.1);
      expect(useGameStore.getState().timeProgress).toBeCloseTo(normal * 10, 10);
    });

    it('x10 closes the day only once when it crosses 8 PM', () => {
      openClock();
      dev.setDevClockMode('x10');
      useGameStore.setState({ timeProgress: 0.99 });
      tick(0.25);
      expect(eco().dayHistory.length).toBe(1);
    });

    it('paused freezes the clock; normal restores it', () => {
      openClock();
      dev.setDevClockMode('paused');
      tick(0.1);
      expect(useGameStore.getState().timeProgress).toBe(0);
      dev.setDevClockMode('normal');
      tick(0.1);
      expect(useGameStore.getState().timeProgress).toBeGreaterThan(0);
      expect(dev.getDevClockMode()).toBe('normal');
    });

    it('switching modes repeatedly never stacks wrappers', () => {
      openClock();
      dev.setDevClockMode('x10');
      dev.setDevClockMode('x10');
      tick(0.1);
      useGameStore.setState({ timeProgress: 0 });
      dev.setDevClockMode('normal');
      tick(0.1);
      const once = useGameStore.getState().timeProgress;
      expect(once).toBeCloseTo(0.1 / 120, 10);
    });
  });
});

describe('progress cheats', () => {
  it('skipTutorial ends the tutorial', () => {
    expect(useGameStore.getState().tutorialActive).toBe(true);
    dev.skipTutorial();
    expect(useGameStore.getState().tutorialActive).toBe(false);
  });

  it('resetSellerDeal reopens a finished deal and clears the deal view', () => {
    useGameStore.setState({
      economy: { ...eco(), dealStatus: 'rejected', dealBidPrice: 9 },
      activeModal: 'seller-stand',
    });
    dev.resetSellerDeal();
    expect(eco().dealStatus).toBe('open');
    expect(eco().dealBidPrice).toBeNull();
    expect(useGameStore.getState().deal).toBeNull();
    expect(useGameStore.getState().activeModal).toBeNull();
  });

  it('buildStandHere leases, buys a kit and builds; the kit costs equity, not cash', () => {
    expect(dev.buildStandHere()).toEqual({ ok: true });
    expect(eco().plots['central-park']).toBe('built');
    expect(eco().ownedStands).toBe(1);
    expect(eco().stallKits).toBe(0); // consumed by the build
    expect(eco().cash).toBe(30);
  });

  it('buildStandHere reuses a kit already owned, and refuses a built plot', () => {
    dev.addStallKit();
    dev.addStallKit();
    dev.buildStandHere();
    expect(eco().stallKits).toBe(1);
    expect(dev.buildStandHere()).toEqual({ ok: false, reason: 'already-built' });
  });

  it('buildStandHere refuses in the market (no plots there)', () => {
    useGameStore.setState({ neighborhoodId: 'market' });
    expect(dev.buildStandHere()).toEqual({ ok: false, reason: 'market-has-no-plots' });
  });
});

describe('seed', () => {
  it('shows the run seed and builds the restart URL', () => {
    expect(dev.currentSeed()).toBe(4242);
    expect(dev.restartUrl(4242, '/')).toBe('/?seed=4242&dev');
  });
});
