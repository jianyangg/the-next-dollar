/**
 * Limits and versions for the seller agent, shared by the browser and the Worker.
 * Every value is copied from docs/CONFIGURATION.md (Part A); the section is noted
 * beside each one so a reviewer can check the number against its source.
 *
 * This file must stay free of DOM and Workers globals and of heavy imports,
 * because the browser bundle imports it too.
 */

/** A5/A6: the player may ask at most three questions per deal. */
export const MAX_QUESTIONS = 3;
/** A7.5: each question is at most 200 characters. */
export const MAX_QUESTION_CHARS = 200;
/** A7.1: a pitch or answer is at most 80 words. */
export const MAX_REPLY_WORDS = 80;
/** A9: hard deadline for one pitch or one answer, across all attempts. */
export const CALL_DEADLINE_MS = 6000;
/**
 * A7 says "one silent retry if within the 6-second budget" but not how much time
 * must be left. 1.5 s is OUR choice: the midterm's average call took 3.5 s, so a
 * retry started with less than this left would almost surely be cut off anyway
 * and would only add cost. Not from the document; flagged in the Phase 5 report.
 */
export const RETRY_MIN_REMAINING_MS = 1500;
/** A9: spending cap for the final's seller agent, in US dollars. */
export const SPEND_CAP_USD = 5;

/** A13 versions, logged with every call so results can be traced to a setup. */
export const PROMPT_VERSION = 'seller-prompt-v1';
export const CONFIG_VERSION = 'seller-config-v1';

/**
 * A5 model settings.
 *
 * OPEN: the document names the model "Gemini 3.8 Flash". Vertex model ids are
 * lower-case slugs; 'gemini-3.8-flash' is our best reading of that name and has
 * NOT been checked against Vertex's model list. Verify before the first live call.
 */
/**
 * The seller's model. Owner decision (2026-11-24): OpenAI gpt-6-luna "for now", in place
 * of Gemini on Vertex, whose sign-in from a Cloudflare Worker was never proven.
 * Checked on 2026-11-24 with one live call: the model exists, accepts Chat Completions
 * with reasoning_effort and response_format json_object, and returns usage counts.
 */
export const MODEL_CONFIG = {
  provider: 'openai',
  model: 'gpt-6-luna',
  /** A5 "Thinking: low", sent as Chat Completions `reasoning_effort`. */
  reasoningEffort: 'low',
  /** A5: about 80 words of text plus reasoning. Reasoning tokens count against this cap. */
  maxOutputTokens: 400,
} as const;

/**
 * A9 prices for MODEL_CONFIG.model, used for the $5 running cost tally. OpenAI's listed
 * standard price for gpt-6-luna (https://developers.openai.com/api/docs/pricing, read
 * 2026-11-24): $0.10 per 1M input tokens, $0.50 per 1M output tokens (reasoning tokens
 * are billed as output and are included in the output count). Estimates, not billing
 * records. Change these together with MODEL_CONFIG.model, never separately.
 */
export const PRICE_USD_PER_MILLION_INPUT_TOKENS = 0.1;
export const PRICE_USD_PER_MILLION_OUTPUT_TOKENS = 0.5;

/**
 * A9 token ceilings. Used only to charge the budget for a call that timed out:
 * the Gemini SDK warns that aborting a request client-side does NOT stop the
 * service, so an aborted call is still billed and we cannot see its token counts.
 */
export const PITCH_INPUT_TOKEN_CEILING = 2000;
export const ANSWER_INPUT_TOKEN_CEILING = 3000;
export const OUTPUT_TOKEN_CEILING = 400;

/**
 * How long an unfinished deal conversation is kept if the client never calls
 * `close` (tab closed, crash). Our choice: A4 only says "cleared when the deal
 * closes". 24 hours keeps abandoned conversations from living forever.
 */
export const SESSION_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Attempts per seller call: one try plus one silent retry (A7). The model-call
 * ceiling below is derived from it, so change them together.
 */
export const MAX_ATTEMPTS_PER_CALL = 2;

/**
 * REFUND POLICY (product decision). When the seller's answer fails the validator or
 * the 6-second budget and the player only sees the neutral line, that question does
 * NOT count toward the 3-question limit: the seller "didn't answer", so the player
 * may ask again.
 *
 * ABUSE CEILING: a player (or a script) could otherwise keep provoking failures to
 * get unlimited free questions and unlimited model calls. So at most this many
 * refunds are granted per deal, for the deal's whole lifetime (closing does not
 * reset it). After that a failed answer counts as a normal question.
 * TUNABLE: raise it if real play shows honest players hitting failures often; each
 * extra refund adds up to MAX_ATTEMPTS_PER_CALL paid model calls.
 */
export const MAX_REFUNDS_PER_DEAL = 3;

/**
 * Hard ceiling on paid model attempts for one deal, for its whole lifetime:
 *   pitch attempts + (questions + refunds) x attempts per answer
 *   = 2 + (3 + 3) x 2 = 14.
 * That is the most an honest-but-unlucky player can ever use, so the ceiling never
 * bites in normal play. Once it is reached, answers return the neutral line
 * WITHOUT calling the model (the spend cap still applies on top of this).
 */
export const MAX_MODEL_CALLS_PER_DEAL = MAX_ATTEMPTS_PER_CALL + (MAX_QUESTIONS + MAX_REFUNDS_PER_DEAL) * MAX_ATTEMPTS_PER_CALL;
