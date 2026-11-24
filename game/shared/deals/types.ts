/**
 * The plain TypeScript shapes of a deal, shared by the browser game and the Worker.
 *
 * `PublicDealView` is everything the player AND the seller's AI agent may see.
 * The hidden minimum (`reservationPrice`) is deliberately NOT here: it exists only
 * on `Deal` in src/core/deal.ts, which the server never imports. Because the server
 * only knows `PublicDealView`, leaking the minimum into a prompt is a type error.
 *
 * shared/ must not import from src/, so the neighborhood ids are defined in
 * shared/dealSchema.ts and src/core/neighborhoods.ts is checked against them by a test.
 */
import type { NEIGHBORHOOD_IDS } from '../dealSchema.ts';

export type DealNeighborhoodId = (typeof NEIGHBORHOOD_IDS)[number];

export interface BookPeriod {
  label: string;
  sales: number;
  lemons: number;
  managerWage: number;
  rent: number;
  profit: number;
}

export interface OffBookFact {
  /** Stable id so the validator and the post-purchase reveal can point at it. */
  id: string;
  /** What the topic is, used to match a player's direct question. */
  topic: 'staffing' | 'lease' | 'reason-for-selling';
  /** The true statement, in plain words. */
  statement: string;
  /** Every number the statement contains, so validators can whitelist them. */
  figures: number[];
}

export interface PublicDealView {
  id: string;
  neighborhood: DealNeighborhoodId;
  askingPrice: number;
  books: BookPeriod[];
  offBookFacts: OffBookFact[];
}

/**
 * The seller's character. It is pasted into the model's system prompt, so it is
 * OWNED BY THE SERVER (the shared/deals registry) and never accepted from a client.
 */
export interface SellerPersona {
  /** Seller's name, e.g. "Dana Reyes". */
  name: string;
  /** Where the stand is, e.g. "a brownstone corner by Central Park". */
  location: string;
  /** Way of talking, e.g. "warm and chatty, ...". */
  manner: string;
}
