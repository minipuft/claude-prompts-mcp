// @lifecycle canonical - Pure refusal wording for gate review transitions.
import type { GateReview } from '#shared/types/chain-execution.js';
import type { ChainSession } from '#shared/types/chain-session.js';
import type { GateAction } from '../../execution/pipeline/decisions/gates/gate-enforcement-types.js';
import type { resolveReviewTarget } from '../../execution/pipeline/decisions/gates/review-target.js';

import { ordinalOf } from '#shared/utils/node-order.js';

/**
 * The sentence a refused event reads (`advanceReview` refused it, and nothing was charged).
 *
 * - `failing-check` — a PASS over a check the engine recorded as failing (ruling B4): the stage
 *   that runs a gate's `shell_verify` / `script_tool` criteria writes `checkResults`, and a model
 *   PASS over a recorded exit code is an unnoticed contradiction. `gate_action: skip` is the
 *   operator's override, behind exhaustion; a FAIL is the submitter agreeing with the check.
 * - `phase` — the review is not waiting for this kind of call: an exhausted review answers only
 *   `gate_action` (R9), and a detached review never `abort`s — `cancel: true` stops a run.
 */
export function describeRefusal(reason: 'phase' | 'failing-check', review: GateReview): string {
  if (reason === 'failing-check') {
    const failed = (review.checkResults ?? []).filter((result) => !result.passed);
    const gateIds = [...new Set(failed.map((result) => result.gateId))].join(', ');
    const summaries = failed.map((result) => result.summary).join('; ');
    return (
      `❌ Gate verdict refused: ${gateIds} recorded a failing check (${summaries}). ` +
      'Fix the cause and resubmit; the check re-runs on the next review.'
    );
  }
  const waitingFor: Record<GateReview['phase'], string> = {
    'awaiting-verdict': 'a gate_verdict',
    'awaiting-replacement': "the worker's replacement result",
    exhausted:
      review.kind === 'detached'
        ? 'gate_action "retry" or "skip", or cancel: true'
        : 'gate_action "retry", "skip" or "abort"',
  };
  return (
    `❌ The gate review of node '${review.nodeId}' (${review.attemptCount}/${review.maxAttempts} ` +
    `attempts) is waiting for ${waitingFor[review.phase]}. Nothing was recorded.`
  );
}

/** The sentence a call reads when no review answers it: a name the run lacks, or no open review. */
export function describeMissingReview(
  target: ReturnType<typeof resolveReviewTarget>,
  trailerNodeId: string | undefined,
  currentOrdinal: number
): string {
  if (target.kind === 'refuse' && target.reason === 'unknown-node') {
    return `❌ The reply names node '${trailerNodeId}', which this run does not have. Nothing was recorded.`;
  }
  if (target.kind === 'refuse' && target.reason === 'ambiguous') {
    const named = target.nodeIds.map((nodeId) => `'${nodeId}'`).join(', ');
    return `❌ Gate reviews are open on nodes ${named}; name the one this call answers with a HANDOFF RESULT trailer (\`node: <id>\`). Nothing was recorded.`;
  }
  const answerFirst = currentOrdinal > 0 ? `; answer step ${currentOrdinal} first` : '';
  return trailerNodeId === undefined
    ? `❌ No gate review is open on this run, so there is nothing for this call to answer${answerFirst}. Nothing was recorded.`
    : `❌ No gate review is open for node '${trailerNodeId}'. Nothing was recorded.`;
}

/** The sentence a FAIL reads on a step with no gates: there is nothing for it to fail. */
export function describeGatelessStep(ordinal: number): string {
  return (
    `❌ Step ${ordinal} carries no gates, so a FAIL verdict has nothing to grade; send its ` +
    'output as user_response without a gate_verdict. Nothing was recorded.'
  );
}

/** The sentence a `gate_action` reads on a review that still has attempts left. */
export function describeInBudgetAction(
  action: GateAction,
  review: GateReview,
  session: ChainSession
): string {
  const ordinal = ordinalOf(session.state.nodes, review.nodeId);
  return (
    `❌ gate_action "${action}" is accepted only on an exhausted review; the review of step ` +
    `${ordinal} is at ${review.attemptCount}/${review.maxAttempts} attempts — answer it or send ` +
    'a gate_verdict. Nothing was recorded.'
  );
}

/** The sentence a response-less PASS reads when the step its review grades has no answer. */
export function describeUnansweredStep(session: ChainSession, nodeId: string): string {
  const ordinal = ordinalOf(session.state.nodes, nodeId);
  return (
    `❌ Step ${ordinal} has no answer yet, so a gate_verdict alone has nothing to grade; answer ` +
    `step ${ordinal} first (send its output as user_response with the verdict). Nothing was recorded.`
  );
}
