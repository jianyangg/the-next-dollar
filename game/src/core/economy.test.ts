import { describe, expect, it } from 'vitest';
import {
  advanceClock,
  CLOSING_TIME_SHORT,
  formatClockTime,
  isClockPaused,
  SUNRISE_PROGRESS,
  SUNSET_PROGRESS,
  sunArcPosition,
} from './clock';
import { beatTheLine, closeDay, projectDay, startNextDay } from './dayEnd';
import { CENTRAL_PARK_DEAL, resolveSealedBid, toPublicView } from './deal';
import * as P from './purchases';
import { getDailyPlotRent } from './rent';
import { applySale, applyWalkout, salePopLabel } from './sales';
import { countOwnedStands, createInitialState, getDailyHurdleCharge, getDailyWages, SliceState } from './sliceModel';
import { SELLER_PLOT_ID } from './plots';

/**
 * Characterization tests: they pin the exact numbers the original App.tsx handlers
 * produced, so moving the rules into src/core cannot silently change the economy.
 * Each expected value is worked out by hand in the comment beside it.
 */
const ok = (r: P.PurchaseResult): SliceState => {
  if (!r.ok) throw new Error(`expected success, got ${r.reason}`);
  return r.state;
};

/** The tutorial path: lease the Central Park corner, buy kit + pitcher + lemons, build. */
const CP = 'central-park/corner';
function tutorialStand(): SliceState {
  let s = createInitialState(); // $30 cash
  s = ok(P.signLease(s, CP));
  s = ok(P.buyStallKit(s)); // 30 − 12 = 18
  s = ok(P.buyPitcher(s)); // 18 − 10 = 8
  s = ok(P.buyLemons(s)); // 8 − 5 = 3, +10 cups
  s = ok(P.buildStand(s, CP));
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
    expect(countOwnedStands(s)).toBe(1);
    expect(s.plots[CP]).toBe('built');
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
    const staffed = ok(P.hireWorker(tutorialStand(), CP));
    const s = ok(P.divestStand(staffed, CP));
    expect(s.cash).toBe(11.4);
    expect(s.equipmentValue).toBe(10);
    expect(countOwnedStands(s)).toBe(0);
    expect(s.plots[CP]).toBe('empty');
    expect(s.staffedPlots).toEqual([]); // the stand's worker goes with it
    expect(s.dayCogs).toBe(3.6);
  });

  it('enforces the plot lifecycle empty → leased → built', () => {
    const s = createInitialState();
    expect(P.signLease(s, SELLER_PLOT_ID)).toEqual({ ok: false, reason: 'plot-not-leasable' });
    expect(P.buildStand(s, 'columbia/side')).toEqual({ ok: false, reason: 'plot-not-leased' });
    const leased = ok(P.signLease(s, 'columbia/side'));
    expect(P.signLease(leased, 'columbia/side')).toEqual({ ok: false, reason: 'plot-not-empty' });
    expect(P.buildStand(leased, 'columbia/side')).toEqual({ ok: false, reason: 'no-stall-kit' });
    // Plots in one district are independent: the corner is still free.
    expect(leased.plots['columbia/corner']).toBe('empty');
  });

  it('one worker per built stand, $3/day each from the bell; letting go stops the wage', () => {
    const s = tutorialStand();
    expect(P.hireWorker(createInitialState(), CP)).toEqual({ ok: false, reason: 'no-built-stand' });
    const staffed = ok(P.hireWorker(s, CP));
    expect(staffed.cash).toBe(s.cash); // hiring itself is free
    expect(getDailyWages(staffed)).toBe(3);
    expect(P.hireWorker(staffed, CP)).toEqual({ ok: false, reason: 'already-staffed' });
    expect(getDailyWages(ok(P.letWorkerGo(staffed, CP)))).toBe(0);
    expect(P.letWorkerGo(s, CP)).toEqual({ ok: false, reason: 'not-staffed' });
  });

  it('a manager is still a headcount with a $5 wage', () => {
    const s = P.hireManager(createInitialState());
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
    // Plain text since the Paper Trail UI: excitement is shown by size and colour.
    expect(salePopLabel(3, 1)).toBe('+$3');
    expect(salePopLabel(3, 2)).toBe('+$3 x2');
    expect(salePopLabel(3, 4)).toBe('+$3 x4');
  });
});

describe('rent and day close', () => {
  it('charges each leased or built plot its own rent (side $1 less, plaza $2 more)', () => {
    let s = ok(P.signLease(tutorialStand(), 'broadway/corner'));
    expect(getDailyPlotRent(s)).toBe(2 + 4); // Central Park corner $2 + Broadway corner $4
    s = ok(P.signLease(s, 'broadway/side'));
    s = ok(P.signLease(s, 'broadway/plaza'));
    expect(getDailyPlotRent(s)).toBe(2 + 4 + 3 + 6);
  });

  it("the bought seller stand's rent steps from $3 to $5 four days after the purchase", () => {
    const won = { ...createInitialState(), day: 3, plots: { ...createInitialState().plots, [SELLER_PLOT_ID]: 'built' as const }, sellerStandSince: 3 };
    expect(getDailyPlotRent(won)).toBe(3);
    expect(getDailyPlotRent({ ...won, day: 6 })).toBe(3);
    expect(getDailyPlotRent({ ...won, day: 7 })).toBe(5);
  });

  it('closes a day of 4 sales with one worker', () => {
    let s = ok(P.hireWorker(tutorialStand(), CP));
    for (let i = 1; i <= 4; i++) s = applySale(s, 0.9, i);
    // revenue 12, cogs 2, rent 2 + wages 3 = 5 → NOPAT 5
    // money in business = cash 15 + inventory 3 + equipment 22 = 40 → hurdle 2.00
    // value created = 5 − 2 = 3.00; return = 5 / 40 = 12.5% → grade A
    const closed = closeDay(s)!;
    expect(closed.record).toEqual({
      day: 1,
      cupsSold: 4,
      revenue: 12,
      cogs: 2,
      rentAndWages: 5,
      nopat: 5,
      hurdleCharge: 2,
      chargedOn: 40,
      valueCreated: 3,
      cumulativeValue: 3,
      roicPct: 12.5,
      grade: 'A',
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

  it('formats 5 AM to 9 PM in 5-minute steps', () => {
    expect(formatClockTime(0)).toBe('5:00 AM');
    expect(formatClockTime(0.5)).toBe('1:00 PM');
    expect(formatClockTime(1)).toBe('9:00 PM');
    expect(CLOSING_TIME_SHORT).toBe('9 PM');
  });

  it('the sun arc matches the sky: below the horizon before sunrise and after sunset, highest mid-day', () => {
    expect(sunArcPosition(0).up).toBe(false);
    expect(sunArcPosition(0).height).toBeLessThan(0);
    expect(sunArcPosition(SUNRISE_PROGRESS).height).toBeCloseTo(0);
    const noon = (SUNRISE_PROGRESS + SUNSET_PROGRESS) / 2;
    expect(sunArcPosition(noon).height).toBeCloseTo(1);
    expect(sunArcPosition(SUNSET_PROGRESS).height).toBeCloseTo(0);
    expect(sunArcPosition(1).up).toBe(false);
    // The sun's sideways position is the clock itself.
    expect(sunArcPosition(0.25).x).toBe(0.25);
  });
});

describe('today vs the line (projectDay)', () => {
  it('is the same arithmetic the closing bell books', () => {
    let s = { ...createInitialState(), cupsInStock: 10, inventoryValue: 5, equipmentValue: 22 };
    s = { ...s, plots: { ...s.plots, [CP]: 'built' as const } };
    s = { ...s, dayRevenue: 9, dayCogs: 1.5 };
    const p = projectDay(s);
    expect(p.earned).toBe(7.5);
    expect(p.rentAndWages).toBe(2); // Central Park corner rent
    expect(p.hurdleCharge).toBe(2.85); // 5% of $57 (cash 30 + stock 5 + gear 22)
    expect(p.line).toBe(4.85);
    expect(p.valueCreated).toBe(2.65);
    expect(closeDay(s)?.record.valueCreated).toBe(p.valueCreated);
  });

  it('idle cash is charged: buying gear with cash leaves the line unchanged', () => {
    const s = createInitialState();
    expect(getDailyHurdleCharge(s)).toBe(1.5); // 5% of $30 cash, before any purchase
    expect(getDailyHurdleCharge(ok(P.buyPitcher(s)))).toBe(1.5); // $10 moved cash -> gear
  });

  it('beatTheLine: zero counts as beating it, a cent short does not', () => {
    expect(beatTheLine({ valueCreated: 0 })).toBe(true);
    expect(beatTheLine({ valueCreated: -0.01 })).toBe(false);
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
    expect(countOwnedStands(r.state)).toBe(1);
    // The stand is the player's but comes without staff (the seller ran it unpaid),
    // and its rent clock starts today.
    expect(r.state.plots[SELLER_PLOT_ID]).toBe('built');
    expect(r.state.staffedPlots).toEqual([]);
    expect(r.state.sellerStandSince).toBe(1);
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
