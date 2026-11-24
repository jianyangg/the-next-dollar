/**
 * Money rounding used by every ledger rule.
 *
 * The game stores dollars as JavaScript numbers (floating point). Adding 0.1 + 0.2
 * in floating point gives 0.30000000000000004, so every rule rounds its result to
 * cents the same way the original App.tsx did: `+(x).toFixed(2)`. Keeping that one
 * expression in one helper means a future switch to integer cents happens in one place.
 */
export function cents(value: number): number {
  return +value.toFixed(2);
}
