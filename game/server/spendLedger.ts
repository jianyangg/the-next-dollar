import type { SpendStore } from './budget.ts';

/**
 * Cloudflare adapters for the spend tally. Kept apart from budget.ts so the
 * budget logic (and the live-evaluation script) never needs Workers types.
 */

// ---------------------------------------------------------------------------

/** Talks to the single SpendLedgerDO over its fetch interface. */
export class DurableSpendStore implements SpendStore {
  constructor(private readonly stub: DurableObjectStub) {}

  async getMicroUsd(): Promise<number> {
    const res = await this.stub.fetch('https://ledger/spend');
    const body = (await res.json()) as { microUsd: number };
    return body.microUsd;
  }

  async addMicroUsd(amount: number): Promise<number> {
    const res = await this.stub.fetch('https://ledger/spend', {
      method: 'POST',
      body: JSON.stringify({ microUsd: amount }),
    });
    const body = (await res.json()) as { microUsd: number };
    return body.microUsd;
  }
}

/**
 * The one Durable Object that owns the tally. A Durable Object processes its
 * requests one at a time, so the read-modify-write below cannot interleave.
 * UNTESTED against the real Workers runtime.
 */
export class SpendLedgerDO implements DurableObject {
  constructor(private readonly state: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    let total = (await this.state.storage.get<number>('microUsd')) ?? 0;
    if (request.method === 'POST') {
      const body = (await request.json()) as { microUsd?: unknown };
      const add = typeof body.microUsd === 'number' && Number.isFinite(body.microUsd) && body.microUsd >= 0 ? body.microUsd : 0;
      total += add;
      await this.state.storage.put('microUsd', total);
    }
    return Response.json({ microUsd: total });
  }
}
