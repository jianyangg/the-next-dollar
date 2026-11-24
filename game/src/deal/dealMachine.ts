/**
 * The seller deal flow as an XState v5 state machine (one actor per deal).
 *
 * WHAT IS A STATE MACHINE?
 * A machine is always in exactly one named state (for example `open.answering`),
 * and each state lists which events it reacts to. An event the current state does
 * not list is simply ignored. Compare that with a pile of boolean flags in a UI
 * component (`isAnswering`, `hasWalkedAway`, `questionCount < 3` ...), where every
 * button handler has to remember to check the right combination.
 *
 * WHY THAT MATTERS HERE
 * - "No 4th question": `ASK` carries a guard (a yes/no check) that fails once three
 *   questions are recorded, so the transition does not exist any more. Hiding the
 *   input box in the UI is a courtesy; the rule itself is enforced here.
 * - "No bid after walking away": `walkedAway` is a `final` state. A finished actor
 *   accepts no events at all, so `SUBMIT_BID` has nowhere to go. The same holds
 *   after `won` and `rejected` (GDD §10: deals are final for the whole career).
 * - "No bid while the seller is still answering": `SUBMIT_BID` is only listed under
 *   `open.idle`, not under `open.answering`.
 *
 * SECRECY
 * The seller's hidden reservation price never enters this machine: the input is a
 * `PublicDealView`, and the bid comparison happens in the injected `resolveBid`
 * actor, built by the caller from the full `Deal` and the live cash balance.
 *
 * NO FALLBACK DATA
 * If the seller's service fails, the machine records the failure and invents no text;
 * the UI renders an explicit "unavailable" state. The server sometimes answers with
 * stand-in words of its own: a scripted "template" pitch (AI off or failed) or a
 * "neutral" line (an answer failed). The machine does NOT keep those as the seller's
 * words: a template pitch becomes `sellerOffline` (no pitch text, no questions) and a
 * neutral answer becomes `status: 'no-answer'` with `a: null`. Only words the AI seller
 * actually said, after passing the server's checks, are shown as speech.
 *
 * QUESTION COUNT
 * The server is the authority (it refunds failed answers, caps model calls), so the
 * machine stores the server's `questionsRemaining` instead of counting locally.
 *
 * ACTORS THE CALLER MUST PROVIDE (via `dealMachine.provide({ actors: { ... } })`)
 * - `fetchPitch`  ({deal}) -> the server's PitchResponse {text, source, questionsEnabled, questionsRemaining}
 * - `askSeller`   ({deal, history, question}) -> the server's QuestionResponse {text, source, questionsRemaining, refunded}
 * - `resolveBid`  ({bid}) -> BidResolution-like result; it should also apply any
 *   state change (cash, ownership) as a side effect, because the machine keeps only
 *   the verdict, not the resulting game state.
 * Unprovided actors reject with a clear error rather than returning fake data.
 *
 * STATE CHART
 *   loadingPitch --pitch ok--> open
 *   loadingPitch --pitch error or template--> open (pitch: null, sellerOffline, questions off)
 *   open.idle --ASK [guard]--> open.answering --done/error--> open.idle
 *   open.idle --SUBMIT_BID [bid finite and > 0]--> open.resolving
 *   open.resolving --won--> won (final) | --rejected--> rejected (final)
 *                  --insufficient-cash / invalid / deal-closed / error--> open.idle + bidError
 *   open.idle --WALK_AWAY--> walkedAway (final)
 *   CLOSE_PANEL: accepted by no state on purpose; closing the modal is UI-only.
 */
import { assign, fromPromise, setup, type SnapshotFrom } from 'xstate';
import type { PitchResponse, QuestionResponse } from '../../shared/sellerReply';
import type { BidResolution, PublicDealView } from '../core/deal';
import { SellerApiError } from './sellerClient';
import { MAX_QUESTION_CHARS, MAX_QUESTIONS } from './limits';

export { MAX_QUESTION_CHARS, MAX_QUESTIONS };

export interface QaEntry {
  q: string;
  /** The AI seller's checked answer; null unless status is 'answered'. Never invented text. */
  a: string | null;
  /**
   * answered:  the seller replied (a holds the words)
   * no-answer: the server could not get a valid answer (its neutral line is not shown)
   * error:     the request itself failed (network, closed deal, limit)
   */
  status: 'answered' | 'no-answer' | 'error';
  /** True when the server did not charge this question against the limit. */
  refunded: boolean;
}

export type BidError =
  | { kind: 'insufficient-cash'; cash: number }
  | { kind: 'invalid' }
  | { kind: 'deal-closed' }
  | { kind: 'error' };

export type DealOutcome = 'won' | 'rejected' | 'walkedAway';

export interface DealContext {
  deal: PublicDealView;
  pitch: string | null;
  /** The seller is not talking: the pitch failed, or the server sent its scripted template. */
  sellerOffline: boolean;
  questionsEnabled: boolean;
  /** From the server; the client never counts on its own. */
  questionsRemaining: number;
  qa: QaEntry[];
  /** The question currently being answered (only meaningful in open.answering). */
  pendingQuestion: string | null;
  bid?: number;
  bidError?: BidError;
  outcome?: DealOutcome;
}

export interface DealInput {
  deal: PublicDealView;
}

export type DealEvent =
  | { type: 'ASK'; question: string }
  | { type: 'SUBMIT_BID'; bid: number }
  | { type: 'WALK_AWAY' }
  | { type: 'CLOSE_PANEL' };

/**
 * The verdict type is the real `BidResolution` so the caller can return
 * `resolveSealedBid`'s result unchanged. The machine reads only `kind` and
 * `cash`; the `state` field (the new game state) is never stored in context.
 */
export type BidVerdict = BidResolution;

const notProvided = (name: string) => async (): Promise<never> => {
  throw new Error(`dealMachine actor "${name}" was not provided`);
};

export const dealMachine = setup({
  types: {
    context: {} as DealContext,
    events: {} as DealEvent,
    input: {} as DealInput,
    output: {} as { outcome: DealOutcome; bid?: number },
  },
  actors: {
    fetchPitch: fromPromise<PitchResponse, { deal: PublicDealView }>(notProvided('fetchPitch')),
    askSeller: fromPromise<QuestionResponse, { deal: PublicDealView; history: QaEntry[]; question: string }>(
      notProvided('askSeller')
    ),
    resolveBid: fromPromise<BidVerdict, { bid: number }>(notProvided('resolveBid')),
  },
  guards: {
    canAskNow: ({ context, event }) =>
      event.type === 'ASK' &&
      context.questionsEnabled &&
      context.questionsRemaining > 0 &&
      event.question.trim().length > 0 &&
      event.question.trim().length <= MAX_QUESTION_CHARS,
    validBid: ({ event }) =>
      event.type === 'SUBMIT_BID' && Number.isFinite(event.bid) && event.bid > 0,
    bidWon: (_, params: { v: BidVerdict }) => params.v.kind === 'won',
    bidRejected: (_, params: { v: BidVerdict }) => params.v.kind === 'rejected',
  },
  actions: {
    rememberQuestion: assign({
      pendingQuestion: ({ event }) => (event.type === 'ASK' ? event.question.trim() : null),
      bidError: undefined,
    }),
    rememberBid: assign({
      bid: ({ event }) => (event.type === 'SUBMIT_BID' ? event.bid : undefined),
      bidError: undefined,
    }),
  },
}).createMachine({
  id: 'deal',
  context: ({ input }) => ({
    deal: input.deal,
    pitch: null,
    sellerOffline: false,
    questionsEnabled: false,
    questionsRemaining: 0,
    qa: [],
    pendingQuestion: null,
  }),
  initial: 'loadingPitch',
  states: {
    loadingPitch: {
      invoke: {
        src: 'fetchPitch',
        input: ({ context }) => ({ deal: context.deal }),
        onDone: {
          target: 'open',
          actions: assign(({ event }) => {
            const r = event.output;
            // A scripted template is not the seller speaking: treat it as offline.
            if (r.source === 'template') {
              return { pitch: null, sellerOffline: true, questionsEnabled: false, questionsRemaining: 0 };
            }
            return {
              pitch: r.text,
              sellerOffline: false,
              questionsEnabled: r.questionsEnabled,
              questionsRemaining: r.questionsRemaining,
            };
          }),
        },
        onError: {
          target: 'open',
          actions: assign({ pitch: null, sellerOffline: true, questionsEnabled: false, questionsRemaining: 0 }),
        },
      },
    },
    open: {
      initial: 'idle',
      states: {
        idle: {
          on: {
            ASK: { guard: 'canAskNow', target: 'answering', actions: 'rememberQuestion' },
            SUBMIT_BID: { guard: 'validBid', target: 'resolving', actions: 'rememberBid' },
            WALK_AWAY: '#deal.walkedAway',
          },
        },
        answering: {
          invoke: {
            src: 'askSeller',
            input: ({ context }) => ({
              deal: context.deal,
              history: context.qa,
              question: context.pendingQuestion ?? '',
            }),
            onDone: {
              target: 'idle',
              actions: assign(({ context, event }) => {
                const r = event.output;
                const answered = r.source === 'model';
                return {
                  qa: [
                    ...context.qa,
                    {
                      q: context.pendingQuestion ?? '',
                      a: answered ? r.text : null,
                      status: answered ? ('answered' as const) : ('no-answer' as const),
                      refunded: r.refunded,
                    },
                  ],
                  questionsRemaining: r.questionsRemaining,
                  pendingQuestion: null,
                };
              }),
            },
            onError: {
              target: 'idle',
              actions: assign(({ context, event }) => {
                const code = event.error instanceof SellerApiError ? event.error.code : null;
                // Learn what we can from the server's refusal; otherwise keep the last known count.
                const closed = code === 'deal-closed' || code === 'questions-disabled';
                return {
                  qa: [
                    ...context.qa,
                    { q: context.pendingQuestion ?? '', a: null, status: 'error' as const, refunded: false },
                  ],
                  questionsEnabled: closed ? false : context.questionsEnabled,
                  questionsRemaining: code === 'question-limit' || closed ? 0 : context.questionsRemaining,
                  pendingQuestion: null,
                };
              }),
            },
          },
        },
        resolving: {
          invoke: {
            src: 'resolveBid',
            input: ({ context }) => ({ bid: context.bid as number }),
            onDone: [
              { guard: { type: 'bidWon', params: ({ event }) => ({ v: event.output }) }, target: '#deal.won' },
              { guard: { type: 'bidRejected', params: ({ event }) => ({ v: event.output }) }, target: '#deal.rejected' },
              {
                target: 'idle',
                actions: assign({
                  bidError: ({ event }): BidError => {
                    const v = event.output;
                    if (v.kind === 'insufficient-cash') return { kind: 'insufficient-cash', cash: v.cash };
                    if (v.kind === 'deal-closed') return { kind: 'deal-closed' };
                    return { kind: 'invalid' };
                  },
                }),
              },
            ],
            onError: { target: 'idle', actions: assign({ bidError: { kind: 'error' } }) },
          },
        },
      },
    },
    won: { type: 'final', entry: assign({ outcome: 'won' as const }) },
    rejected: { type: 'final', entry: assign({ outcome: 'rejected' as const }) },
    walkedAway: { type: 'final', entry: assign({ outcome: 'walkedAway' as const, bid: undefined }) },
  },
  output: ({ context }) => ({ outcome: context.outcome as DealOutcome, bid: context.bid }),
});

export type DealSnapshot = SnapshotFrom<typeof dealMachine>;

/** Questions the player may still ask (0 when disabled, finished or limit reached). */
export function questionsLeft(snapshot: DealSnapshot): number {
  if (!snapshot.context.questionsEnabled) return 0;
  return Math.max(0, Math.min(MAX_QUESTIONS, snapshot.context.questionsRemaining));
}

/** True when the UI should offer the question box: an ASK would be accepted. */
export function canAsk(snapshot: DealSnapshot): boolean {
  return snapshot.matches({ open: 'idle' }) && questionsLeft(snapshot) > 0;
}
