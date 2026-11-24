import { Hono } from 'hono';
import { pitchRequestSchema, questionRequestSchema, type ApiError } from '../shared/sellerReply.ts';
import type { Env } from './env.ts';

/**
 * The Worker entry point (a Hono app).
 *
 *   POST /api/deals/:dealId/pitch      body { deal, persona }  -> { text, source, questionsEnabled, questionsRemaining }
 *   POST /api/deals/:dealId/questions  body { question }       -> { text, source, questionsRemaining }
 *   POST /api/deals/:dealId/close      (no body)               -> { closed: true }
 *
 * This layer only checks the request's SHAPE and forwards it to the deal's Durable
 * Object, which owns every rule (question cap, length limit, kill switch, budget).
 * Failures use the codes in `apiErrorSchema`: 400 invalid body, 404 no pitch yet,
 * 409 questions disabled, 429 question limit reached.
 */

/** Deal ids become Durable Object names, so keep them short and boring. */
const DEAL_ID = /^[A-Za-z0-9_-]{1,64}$/;

function bad(error: ApiError['error'], message?: string): Response {
  const body: ApiError = message === undefined ? { error } : { error, message };
  return Response.json(body, { status: 400 });
}

const app = new Hono<{ Bindings: Env }>();

app.use('/api/deals/:dealId/*', async (c, next) => {
  if (!DEAL_ID.test(c.req.param('dealId'))) return bad('invalid-request', 'bad deal id');
  await next();
  return undefined;
});

/** Sends a JSON body to the deal's Durable Object and passes its response straight back. */
function forward(env: Env, dealId: string, path: string, body?: unknown): Promise<Response> {
  const stub = env.DEAL_SESSION.get(env.DEAL_SESSION.idFromName(dealId));
  return stub.fetch(`https://deal-session${path}`, {
    method: 'POST',
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return undefined;
  }
}

app.post('/api/deals/:dealId/pitch', async (c) => {
  const dealId = c.req.param('dealId');
  const parsed = pitchRequestSchema.safeParse(await readJson(c.req.raw));
  // The strict schema is also what rejects a body that carries a reservationPrice.
  if (!parsed.success) return bad('invalid-request');
  // A client must not be able to open session A while describing deal B.
  if (parsed.data.deal.id !== dealId) return bad('deal-id-mismatch');
  return forward(c.env, dealId, '/pitch', parsed.data);
});

app.post('/api/deals/:dealId/questions', async (c) => {
  const parsed = questionRequestSchema.safeParse(await readJson(c.req.raw));
  if (!parsed.success) {
    // Distinguish "too long" so the UI can say so; everything else is a plain bad request.
    const tooLong = parsed.error.issues.some((i) => i.code === 'too_big');
    return bad(tooLong ? 'question-too-long' : 'invalid-request');
  }
  return forward(c.env, c.req.param('dealId'), '/questions', parsed.data);
});

app.post('/api/deals/:dealId/close', (c) => forward(c.env, c.req.param('dealId'), '/close'));

app.onError((error) => {
  // Log the detail on the server; never send internals to the browser.
  console.error('unhandled error', error);
  const body: ApiError = { error: 'internal' };
  return Response.json(body, { status: 500 });
});

export default app;
export { app };
// Cloudflare finds Durable Object classes by their exported names (see wrangler.toml).
export { DealSessionDO } from './dealSession.ts';
export { SpendLedgerDO } from './spendLedger.ts';
