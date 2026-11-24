import { z } from 'zod';
import { MAX_QUESTION_CHARS } from './limits.ts';

/**
 * What the model must return (CONFIGURATION.md A5): JSON `{ "text": string }`.
 * Extra keys are ignored rather than rejected: we only ever show `text`, so an
 * extra key cannot reach the player.
 */
export const sellerReplySchema = z.object({ text: z.string() });

// ---------------------------------------------------------------------------
// HTTP contract between the browser and the Worker.
//
// The client names a deal ONLY by the dealId in the URL. The deal's books, facts and
// the seller's persona are owned by the server (shared/deals registry), so there is
// nothing for a client to forge.
// ---------------------------------------------------------------------------

/**
 * POST /api/runs/:runId/deals/:dealId/pitch. The body must be empty or `{}`. Any field at all
 * (a persona, a deal, a price) is rejected with 400 rather than silently ignored,
 * so a tampered client gets a loud failure instead of a quiet no-op.
 */
export const pitchRequestSchema = z.strictObject({});
export type PitchRequest = z.infer<typeof pitchRequestSchema>;

/**
 * `source` says where the visible text came from, so the UI can be honest:
 * - model:    written by the AI seller and passed every check
 * - template: the scripted baseline pitch (AI off, over budget, or it failed)
 * - neutral:  (answers only) a fixed safe line standing in for a failed answer
 */
export const pitchResponseSchema = z.strictObject({
  text: z.string(),
  source: z.enum(['model', 'template']),
  /** False when the player cannot ask questions for this deal (template pitch). */
  questionsEnabled: z.boolean(),
  questionsRemaining: z.number().int().min(0),
});
export type PitchResponse = z.infer<typeof pitchResponseSchema>;

/** POST /api/runs/:runId/deals/:dealId/questions */
export const questionRequestSchema = z.strictObject({
  question: z.string().trim().min(1).max(MAX_QUESTION_CHARS),
});
export type QuestionRequest = z.infer<typeof questionRequestSchema>;

export const questionResponseSchema = z.strictObject({
  text: z.string(),
  source: z.enum(['model', 'neutral']),
  questionsRemaining: z.number().int().min(0),
  /**
   * True when this answer failed, the player got the neutral line, and the question
   * was NOT charged against the 3-question limit (at most MAX_REFUNDS_PER_DEAL times
   * per deal). The UI should say the seller didn't answer. Always false for
   * `source: 'model'`; a `neutral` answer with `refunded: false` means the refund
   * allowance is used up and the question counted.
   */
  refunded: z.boolean(),
});
export type QuestionResponse = z.infer<typeof questionResponseSchema>;

/** Every non-200 response body. `error` is a stable machine code for the UI. */
export const apiErrorSchema = z.strictObject({
  error: z.enum([
    'invalid-request',
    /** 400: the run id in the URL is not a UUID v4. */
    'invalid-run',
    /** 404: the deal id is not in the server's registry. */
    'unknown-deal',
    /** 404: a question was sent before the pitch. */
    'no-pitch',
    /** 409: the deal was closed; it can never be reopened. */
    'deal-closed',
    'questions-disabled',
    'question-limit',
    'question-too-long',
    /** 429: too many requests from this IP (only when the rate-limit binding is configured). */
    'rate-limited',
    'internal',
  ]),
  message: z.string().optional(),
});
export type ApiError = z.infer<typeof apiErrorSchema>;
