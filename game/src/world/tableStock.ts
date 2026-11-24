/**
 * What the live stand's counter shows for the player's stock.
 *
 * The stand has two piles of stock (see core/brewing.ts lemonCupsLeft):
 *   - ready cups: lemonade already brewed, waiting to be sold (store `brewedCups`);
 *   - lemons left: cups' worth of lemons not brewed yet.
 * The HUD card shows the exact numbers. The 3D counter shows the same two piles so
 * the player can read them in the world at a glance:
 *   - one filled cup per ready cup, in a row (capped, the counter is only so wide);
 *   - one pitcher whose fill level follows the ready cups too, so "a full pitcher"
 *     always means "lemonade is ready" and an empty pitcher means "brew some";
 *   - the lemon crate holds a few, some or a full heap of lemons.
 *
 * This file is pure (numbers in, numbers out) so the steps can be unit tested
 * without a WebGL scene; CentralParkScene only turns sprites/meshes on and off.
 */

/** Filled cups the counter has room for. More ready cups still show this many. */
export const MAX_TABLE_CUPS = 6;

/** Lemon meshes in a full crate (CentralParkScene.buildLemonCrate draws this many). */
export const CRATE_LEMON_SLOTS = 6;

/** The pitcher has one texture per level, drawn in pixelArt.ts createPitcherFillTexture. */
export type PitcherFill = 'empty' | 'low' | 'half' | 'full';

export interface TableStockInput {
  /** Brewed cups waiting to be sold (store `brewedCups`). */
  readyCups: number;
  /** Cups' worth of lemons not yet brewed (core/brewing.ts lemonCupsLeft). */
  lemons: number;
}

export interface TableStockView {
  /** Filled cups to draw on the counter, 0..MAX_TABLE_CUPS. */
  cups: number;
  /** How full the one pitcher on the counter looks. */
  pitcher: PitcherFill;
  /** Lemons to draw in the crate, 0..CRATE_LEMON_SLOTS. */
  crateLemons: number;
}

/**
 * Lemon steps. A crate with 0 lemons is empty; with 1-4 cups' worth it has a couple
 * of lemons; 5-9 is "some"; 10 or more is a full heap. Steps (rather than one lemon
 * per cup) because a few cups' difference is not readable from across the street,
 * while "empty / running low / plenty" is. Listed from the highest threshold down;
 * the first row the stock reaches wins.
 */
const CRATE_STEPS: ReadonlyArray<{ minLemons: number; shown: number }> = [
  { minLemons: 10, shown: CRATE_LEMON_SLOTS },
  { minLemons: 5, shown: 4 },
  { minLemons: 1, shown: 2 },
];

/**
 * Pitcher steps, from ready cups. A perfect brew adds 6 cups, so a fresh perfect batch
 * fills the pitcher and every sale visibly drains it a little.
 */
const PITCHER_STEPS: ReadonlyArray<{ minCups: number; fill: PitcherFill }> = [
  { minCups: 5, fill: 'full' },
  { minCups: 3, fill: 'half' },
  { minCups: 1, fill: 'low' },
];

/** Whole, non-negative count (stock is always an integer, but never draw -1 cups). */
const wholeCount = (n: number): number => Math.max(0, Math.floor(n));

export function tableStockView({ readyCups, lemons }: TableStockInput): TableStockView {
  const ready = wholeCount(readyCups);
  const left = wholeCount(lemons);
  return {
    cups: Math.min(MAX_TABLE_CUPS, ready),
    pitcher: PITCHER_STEPS.find((s) => ready >= s.minCups)?.fill ?? 'empty',
    crateLemons: CRATE_STEPS.find((s) => left >= s.minLemons)?.shown ?? 0,
  };
}

/**
 * The stand has nothing left to sell: no brewed cups and no lemons to brew more.
 *
 * This is the same condition that closes the stand to customers (state/gameStore.ts
 * `selectStandOpen` needs `cupsInStock > 0`, and ready cups + lemons left IS
 * `cupsInStock`), so the SOLD OUT sign over the stand only ever shows while walkers
 * really are skipping the line. Stock is shared by every stand the player owns, so
 * when it runs out, every built stand on the street is sold out at once.
 */
export function isSoldOut({ readyCups, lemons }: TableStockInput): boolean {
  return wholeCount(readyCups) + wholeCount(lemons) === 0;
}
