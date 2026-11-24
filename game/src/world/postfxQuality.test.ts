import { describe, expect, it } from 'vitest';
import {
  parseFxParam,
  pickQuality,
  resolveFxQuality,
  screenYToTiltOffset,
  smoothToward,
} from './postfxQuality';

describe('parseFxParam', () => {
  it('accepts the three valid values', () => {
    expect(parseFxParam('high')).toBe('high');
    expect(parseFxParam('low')).toBe('low');
    expect(parseFxParam('off')).toBe('off');
  });
  it('returns null for absent or invalid input', () => {
    expect(parseFxParam(null)).toBeNull();
    expect(parseFxParam('')).toBeNull();
    expect(parseFxParam('HIGH')).toBeNull();
    expect(parseFxParam('medium')).toBeNull();
    expect(parseFxParam(' low')).toBeNull();
  });
});

describe('pickQuality', () => {
  const desktop = { param: null, devicePixelRatio: 1, isCoarsePointer: false } as const;
  it('explicit param wins over every heuristic', () => {
    expect(pickQuality({ ...desktop, param: 'off', isCoarsePointer: true })).toBe('off');
    expect(pickQuality({ ...desktop, param: 'high', isCoarsePointer: true, devicePixelRatio: 3 })).toBe('high');
    expect(pickQuality({ ...desktop, param: 'low' })).toBe('low');
  });
  it('desktop defaults to high', () => {
    expect(pickQuality(desktop)).toBe('high');
    expect(pickQuality({ ...desktop, devicePixelRatio: 2 })).toBe('high');
  });
  it('coarse pointer (phone/tablet) gets low', () => {
    expect(pickQuality({ ...desktop, isCoarsePointer: true })).toBe('low');
  });
  it('DPR above 2 gets low', () => {
    expect(pickQuality({ ...desktop, devicePixelRatio: 2.01 })).toBe('low');
    expect(pickQuality({ ...desktop, devicePixelRatio: 3 })).toBe('low');
  });
  it('small max texture size gets low, adequate or unknown stays high', () => {
    expect(pickQuality({ ...desktop, maxTextureSize: 2048 })).toBe('low');
    expect(pickQuality({ ...desktop, maxTextureSize: 4096 })).toBe('high');
    expect(pickQuality({ ...desktop, maxTextureSize: undefined })).toBe('high');
  });
});

describe('resolveFxQuality', () => {
  const env = { devicePixelRatio: 1, isCoarsePointer: false };
  it('uses the param when valid', () => {
    expect(resolveFxQuality('?fx=off', env)).toBe('off');
    expect(resolveFxQuality('?a=1&fx=low', env)).toBe('low');
  });
  it('falls to heuristics when the param is absent', () => {
    expect(resolveFxQuality('', env)).toBe('high');
    expect(resolveFxQuality('?other=1', { ...env, isCoarsePointer: true })).toBe('low');
  });
  it('throws a clear error when the param is present but invalid', () => {
    expect(() => resolveFxQuality('?fx=ultra', env)).toThrow(/Invalid \?fx= value "ultra"/);
    expect(() => resolveFxQuality('?fx=', env)).toThrow(/Invalid/);
  });
});

describe('screenYToTiltOffset', () => {
  it('maps top/middle/bottom to +1/0/-1 and clamps', () => {
    expect(screenYToTiltOffset(0)).toBe(1);
    expect(screenYToTiltOffset(0.5)).toBe(0);
    expect(screenYToTiltOffset(1)).toBe(-1);
    expect(screenYToTiltOffset(-3)).toBe(1);
    expect(screenYToTiltOffset(9)).toBe(-1);
  });
});

describe('smoothToward', () => {
  it('halves the gap every half-life', () => {
    expect(smoothToward(0, 1, 0.1, 0.1)).toBeCloseTo(0.5, 6);
    expect(smoothToward(0, 1, 0.2, 0.1)).toBeCloseTo(0.75, 6);
  });
  it('is frame-rate independent', () => {
    let a = 0;
    for (let i = 0; i < 10; i++) a = smoothToward(a, 1, 0.01, 0.1);
    expect(a).toBeCloseTo(smoothToward(0, 1, 0.1, 0.1), 6);
  });
  it('handles zero dt and zero half-life', () => {
    expect(smoothToward(0.3, 1, 0, 0.1)).toBe(0.3);
    expect(smoothToward(0.3, 1, 0.1, 0)).toBe(1);
  });
});
