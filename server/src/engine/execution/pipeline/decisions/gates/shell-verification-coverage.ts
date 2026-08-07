// @lifecycle canonical - Decides whether ground-truth shell verification clears a gate review.
/**
 * Shell-verification coverage decision.
 *
 * "Has this pending gate review already been satisfied by running commands?" is
 * gate-verdict domain work — it decides a gate is cleared — so it belongs beside the
 * other gate-enforcement decisions rather than inside the stage that renders reviews.
 *
 * It is a **function, not a method on `GateEnforcementAuthority`**, and deliberately so.
 * The authority is stateful (it caches an enforcement decision and holds the session
 * store) and reaches stages as an optional `context.gateEnforcement`. This decision is
 * stateless and is needed on a path that must work whether or not an authority instance
 * was wired: routing it through the instance would mean a pending review silently fails
 * to auto-clear wherever the port is unset. Per the layer model a stateless decision is a
 * pure utility, and `architecture.md` imports pure functions directly rather than
 * injecting them.
 */

import type {
  ShellVerificationCoverage,
  ShellVerificationCoverageInput,
} from './gate-enforcement-types.js';

/**
 * Decide whether shell verification alone clears a pending review.
 *
 * Clears only when this request actually ran verifications, every one passed, and the
 * gates verified here plus any an earlier stage verified cover every gate the review is
 * waiting on. Partial coverage falls through to normal review: a gate with no
 * `shell_verify` criteria has been checked by nothing, and a passing sibling does not
 * speak for it.
 */
export function resolveShellVerificationCoverage(
  input: ShellVerificationCoverageInput
): ShellVerificationCoverage {
  const priorVerified = input.priorVerifiedGateIds ?? [];

  if (input.results.length === 0) {
    return {
      satisfied: false,
      verifiedGateIds: [...new Set(priorVerified)],
      reason: 'No shell_verify criteria ran for this review',
    };
  }

  const verifiedGateIds = [
    ...new Set([...input.results.map((result) => result.gateId), ...priorVerified]),
  ];

  const failedGateIds = [
    ...new Set(input.results.filter((result) => !result.passed).map((result) => result.gateId)),
  ];
  if (failedGateIds.length > 0) {
    return {
      satisfied: false,
      verifiedGateIds,
      reason: `Shell verification failed for ${failedGateIds.join(', ')}`,
    };
  }

  const uncovered = input.requiredGateIds.filter((id) => !verifiedGateIds.includes(id));
  if (uncovered.length > 0) {
    return {
      satisfied: false,
      verifiedGateIds,
      reason: `Shell verification does not cover ${uncovered.join(', ')}`,
    };
  }

  return {
    satisfied: true,
    verifiedGateIds,
    reason: 'Every required gate passed shell verification',
  };
}
