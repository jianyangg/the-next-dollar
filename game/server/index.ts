import { Hono } from 'hono';
import { getPublicDeal } from '../shared/deals/index.ts';
import { pitchRequestSchema, questionRequestSchema, type ApiError } from '../shared/sellerReply.ts';
import type { Env } from './env.ts';

/**
 * The Worker entry point (a Hono app).
 *
 *   POST /api/runs/:runId/deals/:dealId/pitch      body {} or empty   -> { text, source, questionsEnabled, questionsRemaining }
 *   POST /api/runs/:runId/deals/:dealId/questions  body { question }  -> { text, source, questionsRemaining, refunded }
 *   POST /api/runs/:runId/deals/:dealId/close      (no body)          -> { closed: true }
 *
 * The client names a deal ONLY by `dealId`. The deal's books and the seller's
 * persona live on the server (shared/deals), so a client has nothing to forge.
 *
 * WHY A RUN ID
 *   One conversation (Durable Object) exists per (run, deal), not per deal. With the
 *   bare deal id as the key, every player in the world shared ONE conversation and
 *   ONE 3-question allowance, and anyone could close the deal (a permanent tombstone)
 *   for everybody, forever. Now each playthrough has its own random run id
 *   (a UUID v4 the browser makes with crypto.randomUUID): 122 random bits, so another
 *   player cannot guess it, and a new playthrough starts a fresh conversation.
 *   The global spend cap and the per-IP limiter still bound what many runs can cost.
 *
 * This layer checks the deal id and the request's SHAPE, then forwards to the deal's
 * Durable Object, which owns every rule (question cap, refunds, call ceiling, closed
 * tombstone, kill switch, budget). Failure codes are in `apiErrorSchema`:
 *   400 invalid-request / question-too-long   bad body (an unknown field is a 400, never ignored)
 *   400 invalid-run                           the run id is not a UUID v4
 *   404 unknown-deal                          the id is not in the registry
 *   404 no-pitch                              a question before the pitch
 *   409 deal-closed                           the deal was closed; it can never be reopened
 *   409 questions-disabled                    kill switch / template pitch
 *   429 question-limit                        3 questions used
 *   429 rate-limited                          per-IP limiter (only if the binding is configured)
 */

function fail(error: ApiError['error'], status: number, message?: string): Response {
  const body: ApiError = message === undefined ? { error } : { error, message };
  return Response.json(body, { status });
}

const app = new Hono<{ Bindings: Env }>();

/**
 * Per-IP rate limiting, using the Workers Rate Limiting binding (RATE_LIMITER in
 * wrangler.toml). It stops one address from hammering the Worker; the per-deal rules
 * in the Durable Object stop one DEAL from over-using the model. They protect
 * different things: the deal rules cap spend per deal, while this caps request
 * volume per address (including floods of requests that would only earn 4xx errors).
 *
 * It is OPTIONAL: when the binding is absent (unit tests, plain `wrangler dev`
 * without it) this is a no-op. A request with no `CF-Connecting-IP` header (only
 * happens off Cloudflare's network, i.e. local dev) is not limited either, because
 * there is no honest key to count against.
 * A Cloudflare WAF rate-limiting rule in front of the Worker is an equally valid
 * (and dashboard-configurable) alternative; see the report.
 */
app.use('/api/runs/*', async (c, next) => {
  const limiter = c.env.RATE_LIMITER;
  const ip = c.req.header('cf-connecting-ip');
  if (limiter && ip) {
    const { success } = await limiter.limit({ key: ip });
    if (!success) return fail('rate-limited', 429);
  }
  await next();
  return undefined;
});

/** A run id is exactly a lowercase or uppercase UUID v4 (what crypto.randomUUID returns). */
const RUN_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * 400 for a malformed run id, 404 for a deal id that is not in the server's registry.
 * Runs before every deal route.
 */
app.use('/api/runs/:runId/deals/:dealId/*', async (c, next) => {
  if (!RUN_ID.test(c.req.param('runId'))) return fail('invalid-run', 400);
  if (!getPublicDeal(c.req.param('dealId'))) return fail('unknown-deal', 404);
  await next();
  return undefined;
});

/**
 * Sends a body (or none) to this run's conversation for the deal and passes its
 * response straight back. The Durable Object is named `<runId>:<dealId>`; the deal id
 * also travels in the query so the object can re-check it against the registry.
 */
function forward(env: Env, runId: string, dealId: string, path: string, body?: unknown): Promise<Response> {
  const stub = env.DEAL_SESSION.get(env.DEAL_SESSION.idFromName(`${runId.toLowerCase()}:${dealId}`));
  return stub.fetch(`https://deal-session${path}?dealId=${encodeURIComponent(dealId)}`, {
    method: 'POST',
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** Reads a JSON body. An empty body counts as `{}`; text that is not valid JSON is `{ ok: false }`. */
async function readJson(request: Request): Promise<{ ok: true; value: unknown } | { ok: false }> {
  try {
    const text = await request.text();
    return { ok: true, value: text.trim() === '' ? {} : JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}

app.post('/api/runs/:runId/deals/:dealId/pitch', async (c) => {
  const body = await readJson(c.req.raw);
  // Strict: the body must be empty or `{}`. A client that still sends a persona or a
  // deal gets a 400, which tells its developer the contract changed.
  if (!body.ok || !pitchRequestSchema.safeParse(body.value).success) return fail('invalid-request', 400);
  return forward(c.env, c.req.param('runId'), c.req.param('dealId'), '/pitch', {});
});

app.post('/api/runs/:runId/deals/:dealId/questions', async (c) => {
  const body = await readJson(c.req.raw);
  const parsed = body.ok ? questionRequestSchema.safeParse(body.value) : undefined;
  if (!parsed?.success) {
    // Distinguish "too long" so the UI can say so; everything else is a plain bad request.
    const tooLong = parsed?.error.issues.some((i) => i.code === 'too_big') ?? false;
    return fail(tooLong ? 'question-too-long' : 'invalid-request', 400);
  }
  return forward(c.env, c.req.param('runId'), c.req.param('dealId'), '/questions', parsed.data);
});

app.post('/api/runs/:runId/deals/:dealId/close', (c) =>
  forward(c.env, c.req.param('runId'), c.req.param('dealId'), '/close')
);

app.onError((error) => {
  // Log the detail on the server; never send internals to the browser.
  console.error('unhandled error', error);
  return fail('internal', 500);
});

export default app;
export { app };

// Cloudflare finds Durable Object classes by their exported names (see wrangler.toml).
export { DealSessionDO } from './dealSession.ts';
export { SpendLedgerDO } from './spendLedger.ts';
