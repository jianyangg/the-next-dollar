import { describe, expect, it, vi } from 'vitest';
import { MODEL_CONFIG } from '../shared/limits.ts';
import { OpenAISellerModel } from './openai.ts';

/** A fake fetch that records the request and answers with `body` (no network, no cost). */
function fakeFetch(status: number, body: unknown) {
  return vi.fn(async (_url: RequestInfo | URL, _init?: RequestInit) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
  );
}

const input = () => ({ system: 'SYS', user: 'USER', signal: new AbortController().signal });

describe('OpenAISellerModel', () => {
  it('sends the configured model, both prompts, JSON mode and the token cap', async () => {
    const fetchImpl = fakeFetch(200, { choices: [{ message: { content: '{"text":"hi"}' } }], usage: {} });
    await new OpenAISellerModel({ apiKey: 'k', fetchImpl }).generate(input());
    const [, init] = fetchImpl.mock.calls[0]!;
    const sent = JSON.parse(String(init?.body));
    expect(sent.model).toBe(MODEL_CONFIG.model);
    expect(sent.messages).toEqual([
      { role: 'system', content: 'SYS' },
      { role: 'user', content: 'USER' },
    ]);
    expect(sent.response_format).toEqual({ type: 'json_object' });
    expect(sent.max_completion_tokens).toBe(MODEL_CONFIG.maxOutputTokens);
    expect((init?.headers as Record<string, string>).authorization).toBe('Bearer k');
  });

  it('returns the reply text and the billed token counts', async () => {
    const fetchImpl = fakeFetch(200, {
      choices: [{ message: { content: '{"text":"hi"}' } }],
      usage: { prompt_tokens: 120, completion_tokens: 45 },
    });
    const out = await new OpenAISellerModel({ apiKey: 'k', fetchImpl }).generate(input());
    expect(out).toEqual({ rawText: '{"text":"hi"}', inputTokens: 120, outputTokens: 45 });
  });

  it('fails on an HTTP error with the status only, never the key', async () => {
    const fetchImpl = fakeFetch(401, { error: { message: 'bad key sk-secret' } });
    const run = new OpenAISellerModel({ apiKey: 'sk-secret', fetchImpl }).generate(input());
    await expect(run).rejects.toThrow('HTTP 401');
    await expect(run).rejects.not.toThrow(/sk-secret/);
  });

  it('refuses to be built without a key', () => {
    expect(() => new OpenAISellerModel({ apiKey: '' })).toThrow();
  });
});
