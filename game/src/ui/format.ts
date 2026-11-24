/**
 * Small pure helpers shared by several UI components. Keeping them in one leaf module
 * (no React, no store) means any component can import them without creating an import
 * cycle, and they can be unit-tested without rendering anything.
 */

/** "+$1.50" / "-$0.25": always shows the sign, always two decimals. */
export function fmtSignedMoney(val: number): string {
  return `${val >= 0 ? '+' : '-'}$${Math.abs(val).toFixed(2)}`;
}
