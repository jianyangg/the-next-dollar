import {
  PRICE_USD_PER_MILLION_INPUT_TOKENS,
  PRICE_USD_PER_MILLION_OUTPUT_TOKENS,
  SPEND_CAP_USD,
} from '../shared/limits.ts';

/**
 * Running cost tally and the spending cap (CONFIGURATION.md A9 and A12).
 *
 * Money is stored as whole MICRO-dollars (1 USD = 1,000,000). A single call costs
 * about $0.003 = 3,000 micro-dollars, so integers are exact, whereas adding many
 * tiny floating-point dollar amounts slowly drifts.
 *
 * KNOWN LIMIT: "check the cap, call the model, add the cost" is not one atomic
 * step across many deals at once, so several simultaneous calls can each pass the
 * check and push spend a few calls (cents) past $5. Acceptable for a $5 student
 * cap; a hard guarantee would need to reserve cost before the call.
 */

const MICRO = 1_000_000;

export function estimateCostUsd(inputTokens: number, outputTokens: number): number {
  return (
    (inputTokens * PRICE_USD_PER_MILLION_INPUT_TOKENS) / MICRO +
    (outputTokens * PRICE_USD_PER_MILLION_OUTPUT_TOKENS) / MICRO
  );
}

/** Where the tally lives. A Durable Object in production, an in-memory object in tests. */
export interface SpendStore {
  getMicroUsd(): Promise<number>;
  /** Adds to the tally and returns the new total. */
  addMicroUsd(amount: number): Promise<number>;
}

export class Budget {
  constructor(
    private readonly store: SpendStore,
    private readonly capUsd: number = SPEND_CAP_USD,
  ) {}

  /** True once spend has reached the cap (>=, not >, per A9: "refuses calls once the cap is reached"). */
  async isExhausted(): Promise<boolean> {
    return (await this.store.getMicroUsd()) >= Math.round(this.capUsd * MICRO);
  }

  /** Records the cost of one finished call; returns that cost in dollars. */
  async record(inputTokens: number, outputTokens: number): Promise<number> {
    const usd = estimateCostUsd(inputTokens, outputTokens);
    await this.store.addMicroUsd(Math.round(usd * MICRO));
    return usd;
  }

  async spentUsd(): Promise<number> {
    return (await this.store.getMicroUsd()) / MICRO;
  }
}

export class InMemorySpendStore implements SpendStore {
  constructor(private micro = 0) {}
  async getMicroUsd(): Promise<number> {
    return this.micro;
  }
  async addMicroUsd(amount: number): Promise<number> {
    this.micro += amount;
    return this.micro;
  }
}
