import { PUBLIC_DEALS, type PublicDealView } from '../../shared/deals/index';
import { cents } from './money';
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
export interface Deal extends PublicDealView {
  /** Hidden minimum the seller accepts. Engine-only. */
  reservationPrice: number;
}

// The public types live in shared/ (the server owns them); re-exported so existing imports keep working.
export type { BookPeriod, OffBookFact, PublicDealView } from '../../shared/deals/index';

/**
 * The public half (books, asking price, off-book facts) comes from the server's
 * registry in shared/deals, so the Worker and the game cannot drift apart. The hidden
 * minimum is added here, in src/core only: the server never imports this file.
 */
export const CENTRAL_PARK_DEAL: Deal = {
  ...PUBLIC_DEALS['central-park-seller-1'].deal,
  reservationPrice: 42,
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
