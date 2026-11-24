import type { RejectReason } from './validator.ts';

/**
 * One structured JSON log line per model call (CONFIGURATION.md A11).
 *
 * Privacy rules from the document, enforced by what this type does NOT contain:
 * there is no player, account or device field. The deal id is the only key. The
 * player's question text is logged on purpose (A11: playtesters are told), as is
 * the raw model reply.
 */
export interface SellerCallLog {
  event: 'seller_call';
  dealId: string;
  configVersion: string;
  promptVersion: string;
  kind: 'pitch' | 'answer';
  /** 1 for the first try, 2 for the silent retry. */
  attempt: number;
  /** The exact text sent to the model, including the player's question. */
  sent: { system: string; user: string };
  /** What the model returned, or null if it timed out or errored. */
  rawReply: string | null;
  verdict: 'accepted' | 'rejected' | 'timeout' | 'error';
  /** Why it was rejected, or the error message for 'error'. */
  reason: RejectReason | string | null;
  latencyMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  /** Estimated cost in US dollars (an estimate, not a billing record). */
  costUsd: number;
  /**
   * Set on the LAST attempt of a call that fell back; 'none' otherwise. A call
   * that produced an accepted reply on any attempt logs 'none' on that attempt.
   */
  fallbackUsed: 'none' | 'template' | 'neutral';
}

/** Logged when the model is not called at all (kill switch off, or cap reached). */
export interface SellerSkippedLog {
  event: 'seller_skipped';
  dealId: string;
  configVersion: string;
  promptVersion: string;
  kind: 'pitch' | 'answer';
  reason: 'agent-disabled' | 'spend-cap-reached';
  fallbackUsed: 'template' | 'neutral';
}

export type SellerLogLine = SellerCallLog | SellerSkippedLog;
export type Logger = (line: SellerLogLine) => void;

/** Production logger: one JSON object per line, which Workers Logs can index by field. */
export const consoleLogger: Logger = (line) => {
  console.log(JSON.stringify(line));
};
