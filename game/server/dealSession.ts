import { z } from 'zod';
import { getPublicDeal } from '../shared/deals/index.ts';
import {
  MAX_ATTEMPTS_PER_CALL,
  MAX_MODEL_CALLS_PER_DEAL,
  MAX_QUESTIONS,
  MAX_QUESTION_CHARS,
  MAX_REFUNDS_PER_DEAL,
  SESSION_TTL_MS,
} from '../shared/limits.ts';
import {
  pitchRequestSchema,
  type ApiError,
  type PitchResponse,
  type QuestionResponse,
} from '../shared/sellerReply.ts';
import { Budget } from './budget.ts';
import { SellerService, type AnswerOutcome, type PitchOutcome, type SellerCallContext } from './callSeller.ts';
import type { Env } from './env.ts';
import { isAgentEnabled } from './env.ts';
import { OpenAISellerModel } from './openai.ts';
import { consoleLogger } from './log.ts';
import type { ConversationTurn } from './prompt.ts';
import { DurableSpendStore } from './spendLedger.ts';

/**
 * One conversation about one deal (CONFIGURATION.md A4): the pitch, and up to three
 * questions with their answers.
 *
 * The file has two layers on purpose:
 *  - `DealSession`: a plain class. All the rules live here (3-question cap, refunds,
 *    model-call ceiling, 200-char limit, "pitch only once", "closed is forever").
 *    It depends only on two small interfaces, so unit tests run it with an
 *    in-memory store and a stub model.
 *  - `DealSessionDO`: a thin Cloudflare Durable Object that plugs real storage and
 *    the real model into `DealSession` and routes HTTP-style calls to it.
 *
 * The client is never trusted: every limit is enforced here, on the server. The
 * client sends only a deal id; the deal and the persona come from the server's
 * registry (shared/deals), so nothing a client sends can reach the prompt.
 *
 * STORAGE LAYOUT (one Durable Object per deal id, two keys):
 *   'session' -> SessionState  the conversation (pitch + history). Deleted on close.
 *   'meta'    -> DealMeta      the deal's lifetime ledger and the "closed" tombstone.
 *                              NEVER deleted. This is what makes limits survive
 *                              `close`: before, close wiped everything, so a client
 *                              could close and start over with fresh counters.
 */

// ---------------------------------------------------------------------------
// Plain, testable layer
// ---------------------------------------------------------------------------

/** The conversation. Cleared on close. The deal and persona are NOT stored: they come from the registry. */
export interface SessionState {
  pitch: { text: string; source: 'model' | 'template' };
  questionsEnabled: boolean;
  history: ConversationTurn[];
}

/**
 * The deal's permanent ledger. It survives `close` so a client cannot reset its
 * limits by closing and re-opening. All counters are lifetime totals.
 */
export interface DealMeta {
  /** Tombstone: once true, pitch and question requests get 409 `deal-closed` forever. */
  closed: boolean;
  /** When the tombstone was written (ms since epoch); informational. */
  closedAt?: number;
  /** Pitches generated (a deal normally gets exactly one). */
  pitchesGenerated: number;
  /** Paid model attempts made (pitch tries + answer tries, retries included). Capped by MAX_MODEL_CALLS_PER_DEAL. */
  modelCalls: number;
  /** Questions accepted, INCLUDING ones later refunded. */
  questionsAccepted: number;
  /** Failed answers that were refunded. Capped by MAX_REFUNDS_PER_DEAL. */
  refundsUsed: number;
}

export const EMPTY_META: DealMeta = {
  closed: false,
  pitchesGenerated: 0,
  modelCalls: 0,
  questionsAccepted: 0,
  refundsUsed: 0,
};

/** Where the state is kept. A Durable Object's storage in production, variables in tests. */
export interface SessionStorage {
  load(): Promise<SessionState | undefined>;
  save(state: SessionState): Promise<void>;
  /** Deletes ONLY the conversation. The meta ledger is never deleted. */
  clearConversation(): Promise<void>;
  loadMeta(): Promise<DealMeta>;
  saveMeta(meta: DealMeta): Promise<void>;
}

/** The part of SellerService that DealSession needs (so tests can substitute it). */
export interface SellerPort {
  pitch(ctx: SellerCallContext): Promise<PitchOutcome>;
  answer(
    ctx: SellerCallContext,
    conversation: { pitch: string; history: ConversationTurn[]; question: string },
  ): Promise<AnswerOutcome>;
}

// invalid-run is checked by the Worker before a request reaches a session.
export type SessionErrorCode = Exclude<ApiError['error'], 'internal' | 'rate-limited' | 'invalid-run'>;
export type SessionResult<T> = { ok: true; value: T } | { ok: false; error: SessionErrorCode };

const rawQuestionSchema = z.strictObject({ question: z.string() });

/** Questions the player may still ask: the cap minus questions accepted and not refunded. */
function questionsLeft(meta: DealMeta): number {
  return Math.max(0, MAX_QUESTIONS - (meta.questionsAccepted - meta.refundsUsed));
}

export class DealSession {
  /** Tail of a queue that makes operations run strictly one after another. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly storage: SessionStorage,
    private readonly seller: SellerPort,
    /** Called once when a new conversation is created (the DO uses it to set an expiry alarm). */
    private readonly onCreated?: (ttlMs: number) => Promise<void>,
    /** Injectable clock for the tombstone timestamp. */
    private readonly now: () => number = Date.now,
  ) {}

  /**
   * Runs `task` only after every earlier task has finished. A model call takes
   * seconds, and while we wait for it other requests for the same deal can arrive
   * (a double-click, or a hostile script firing four questions at once). Without
   * this queue they could all read "0 questions used" before any of them wrote
   * "1", and slip past the cap.
   */
  private serialize<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(task);
    this.queue = run.catch(() => undefined);
    return run;
  }

  /**
   * Creates the conversation and writes the pitch. Calling it again for a deal that
   * already has a pitch returns the STORED pitch without calling the model, so a
   * client cannot re-roll pitches (or spend credit) by repeating the request.
   */
  startPitch(dealId: string, input: unknown): Promise<SessionResult<PitchResponse>> {
    return this.serialize(async () => {
      const entry = getPublicDeal(dealId);
      if (!entry) return { ok: false as const, error: 'unknown-deal' as const };
      const meta = await this.storage.loadMeta();
      if (meta.closed) return { ok: false as const, error: 'deal-closed' as const };
      // The body must be empty `{}`: the strict schema rejects any field a client tries to add.
      if (!pitchRequestSchema.safeParse(input).success) return { ok: false as const, error: 'invalid-request' as const };

      const existing = await this.storage.load();
      if (existing) return { ok: true as const, value: toPitchResponse(existing, meta) };

      // Reserve the worst-case model calls BEFORE the slow call and save them, so a
      // crash mid-call cannot hide spend from the lifetime ceiling. The unused part
      // is handed back afterwards.
      const remaining = MAX_MODEL_CALLS_PER_DEAL - meta.modelCalls;
      const reserved = Math.max(0, Math.min(MAX_ATTEMPTS_PER_CALL, remaining));
      meta.pitchesGenerated += 1;
      meta.modelCalls += reserved;
      await this.storage.saveMeta(meta);

      const outcome = await this.seller.pitch({ dealId, deal: entry.deal, persona: entry.persona, modelCallsRemaining: remaining });
      meta.modelCalls -= reserved - outcome.modelCalls;

      const state: SessionState = {
        pitch: { text: outcome.text, source: outcome.source },
        questionsEnabled: outcome.questionsEnabled,
        history: [],
      };
      await this.storage.save(state);
      await this.storage.saveMeta(meta);
      await this.onCreated?.(SESSION_TTL_MS);
      return { ok: true as const, value: toPitchResponse(state, meta) };
    });
  }

  /** Accepts one player question, enforcing the 3-question and 200-character limits. */
  ask(dealId: string, input: unknown): Promise<SessionResult<QuestionResponse>> {
    return this.serialize(async () => {
      const entry = getPublicDeal(dealId);
      if (!entry) return { ok: false as const, error: 'unknown-deal' as const };
      const meta = await this.storage.loadMeta();
      if (meta.closed) return { ok: false as const, error: 'deal-closed' as const };

      const body = rawQuestionSchema.safeParse(input);
      if (!body.success) return { ok: false as const, error: 'invalid-request' as const };
      const question = body.data.question.trim();
      if (question === '') return { ok: false as const, error: 'invalid-request' as const };
      if (question.length > MAX_QUESTION_CHARS) return { ok: false as const, error: 'question-too-long' as const };

      const state = await this.storage.load();
      if (!state) return { ok: false as const, error: 'no-pitch' as const };
      if (!state.questionsEnabled) return { ok: false as const, error: 'questions-disabled' as const };
      if (questionsLeft(meta) <= 0) return { ok: false as const, error: 'question-limit' as const };

      // Spend the question and reserve the worst-case model calls BEFORE the slow
      // model call, and save them, so a crash or a timeout mid-call cannot hand the
      // player a free question or hide spend from the ceiling.
      const remaining = MAX_MODEL_CALLS_PER_DEAL - meta.modelCalls;
      const reserved = Math.max(0, Math.min(MAX_ATTEMPTS_PER_CALL, remaining));
      meta.questionsAccepted += 1;
      meta.modelCalls += reserved;
      await this.storage.saveMeta(meta);

      const outcome = await this.seller.answer(
        { dealId, deal: entry.deal, persona: entry.persona, modelCallsRemaining: remaining },
        { pitch: state.pitch.text, history: state.history, question },
      );
      meta.modelCalls -= reserved - outcome.modelCalls;

      // REFUND: the player got the neutral line instead of a real answer, so the
      // question does not count against their 3, but only MAX_REFUNDS_PER_DEAL times
      // per deal (lifetime). Past that, a failed answer is charged like any other,
      // which stops a script from farming free questions (and model calls).
      const refunded = outcome.source === 'neutral' && meta.refundsUsed < MAX_REFUNDS_PER_DEAL;
      if (refunded) meta.refundsUsed += 1;

      // Even the neutral fallback line is remembered, because the player saw it.
      state.history = [...state.history, { question, answer: outcome.text }];
      await this.storage.save(state);
      await this.storage.saveMeta(meta);
      return {
        ok: true as const,
        value: { text: outcome.text, source: outcome.source, questionsRemaining: questionsLeft(meta), refunded },
      };
    });
  }

  /**
   * Closes the deal for good (A4: "cleared when the deal closes"). Deletes the
   * conversation but writes a permanent tombstone, and keeps every lifetime counter.
   * Closing twice is fine.
   */
  close(dealId: string): Promise<SessionResult<{ closed: true }>> {
    return this.serialize(async () => {
      if (!getPublicDeal(dealId)) return { ok: false as const, error: 'unknown-deal' as const };
      await this.tombstone();
      return { ok: true as const, value: { closed: true as const } };
    });
  }

  /** Called when the session's TTL alarm fires: an abandoned deal is closed the same way (tombstone included). */
  expire(): Promise<void> {
    return this.serialize(() => this.tombstone());
  }

  private async tombstone(): Promise<void> {
    const meta = await this.storage.loadMeta();
    if (!meta.closed) {
      meta.closed = true;
      meta.closedAt = this.now();
    }
    // Tombstone FIRST, conversation second: if we crash in between, the deal is
    // already closed and the leftover conversation is unreachable.
    await this.storage.saveMeta(meta);
    await this.storage.clearConversation();
  }
}

function toPitchResponse(state: SessionState, meta: DealMeta): PitchResponse {
  return {
    text: state.pitch.text,
    source: state.pitch.source,
    questionsEnabled: state.questionsEnabled,
    questionsRemaining: state.questionsEnabled ? questionsLeft(meta) : 0,
  };
}

// ---------------------------------------------------------------------------
// HTTP-style routing inside the Durable Object (also used directly by tests)
// ---------------------------------------------------------------------------

const STATUS_FOR: Record<SessionErrorCode, number> = {
  'invalid-request': 400,
  'question-too-long': 400,
  'unknown-deal': 404,
  'no-pitch': 404,
  'deal-closed': 409,
  'questions-disabled': 409,
  'question-limit': 429,
};

function errorResponse(error: SessionErrorCode): Response {
  const body: ApiError = { error };
  return Response.json(body, { status: STATUS_FOR[error] });
}

/**
 * Maps `POST /pitch`, `POST /questions` and `POST /close` onto a DealSession.
 * The Worker names the deal in the `dealId` query parameter (it has already looked
 * it up in the registry); the session checks it again, because it is the trust
 * boundary. Separate from the DO class so tests can call it without the Workers runtime.
 */
export async function handleSessionRequest(session: DealSession, request: Request): Promise<Response> {
  const url = new URL(request.url);
  const dealId = url.searchParams.get('dealId') ?? '';
  if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
  if (url.pathname === '/close') {
    const result = await session.close(dealId);
    return result.ok ? Response.json(result.value) : errorResponse(result.error);
  }
  if (url.pathname === '/pitch' || url.pathname === '/questions') {
    let body: unknown;
    try {
      // An empty body is allowed for the pitch (it means `{}`); for questions it fails the schema.
      const text = await request.text();
      body = text.trim() === '' ? {} : JSON.parse(text);
    } catch {
      return errorResponse('invalid-request');
    }
    const result = url.pathname === '/pitch' ? await session.startPitch(dealId, body) : await session.ask(dealId, body);
    return result.ok ? Response.json(result.value) : errorResponse(result.error);
  }
  return new Response('Not Found', { status: 404 });
}

// ---------------------------------------------------------------------------
// Cloudflare adapter (thin; UNTESTED against the real Workers runtime)
// ---------------------------------------------------------------------------

const STATE_KEY = 'session';
const META_KEY = 'meta';

class DurableSessionStorage implements SessionStorage {
  constructor(private readonly storage: DurableObjectStorage) {}
  load() {
    return this.storage.get<SessionState>(STATE_KEY);
  }
  async save(state: SessionState) {
    await this.storage.put(STATE_KEY, state);
  }
  async clearConversation() {
    // Deletes ONLY the conversation key. Never `deleteAll()`: that would erase the tombstone and the counters.
    await this.storage.delete(STATE_KEY);
  }
  async loadMeta() {
    return (await this.storage.get<DealMeta>(META_KEY)) ?? { ...EMPTY_META };
  }
  async saveMeta(meta: DealMeta) {
    await this.storage.put(META_KEY, meta);
  }
}

/** Wires the real budget, kill switch, logger and Vertex model into a SellerService. */
export function createSellerService(env: Env): SellerService {
  const ledger = env.SPEND_LEDGER.get(env.SPEND_LEDGER.idFromName('global'));
  return new SellerService({
    budget: new Budget(new DurableSpendStore(ledger)),
    enabled: isAgentEnabled(env),
    log: consoleLogger,
    // Built only when a call is actually allowed, so a disabled agent needs no credentials.
    getModel: () => {
      // No key = a configuration error, surfaced as a failed call (logged, the client
      // shows the seller as unreachable). Never a made-up reply.
      if (!env.OPENAI_API_KEY_2) throw new Error('OPENAI_API_KEY_2 must be set');
      return new OpenAISellerModel({ apiKey: env.OPENAI_API_KEY_2 });
    },
  });
}

/** One instance of this class exists per (run, deal) pair (the Worker uses `idFromName(`${runId}:${dealId}`)`). */
export class DealSessionDO implements DurableObject {
  private readonly session: DealSession;

  constructor(
    state: DurableObjectState,
    env: Env,
  ) {
    this.session = new DealSession(new DurableSessionStorage(state.storage), createSellerService(env), (ttlMs) =>
      state.storage.setAlarm(Date.now() + ttlMs),
    );
  }

  fetch(request: Request): Promise<Response> {
    return handleSessionRequest(this.session, request);
  }

  /** Fires after SESSION_TTL_MS: closes (tombstones) a conversation the client never closed. */
  async alarm(): Promise<void> {
    await this.session.expire();
  }
}
