// @lifecycle canonical - Pure refusal wording for gate review transitions.
import { buildStructuredVerdictTemplate } from '../../execution/pipeline/decisions/gates/describe-review-for-render.js';
import { projectFrozenReview } from '../../execution/pipeline/decisions/gates/semantic-review-context.js';

import type { GateReview } from '#shared/types/chain-execution.js';
import type { ChainSession } from '#shared/types/chain-session.js';
import type { GateAction } from '../../execution/pipeline/decisions/gates/gate-enforcement-types.js';
import type { resolveReviewTarget } from '../../execution/pipeline/decisions/gates/review-target.js';
import type { ParsedGateVerdict } from '../core/gate-verdict-contract.js';

import { attemptInHand, formatAttempt } from '#shared/utils/attempt-number.js';
import { ordinalOf } from '#shared/utils/node-order.js';

/**
 * The sentence a refused event reads (`advanceReview` refused it, and nothing was charged).
 *
 * - `failing-check` — a PASS over a check the engine recorded as failing: the stage
 *   that runs a gate's `shell_verify` / `script_tool` criteria writes `checkResults`, and a model
 *   PASS over a recorded exit code is an unnoticed contradiction. `gate_action: skip` is the
 *   operator's override, behind exhaustion; a FAIL is the submitter agreeing with the check.
 * - `phase` — the review is not waiting for this kind of call: an exhausted review answers only
 *   review-owned `gate_action` (`retry`/`skip`). Run-level abort bypasses review handling.
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
      'gate_action "retry" or "skip"; to stop the run, use gate_action "abort" with chain_id',
  };
  return (
    `❌ The gate review of node '${review.nodeId}' (${formatAttempt(attemptInHand(review.attemptCount, review.maxAttempts), review.maxAttempts)}) ` +
    `is waiting for ${waitingFor[review.phase]}. Nothing was recorded.`
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
    `${ordinal} is on ${formatAttempt(attemptInHand(review.attemptCount, review.maxAttempts), review.maxAttempts)} — answer it or send ` +
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

/**
 * The refusal a verdict reads when it carries no report for a semantic gate the review requires
 * (R11.2): a string verdict, or an object whose matching `per_gate` entry has no `evaluation`.
 * Nothing is graded, so no attempt is spent and the captured target stays; the reply ends on the
 * review's own structured template, its binding already filled in. An exhausted review takes no
 * verdict at all (R9), so it reads the retry-limit sentence instead of an invitation to resubmit.
 */
export function describeMissingSemanticReport(
  review: GateReview,
  gateId: string,
  verdict: Pick<ParsedGateVerdict, 'submission'>
): string {
  if (review.phase === 'exhausted') return describeRefusal('phase', review);
  const index = review.gateIds.indexOf(gateId) + 1;
  const carrier =
    verdict.submission === undefined
      ? 'a string verdict cannot carry it'
      : 'the submitted verdict carries none';
  const template = buildStructuredVerdictTemplate(
    review.gateIds,
    review.prompts,
    new Map(Object.entries(review.gateTiers ?? {})),
    new Map((review.checkResults ?? []).map((result) => [result.gateId, result])),
    projectFrozenReview(review)
  );
  return (
    `Semantic gate '${gateId}' needs gate_verdict.per_gate[${index}].evaluation; ${carrier}. ` +
    `No attempt was used. Resubmit:\n\n\`\`\`\ngate_verdict=${template}\n\`\`\``
  );
}
