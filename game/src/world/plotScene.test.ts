import { describe, expect, it, vi } from 'vitest';

// CentralParkScene imports the sound engine (Web Audio); these tests never play sound.
vi.mock('../audio/soundEngine', () => ({ playStep: () => {} }));

import { NEIGHBORHOODS } from '../core/neighborhoods';
import { getPlot, plotsIn, SELLER_PLOT_ID, type PlotView } from '../core/plots';
import type { PlotStatus } from '../core/sliceModel';
import {
  FOOT_TRAFFIC_MAX,
  FOOT_TRAFFIC_MIN,
  PLOT_INTERACT_RADIUS,
  QUEUE_CAPACITY,
  isWithinQueueReach,
  pickNearbyCandidate,
  queueJoinCooldownSeconds,
  queueSlotsAt,
  streetCandidates,
} from './CentralParkScene';

/** A district's plots as the store would hand them to the scene, all with one status. */
const viewsOf = (district: (typeof NEIGHBORHOODS)[number]['id'], status: PlotStatus, staffed = false): PlotView[] =>
  plotsIn(district).map((p) => ({ ...p, status, staffed }));

describe('live queue follows the live plot', () => {
  it('puts the same line shape in front of whichever plot is live', () => {
    const corner = getPlot('fidi/corner');
    const side = getPlot('fidi/side');
    const atCorner = queueSlotsAt(corner);
    const atSide = queueSlotsAt(side);
    expect(atCorner).toHaveLength(QUEUE_CAPACITY);
    // The first customer stands right in front of the counter (toward the camera, +z).
    expect(atSide[0].x).toBeCloseTo(side.x);
    expect(atSide[0].z).toBeGreaterThan(side.z);
    // Moving the live plot moves every spot by exactly the plot offset (shape unchanged).
    atCorner.forEach((slot, i) => {
      expect(atSide[i].x - slot.x).toBeCloseTo(side.x - corner.x);
      expect(atSide[i].z - slot.z).toBeCloseTo(side.z - corner.z);
    });
  });

  it('only walkers level with the LIVE stand consider joining', () => {
    const side = getPlot('fidi/side');
    const corner = getPlot('fidi/corner');
    expect(isWithinQueueReach(side.x + 1, side.x)).toBe(true);
    // A walker passing the corner is not in reach of a live stand on the side plot.
    expect(isWithinQueueReach(corner.x, side.x)).toBe(false);
  });
});

describe('foot traffic scales how often customers arrive', () => {
  it('divides the tuned 2.6..4.8 s gap by the multiplier', () => {
    expect(queueJoinCooldownSeconds(0, 1)).toBeCloseTo(2.6);
    expect(queueJoinCooldownSeconds(1, 1)).toBeCloseTo(4.8);
    expect(queueJoinCooldownSeconds(0.5, 2)).toBeCloseTo(3.7 / 2);
  });

  it('clamps an out-of-range multiplier instead of stalling or flooding the line', () => {
    expect(queueJoinCooldownSeconds(0, 0)).toBeCloseTo(2.6 / FOOT_TRAFFIC_MIN);
    expect(queueJoinCooldownSeconds(0, 100)).toBeCloseTo(2.6 / FOOT_TRAFFIC_MAX);
  });
});

describe('nearest-plot targeting', () => {
  it('names the plot the player stands at, with the target its status calls for', () => {
    const plots = viewsOf('fidi', 'empty');
    plots[1] = { ...plots[1], status: 'built' }; // the side plot has a stand
    const side = plots[1];
    const atSide = pickNearbyCandidate(streetCandidates({ x: side.x, z: side.z + 1.2 }, 'fidi', plots, false));
    expect(atSide).toMatchObject({ target: 'own-stand', plotId: side.id });

    const corner = plots[0];
    const atCorner = pickNearbyCandidate(streetCandidates({ x: corner.x, z: corner.z + 1.2 }, 'fidi', plots, false));
    expect(atCorner).toMatchObject({ target: 'plot-lease', plotId: corner.id });
  });

  it('picks the closer plot when two are in reach', () => {
    const plots = viewsOf('broadway', 'leased');
    const side = getPlot('broadway/side');
    const plaza = getPlot('broadway/plaza');
    // A point between side and plaza, a little nearer the plaza, inside both radii.
    const x = (side.x + plaza.x) / 2 + 0.3;
    const z = side.z + 0.8;
    expect(Math.hypot(x - side.x, z - side.z)).toBeLessThan(PLOT_INTERACT_RADIUS);
    expect(Math.hypot(x - plaza.x, z - plaza.z)).toBeLessThan(PLOT_INTERACT_RADIUS);
    expect(pickNearbyCandidate(streetCandidates({ x, z }, 'broadway', plots, false))?.plotId).toBe(plaza.id);
  });

  it('offers no plot targets in the market, only its stalls', () => {
    const near = pickNearbyCandidate(streetCandidates({ x: -4.3, z: -0.2 }, 'market', [], true));
    expect(near?.target).toBe('market-stalls');
    expect(near?.plotId).toBeUndefined();
  });
});

describe('the seller stand', () => {
  const seller = getPlot(SELLER_PLOT_ID);
  const standingAtSeller = { x: seller.x, z: seller.z + 1.2 };

  it('is a target in Central Park while the seller is present, never as a plot to lease', () => {
    const near = pickNearbyCandidate(
      streetCandidates(standingAtSeller, 'central-park', viewsOf('central-park', 'empty'), true)
    );
    expect(near).toMatchObject({ target: 'seller-stand' });
    expect(near?.plotId).toBeUndefined();
  });

  it('is never a target outside Central Park, even while the seller is present', () => {
    for (const n of NEIGHBORHOODS.filter((d) => d.id !== 'central-park')) {
      const targets = streetCandidates(standingAtSeller, n.id, viewsOf(n.id, 'empty'), true).map((c) => c.target);
      expect(targets, n.id).not.toContain('seller-stand');
    }
  });

  it("becomes the player's own stand once the deal is won", () => {
    const plots = viewsOf('central-park', 'empty').map((p) =>
      p.id === SELLER_PLOT_ID ? { ...p, status: 'built' as const } : p
    );
    const near = pickNearbyCandidate(streetCandidates(standingAtSeller, 'central-park', plots, false));
    expect(near).toMatchObject({ target: 'own-stand', plotId: SELLER_PLOT_ID });
  });
});
