import { describe, expect, it, vi } from 'vitest';

// CentralParkScene imports the sound engine (Web Audio); these tests never play sound.
vi.mock('../audio/soundEngine', () => ({ playStep: () => {} }));

import { NEIGHBORHOODS } from '../core/neighborhoods';
import { getPlot, plotsIn, SELLER_PLOT_ID, type PlotView } from '../core/plots';
import type { PlotStatus } from '../core/sliceModel';
import {
  CROSS_STREET_Z_MAX,
  CROSS_STREET_Z_MIN,
  WALKER_LANES,
  isOnRoad,
  ownStandBox,
  sidewalkOf,
  standFacing,
} from './collision';
import {
  customerLookDirection,
  PLOT_INTERACT_RADIUS,
  QUEUE_CAPACITY,
  isWithinQueueReach,
  pickNearbyCandidate,
  queueSlotsAt,
  streetCandidates,
  vendorLookDirection,
} from './CentralParkScene';

/** A district's plots as the store would hand them to the scene, all with one status. */
const viewsOf = (district: (typeof NEIGHBORHOODS)[number]['id'], status: PlotStatus, staffed = false): PlotView[] =>
  plotsIn(district).map((p) => ({ ...p, status, staffed }));

describe('live queue follows the live plot', () => {
  const corner = getPlot('fidi/corner'); // far sidewalk
  const side = getPlot('fidi/side'); // near sidewalk
  const plaza = getPlot('fidi/plaza'); // near sidewalk

  it('puts plots on both sidewalks: the corner far, side and plaza near', () => {
    expect(sidewalkOf(corner.z)).toBe('far');
    expect(sidewalkOf(side.z)).toBe('near');
    expect(sidewalkOf(plaza.z)).toBe('near');
    expect(standFacing(corner)).toBe(1);
    expect(standFacing(side)).toBe(-1);
  });

  it('lines customers up in front of a far stand: toward the camera (+z), trailing right', () => {
    const slots = queueSlotsAt(corner);
    expect(slots).toHaveLength(QUEUE_CAPACITY);
    expect(slots[0].x).toBeCloseTo(corner.x);
    for (const slot of slots) expect(slot.z).toBeGreaterThan(corner.z);
    for (let i = 1; i < slots.length; i++) expect(slots[i].x).toBeGreaterThan(slots[i - 1].x);
  });

  it('mirrors the line for a near stand: toward the street (-z), trailing left, same shape', () => {
    const far = queueSlotsAt(corner);
    const near = queueSlotsAt(side);
    expect(near[0].x).toBeCloseTo(side.x);
    for (const slot of near) expect(slot.z).toBeLessThan(side.z);
    // Half-circle turn: every offset from the stand is exactly negated.
    far.forEach((slot, i) => {
      expect(near[i].x - side.x).toBeCloseTo(-(slot.x - corner.x));
      expect(near[i].z - side.z).toBeCloseTo(-(slot.z - corner.z));
    });
  });

  it('keeps every near-side queue spot on the sidewalk, off the road, behind the walker lane and clear of the stand', () => {
    for (const plot of [side, plaza]) {
      const box = ownStandBox(plot);
      for (const slot of queueSlotsAt(plot)) {
        expect(sidewalkOf(slot.z)).toBe('near');
        expect(isOnRoad(slot), `${plot.id} slot on a road`).toBe(false);
        expect(slot.z).toBeGreaterThan(WALKER_LANES.near.maxZ);
        expect(slot.z).toBeLessThan(box.minZ);
      }
    }
  });

  it('puts the vendor behind the counter looking at the customers, mirrored for near stands', () => {
    expect(vendorLookDirection(standFacing(corner))).toBe('down');
    expect(customerLookDirection(standFacing(corner))).toBe('up');
    expect(vendorLookDirection(standFacing(side))).toBe('up');
    expect(customerLookDirection(standFacing(side))).toBe('down');
  });

  it('only walkers level with the LIVE stand, on its own sidewalk, consider joining', () => {
    const farLane = WALKER_LANES.far.minZ;
    const nearLane = WALKER_LANES.near.minZ;
    expect(isWithinQueueReach({ x: corner.x + 1, laneZ: farLane }, corner)).toBe(true);
    expect(isWithinQueueReach({ x: side.x + 1, laneZ: nearLane }, side)).toBe(true);
    // Level with the stand but on the other sidewalk: never crosses the street to queue.
    expect(isWithinQueueReach({ x: side.x, laneZ: farLane }, side)).toBe(false);
    expect(isWithinQueueReach({ x: corner.x, laneZ: nearLane }, corner)).toBe(false);
    // Same sidewalk but too far along it.
    expect(isWithinQueueReach({ x: plaza.x, laneZ: nearLane }, side)).toBe(false);
  });

  it('has a walker lane on each sidewalk, outside the cross street', () => {
    expect(WALKER_LANES.far.maxZ).toBeLessThan(CROSS_STREET_Z_MIN);
    expect(WALKER_LANES.near.minZ).toBeGreaterThan(CROSS_STREET_Z_MAX);
    expect(sidewalkOf(WALKER_LANES.near.minZ)).toBe('near');
    expect(sidewalkOf(WALKER_LANES.far.maxZ)).toBe('far');
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
    // No two plots of today's layout are within reach of one point (they sit on opposite
    // sidewalks or far apart), so this checks the tie-break rule itself.
    const near = pickNearbyCandidate([
      { target: 'plot-lease', dist: 2.0, radius: PLOT_INTERACT_RADIUS, plotId: 'x/side' },
      { target: 'own-stand', dist: 1.1, radius: PLOT_INTERACT_RADIUS, plotId: 'x/plaza' },
    ]);
    expect(near?.plotId).toBe('x/plaza');
  });

  it('never has one point in reach of two plots in the real layout', () => {
    for (const n of NEIGHBORHOODS) {
      const plots = plotsIn(n.id);
      for (let i = 0; i < plots.length; i++) {
        for (let j = i + 1; j < plots.length; j++) {
          const gap = Math.hypot(plots[i].x - plots[j].x, plots[i].z - plots[j].z);
          expect(gap, `${plots[i].id} vs ${plots[j].id}`).toBeGreaterThan(2 * PLOT_INTERACT_RADIUS);
        }
      }
    }
  });

  it('targets a near-side plot from the walker lane in front of it', () => {
    const plots = viewsOf('fifth-ave', 'empty');
    const plaza = getPlot('fifth-ave/plaza');
    const near = pickNearbyCandidate(streetCandidates({ x: plaza.x, z: plaza.z - 1.4 }, 'fifth-ave', plots, false));
    expect(near).toMatchObject({ target: 'plot-lease', plotId: plaza.id });
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
