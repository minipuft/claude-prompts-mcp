// @lifecycle canonical - Pure refusal wording for gate review transitions.
import type { GateReview } from '#shared/types/chain-execution.js';

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
