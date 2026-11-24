import { CENTRAL_PARK_DEAL, toPublicView } from '../src/core/deal.ts';
import { sellerPersonaSchema, type SellerPersona } from '../shared/dealSchema.ts';
import { sellerReplySchema } from '../shared/sellerReply.ts';
import { Budget, InMemorySpendStore } from './budget.ts';
import { SellerService } from './callSeller.ts';
import type { SessionState, SessionStorage } from './dealSession.ts';
import type { SellerModel } from './gemini.ts';
import type { SellerLogLine } from './log.ts';

/**
 * Shared helpers for the server tests. This file is NOT a test and is never
 * imported by the Worker, so none of it ships. Everything here is offline: the only
 * model is a stub, so no test can spend money.
 */

/** The deal exactly as the server sees it: the hidden minimum already stripped. */
export const PUBLIC_DEAL = toPublicView(CENTRAL_PARK_DEAL);
export const HIDDEN_MINIMUM = CENTRAL_PARK_DEAL.reservationPrice; // 42; must never reach a prompt

export const PERSONA: SellerPersona = sellerPersonaSchema.parse({
  name: 'Miles',
  location: 'Park Corner',
  manner: 'warm and chatty',
});

export const CTX = { dealId: PUBLIC_DEAL.id, deal: PUBLIC_DEAL, persona: PERSONA };

/** A reply the validator accepts as a PITCH for the Central Park deal. */
export const GOOD_PITCH = 'Park Corner stand, asking $60. Sales climbed from $14 to $16 a day and profit reached $8 a day.';
/** A reply the validator accepts as an ANSWER about the lease (all figures are off-book facts). */
export const GOOD_LEASE_ANSWER = 'The lease renews in 4 days, and rent goes from $3 to $5 a day.';

/** Wraps text the way the real model must answer: JSON `{ "text": ... }`. */
export const json = (text: string): string => JSON.stringify(sellerReplySchema.parse({ text }));

export function memoryStorage(): SessionStorage & { snapshot(): SessionState | undefined } {
  let state: SessionState | undefined;
  return {
    load: async () => (state ? structuredClone(state) : undefined),
    save: async (s) => {
      state = structuredClone(s);
    },
    clear: async () => {
      state = undefined;
    },
    snapshot: () => state,
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
