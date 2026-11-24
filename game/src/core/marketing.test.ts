import { describe, expect, it } from 'vitest';
import { awayCupsPerDay } from './awaySales';
import { DAY_SECONDS } from './clock';
import { closeDay, projectDay } from './dayEnd';
import {
  awarenessAfterCampaign,
  awarenessWalkerFactor,
  buyCampaign,
  campaignCost,
  districtWalkers,
  fadedAwareness,
} from './marketing';
import { createRunStreams } from './rng';
import { createInitialState, getWorth, type SliceState } from './sliceModel';
import { crowdAt, LONE_PLOT, walkerGapSeconds, walkersPerDay } from './standSales';
import { TUNING } from './tuning';

const CP = 'central-park/corner';
const BROADWAY = 'broadway/corner';

/** A player with cash, owning a built, staffed stand on `plot`. */
const owner = (plot = BROADWAY, cash = 100): SliceState => {
  const s = createInitialState();
  return { ...s, cash, openingWorth: cash, plots: { ...s.plots, [plot]: 'built' }, staffedPlots: [plot] };
};

describe('marketing: the numbers the design promises', () => {
  it('ships with a 25% nightly fade, half-the-gap campaigns, +40% at full, $0.20 a walker', () => {
    expect(TUNING.awarenessFadePerDay).toBe(0.25);
    expect(TUNING.campaignGapShare).toBe(0.5);
    expect(TUNING.awarenessWalkerLift).toBe(0.4);
    expect(TUNING.campaignCostPerWalker).toBe(0.2);
  });

  it('a campaign costs $0.20 x every walker in the district; the market has nothing to reach', () => {
    expect(campaignCost('broadway')).toBeCloseTo(districtWalkers('broadway') * 0.2, 2);
    expect(campaignCost('central-park')).toBeCloseTo(districtWalkers('central-park') * 0.2, 2);
    expect(campaignCost('market')).toBeNull();
  });

  it('closes half the gap to full: 0 -> 0.5 -> 0.75, so the second campaign adds less', () => {
    expect(awarenessAfterCampaign(0)).toBe(0.5);
    expect(awarenessAfterCampaign(0.5)).toBe(0.75);
  });

  it('loses a quarter at every closing bell: half gone in about 2.4 days', () => {
    expect(fadedAwareness(0.5)).toBe(0.375);
    let a = 1;
    for (let d = 0; d < 3; d++) a = fadedAwareness(a);
    expect(a).toBeCloseTo(0.42, 2); // 0.75^3: after 3 nights less than half is left
  });

  it('lifts walkers by up to 40%, at every kind of stand alike', () => {
    expect(awarenessWalkerFactor(0)).toBe(1);
    expect(awarenessWalkerFactor(1)).toBe(1.4);
    const base = walkersPerDay(CP, LONE_PLOT);
    expect(walkersPerDay(CP, { standsInDistrict: 1, awareness: 0.5 })).toBeCloseTo(base * 1.2);
    // A staffed stand away from the player reads the same crowd (CP side street at $4: under the 20-cup worker cap).
    const side = 'central-park/side';
    expect(awayCupsPerDay(side, 4, { standsInDistrict: 1, awareness: 0.5 })).toBeCloseTo(
      awayCupsPerDay(side, 4, LONE_PLOT) * 1.2
    );
  });
});

describe('buying a campaign', () => {
  it('takes the price from cash, raises awareness, and books it as today\'s marketing', () => {
    const s = owner();
    const cost = campaignCost('broadway')!;
    const after = buyCampaign(s, 'broadway')!;
    expect(after.cash).toBeCloseTo(s.cash - cost, 2);
    expect(after.awareness.broadway).toBe(0.5);
    expect(after.dayMarketing).toBeCloseTo(cost, 2);
    expect(after.totalMarketing).toBeCloseTo(cost, 2);
    // Only the advertised district changes.
    expect(after.awareness['central-park']).toBe(0);
  });

  it('is refused, with nothing changed, when cash is short or there is nothing to reach', () => {
    expect(buyCampaign(owner(BROADWAY, 1), 'broadway')).toBeNull();
    expect(buyCampaign(owner(), 'market')).toBeNull();
  });

  it('the crowd at an owned plot reads its district awareness', () => {
    const after = buyCampaign(owner(), 'broadway')!;
    expect(crowdAt(after, BROADWAY)).toEqual({ standsInDistrict: 1, awareness: 0.5 });
  });
});

describe('marketing in the books (an expense of the day, not part of worth)', () => {
  it('worth drops by exactly the price; the receipt, the line and NOPAT carry it', () => {
    const s = { ...owner(), dayRevenue: 40, dayCogs: 8 };
    const cost = campaignCost('broadway')!;
    const after = buyCampaign(s, 'broadway')!;
    expect(getWorth(after)).toBeCloseTo(getWorth(s) - cost, 2);

    const before = projectDay(s);
    const today = projectDay(after);
    expect(today.marketing).toBeCloseTo(cost, 2);
    expect(today.nopat).toBeCloseTo(before.nopat - cost, 2);
    expect(today.line).toBeCloseTo(before.line + cost, 2);
    expect(today.valueCreated).toBeCloseTo(before.valueCreated - cost, 2);

    // The closing bell books the same numbers, does not charge the cash a second time,
    // starts tomorrow with no marketing, and fades the awareness.
    const closed = closeDay(after)!;
    expect(closed.record.marketing).toBeCloseTo(cost, 2);
    expect(closed.record.nopat).toBe(today.nopat);
    expect(closed.record.valueCreated).toBe(today.valueCreated);
    expect(closed.state.cash).toBeCloseTo(after.cash - today.rentAndWages, 2);
    expect(closed.state.dayMarketing).toBe(0);
    expect(closed.state.awareness.broadway).toBe(0.375);
    expect(closed.state.totalMarketing).toBeCloseTo(cost, 2);
  });
});

describe('the decision timer alone (walkers are checked in liveCrowd.test.ts)', () => {
  /** Count the decisions the scene's spawner would make in one whole day. */
  const decisionsInADay = (walkers: number, speed: 1 | 2, seed: number): number => {
    const rand = createRunStreams(seed).gameplay;
    let t = 0;
    let n = 0;
    for (;;) {
      t += walkerGapSeconds(walkers, speed, rand());
      if (t > DAY_SECONDS[speed]) return n;
      n += 1;
    }
  };

  for (const speed of [1, 2] as const) {
    it(`matches walkersPerDay within 5% at ${speed}x (averaged over 50 days)`, () => {
      const crowd = { standsInDistrict: 2, awareness: 0.5 };
      const walkers = walkersPerDay(CP, crowd);
      const days = Array.from({ length: 50 }, (_, i) => decisionsInADay(walkers, speed, i + 1));
      const mean = days.reduce((a, b) => a + b, 0) / days.length;
      expect(Math.abs(mean - walkers) / walkers).toBeLessThan(0.05);
    });
  }
});

describe('awareness out of range is a bug, not something to clamp', () => {
  it('throws instead of quietly forcing the value into 0..1', () => {
    expect(() => awarenessAfterCampaign(1.2)).toThrow(/out of range/);
    expect(() => fadedAwareness(-0.1)).toThrow(/out of range/);
    expect(() => awarenessWalkerFactor(Number.NaN)).toThrow(/out of range/);
  });
});
