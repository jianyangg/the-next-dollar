/**
 * CUSTOMER DEMAND: the chance (0..1) that a passer-by who reaches the stand decides to
 * buy at `price`, given how price-sensitive the district is (core/neighborhoods.ts).
 *
 * One function, two readers:
 *   - the 3D scene rolls against it each time a pedestrian walks up to the stand
 *     (pass = they keep walking), so the price really changes how many cups sell;
 *   - the price menu draws it as "N of 10 people buy" (ui/stand/PriceCustomers.tsx).
 * Because both read the same number, what the price menu promises is what happens.
 *
 * Shape: cheap cups ($2 or less) sell to almost everyone; each dollar above that loses
 * buyers fast. Districts with LOW sensitivity (Fifth Ave 0.84: shoppers who pay up)
 * get a boost that grows with the price, so a high price can pay off there and not in
 * the park. Clamped to 12%..96% so nobody is ever certain to buy or certain to pass.
 * (Moved unchanged from ui/format.ts, where it was only ever displayed.)
 */
export function getConversionProb(price: number, priceSensitivity: number): number {
  const base = price <= 2 ? 0.95 : price === 3 ? 0.78 : price === 4 ? 0.42 : 0.18;
  const boost = Math.max(0, (1.1 - priceSensitivity) * Math.max(0, price - 2) * 0.55);
  return Math.min(0.96, Math.max(0.12, +(base + boost).toFixed(2)));
}
