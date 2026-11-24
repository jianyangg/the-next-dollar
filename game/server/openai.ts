import { MODEL_CONFIG } from '../shared/limits.ts';
import type { SellerModel } from './gemini.ts';

/**
 * The seller's language model on OpenAI (Chat Completions), behind the same
 * `SellerModel` seam as every other model, so the validator, budget and deadline logic
 * in callSeller.ts do not change and tests keep using StubSellerModel.
 *
 * Why plain `fetch` and not the OpenAI SDK: a Cloudflare Worker has fetch built in, a
 * JSON POST is all we need, and no extra dependency means nothing that might rely on
 * Node-only APIs (the exact problem that left the Vertex client unproven).
 *
 * The API key is a secret: it is read from the Worker's environment by the caller and
 * only ever placed in the Authorization header. It never appears in errors or logs.
 */
export interface OpenAIConfig {
  apiKey: string;
  /** Overridable for tests. Defaults to the public endpoint. */
  endpoint?: string;
  fetchImpl?: typeof fetch;
}

const DEFAULT_ENDPOINT = 'https://api.openai.com/v1/chat/completions';

/** The slice of the Chat Completions response we read. Everything else is ignored. */
interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string | null } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

export class OpenAISellerModel implements SellerModel {
  private readonly endpoint: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly config: OpenAIConfig) {
    if (!config.apiKey) throw new Error('OpenAI API key is missing');
    this.endpoint = config.endpoint ?? DEFAULT_ENDPOINT;
    this.fetchImpl = config.fetchImpl ?? ((...args) => fetch(...args));
  }

  async generate(input: { system: string; user: string; signal: AbortSignal }) {
    const res = await this.fetchImpl(this.endpoint, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.config.apiKey}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL_CONFIG.model,
        messages: [
          { role: 'system', content: input.system },
          { role: 'user', content: input.user },
        ],
        max_completion_tokens: MODEL_CONFIG.maxOutputTokens,
        reasoning_effort: MODEL_CONFIG.reasoningEffort,
        // Ask for a JSON object. The validator still checks the shape, because a reply
        // can be cut off at the token cap or be a refusal.
        response_format: { type: 'json_object' },
      }),
      // Aborting stops our wait at the 6 s deadline. The service may still finish and
      // bill the call, which is why callSeller charges the token ceilings on a timeout.
      signal: input.signal,
    });

    if (!res.ok) {
      // Status only: the body can echo request details, and the key must never be logged.
      throw new Error(`OpenAI request failed (HTTP ${res.status})`);
    }
    const data = (await res.json()) as ChatCompletionResponse;
    return {
      rawText: data.choices?.[0]?.message?.content ?? '',
      inputTokens: data.usage?.prompt_tokens ?? 0,
      // completion_tokens already includes reasoning tokens, which are billed as output.
      outputTokens: data.usage?.completion_tokens ?? 0,
    };
  }
}
