import { CALL_DEADLINE_MS } from '../../shared/limits';
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

export type SellerErrorCode = ApiError['error'] | 'network' | 'bad-response' | 'timeout';

/**
 * The longest the browser waits for one seller call. The server already gives up at
 * CALL_DEADLINE_MS (6 s, retry included) and then answers with its own fallback, so a
 * healthy server always replies before this. The extra 2 s covers the network.
 *
 * Without a limit, a request that never comes back (seller server not running behind a
 * proxy that holds the connection, a dropped Wi-Fi) left the deal window stuck in its
 * "loading" state with every row disabled: the window looked frozen and could not be
 * used. Now the call fails as 'timeout' and the window opens in its "seller
 * unavailable" state, where Bid and Walk away still work.
 */
export const CLIENT_DEADLINE_MS = CALL_DEADLINE_MS + 2000;

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
    // One AbortController covers the whole call: the request AND reading its body.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), CLIENT_DEADLINE_MS);
    let res: Response;
    let json: unknown;
    try {
      try {
        res = await fetchImpl(path, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: body === undefined ? undefined : JSON.stringify(body),
          signal: controller.signal,
        });
      } catch {
        throw new SellerApiError(controller.signal.aborted ? 'timeout' : 'network', null);
      }
      try {
        json = await res.json();
      } catch {
        throw new SellerApiError(controller.signal.aborted ? 'timeout' : 'bad-response', res.status);
      }
    } finally {
      clearTimeout(timer);
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
