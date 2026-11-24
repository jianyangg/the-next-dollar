/**
 * Ten pixel customers standing for "out of 10 passers-by, how many buy at this price".
 * Same number as the old "72%" text (getConversionProb), drawn instead of written.
 */

/** How many of the 10 figures are lit: the buy chance rounded to the nearest tenth. */
export function litCustomers(buyChance: number): number {
  return Math.max(0, Math.min(10, Math.round(buyChance * 10)));
}

export function PriceCustomers({ buyChance }: { buyChance: number }) {
  const lit = litCustomers(buyChance);
  return (
    <div className="stand-custs" role="img" aria-label={`${lit} of 10 customers buy`}>
      {Array.from({ length: 10 }, (_, i) => (
        <i key={i} className={`stand-cust ${i < lit ? 'is-lit' : ''}`} />
      ))}
    </div>
  );
}
