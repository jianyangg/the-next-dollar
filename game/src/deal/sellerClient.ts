import {
  apiErrorSchema,
  type ApiError,
  type PitchResponse,
  pitchResponseSchema,
  type QuestionResponse,
  questionResponseSchema,
} from '../../shared/sellerReply';

/**
 * The browser's client for the seller Worker (server/index.ts).
 *
 *   pitch(dealId)            POST /api/runs/:runId/deals/:dealId/pitch
 *   ask(dealId, question)    POST /api/runs/:runId/deals/:dealId/questions
 *   close(dealId)            POST /api/runs/:runId/deals/:dealId/close
 *
 * TRUST BOUNDARY
 *   Every response is parsed with the SAME zod schemas the server uses to build it
 *   (shared/sellerReply.ts). A malformed body (a proxy error page, a server bug) becomes
 *   a typed `SellerApiError` instead of `undefined` text on screen. The client never
 *   fills a gap with made-up words: callers get either a valid reply or an error, and
 *   the UI shows an explicit "unavailable" state for the error.
 *
 * RUN ID
 *   Each playthrough talks to its own server-side conversation, named by a random
 *   UUID v4 (see server/index.ts "WHY A RUN ID"). One page load = one run.
 */

export type SellerErrorCode = ApiError['error'] | 'network' | 'bad-response';

export class SellerApiError extends Error {
  constructor(
    readonly code: SellerErrorCode,
    readonly status: number | null
  ) {
    super(`seller API: ${code}${status === null ? '' : ` (HTTP ${status})`}`);
    this.name = 'SellerApiError';
  }
}

export interface SellerClient {
  pitch(dealId: string): Promise<PitchResponse>;
  ask(dealId: string, question: string): Promise<QuestionResponse>;
  close(dealId: string): Promise<void>;
}

interface ClientOptions {
  runId: string;
  /** Injected in tests; the real browser fetch otherwise. */
  fetchImpl?: typeof fetch;
}

export function createSellerClient({ runId, fetchImpl = (...args) => fetch(...args) }: ClientOptions): SellerClient {
  const url = (dealId: string, route: string) =>
    `/api/runs/${encodeURIComponent(runId)}/deals/${encodeURIComponent(dealId)}/${route}`;

  /** POST and parse; any failure becomes a SellerApiError with a stable code. */
  async function post<T>(path: string, body: unknown, parse: (v: unknown) => T | null): Promise<T> {
    let res: Response;
    try {
      res = await fetchImpl(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    } catch {
      throw new SellerApiError('network', null);
    }
    let json: unknown;
    try {
      json = await res.json();
    } catch {
      throw new SellerApiError('bad-response', res.status);
    }
    if (!res.ok) {
      const err = apiErrorSchema.safeParse(json);
      throw new SellerApiError(err.success ? err.data.error : 'bad-response', res.status);
    }
    const parsed = parse(json);
    if (parsed === null) throw new SellerApiError('bad-response', res.status);
    return parsed;
  }

  return {
    pitch: (dealId) =>
      post(url(dealId, 'pitch'), {}, (v) => {
        const r = pitchResponseSchema.safeParse(v);
        return r.success ? r.data : null;
      }),
    ask: (dealId, question) =>
      post(url(dealId, 'questions'), { question }, (v) => {
        const r = questionResponseSchema.safeParse(v);
        return r.success ? r.data : null;
      }),
    close: async (dealId) => {
      await post(url(dealId, 'close'), undefined, (v) =>
        typeof v === 'object' && v !== null && (v as { closed?: unknown }).closed === true ? true : null
      );
    },
  };
}

/** This page load's run id. Lazy so tests (and non-browser imports) never touch crypto early. */
let runId: string | null = null;
export function getRunId(): string {
  runId ??= crypto.randomUUID();
  return runId;
}
