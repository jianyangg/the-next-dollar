import { cents } from './money';
import { NeighborhoodId } from './neighborhoods';
import { SliceState } from './sliceModel';

/**
 * A stand that a seller wants to sell to the player.
 *
 * The deal is split into two views on purpose:
 * - `PublicDealView` is everything the player and the seller's AI agent may see:
 *   the published books, the asking price, and the off-book facts the seller must
 *   answer truthfully if asked directly (GDD §"Off-book facts").
 * - `reservationPrice` (the seller's hidden minimum) lives only on `Deal`, and only
 *   `resolveSealedBid` reads it. Handing an agent or a UI component a
 *   `PublicDealView` therefore makes leaking the minimum a type error, not a
 *   matter of remembering.
 *
 * The one deal below is the Central Park seller that App.tsx previously hard-coded
 * across SELLER_PERIODS, SELLER_ASK, SELLER_HIDDEN_MIN and the keyword answers in
 * `answerSellerQuestion`. Every number and fact is copied from there unchanged.
 */
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
  neighborhood: NeighborhoodId;
  askingPrice: number;
  books: BookPeriod[];
  offBookFacts: OffBookFact[];
}

export interface Deal extends PublicDealView {
  /** Hidden minimum the seller accepts. Engine-only. */
  reservationPrice: number;
}

export const CENTRAL_PARK_DEAL: Deal = {
  id: 'central-park-seller-1',
  neighborhood: 'central-park',
  askingPrice: 60,
  reservationPrice: 42,
  books: [
    { label: '2 periods ago', sales: 14, lemons: 5, managerWage: 0, rent: 3, profit: 6 },
    { label: 'Last period', sales: 15, lemons: 5, managerWage: 0, rent: 3, profit: 7 },
    { label: 'Latest', sales: 16, lemons: 5, managerWage: 0, rent: 3, profit: 8 },
  ],
  offBookFacts: [
    {
      id: 'owner-unpaid-labour',
      topic: 'staffing',
      statement: 'The owner runs the stand personally, so manager pay is $0 on the books.',
      figures: [0],
    },
    {
      id: 'lease-rent-step-up',
      topic: 'lease',
      statement: 'The lease renews in 4 days and rent rises from $3 to $5 a day on renewal.',
      figures: [4, 3, 5],
    },
    {
      id: 'moving-to-brooklyn',
      topic: 'reason-for-selling',
      statement: 'The seller is moving to Brooklyn next week and does not want to commute uptown.',
      figures: [],
    },
  ],
};

/** Strip the hidden minimum before handing a deal to the UI or the seller agent. */
export function toPublicView({ reservationPrice: _hidden, ...publicView }: Deal): PublicDealView {
  return publicView;
}

export type BidResolution =
  | { kind: 'invalid' }
  | { kind: 'insufficient-cash'; cash: number }
  | { kind: 'deal-closed' }
  | { kind: 'won'; bid: number; state: SliceState }
  | { kind: 'rejected'; bid: number; state: SliceState };

/**
 * One sealed bid, compared once against the hidden minimum (GDD: "if bid >=
 * reservationPrice, the stand joins the player's chain at the bid price").
 * An unaffordable or non-positive bid is refused without closing the deal.
 */
export function resolveSealedBid(s: SliceState, deal: Deal, bid: number): BidResolution {
  if (s.dealStatus !== 'open') return { kind: 'deal-closed' };
  if (!Number.isFinite(bid) || bid <= 0) return { kind: 'invalid' };
  if (bid > s.cash) return { kind: 'insufficient-cash', cash: s.cash };
  if (bid >= deal.reservationPrice) {
    return {
      kind: 'won',
      bid,
      state: {
        ...s,
        cash: cents(s.cash - bid),
        equipmentValue: cents(s.equipmentValue + bid),
        ownedStands: s.ownedStands + 1,
        dealStatus: 'won',
        dealBidPrice: bid,
      },
    };
  }
  return { kind: 'rejected', bid, state: { ...s, dealStatus: 'rejected', dealBidPrice: bid } };
}
