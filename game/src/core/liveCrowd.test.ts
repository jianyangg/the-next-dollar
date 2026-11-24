import { describe, expect, it } from 'vitest';
import { type ClockSpeed, DAY_SECONDS } from './clock';
import {
  MAX_OWED,
  MAX_WALKERS_PER_LANE,
  MIN_WALKERS_PER_LANE,
  newGate,
  STREET_EDGE,
  STROLL_SPEED_MAX,
  STROLL_SPEED_MIN,
  strollSpeedFactor,
  takeDecision,
  tickGate,
  walkersPerLane,
} from './liveCrowd';
import { createRunStreams } from './rng';
import { walkersPerDay } from './standSales';

/** The scene's reach: a walker within this many units (in x) of the stand can decide. */
const REACH_X = 2.6; // world/CentralParkScene.ts QUEUE_REACH_X

/**
 * A model of the live street, built from the same rules the scene uses: `walkersPerLane`
 * walkers on the stand's sidewalk, each crossing from one edge to the other at a random
 * stroll speed scaled by the clock (`strollSpeedFactor`), deciding at most once per
 * crossing, and only when the gate (`tickGate` / `takeDecision`) owes a decision.
 * It counts the decisions made in one game day. Buyers are assumed to step out of the
 * way at once (the line is never full), so this checks the SUPPLY of walkers and the
 * gate, which is what can starve the stand.
 */
function decisionsInADay(perDay: number, speed: ClockSpeed, seed: number, standX = 5.6): number {
  const rand = createRunStreams(seed).gameplay;
  const n = walkersPerLane(perDay);
  const walkers = Array.from({ length: n }, () => {
    const dir = rand() < 0.5 ? 1 : -1;
    return {
      x: -STREET_EDGE + rand() * 2 * STREET_EDGE,
      v: dir * (STROLL_SPEED_MIN + rand() * (STROLL_SPEED_MAX - STROLL_SPEED_MIN)),
      decided: false,
    };
  });
  let gate = newGate();
  let decisions = 0;
  const dt = 1 / 60;
  const factor = strollSpeedFactor(speed);
  for (let t = 0; t < DAY_SECONDS[speed]; t += dt) {
    gate = tickGate(gate, dt, true, perDay, speed, rand);
    for (const w of walkers) {
      w.x += w.v * factor * dt;
      if ((w.v < 0 && w.x < -STREET_EDGE) || (w.v > 0 && w.x > STREET_EDGE)) {
        // Off the far edge: a new walker enters from a random edge.
        const dir = rand() < 0.5 ? 1 : -1;
        w.x = dir === 1 ? -STREET_EDGE : STREET_EDGE;
        w.v = dir * (STROLL_SPEED_MIN + rand() * (STROLL_SPEED_MAX - STROLL_SPEED_MIN));
        w.decided = false;
        continue;
      }
      if (!w.decided && Math.abs(w.x - standX) < REACH_X) {
        const next = takeDecision(gate);
        if (next) {
          gate = next;
          w.decided = true;
          decisions += 1;
        }
      }
    }
  }
  return decisions;
}

const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;

describe('the live street delivers the formula\'s passers-by (checklist item 1, with walkers)', () => {
  const cases: Array<[string, number]> = [
    ['Central Park corner', walkersPerDay('central-park/corner', { standsInDistrict: 1, awareness: 0 })],
    ['Central Park corner after a campaign', walkersPerDay('central-park/corner', { standsInDistrict: 1, awareness: 0.5 })],
    ['Fifth Avenue plaza at full awareness', walkersPerDay('fifth-ave/plaza', { standsInDistrict: 1, awareness: 1 })],
    ['Columbia side street', walkersPerDay('columbia/side', { standsInDistrict: 1, awareness: 0 })],
  ];
  for (const [name, perDay] of cases) {
    for (const speed of [1, 2] as const) {
      it(`${name} (${perDay.toFixed(1)} a day) at ${speed}x: within 5% over 20 days`, () => {
        const days = Array.from({ length: 20 }, (_, i) => decisionsInADay(perDay, speed, i + 1));
        expect(Math.abs(mean(days) - perDay) / perDay).toBeLessThan(0.05);
      });
    }
  }
});

describe('crowd size follows demand', () => {
  it('a busier stand gets a bigger crowd, within the floor and the cap', () => {
    expect(walkersPerLane(5)).toBe(MIN_WALKERS_PER_LANE);
    expect(walkersPerLane(36)).toBeGreaterThan(MIN_WALKERS_PER_LANE);
    expect(walkersPerLane(121.8)).toBeGreaterThan(walkersPerLane(36));
    expect(walkersPerLane(121.8)).toBeLessThanOrEqual(MAX_WALKERS_PER_LANE);
    expect(walkersPerLane(10_000)).toBe(MAX_WALKERS_PER_LANE);
  });
});

describe('the decision gate', () => {
  const rand = createRunStreams(1).gameplay;
  it('owes nothing while the clock is paused or there is no crowd', () => {
    expect(tickGate(newGate(), 60, false, 36, 1, rand)).toEqual(newGate());
    expect(tickGate(newGate(), 60, true, 0, 1, rand)).toEqual(newGate());
  });

  it('caps owed decisions so an empty stretch cannot release a burst', () => {
    expect(tickGate(newGate(), 600, true, 36, 1, rand).owed).toBe(MAX_OWED);
  });

  it('a walker settles exactly one owed decision', () => {
    const g = { owed: 2, untilNext: 1 };
    expect(takeDecision(g)).toEqual({ owed: 1, untilNext: 1 });
    expect(takeDecision({ owed: 0, untilNext: 1 })).toBeNull();
  });
});

describe('the decision timer counts game time', () => {
  it('1 real second at 2x owes exactly what 2 real seconds at 1x owe', () => {
    // So a wait drawn while the counter holds the game at 1x is not stretched
    // when 2x resumes (core/clock.ts effectiveClockSpeed).
    const a = tickGate(newGate(), 1, true, 120, 2, createRunStreams(7).gameplay);
    const b = tickGate(newGate(), 2, true, 120, 1, createRunStreams(7).gameplay);
    expect(a).toEqual(b);
  });
});
