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
import {
  countOwnedStands,
  createInitialState,
  getDailyHurdleCharge,
  getDailyWages,
  getWorth,
  grandmaWorth,
  SliceState,
} from './sliceModel';
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
  s = ok(P.buyLemons(s)); // 8 − 5 = 3, +5 cups ($1 a cup)
  s = ok(P.buildStand(s, CP));
  return s;
}

describe('purchases', () => {
  it('walks the tutorial path to a built stand with $3 left', () => {
    const s = tutorialStand();
    expect(s.cash).toBe(3);
    expect(s.inventoryValue).toBe(5);
    expect(s.equipmentValue).toBe(22); // kit 12 + pitcher 10
    expect(s.cupsInStock).toBe(5);
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

  it('one worker per built stand, $10/day each from the bell; letting go stops the wage', () => {
    const s = tutorialStand();
    expect(P.hireWorker(createInitialState(), CP)).toEqual({ ok: false, reason: 'no-built-stand' });
    const staffed = ok(P.hireWorker(s, CP));
    expect(staffed.cash).toBe(s.cash); // hiring itself is free
    expect(getDailyWages(staffed)).toBe(10);
    expect(P.hireWorker(staffed, CP)).toEqual({ ok: false, reason: 'already-staffed' });
    expect(getDailyWages(ok(P.letWorkerGo(staffed, CP)))).toBe(0);
    expect(P.letWorkerGo(s, CP)).toEqual({ ok: false, reason: 'not-staffed' });
  });

  it('a manager is still a headcount, with a $20 wage', () => {
    const s = P.hireManager(createInitialState());
    expect(s.managers).toBe(1);
    expect(s.cash).toBe(30);
    expect(getDailyWages(s)).toBe(20);
  });
});

describe('sales', () => {
  it('sells one $3 cup that cost $1', () => {
    const s = applySale(tutorialStand(), 0.9, 1);
    expect(s.cash).toBe(6);
    expect(s.cupsInStock).toBe(4);
    expect(s.inventoryValue).toBe(4);
    expect(s.dayRevenue).toBe(3);
    expect(s.dayCogs).toBe(1);
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
  it('charges each leased or built plot its own rent (side 70% of the corner, plaza 140%)', () => {
    // Cash-rich so the three Broadway permits ($60 each) can be paid.
    let s = ok(P.signLease({ ...tutorialStand(), cash: 500 }, 'broadway/corner'));
    expect(getDailyPlotRent(s)).toBe(4 + 18); // Central Park corner $4 + Broadway corner $18
    s = ok(P.signLease(s, 'broadway/side'));
    s = ok(P.signLease(s, 'broadway/plaza'));
    expect(getDailyPlotRent(s)).toBe(4 + 18 + 13 + 25); // side 18 x 0.7 = 12.6 -> 13; plaza 18 x 1.4 = 25.2 -> 25
  });

  it('signing a lease pays the district permit: free in Central Park, $60 on Broadway', () => {
    expect(P.leaseFee('central-park/corner')).toBe(0);
    expect(P.leaseFee('broadway/side')).toBe(60);
    expect(P.leaseFee('fifth-ave/plaza')).toBe(150);
    // $30 cannot pay a $60 permit: refused, nothing changes.
    expect(P.signLease(createInitialState(), 'broadway/corner')).toEqual({ ok: false, reason: 'insufficient-cash' });
    const before = { ...createInitialState(), cash: 100 };
    const s = ok(P.signLease(before, 'broadway/corner'));
    expect(s.cash).toBe(40);
    expect(s.equipmentValue).toBe(60); // on the books it is something the business owns...
    expect(getWorth(s)).toBe(40); // ...but it cannot be resold, so the player is $60 poorer at once
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
    // revenue 12, cogs 4, rent 4 + wages 10 = 14 → NOPAT −6: four cups cannot carry a $10 worker
    // the line's base = $30, the money the day opened with → hurdle 15% x 30 = 4.50
    // value created = −6 − 4.50 = −10.50; return = −6 / 30 = −20% → grade D
    const closed = closeDay(s)!;
    expect(closed.record).toEqual({
      day: 1,
      cupsSold: 4,
      revenue: 12,
      cogs: 4,
      rentAndWages: 14,
      nopat: -6,
      hurdleCharge: 4.5,
      chargedOn: 30,
      valueCreated: -10.5,
      cumulativeValue: -10.5,
      roicPct: -20,
      grade: 'D',
    });
    expect(closed.state.cash).toBe(1); // 3 + 12 − 14; the hurdle is not paid in cash
    expect(closed.state.dayRevenue).toBe(0);
    expect(closed.state.totalRent).toBe(14);
    expect(closed.state.dayHistory).toHaveLength(1);
    // YOU at the bell: cash 1 + 1 cup of lemons $1 + kit $8.40 + pitcher $7 (resale values).
    expect(closed.state.worthHistory).toEqual([17.4]);
    // The next opening bell writes that worth down as tomorrow's line base.
    const next = startNextDay(closed.state);
    expect(next.day).toBe(2);
    expect(next.openingWorth).toBe(17.4);
    expect(getDailyHurdleCharge(next)).toBe(2.61); // 15% x 17.40
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
    const base = { overlayOpen: false, day: 2, maxDays: 30 };
    expect(isClockPaused(base)).toBe(false);
    expect(isClockPaused({ ...base, overlayOpen: true })).toBe(true);
    // Day 1 runs from the moment the story ends, stand or no stand.
    expect(isClockPaused({ ...base, day: 1 })).toBe(false);
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
    expect(p.rentAndWages).toBe(4); // Central Park corner rent
    expect(p.hurdleCharge).toBe(4.5); // 15% of the $30 the day opened with
    expect(p.line).toBe(8.5);
    expect(p.valueCreated).toBe(-1);
    expect(closeDay(s)?.record.valueCreated).toBe(p.valueCreated);
  });

  it('the line is frozen at the opening bell: nothing done during the day moves the 15% part', () => {
    const s = createInitialState();
    expect(getDailyHurdleCharge(s)).toBe(4.5); // 15% of the $30 the run opens with (idle cash is charged)
    expect(getDailyHurdleCharge(ok(P.buyPitcher(s)))).toBe(4.5); // spending does not move it
    expect(getDailyHurdleCharge(applySale(tutorialStand(), 1, 1))).toBe(4.5); // nor does a sale
  });

  it('beatTheLine: zero counts as beating it, a cent short does not', () => {
    expect(beatTheLine({ valueCreated: 0 })).toBe(true);
    expect(beatTheLine({ valueCreated: -0.01 })).toBe(false);
  });
});

describe('the race: You vs Grandma', () => {
  it("Grandma's bank turns the $30 loan into $34.50 after a day and $1,986.35 after thirty", () => {
    expect(grandmaWorth(0)).toBe(30);
    expect(grandmaWorth(1)).toBe(34.5);
    expect(grandmaWorth(10)).toBe(121.37);
    expect(grandmaWorth(30)).toBe(1986.35);
  });

  it('YOU counts cash, lemons at cost and gear at what it would sell for', () => {
    expect(getWorth(createInitialState())).toBe(30);
    // Tutorial stand: cash 3 + lemons 5 + kit 8.40 + pitcher 7 = 23.40 (it cost 27).
    expect(getWorth(tutorialStand())).toBe(23.4);
  });

  it('the price paid for a stand now matters: a higher bid leaves the player poorer', () => {
    const rich = { ...createInitialState(), cash: 100 };
    const atMinimum = resolveSealedBid(rich, CENTRAL_PARK_DEAL, 42);
    const atAsking = resolveSealedBid(rich, CENTRAL_PARK_DEAL, 60);
    if (atMinimum.kind !== 'won' || atAsking.kind !== 'won') throw new Error('both bids should win');
    // Either way the stand is worth one kit ($8.40) if sold; the rest of the price is gone.
    expect(getWorth(atMinimum.state)).toBe(66.4); // 100 − 42 + 8.40
    expect(getWorth(atAsking.state)).toBe(48.4); // 100 − 60 + 8.40: $18 worse for the same stand
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
