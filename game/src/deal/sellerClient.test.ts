import { describe, expect, it, vi } from 'vitest';
import { createSellerClient, SellerApiError } from './sellerClient';

const RUN = '2f1c7a4e-9b3d-4c8a-a1e2-5d6f7a8b9c0d';
const reply = (status: number, body: unknown) =>
  vi.fn(async () => new Response(typeof body === 'string' ? body : JSON.stringify(body), { status }));

describe('sellerClient', () => {
  it('posts to the run-scoped route and returns a parsed pitch', async () => {
    const fetchImpl = reply(200, { text: 'Hi', source: 'model', questionsEnabled: true, questionsRemaining: 3 });
    const client = createSellerClient({ runId: RUN, fetchImpl });
    await expect(client.pitch('central-park-seller-1')).resolves.toMatchObject({ text: 'Hi', source: 'model' });
    expect(fetchImpl).toHaveBeenCalledWith(
      `/api/runs/${RUN}/deals/central-park-seller-1/pitch`,
      expect.objectContaining({ method: 'POST', body: '{}' })
    );
  });

  it("turns the server's error body into a typed code", async () => {
    const client = createSellerClient({ runId: RUN, fetchImpl: reply(429, { error: 'question-limit' }) });
    await expect(client.ask('d', 'q')).rejects.toEqual(new SellerApiError('question-limit', 429));
  });

  it('rejects a malformed success body instead of showing undefined text', async () => {
    const client = createSellerClient({ runId: RUN, fetchImpl: reply(200, { text: 5 }) });
    await expect(client.ask('d', 'q')).rejects.toMatchObject({ code: 'bad-response' });
  });

  it('rejects a non-JSON body (e.g. a proxy error page)', async () => {
    const client = createSellerClient({ runId: RUN, fetchImpl: reply(502, '<html>Bad gateway</html>') });
    await expect(client.pitch('d')).rejects.toMatchObject({ code: 'bad-response', status: 502 });
  });

  it('reports a network failure as code network', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    const client = createSellerClient({ runId: RUN, fetchImpl });
    await expect(client.close('d')).rejects.toMatchObject({ code: 'network', status: null });
  });
});
