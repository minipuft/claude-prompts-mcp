// @lifecycle canonical - Delegation acknowledgment predicate for S8 telemetry.
/**
 * S8 / R-4 (owner-ruled): enforcement stays advisory — the server records what it cannot
 * prevent. A delegated step with gate text hands the worker a brief whose Result Contract
 * REQUIRES a `Proposed Gate Review:` block ({@link buildResultContractSection}); a captured
 * step output missing that token is therefore evidence the parent answered inline instead of
 * spawning the worker. This module owns that predicate, and nothing else: the caller decides
 * where the verdict lands (`execution_records.delegation_skipped`).
 */

import { PROPOSED_GATE_REVIEW_TOKEN } from './brief.js';

/** Inputs the predicate needs, all derivable at the step-capture site. */
export interface DelegationAcknowledgmentInput {
  /** The captured step's `delegated` flag (`ChainStepPrompt.delegated`). */
  readonly delegated: boolean | undefined;
  /**
   * The step's own gate text (`step.metadata['gateInstructions']`, stage 11's per-step field) —
   * the SAME field `assembleBriefBody` derives `hasGates` from, so "the brief demanded the
   * token" and "the predicate expects the token" cannot disagree.
   */
  readonly stepGateText: string | undefined;
  /** The captured user_response for the step. */
  readonly capturedResponse: string;
}

/**
 * Was a delegated, gated step's output produced without the contracted acknowledgment?
 *
 * - `undefined` — not evaluable: the step was not delegated, or it carried no gate text, so a
 *   conforming worker was never required to emit the token. Callers bind NULL (partial
 *   population BY ROW TYPE, the v21/v23 `execution_records` reading).
 * - `true` — delegated + gated, and the token is absent: the delegation was likely skipped.
 * - `false` — delegated + gated, and the token is present: a worker (or a conforming parent)
 *   acknowledged the contract.
 */
export function resolveDelegationSkipped(
  input: DelegationAcknowledgmentInput
): boolean | undefined {
  if (input.delegated !== true) {
    return undefined;
  }
  if (input.stepGateText === undefined || input.stepGateText.trim().length === 0) {
    return undefined;
  }
  return !input.capturedResponse.includes(PROPOSED_GATE_REVIEW_TOKEN);
}
