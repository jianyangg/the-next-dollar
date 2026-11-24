/**
 * How many coin pips (1 to 3) a station plate shows, so cheap and pricey districts can
 * be told apart at a glance without hovering.
 *
 * The tier is computed from the real daily rents, not hard-coded per district: the
 * paying rents are split into three equal-width bands between the cheapest and the
 * dearest. A district with no rent at all (the supply market) gets 0 pips: it is not
 * "cheap", it is free, and the plate shows nothing rather than a misleading coin.
 *
 * Example with the real rents 2,3,4,5,6,7: 2 and 3 -> 1 pip, 4 and 5 -> 2, 6 and 7 -> 3.
 */
export type RentPips = 0 | 1 | 2 | 3;

export function rentPips(rent: number, allRents: readonly number[]): RentPips {
  if (rent <= 0) return 0;
  const paying = allRents.filter((r) => r > 0);
  if (paying.length === 0 || !paying.includes(rent)) {
    throw new Error(`Rent ${rent} is not one of the known rents`);
  }
  const min = Math.min(...paying);
  const max = Math.max(...paying);
  if (max === min) return 2; // every district costs the same: call it the middle tier
  const band = Math.floor(((rent - min) / (max - min)) * 3);
  return (Math.min(band, 2) + 1) as RentPips; // the dearest rent lands on 3.0, so cap it
}
