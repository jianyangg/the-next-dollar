import { LEMON_CRATE_COST, PITCHER_COST } from './purchases';
import { countOwnedStands, type SliceState, STALL_KIT_COST } from './sliceModel';

/**
 * TUTORIAL SPENDING GUARD (pure rules, no UI).
 *
 * THE PROBLEM IT FIXES
 *   The first stand needs three things from the Supply Market: a stall kit ($12), a
 *   pitcher ($10) and at least one crate of lemons ($5) = $27 of the starting $30. Every
 *   item was affordable on its own, so a new player could buy the kit and two crates
 *   ($22), be left with $8, and never afford the $10 pitcher. Without a pitcher there is
 *   no brewing, without brewing no sales, so the run was dead on day 1 with nothing on
 *   screen saying why.
 *
 * THE RULE
 *   While the tutorial is running, a purchase is refused if, after paying for it, the
 *   cash left would not cover the OTHER starter items the player still lacks. Think of
 *   it as "reserving" money for the essentials. Once the player owns all three (or the
 *   tutorial is over or skipped) the guard steps aside and normal rules apply.
 */

export type StarterItem = 'stall-kit' | 'pitcher' | 'lemons';

export const STARTER_COST: Record<StarterItem, number> = {
  'stall-kit': STALL_KIT_COST,
  pitcher: PITCHER_COST,
  lemons: LEMON_CRATE_COST,
};

/** Short display names, used in the refusal note ("Keep $10 for pitcher"). */
export const STARTER_NAME: Record<StarterItem, string> = {
  'stall-kit': 'kit',
  pitcher: 'pitcher',
  lemons: 'lemons',
};

/** The starter items the player does not have yet, in shop order. */
export function missingStarterItems(s: SliceState): StarterItem[] {
  const missing: StarterItem[] = [];
  // A stall kit is consumed when the stand is built, so an owned stand counts as "has kit".
  if (s.stallKits < 1 && countOwnedStands(s) < 1) missing.push('stall-kit');
  if (s.pitchers < 1) missing.push('pitcher');
  if (s.cupsInStock < 1) missing.push('lemons');
  return missing;
}

/** What a refused purchase would have left the player unable to buy. */
export interface StarterShortfall {
  /** The other missing items the money must be kept for. */
  reservedFor: StarterItem[];
  /** Their total cost: the cash that must remain after the purchase. */
  reserve: number;
}

/**
 * Would buying `item` (costing `cost`) leave too little cash for the other missing
 * starter items? Returns the shortfall to explain, or null when the purchase is fine.
 * (Whether the player can afford `item` itself is the purchase rule's job, not this one.)
 */
export function starterShortfall(s: SliceState, item: StarterItem): StarterShortfall | null {
  const reservedFor = missingStarterItems(s).filter((m) => m !== item);
  if (reservedFor.length === 0) return null;
  const reserve = reservedFor.reduce((sum, m) => sum + STARTER_COST[m], 0);
  return s.cash - STARTER_COST[item] < reserve ? { reservedFor, reserve } : null;
}
