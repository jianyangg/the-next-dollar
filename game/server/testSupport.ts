import { CENTRAL_PARK_DEAL } from '../src/core/deal.ts';
import { getPublicDeal, type SellerPersona } from '../shared/deals/index.ts';
import { MAX_MODEL_CALLS_PER_DEAL } from '../shared/limits.ts';
import { sellerReplySchema } from '../shared/sellerReply.ts';
import { Budget, InMemorySpendStore } from './budget.ts';
import { SellerService } from './callSeller.ts';
import { EMPTY_META, type DealMeta, type SessionState, type SessionStorage } from './dealSession.ts';
import type { SellerModel } from './gemini.ts';
import type { SellerLogLine } from './log.ts';

/**
 * Shared helpers for the server tests. This file is NOT a test and is never
 * imported by the Worker, so none of it ships. Everything here is offline: the only
 * model is a stub, so no test can spend money.
 *
 * (It imports src/core only to read the hidden minimum for the "never in a prompt"
 * test. Server CODE must never import src/core; this test helper is the one exception.)
 */

export const DEAL_ID = 'central-park-seller-1';

const entry = getPublicDeal(DEAL_ID);
if (!entry) throw new Error(`${DEAL_ID} missing from the deal registry`);

/** The deal exactly as the server sees it: from the registry, no hidden minimum. */
export const PUBLIC_DEAL = entry.deal;
export const HIDDEN_MINIMUM = CENTRAL_PARK_DEAL.reservationPrice; // 42; must never reach a prompt

/** The registry's (draft) persona for the deal. */
export const PERSONA: SellerPersona = entry.persona;

export const CTX = { dealId: PUBLIC_DEAL.id, deal: PUBLIC_DEAL, persona: PERSONA, modelCallsRemaining: MAX_MODEL_CALLS_PER_DEAL };

/** A reply the validator accepts as a PITCH for the Central Park deal. */
export const GOOD_PITCH = 'Park Corner stand, asking $60. Sales climbed from $14 to $16 a day and profit reached $8 a day.';
/** A reply the validator accepts as an ANSWER about the lease (all figures are off-book facts). */
export const GOOD_LEASE_ANSWER = 'The lease renews in 4 days, and rent goes from $3 to $5 a day.';

/** Wraps text the way the real model must answer: JSON `{ "text": ... }`. */
export const json = (text: string): string => JSON.stringify(sellerReplySchema.parse({ text }));

export interface MemoryStorage extends SessionStorage {
  snapshot(): SessionState | undefined;
  metaSnapshot(): DealMeta;
}

/**
 * In-memory stand-in for Durable Object storage, with the same two-key layout:
 * the conversation can be cleared, the meta ledger cannot.
 */
export function memoryStorage(): MemoryStorage {
  let state: SessionState | undefined;
  let meta: DealMeta = { ...EMPTY_META };
  return {
    load: async () => (state ? structuredClone(state) : undefined),
    save: async (s) => {
      state = structuredClone(s);
    },
    clearConversation: async () => {
      state = undefined;
    },
    loadMeta: async () => structuredClone(meta),
    saveMeta: async (m) => {
      meta = structuredClone(m);
    },
    snapshot: () => state,
    metaSnapshot: () => structuredClone(meta),
  };
}

export interface TestService {
  service: SellerService;
  logs: SellerLogLine[];
  store: InMemorySpendStore;
  modelRequested: () => number;
}

/** Builds a SellerService around a stub model with an in-memory budget and a log collector. */
export function makeService(
  model: SellerModel,
  options: { enabled?: boolean; spentMicroUsd?: number; deadlineMs?: number } = {},
): TestService {
  const logs: SellerLogLine[] = [];
  const store = new InMemorySpendStore(options.spentMicroUsd ?? 0);
  let requested = 0;
  const service = new SellerService({
    getModel: () => {
      requested++;
      return model;
    },
    budget: new Budget(store),
    enabled: options.enabled ?? true,
    log: (line) => logs.push(line),
    ...(options.deadlineMs === undefined ? {} : { deadlineMs: options.deadlineMs }),
  });
  return { service, logs, store, modelRequested: () => requested };
}
