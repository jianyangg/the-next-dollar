import { GoogleGenAI, ThinkingLevel } from '@google/genai';
/**
 * Gemini settings, kept with the (currently unused) Vertex client so switching back is
 * one change. NOT the active model: see MODEL_CONFIG in shared/limits.ts. If this is
 * re-enabled, the A9 prices there must be switched back to Gemini's too.
 */
const GEMINI_MODEL_CONFIG = {
  model: 'gemini-3.8-flash',
  temperature: 1.0,
  maxOutputTokens: 400,
} as const;

/**
 * The seam between our code and a language model. Everything else in server/ talks
 * to `SellerModel`, never to the Google SDK, so tests use `StubSellerModel` and no
 * test can ever spend money.
 */
export interface SellerModel {
  generate(input: {
    system: string;
    user: string;
    /** Aborted when the 6-second deadline passes. Implementations must honour it. */
    signal: AbortSignal;
  }): Promise<{ rawText: string; inputTokens: number; outputTokens: number }>;
}

// ---------------------------------------------------------------------------
// Real implementation (UNTESTED LIVE)
// ---------------------------------------------------------------------------

export interface VertexConfig {
  project: string;
  location: string;
  /**
   * Optional. If set, the SDK is given an API key (Vertex "express mode"), which
   * is the only credential style that obviously works without Node-only code.
   */
  apiKey?: string;
}

/**
 * !!! OPEN QUESTION — MUST BE VERIFIED BY A SPIKE BEFORE USE !!!
 * (docs/CONFIGURATION.md, Open question 4: "Calling Vertex AI from a Cloudflare
 * Worker has not been tried.")
 *
 * What the installed @google/genai typings say, so the spike knows where to start:
 *  - Workers are resolved to the SDK's "web" build (the "browser" export condition).
 *    The typings document `project`, `location` and `googleAuthOptions` as
 *    "only supported on Node runtimes, ignored on browser runtimes". So on a Worker
 *    the project and location below may be silently ignored, and service-account
 *    sign-in (google-auth-library) may not run at all.
 *  - Options to try in the spike: (a) Vertex express mode with an API key,
 *    (b) the SDK's node entry with `nodejs_compat`, (c) minting an OAuth token from
 *    a service-account key ourselves and calling the Vertex REST endpoint with
 *    fetch, bypassing the SDK.
 *  - The model id in GEMINI_MODEL_CONFIG is also unverified.
 *
 * This class was written to the typings and has NEVER made a live call.
 */
export class VertexSellerModel implements SellerModel {
  private readonly client: GoogleGenAI;

  constructor(config: VertexConfig) {
    this.client = new GoogleGenAI({
      vertexai: true,
      project: config.project,
      location: config.location,
      ...(config.apiKey ? { apiKey: config.apiKey } : {}),
    });
  }

  async generate(input: { system: string; user: string; signal: AbortSignal }) {
    const response = await this.client.models.generateContent({
      model: GEMINI_MODEL_CONFIG.model,
      contents: input.user,
      config: {
        systemInstruction: input.system,
        temperature: GEMINI_MODEL_CONFIG.temperature,
        maxOutputTokens: GEMINI_MODEL_CONFIG.maxOutputTokens,
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        // Ask for JSON; our validator still checks the shape because the model
        // can still return something unusable (refusal, truncation at the token cap).
        responseMimeType: 'application/json',
        // The SDK warns that aborting only stops waiting; the service may still bill.
        abortSignal: input.signal,
      },
    });

    const usage = response.usageMetadata;
    return {
      rawText: response.text ?? '',
      inputTokens: usage?.promptTokenCount ?? 0,
      // Thinking tokens are billed as output, so count them in the cost.
      outputTokens: (usage?.candidatesTokenCount ?? 0) + (usage?.thoughtsTokenCount ?? 0),
    };
  }
}

// ---------------------------------------------------------------------------
// Test double
// ---------------------------------------------------------------------------

/** One scripted behaviour for one call to the stub. */
export type StubStep =
  | { type: 'reply'; rawText: string; inputTokens?: number; outputTokens?: number; delayMs?: number }
  /** Never resolves and ignores the abort signal (the worst case for the deadline logic). */
  | { type: 'hang' }
  | { type: 'throw'; message: string };

/**
 * A model that follows a script. Each call consumes the next step; when the script
 * runs out, the last step repeats. Every call is recorded so tests can assert what
 * was sent (for example, that the hidden minimum price is never in a prompt).
 */
export class StubSellerModel implements SellerModel {
  readonly calls: Array<{ system: string; user: string }> = [];
  private index = 0;

  constructor(private readonly steps: StubStep[]) {
    if (steps.length === 0) throw new Error('StubSellerModel needs at least one step');
  }

  /** A stub that always answers with `{ "text": text }`. */
  static replying(text: string): StubSellerModel {
    return new StubSellerModel([{ type: 'reply', rawText: JSON.stringify({ text }) }]);
  }

  async generate(input: { system: string; user: string; signal: AbortSignal }) {
    this.calls.push({ system: input.system, user: input.user });
    const step = this.steps[Math.min(this.index, this.steps.length - 1)] as StubStep;
    this.index++;

    if (step.type === 'hang') return new Promise<never>(() => {});
    if (step.type === 'throw') throw new Error(step.message);
    if (step.delayMs) await new Promise((resolve) => setTimeout(resolve, step.delayMs));
    return {
      rawText: step.rawText,
      inputTokens: step.inputTokens ?? 1000,
      outputTokens: step.outputTokens ?? 100,
    };
  }
}
