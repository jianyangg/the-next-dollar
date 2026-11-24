import type { PublicDealView, SellerPersona } from '../shared/deals/index.ts';
import {
  ANSWER_INPUT_TOKEN_CEILING,
  CALL_DEADLINE_MS,
  CONFIG_VERSION,
  OUTPUT_TOKEN_CEILING,
  PITCH_INPUT_TOKEN_CEILING,
  MAX_ATTEMPTS_PER_CALL,
  PROMPT_VERSION,
  RETRY_MIN_REMAINING_MS,
} from '../shared/limits.ts';
import type { Budget } from './budget.ts';
import { estimateCostUsd } from './budget.ts';
import type { SellerModel } from './gemini.ts';
import type { Logger, SellerCallLog } from './log.ts';
import { buildSellerPrompt, type ConversationTurn } from './prompt.ts';
import { NEUTRAL_ANSWER, buildTemplatePitch } from './template.ts';
import { validateSellerReply } from './validator.ts';

/**
 * Orchestrates one seller call (a pitch or one answer):
 *
 *   gate (kill switch, spend cap) -> build prompt -> call model -> validate
 *     -> if rejected and time remains, ONE silent retry
 *     -> if still no good reply, fall back (template pitch / neutral answer)
 *
 * The whole call, retry included, must finish inside one 6-second deadline
 * (CONFIGURATION.md A9). A single AbortController enforces it across attempts.
 *
 * This file returns `source` so the UI can tell the player honestly whether they
 * are reading the AI seller or a scripted fallback.
 */

export interface SellerCallContext {
  dealId: string;
  deal: PublicDealView;
  persona: SellerPersona;
  /**
   * How many more paid model attempts this deal may make, over its whole lifetime
   * (MAX_MODEL_CALLS_PER_DEAL minus what it already used). The caller owns the
   * counter; this service only obeys it: at 0 the model is not called at all, at 1
   * the silent retry is skipped.
   */
  modelCallsRemaining: number;
}

/** `modelCalls` = how many model attempts this call actually made (0, 1 or 2), for the caller's lifetime counter. */
export type PitchOutcome =
  | { source: 'model'; text: string; questionsEnabled: true; modelCalls: number }
  /** Template: the AI was off, over budget, or failed. Questions are disabled. */
  | { source: 'template'; text: string; questionsEnabled: false; modelCalls: number };

export type AnswerOutcome = { source: 'model' | 'neutral'; text: string; modelCalls: number };

export interface SellerServiceDeps {
  /** Called lazily, only after the gate passes, so a disabled agent needs no credentials. */
  getModel: () => SellerModel;
  budget: Budget;
  /** The kill switch, already resolved from the env (see isAgentEnabled). */
  enabled: boolean;
  log: Logger;
  /** Injectable clock for latency measurement; defaults to Date.now (fake-timer friendly). */
  now?: () => number;
  /** Overridable for tests; defaults to CALL_DEADLINE_MS. */
  deadlineMs?: number;
}

/** Internal marker for "the 6-second deadline fired", to tell it apart from a model error. */
class DeadlineExceeded extends Error {}

export class SellerService {
  private readonly now: () => number;
  private readonly deadlineMs: number;

  constructor(private readonly deps: SellerServiceDeps) {
    this.now = deps.now ?? Date.now;
    this.deadlineMs = deps.deadlineMs ?? CALL_DEADLINE_MS;
  }

  async pitch(ctx: SellerCallContext): Promise<PitchOutcome> {
    const template = (modelCalls: number): PitchOutcome => ({
      source: 'template',
      text: buildTemplatePitch(ctx.deal, ctx.persona),
      questionsEnabled: false,
      modelCalls,
    });

    const skip = await this.gate(ctx);
    if (skip) {
      this.logSkipped(ctx, 'pitch', skip, 'template');
      return template(0);
    }

    const prompt = buildSellerPrompt({ deal: ctx.deal, persona: ctx.persona });
    const result = await this.callWithRetry(ctx, 'pitch', prompt, PITCH_INPUT_TOKEN_CEILING, 'template');
    return result.text === null
      ? template(result.calls)
      : { source: 'model', text: result.text, questionsEnabled: true, modelCalls: result.calls };
  }

  async answer(
    ctx: SellerCallContext,
    conversation: { pitch: string; history: ConversationTurn[]; question: string },
  ): Promise<AnswerOutcome> {
    const neutral = (modelCalls: number): AnswerOutcome => ({ source: 'neutral', text: NEUTRAL_ANSWER, modelCalls });

    const skip = await this.gate(ctx);
    if (skip) {
      this.logSkipped(ctx, 'answer', skip, 'neutral');
      return neutral(0);
    }

    const prompt = buildSellerPrompt({
      deal: ctx.deal,
      persona: ctx.persona,
      pitch: conversation.pitch,
      history: conversation.history,
      question: conversation.question,
    });
    const result = await this.callWithRetry(ctx, 'answer', prompt, ANSWER_INPUT_TOKEN_CEILING, 'neutral');
    return result.text === null ? neutral(result.calls) : { source: 'model', text: result.text, modelCalls: result.calls };
  }

  /** Returns why the model must not be called, or null if it may be. */
  private async gate(ctx: SellerCallContext): Promise<'agent-disabled' | 'spend-cap-reached' | 'model-call-ceiling' | null> {
    if (!this.deps.enabled) return 'agent-disabled';
    // Per-deal ceiling (MAX_MODEL_CALLS_PER_DEAL): checked before the budget read so a
    // deal that is out of calls costs nothing, not even a ledger round trip.
    if (ctx.modelCallsRemaining <= 0) return 'model-call-ceiling';
    try {
      if (await this.deps.budget.isExhausted()) return 'spend-cap-reached';
    } catch (error) {
      // Fail CLOSED: if we cannot read the tally we cannot prove we are under the
      // cap, and the safe direction for spending money is to not spend.
      console.error('budget check failed; treating the cap as reached', error);
      return 'spend-cap-reached';
    }
    return null;
  }

  private logSkipped(
    ctx: SellerCallContext,
    kind: 'pitch' | 'answer',
    reason: 'agent-disabled' | 'spend-cap-reached' | 'model-call-ceiling',
    fallbackUsed: 'template' | 'neutral',
  ): void {
    this.deps.log({
      event: 'seller_skipped',
      dealId: ctx.dealId,
      configVersion: CONFIG_VERSION,
      promptVersion: PROMPT_VERSION,
      kind,
      reason,
      fallbackUsed,
    });
  }

  /**
   * Up to two attempts inside one deadline (fewer if the deal's call ceiling is close).
   * Returns the accepted text, or null if every attempt failed (the caller then
   * substitutes its fallback), plus how many model attempts were made.
   */
  private async callWithRetry(
    ctx: SellerCallContext,
    kind: 'pitch' | 'answer',
    prompt: { system: string; user: string },
    inputCeiling: number,
    fallback: 'template' | 'neutral',
  ): Promise<{ text: string | null; calls: number }> {
    let model: SellerModel;
    try {
      model = this.deps.getModel();
    } catch (error) {
      // Misconfiguration (e.g. missing Vertex project). Log loudly, then use the
      // fallback so the player is not stuck; the operator sees the error in logs.
      console.error('could not create the seller model', error);
      return { text: null, calls: 0 };
    }
    const startedAt = this.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.deadlineMs);

    // Resolves never, rejects when the deadline fires. Racing against it means a
    // model client that ignores the abort signal still cannot hold us past 6 s.
    const deadline = new Promise<never>((_, reject) => {
      controller.signal.addEventListener('abort', () => reject(new DeadlineExceeded()), { once: true });
    });
    deadline.catch(() => {}); // avoid an "unhandled rejection" if nobody is racing at that moment

    const attempts: SellerCallLog[] = [];
    let accepted: string | null = null;

    try {
      const maxAttempts = Math.min(MAX_ATTEMPTS_PER_CALL, ctx.modelCallsRemaining);
      for (let attempt = 1; attempt <= maxAttempts && accepted === null; attempt++) {
        const remaining = this.deadlineMs - (this.now() - startedAt);
        // The retry is only worth starting if a useful amount of time is left.
        if (attempt === 2 && remaining < RETRY_MIN_REMAINING_MS) break;
        if (controller.signal.aborted) break;

        const entry = await this.oneAttempt(ctx, kind, attempt, prompt, model, controller.signal, deadline, inputCeiling);
        attempts.push(entry.log);
        if (entry.accepted !== null) accepted = entry.accepted;
        if (entry.log.verdict === 'timeout') break; // deadline is spent; no retry possible
      }
    } finally {
      clearTimeout(timer);
    }

    // The fallback is known only now, so it is stamped on the final attempt's line.
    const last = attempts[attempts.length - 1];
    if (last && accepted === null) last.fallbackUsed = fallback;
    for (const line of attempts) this.deps.log(line);

    return { text: accepted, calls: attempts.length };
  }

  private async oneAttempt(
    ctx: SellerCallContext,
    kind: 'pitch' | 'answer',
    attempt: number,
    prompt: { system: string; user: string },
    model: SellerModel,
    signal: AbortSignal,
    deadline: Promise<never>,
    inputCeiling: number,
  ): Promise<{ log: SellerCallLog; accepted: string | null }> {
    const t0 = this.now();
    const base = {
      event: 'seller_call' as const,
      dealId: ctx.dealId,
      configVersion: CONFIG_VERSION,
      promptVersion: PROMPT_VERSION,
      kind,
      attempt,
      sent: prompt,
      fallbackUsed: 'none' as const,
    };

    let output: Awaited<ReturnType<SellerModel['generate']>>;
    try {
      output = await Promise.race([model.generate({ ...prompt, signal }), deadline]);
    } catch (error) {
      if (error instanceof DeadlineExceeded) {
        // An aborted request may still be billed (the SDK says so), and we cannot
        // see its token counts, so charge the documented worst case to stay safe.
        const costUsd = await this.charge(inputCeiling, OUTPUT_TOKEN_CEILING);
        return {
          accepted: null,
          log: { ...base, rawReply: null, verdict: 'timeout', reason: 'deadline', latencyMs: this.now() - t0, inputTokens: null, outputTokens: null, costUsd },
        };
      }
      // A thrown error (network, auth, quota) is assumed unbilled.
      return {
        accepted: null,
        log: { ...base, rawReply: null, verdict: 'error', reason: error instanceof Error ? error.message : String(error), latencyMs: this.now() - t0, inputTokens: null, outputTokens: null, costUsd: 0 },
      };
    }

    const costUsd = await this.charge(output.inputTokens, output.outputTokens);
    const verdict = validateSellerReply(output.rawText, ctx.deal, kind);
    return {
      accepted: verdict.ok ? verdict.text : null,
      log: {
        ...base,
        rawReply: output.rawText,
        verdict: verdict.ok ? 'accepted' : 'rejected',
        reason: verdict.ok ? null : verdict.detail ? `${verdict.reason}: ${verdict.detail}` : verdict.reason,
        latencyMs: this.now() - t0,
        inputTokens: output.inputTokens,
        outputTokens: output.outputTokens,
        costUsd,
      },
    };
  }

  /** Adds a call's cost to the tally. A ledger failure must not lose a reply we already paid for. */
  private async charge(inputTokens: number, outputTokens: number): Promise<number> {
    try {
      return await this.deps.budget.record(inputTokens, outputTokens);
    } catch (error) {
      console.error('failed to record spend', error);
      return estimateCostUsd(inputTokens, outputTokens);
    }
  }
}
