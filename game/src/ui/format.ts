/**
 * Small pure helpers shared by several UI components. Keeping them in one leaf module
 * (no React, no store) means any component can import them without creating an import
 * cycle, and they can be unit-tested without rendering anything.
 */

/** "+$1.50" / "-$0.25": always shows the sign, always two decimals. */
export function fmtSignedMoney(val: number): string {
  return `${val >= 0 ? '+' : '-'}$${Math.abs(val).toFixed(2)}`;
}

/**
 * The chance (0..1) that a passer-by buys at `price`, given how price-sensitive the
 * district is. Shown as the percentage under each price button.
 */
export function getConversionProb(price: number, priceSensitivity: number): number {
  const base = price <= 2 ? 0.95 : price === 3 ? 0.78 : price === 4 ? 0.42 : 0.18;
  const boost = Math.max(0, (1.1 - priceSensitivity) * Math.max(0, price - 2) * 0.55);
  return Math.min(0.96, Math.max(0.12, +(base + boost).toFixed(2)));
}
