/**
 * Awareness display helper shared by the stand's Advertise panel and the Books drawer.
 * One function so both screens print the same number for the same district.
 */

/** Awareness 0..1 (core/marketing.ts) as the 0..100 the player reads. Rounding is display only. */
export const awarenessPct = (a: number): number => Math.round(a * 100);
