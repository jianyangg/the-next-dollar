import { cents } from './money';
import { NEIGHBORHOODS, type NeighborhoodId } from './neighborhoods';
import { plotsIn } from './plots';
import type { SliceState } from './sliceModel';
import { type Tuning, TUNING } from './tuning';

/**
 * MARKETING: "Awareness", a per-district stock that a campaign fills and time drains.
 *
 * THE IDEA (owner request, 2026-11-24): a marketing lever whose effect fades, so a
 * district that is not advertised for a while forgets the brand.
 *
 *   awareness  0..1 per district (shown as 0..100). Everyone starts at 0.
 *   campaign   awareness += campaignGapShare x (1 - awareness)
 *              It closes a share of the GAP to 100, so the second campaign of a day adds
 *              less than the first: diminishing returns are visible on screen.
 *   fade       at every closing bell, awareness x= (1 - awarenessFadePerDay).
 *              At 25% a day half a campaign is gone in about 2.4 days and 90% in 8,
 *              so in a 30-day run the player sees it rise and fade several times and
 *              has to decide again each time. (10% would feel permanent, which is R&D's
 *              job; 50% would be a daily fee with no feeling of building something.)
 *   effect     walkers at every plot in the district x (1 + awarenessWalkerLift x
 *              awareness): up to +40% more passers-by at full awareness. Read by the
 *              one sales formula (core/standSales.ts `walkersPerDay`), so the live
 *              stand, staffed stands and the balance simulation all feel it alike.
 *   price      campaignCostPerWalker x every walker in the district (corner + side +
 *              plaza or seller). A campaign covers the whole district, so advertising
 *              for a single stand in a big district wastes most of its reach.
 *
 * ACCOUNTING: a campaign is an EXPENSE of the day it is bought (core/dayEnd.ts
 * `projectDay` puts it on the receipt and in the line). It adds nothing to the player's
 * worth (`getWorth`): awareness cannot be sold, so its walk-away value is $0. Real
 * accounts treat advertising the same way, which is the lesson: the balance sheet
 * undercounts a business that has built a brand.
 *
 * Pure functions only: no clock, no randomness.
 */

export type Awareness = Readonly<Record<NeighborhoodId, number>>;

/** Every district at 0: nobody has heard of the stand yet. */
export function noAwareness(): Record<NeighborhoodId, number> {
  return Object.fromEntries(NEIGHBORHOODS.map((n) => [n.id, 0])) as Record<NeighborhoodId, number>;
}

/** All passers-by across the district's plots in a day, before any awareness lift. */
export function districtWalkers(district: NeighborhoodId): number {
  return plotsIn(district).reduce((sum, p) => sum + p.walkersPerDay, 0);
}

/**
 * Price of one campaign in `district`, or null where there is nothing to advertise to
 * (the Supply Market has no stand plots, so it has no walkers to reach).
 */
export function campaignCost(district: NeighborhoodId, t: Tuning = TUNING): number | null {
  const walkers = districtWalkers(district) * t.walkerScale;
  return walkers > 0 ? cents(walkers * t.campaignCostPerWalker) : null;
}

/**
 * Awareness is 0..1 by construction (campaigns close a share of the gap to 1, fades
 * multiply by less than 1). A value outside that range means a bug upstream, so it
 * throws instead of being quietly clamped into range.
 */
function checkAwareness(a: number): number {
  if (!(a >= 0 && a <= 1)) throw new Error(`awareness out of range: ${a}`);
  return a;
}

/** Awareness right after one more campaign. */
export function awarenessAfterCampaign(awareness: number, t: Tuning = TUNING): number {
  const a = checkAwareness(awareness);
  return a + t.campaignGapShare * (1 - a);
}

/** Awareness after one closing bell's fade. */
export function fadedAwareness(awareness: number, t: Tuning = TUNING): number {
  return checkAwareness(awareness) * (1 - t.awarenessFadePerDay);
}

/** Every district's awareness after one closing bell. */
export function fadeAllAwareness(awareness: Awareness, t: Tuning = TUNING): Record<NeighborhoodId, number> {
  return Object.fromEntries(
    Object.entries(awareness).map(([id, a]) => [id, fadedAwareness(a, t)])
  ) as Record<NeighborhoodId, number>;
}

/** The walker multiplier awareness gives: 1 at 0 awareness, 1 + lift at full. */
export function awarenessWalkerFactor(awareness: number, t: Tuning = TUNING): number {
  return 1 + t.awarenessWalkerLift * checkAwareness(awareness);
}

/**
 * Buy one campaign in `district`. Returns null (nothing changes) when the district has
 * nothing to advertise to or the player cannot pay. The money leaves cash now and is
 * recorded as today's marketing expense.
 */
export function buyCampaign(s: SliceState, district: NeighborhoodId, t: Tuning = TUNING): SliceState | null {
  const cost = campaignCost(district, t);
  if (cost === null || s.cash + 1e-9 < cost) return null;
  return {
    ...s,
    cash: cents(s.cash - cost),
    awareness: { ...s.awareness, [district]: awarenessAfterCampaign(s.awareness[district], t) },
    dayMarketing: cents(s.dayMarketing + cost),
    totalMarketing: cents(s.totalMarketing + cost),
  };
}
