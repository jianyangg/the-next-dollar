import { describe, expect, it } from 'vitest';
import { advanceClock, formatClockTime, isClockPaused } from './clock';
import { closeDay, startNextDay } from './dayEnd';
import { CENTRAL_PARK_DEAL, resolveSealedBid, toPublicView } from './deal';
import * as P from './purchases';
import { getDailyPlotRent } from './rent';
import { applySale, applyWalkout, salePopLabel } from './sales';
import { createInitialState, SliceState } from './sliceModel';

/**
 * Characterization tests: they pin the exact numbers the original App.tsx handlers
 * produced, so moving the rules into src/core cannot silently change the economy.
 * Each expected value is worked out by hand in the comment beside it.
 */
const ok = (r: P.PurchaseResult): SliceState => {
  if (!r.ok) throw new Error(`expected success, got ${r.reason}`);
  return r.state;
};

/** The tutorial path: lease Central Park, buy kit + pitcher + lemons, build. */
function tutorialStand(): SliceState {
  let s = createInitialState(); // $30 cash
  s = ok(P.signLease(s, 'central-park'));
  s = ok(P.buyStallKit(s)); // 30 − 12 = 18
  s = ok(P.buyPitcher(s)); // 18 − 10 = 8
  s = ok(P.buyLemons(s)); // 8 − 5 = 3, +10 cups
  s = ok(P.buildStand(s, 'central-park'));
  return s;
}

describe('purchases', () => {
  it('walks the tutorial path to a built stand with $3 left', () => {
    const s = tutorialStand();
    expect(s.cash).toBe(3);
    expect(s.inventoryValue).toBe(5);
    expect(s.equipmentValue).toBe(22); // kit 12 + pitcher 10
    expect(s.cupsInStock).toBe(10);
    expect(s.stallKits).toBe(0);
    expect(s.ownedStands).toBe(1);
    expect(s.plots['central-park']).toBe('built');
  });

  it('refuses purchases the player cannot afford, without changing state', () => {
    const broke = { ...createInitialState(), cash: 4.99 };
    expect(P.buyLemons(broke)).toEqual({ ok: false, reason: 'insufficient-cash' });
    expect(P.buyPitcher({ ...broke, cash: 9.99 })).toEqual({ ok: false, reason: 'insufficient-cash' });
    expect(P.buyStallKit({ ...broke, cash: 11.99 })).toEqual({ ok: false, reason: 'insufficient-cash' });
  });

  it('books a $3 loss when selling a pitcher for $7', () => {
    const s = ok(P.sellUsedPitcher(tutorialStand()));
    expect(s.cash).toBe(10);
    expect(s.equipmentValue).toBe(12);
    expect(s.pitchers).toBe(0);
    expect(s.dayCogs).toBe(3);
    expect(s.totalCogs).toBe(3);
    expect(P.sellUsedPitcher(s)).toEqual({ ok: false, reason: 'no-pitchers' });
  });

  it('books a $3.60 loss when divesting a stand for $8.40', () => {
    const s = ok(P.divestStand(tutorialStand(), 'central-park'));
    expect(s.cash).toBe(11.4);
    expect(s.equipmentValue).toBe(10);
    expect(s.ownedStands).toBe(0);
    expect(s.plots['central-park']).toBe('empty');
    expect(s.dayCogs).toBe(3.6);
  });

  it('enforces the plot lifecycle empty → leased → built', () => {
    const s = createInitialState();
    expect(P.signLease(s, 'market')).toEqual({ ok: false, reason: 'market-has-no-plots' });
    expect(P.buildStand(s, 'columbia')).toEqual({ ok: false, reason: 'plot-not-leased' });
    const leased = ok(P.signLease(s, 'columbia'));
    expect(P.signLease(leased, 'columbia')).toEqual({ ok: false, reason: 'plot-not-empty' });
    expect(P.buildStand(leased, 'columbia')).toEqual({ ok: false, reason: 'no-stall-kit' });
  });

  it('hiring is free and only increments headcount', () => {
    const s = P.hireManager(P.hireWorker(createInitialState()));
    expect(s.workers).toBe(1);
    expect(s.managers).toBe(1);
    expect(s.cash).toBe(30);
  });
});

describe('sales', () => {
  it('sells one $3 cup that cost $0.50', () => {
    const s = applySale(tutorialStand(), 0.9, 1);
    expect(s.cash).toBe(6);
    expect(s.cupsInStock).toBe(9);
    expect(s.inventoryValue).toBe(4.5);
    expect(s.dayRevenue).toBe(3);
    expect(s.dayCogs).toBe(0.5);
    expect(s.reviews).toEqual([{ id: 1, stars: 5, comment: 'Super quick & icy cold!' }]);
  });

  it('does nothing with an empty stock', () => {
    const s = { ...tutorialStand(), cupsInStock: 0 };
    expect(applySale(s, 1, 1)).toBe(s);
  });

  it('records a walkout as a 1-star review', () => {
    const s = applyWalkout(applySale(tutorialStand(), 0.9, 1), 2);
    expect(s.ratingAvg).toBe(3); // (5 + 1) / 2
  });

  it('labels the sale pop by combo size', () => {
    expect(salePopLabel(3, 1)).toBe('+$3!');
    expect(salePopLabel(3, 2)).toBe('+$3!! x2');
    expect(salePopLabel(3, 4)).toBe('+$3!!! 🔥 x4');
  });
});

describe('rent and day close', () => {
  it('charges rent on leased and built plots, plus $3 for an acquired seller stand', () => {
    const s = ok(P.signLease(tutorialStand(), 'broadway'));
    expect(getDailyPlotRent(s)).toBe(2 + 4); // Central Park $2 + Broadway $4
    expect(getDailyPlotRent({ ...s, dealStatus: 'won' })).toBe(9);
  });

  it('closes a day of 4 sales with one worker', () => {
    let s = P.hireWorker(tutorialStand());
    for (let i = 1; i <= 4; i++) s = applySale(s, 0.9, i);
    // revenue 12, cogs 2, rent 2 + wages 3 = 5 → NOPAT 5
    // invested = inventory 3 + equipment 22 = 25 → hurdle 1.25 → value created 3.75
    // ROIC = 5 / 25 = 20% → grade S
    const closed = closeDay(s)!;
    expect(closed.record).toEqual({
      day: 1,
      cupsSold: 4,
      revenue: 12,
      cogs: 2,
      rentAndWages: 5,
      nopat: 5,
      hurdleCharge: 1.25,
      valueCreated: 3.75,
      cumulativeValue: 3.75,
      roicPct: 20,
      grade: 'S',
    });
    expect(closed.state.cash).toBe(10); // 3 + 12 − 5; the hurdle is not paid in cash
    expect(closed.state.dayRevenue).toBe(0);
    expect(closed.state.totalRent).toBe(5);
    expect(closed.state.dayHistory).toHaveLength(1);
    expect(startNextDay(closed.state).day).toBe(2);
  });

  it('will not close a day after the career ends, nor advance past it', () => {
    const s = { ...createInitialState(), day: 31 };
    expect(closeDay(s)).toBeNull();
    expect(startNextDay({ ...createInitialState(), day: 30 }).day).toBe(30);
  });
});

describe('clock', () => {
  it('runs a day in 120 s at 1× and 60 s at 2×, capping each tick at 0.25 s', () => {
    expect(advanceClock(0, 0.08, 1)).toBeCloseTo(0.08 / 120);
    expect(advanceClock(0, 0.08, 2)).toBeCloseTo(0.08 / 60);
    expect(advanceClock(0, 5, 1)).toBeCloseTo(0.25 / 120);
    expect(advanceClock(0.999, 0.25, 2)).toBe(1);
  });

  it('pauses for overlays, before the first stand, and after the career', () => {
    const base = { overlayOpen: false, day: 2, maxDays: 30, ownedStands: 1 };
    expect(isClockPaused(base)).toBe(false);
    expect(isClockPaused({ ...base, overlayOpen: true })).toBe(true);
    expect(isClockPaused({ ...base, day: 1, ownedStands: 0 })).toBe(true);
    expect(isClockPaused({ ...base, day: 31 })).toBe(true);
  });

  it('formats 8 AM to 8 PM in 5-minute steps', () => {
    expect(formatClockTime(0)).toBe('8:00 AM');
    expect(formatClockTime(0.5)).toBe('2:00 PM');
    expect(formatClockTime(1)).toBe('8:00 PM');
  });
});

describe('sealed bid', () => {
  const cashRich = { ...createInitialState(), cash: 100 };

  it('accepts a bid at the hidden minimum and pays the bid price', () => {
    const r = resolveSealedBid(cashRich, CENTRAL_PARK_DEAL, 42);
    expect(r.kind).toBe('won');
    if (r.kind !== 'won') return;
    expect(r.state.cash).toBe(58);
    expect(r.state.equipmentValue).toBe(42);
    expect(r.state.ownedStands).toBe(1);
  });

  it('rejects a bid one cent under the minimum and closes the deal', () => {
    const r = resolveSealedBid(cashRich, CENTRAL_PARK_DEAL, 41.99);
    expect(r.kind).toBe('rejected');
    if (r.kind !== 'rejected') return;
    expect(r.state.cash).toBe(100);
    expect(resolveSealedBid(r.state, CENTRAL_PARK_DEAL, 50).kind).toBe('deal-closed');
  });

  it('refuses unaffordable and non-positive bids without closing the deal', () => {
    expect(resolveSealedBid(createInitialState(), CENTRAL_PARK_DEAL, 45)).toEqual({ kind: 'insufficient-cash', cash: 30 });
    expect(resolveSealedBid(cashRich, CENTRAL_PARK_DEAL, 0).kind).toBe('invalid');
    expect(resolveSealedBid(cashRich, CENTRAL_PARK_DEAL, NaN).kind).toBe('invalid');
  });

  it('never exposes the reservation price in the public view', () => {
    expect(toPublicView(CENTRAL_PARK_DEAL)).not.toHaveProperty('reservationPrice');
  });
});
