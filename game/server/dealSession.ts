import { z } from 'zod';
import type { PublicDealData, SellerPersona } from '../shared/dealSchema.ts';
import { MAX_QUESTIONS, MAX_QUESTION_CHARS, SESSION_TTL_MS } from '../shared/limits.ts';
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
import { VertexSellerModel } from './gemini.ts';
import { consoleLogger } from './log.ts';
import type { ConversationTurn } from './prompt.ts';
import { DurableSpendStore } from './spendLedger.ts';

/**
 * One conversation about one deal (CONFIGURATION.md A4): the public deal, the
 * pitch, and up to three questions with their answers. It is cleared on `close`.
 *
 * The file has two layers on purpose:
 *  - `DealSession`: a plain class. All the rules live here (3-question cap,
 *    200-char limit, "pitch only once"). It depends only on two small interfaces,
 *    so unit tests run it with an in-memory store and a stub model.
 *  - `DealSessionDO`: a thin Cloudflare Durable Object that plugs real storage and
 *    the real model into `DealSession` and routes HTTP-style calls to it.
 *
 * The client is never trusted: every limit is enforced here, on the server.
 */

// ---------------------------------------------------------------------------
// Plain, testable layer
// ---------------------------------------------------------------------------

/** What is remembered about one deal. Contains the PUBLIC deal only. */
export interface SessionState {
  deal: PublicDealData;
  persona: SellerPersona;
  pitch: { text: string; source: 'model' | 'template' };
  questionsEnabled: boolean;
  /** Questions that have been accepted, including ones answered with the neutral line. */
  questionsUsed: number;
  history: ConversationTurn[];
}

/** Where the state is kept. A Durable Object's storage in production, a variable in tests. */
export interface SessionStorage {
  load(): Promise<SessionState | undefined>;
  save(state: SessionState): Promise<void>;
  clear(): Promise<void>;
}

/** The part of SellerService that DealSession needs (so tests can substitute it). */
export interface SellerPort {
  pitch(ctx: SellerCallContext): Promise<PitchOutcome>;
  answer(
    ctx: SellerCallContext,
    conversation: { pitch: string; history: ConversationTurn[]; question: string },
  ): Promise<AnswerOutcome>;
}

export type SessionErrorCode = Exclude<ApiError['error'], 'deal-id-mismatch' | 'internal'>;
export type SessionResult<T> = { ok: true; value: T } | { ok: false; error: SessionErrorCode };

const rawQuestionSchema = z.strictObject({ question: z.string() });

export class DealSession {
  /** Tail of a queue that makes operations run strictly one after another. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly storage: SessionStorage,
    private readonly seller: SellerPort,
    /** Called once when a new conversation is created (the DO uses it to set an expiry alarm). */
    private readonly onCreated?: (ttlMs: number) => Promise<void>,
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
  startPitch(input: unknown): Promise<SessionResult<PitchResponse>> {
    return this.serialize(async () => {
      const existing = await this.storage.load();
      if (existing) return { ok: true as const, value: toPitchResponse(existing) };

      // Validate here as well as in the route: this class is the trust boundary
      // for what gets stored, whoever calls it. The strict schema rejects a
      // reservationPrice (or any unknown key) outright.
      const parsed = pitchRequestSchema.safeParse(input);
      if (!parsed.success) return { ok: false as const, error: 'invalid-request' as const };
      const { deal, persona } = parsed.data;

      const outcome = await this.seller.pitch({ dealId: deal.id, deal, persona });
      const state: SessionState = {
        deal,
        persona,
        pitch: { text: outcome.text, source: outcome.source },
        questionsEnabled: outcome.questionsEnabled,
        questionsUsed: 0,
        history: [],
      };
      await this.storage.save(state);
      await this.onCreated?.(SESSION_TTL_MS);
      return { ok: true as const, value: toPitchResponse(state) };
    });
  }

  /** Accepts one player question, enforcing the 3-question and 200-character limits. */
  ask(input: unknown): Promise<SessionResult<QuestionResponse>> {
    return this.serialize(async () => {
      const body = rawQuestionSchema.safeParse(input);
      if (!body.success) return { ok: false as const, error: 'invalid-request' as const };
      const question = body.data.question.trim();
      if (question === '') return { ok: false as const, error: 'invalid-request' as const };
      if (question.length > MAX_QUESTION_CHARS) return { ok: false as const, error: 'question-too-long' as const };

      const state = await this.storage.load();
      if (!state) return { ok: false as const, error: 'no-pitch' as const };
      if (!state.questionsEnabled) return { ok: false as const, error: 'questions-disabled' as const };
      if (state.questionsUsed >= MAX_QUESTIONS) return { ok: false as const, error: 'question-limit' as const };

      // Spend the question BEFORE the slow model call and save it, so a crash or a
      // timeout mid-call cannot hand the player a free extra question.
      state.questionsUsed += 1;
      await this.storage.save(state);

      const outcome = await this.seller.answer(
        { dealId: state.deal.id, deal: state.deal, persona: state.persona },
        { pitch: state.pitch.text, history: state.history, question },
      );

      // Even the neutral fallback line is remembered, because the player saw it.
      state.history = [...state.history, { question, answer: outcome.text }];
      await this.storage.save(state);

      return {
        ok: true as const,
        value: { text: outcome.text, source: outcome.source, questionsRemaining: MAX_QUESTIONS - state.questionsUsed },
      };
    });
  }

  /** Forgets everything about this deal (A4: "cleared when the deal closes"). */
  close(): Promise<void> {
    return this.serialize(() => this.storage.clear());
  }
}

function toPitchResponse(state: SessionState): PitchResponse {
  return {
    text: state.pitch.text,
    source: state.pitch.source,
    questionsEnabled: state.questionsEnabled,
    questionsRemaining: state.questionsEnabled ? MAX_QUESTIONS - state.questionsUsed : 0,
  };
}

// ---------------------------------------------------------------------------
// HTTP-style routing inside the Durable Object (also used directly by tests)
// ---------------------------------------------------------------------------

const STATUS_FOR: Record<SessionErrorCode, number> = {
  'invalid-request': 400,
  'question-too-long': 400,
  'no-pitch': 404,
  'questions-disabled': 409,
  'question-limit': 429,
};

function errorResponse(error: SessionErrorCode): Response {
  const body: ApiError = { error };
  return Response.json(body, { status: STATUS_FOR[error] });
}

/**
 * Maps `POST /pitch`, `POST /questions` and `POST /close` onto a DealSession.
 * Separate from the DO class so tests can call it without the Workers runtime.
 */
export async function handleSessionRequest(session: DealSession, request: Request): Promise<Response> {
  const path = new URL(request.url).pathname;
  if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });

  if (path === '/close') {
    await session.close();
    return Response.json({ closed: true });
  }

  if (path === '/pitch' || path === '/questions') {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return errorResponse('invalid-request');
    }
    const result = path === '/pitch' ? await session.startPitch(body) : await session.ask(body);
    return result.ok ? Response.json(result.value) : errorResponse(result.error);
  }

  return new Response('Not Found', { status: 404 });
}

// ---------------------------------------------------------------------------
// Cloudflare adapter (thin; UNTESTED against the real Workers runtime)
// ---------------------------------------------------------------------------

const STATE_KEY = 'session';

class DurableSessionStorage implements SessionStorage {
  constructor(private readonly storage: DurableObjectStorage) {}
  load() {
    return this.storage.get<SessionState>(STATE_KEY);
  }
  async save(state: SessionState) {
    await this.storage.put(STATE_KEY, state);
  }
  async clear() {
    await this.storage.deleteAll();
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
      if (!env.GOOGLE_VERTEX_PROJECT || !env.GOOGLE_VERTEX_LOCATION) {
        throw new Error('GOOGLE_VERTEX_PROJECT and GOOGLE_VERTEX_LOCATION must be set');
      }
      return new VertexSellerModel({
        project: env.GOOGLE_VERTEX_PROJECT,
        location: env.GOOGLE_VERTEX_LOCATION,
        ...(env.GOOGLE_VERTEX_API_KEY ? { apiKey: env.GOOGLE_VERTEX_API_KEY } : {}),
      });
    },
  });
}

/** One instance of this class exists per deal id (the Worker uses `idFromName(dealId)`). */
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

  /** Fires after SESSION_TTL_MS: drops a conversation the client never closed. */
  async alarm(): Promise<void> {
    await this.session.close();
  }
}
