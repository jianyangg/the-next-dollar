import { z } from 'zod';
import { MAX_QUESTION_CHARS } from './limits.ts';
import { publicDealViewSchema, sellerPersonaSchema } from './dealSchema.ts';

/**
 * What the model must return (CONFIGURATION.md A5): JSON `{ "text": string }`.
 * Extra keys are ignored rather than rejected: we only ever show `text`, so an
 * extra key cannot reach the player.
 */
export const sellerReplySchema = z.object({ text: z.string() });

// ---------------------------------------------------------------------------
// HTTP contract between the browser and the Worker.
// ---------------------------------------------------------------------------

/** POST /api/deals/:dealId/pitch */
export const pitchRequestSchema = z.strictObject({
  deal: publicDealViewSchema,
  persona: sellerPersonaSchema,
});
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

/** POST /api/deals/:dealId/questions */
export const questionRequestSchema = z.strictObject({
  question: z.string().trim().min(1).max(MAX_QUESTION_CHARS),
});
export type QuestionRequest = z.infer<typeof questionRequestSchema>;

export const questionResponseSchema = z.strictObject({
  text: z.string(),
  source: z.enum(['model', 'neutral']),
  questionsRemaining: z.number().int().min(0),
});
export type QuestionResponse = z.infer<typeof questionResponseSchema>;

/** Every non-200 response body. `error` is a stable machine code for the UI. */
export const apiErrorSchema = z.strictObject({
  error: z.enum([
    'invalid-request',
    'deal-id-mismatch',
    'no-pitch',
    'questions-disabled',
    'question-limit',
    'question-too-long',
    'internal',
  ]),
  message: z.string().optional(),
});
export type ApiError = z.infer<typeof apiErrorSchema>;
