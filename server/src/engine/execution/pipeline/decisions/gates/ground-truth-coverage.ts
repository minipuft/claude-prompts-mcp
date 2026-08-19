// @lifecycle canonical - Decides whether ground-truth verification clears a gate review.
/**
 * Ground-truth coverage decision.
 *
 * "Has this pending gate review already been satisfied by running something?" is
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

import type { GroundTruthCoverage, GroundTruthCoverageInput } from './gate-enforcement-types.js';

/**
 * Decide whether ground-truth verification alone clears a pending review.
 *
 * Clears only when this request actually ran verifications, every one passed, and the
 * gates verified here plus any an earlier stage verified cover every gate the review is
 * waiting on. Partial coverage falls through to normal review: a gate with no
 * ground-truth criteria has been checked by nothing, and a passing sibling does not speak
 * for it.
 *
 * **Mechanism-agnostic by construction.** It reads only `gateId` and `passed`, so
 * `shell_verify` exit codes and `script_tool` structured verdicts feed it unchanged and a
 * third mechanism would too. The name said "shell" until 2026-08-19 purely because shell
 * was the only mechanism that existed.
 */
export function resolveGroundTruthCoverage(input: GroundTruthCoverageInput): GroundTruthCoverage {
  const priorVerified = input.priorVerifiedGateIds ?? [];

  if (input.results.length === 0) {
    return {
      satisfied: false,
      verifiedGateIds: [...new Set(priorVerified)],
      reason: 'No ground-truth criteria ran for this review',
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
      reason: `Ground-truth verification failed for ${failedGateIds.join(', ')}`,
    };
  }

  const uncovered = input.requiredGateIds.filter((id) => !verifiedGateIds.includes(id));
  if (uncovered.length > 0) {
    return {
      satisfied: false,
      verifiedGateIds,
      reason: `Ground-truth verification does not cover ${uncovered.join(', ')}`,
    };
  }

  return {
    satisfied: true,
    verifiedGateIds,
    reason: 'Every required gate passed ground-truth verification',
  };
}
