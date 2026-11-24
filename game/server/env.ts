/**
 * Everything the Worker receives from Cloudflare: plain-text variables, secrets
 * and Durable Object bindings. Declared by hand (rather than generated) so the
 * file is readable and so tests can build a fake one. Keep in step with wrangler.toml.
 */
export interface Env {
  /** Kill switch (CONFIGURATION.md A12). Anything other than the exact string 'true' means OFF. */
  AGENT_ENABLED?: string;

  /** One DealSessionDO per deal id. */
  DEAL_SESSION: DurableObjectNamespace;
  /** One SpendLedgerDO for the whole Worker (the single running cost tally). */
  SPEND_LEDGER: DurableObjectNamespace;

  /**
   * Optional per-IP rate limiter (Workers Rate Limiting binding, `[[ratelimits]]` in
   * wrangler.toml). Absent in tests and in setups that rate-limit with a WAF rule instead.
   */
  RATE_LIMITER?: RateLimit;

  // Vertex AI settings. OPEN QUESTION (CONFIGURATION.md open question 4): how a
  // Worker authenticates to Vertex is unproven. See server/gemini.ts.
  GOOGLE_VERTEX_PROJECT?: string;
  GOOGLE_VERTEX_LOCATION?: string;
  /** Secret. Only meaningful if the spike chooses Vertex "express mode" (API key). */
  GOOGLE_VERTEX_API_KEY?: string;
}

/** The kill switch is opt-in: a missing, empty or misspelled value keeps the agent off. */
export function isAgentEnabled(env: Pick<Env, 'AGENT_ENABLED'>): boolean {
  return env.AGENT_ENABLED === 'true';
}
