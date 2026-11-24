import { CENTRAL_PARK_PERSONA, CENTRAL_PARK_PUBLIC_DEAL } from './centralPark.ts';
import type { PublicDealView, SellerPersona } from './types.ts';

export type { BookPeriod, DealNeighborhoodId, OffBookFact, PublicDealView, SellerPersona } from './types.ts';

/**
 * The server-owned registry of deals the seller agent may discuss, keyed by deal id.
 *
 * WHY: if the client sent the deal text or persona, a modified browser could put
 * instructions in it (prompt injection) and the model would read them as ours. With
 * a registry, the client names a deal by id and everything that reaches the prompt
 * comes from code we reviewed. Adding a deal = adding an entry here.
 */
export const PUBLIC_DEALS: Record<string, { deal: PublicDealView; persona: SellerPersona }> = {
  [CENTRAL_PARK_PUBLIC_DEAL.id]: { deal: CENTRAL_PARK_PUBLIC_DEAL, persona: CENTRAL_PARK_PERSONA },
};

/**
 * Looks up a deal by id, or undefined if it is not registered.
 * `Object.hasOwn` matters: a plain `PUBLIC_DEALS[id]` would "find" inherited keys
 * such as "constructor" or "__proto__" for an attacker-chosen id.
 */
export function getPublicDeal(id: string): { deal: PublicDealView; persona: SellerPersona } | undefined {
  return Object.hasOwn(PUBLIC_DEALS, id) ? PUBLIC_DEALS[id] : undefined;
}
