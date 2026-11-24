import { type BidError, canAsk, type DealSnapshot, type QaEntry, questionsLeft } from './dealMachine';

/**
 * A plain, render-ready view of the deal machine's snapshot.
 *
 * The store keeps THIS (not the XState snapshot) so components select simple fields
 * and React compares them cheaply. `phase` flattens the machine's nested state names
 * into one value the seller screen can switch on.
 */
export type DealPhase = 'loading' | 'idle' | 'answering' | 'resolving' | 'won' | 'rejected' | 'walkedAway';

export interface DealView {
  phase: DealPhase;
  /** The AI seller's checked pitch; null while loading or when the seller is offline. */
  pitch: string | null;
  sellerOffline: boolean;
  qa: QaEntry[];
  questionsLeft: number;
  canAsk: boolean;
  /** The question being answered right now (phase 'answering'). */
  pendingQuestion: string | null;
  bid?: number;
  bidError?: BidError;
}

export function toDealView(snapshot: DealSnapshot): DealView {
  const c = snapshot.context;
  const phase: DealPhase = snapshot.matches('loadingPitch')
    ? 'loading'
    : snapshot.matches('won')
      ? 'won'
      : snapshot.matches('rejected')
        ? 'rejected'
        : snapshot.matches('walkedAway')
          ? 'walkedAway'
          : snapshot.matches({ open: 'answering' })
            ? 'answering'
            : snapshot.matches({ open: 'resolving' })
              ? 'resolving'
              : 'idle';
  return {
    phase,
    pitch: c.pitch,
    sellerOffline: c.sellerOffline,
    qa: c.qa,
    questionsLeft: questionsLeft(snapshot),
    canAsk: canAsk(snapshot),
    pendingQuestion: c.pendingQuestion,
    bid: c.bid,
    bidError: c.bidError,
  };
}
