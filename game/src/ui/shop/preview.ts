import { ledgerChips, type MoneyChip } from '../../core/ledgerChips';
import type { PurchaseResult } from '../../core/purchases';
import type { SliceState } from '../../core/sliceModel';

/**
 * "What happens if I buy this?", answered by running the REAL purchase rule on a copy of
 * the current economy. Nothing is written to the store and no number is typed here:
 *   - when the rule accepts, the chips are the difference between the economy before and
 *     after (core/ledgerChips), so they are true by construction;
 *   - when the rule refuses for lack of money (or a kit), we show what it costs, using the
 *     rule's own price constant that the caller passes in.
 * Any other refusal (for example "no pitcher to sell") means the row simply is not offered,
 * so there is nothing to preview.
 */
export type PurchasePreview =
  | { kind: 'chips'; chips: MoneyChip[]; before: SliceState; after: SliceState }
  | { kind: 'need'; cost: number; needs: 'cash' | 'kit' }
  | { kind: 'none' };

export function previewPurchase(
  economy: SliceState,
  rule: (s: SliceState) => PurchaseResult,
  cost: number
): PurchasePreview {
  const result = rule(economy);
  if (result.ok) {
    return { kind: 'chips', chips: ledgerChips(economy, result.state), before: economy, after: result.state };
  }
  if (result.reason === 'insufficient-cash') return { kind: 'need', cost, needs: 'cash' };
  if (result.reason === 'no-stall-kit') return { kind: 'need', cost, needs: 'kit' };
  return { kind: 'none' };
}
