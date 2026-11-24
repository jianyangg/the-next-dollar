import { describe, expect, it } from 'vitest';
import { getConversionProb } from './demand';
import { getNeighborhood } from './neighborhoods';

describe('price -> demand', () => {
  const park = getNeighborhood('central-park').priceSensitivity;
  const fifth = getNeighborhood('fifth-ave').priceSensitivity;

  it('a higher price never wins more buyers in the same district', () => {
    for (let p = 1; p < 5; p++) {
      expect(getConversionProb(p + 1, park)).toBeLessThanOrEqual(getConversionProb(p, park));
    }
  });

  it('shoppers on Fifth Ave pay up: $5 sells far better there than in the park', () => {
    expect(getConversionProb(5, fifth)).toBeGreaterThan(getConversionProb(5, park) + 0.3);
  });

  it('nobody is ever certain to buy or certain to pass', () => {
    expect(getConversionProb(1, 0)).toBeLessThanOrEqual(0.96);
    expect(getConversionProb(99, 2)).toBeGreaterThanOrEqual(0.12);
  });
});
