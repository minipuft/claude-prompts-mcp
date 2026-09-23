// @lifecycle canonical - Decides the one review a structural (phase-guard) failure produces.
/**
 * Structural review composition (P4.156 / R103).
 *
 * A structural failure on a gated step joins the gate review already open for that step: ONE
 * review names the gate, the missing sections and the attempt counter. The gate's criteria
 * (`prompts`), its `retry_config` (`maxAttempts`), the attempts already spent, its history and
 * its recorded evidence all survive, because the merged review is the gate's own review with the
 * structural findings added — not a second review, and not a replacement. Replacing it (the rule
 * before R103) dropped the gate from the reply and reset the retry budget to the phase guard's.
 *
 * A function beside `resolveGroundTruthCoverage` for the same reason that one is: the decision is
 * stateless, and stage 19 only persists what it returns.
 */

import { isUnknownInterruptPending } from '../mutation/interrupt-policy.js';

import type { PendingGateReview } from './gate-enforcement-types.js';

/** What one failed structural evaluation found, in the vocabulary a review stores. */
export interface StructuralFinding {
  /** The reserved gate id a structural review carries (`PHASE_GUARD_GATE_ID`). */
  readonly gateId: string;
  /** The full retry feedback, stored as the review's prompt text. */
  readonly feedback: string;
  /** One actionable line per failed check, rendered under "Improvements Needed". */
  readonly retryHints: readonly string[];
  readonly failedPhases: readonly string[];
  readonly mode: string;
  /** The answer that was graded. */
  readonly previousResponse: string;
  /** The step graded, from what the capture recorded; empty when this call captured nothing. */
  readonly reviewedStep: { stepNumber: number; nodeId: string } | Record<string, never>;
  /** The phase guard's own budget, used only when no gate review absorbs the finding. */
  readonly maxAttempts: number;
  readonly createdAt: number;
}

/**
 * The review to persist for `finding`, given the review `open` on the run (if any).
 *
 * Merges into `open` when it is a gate review of the graded step; otherwise returns a fresh
 * structural review. Never mutates `open`.
 */
export function composeStructuralReview(
  open: PendingGateReview | undefined,
  finding: StructuralFinding
): PendingGateReview {
  if (open !== undefined && absorbsStructuralFinding(open, finding)) {
    return mergeFinding(open, finding);
  }
  return {
    combinedPrompt: finding.feedback,
    gateIds: [finding.gateId],
    prompts: [],
    createdAt: finding.createdAt,
    attemptCount: 0,
    maxAttempts: finding.maxAttempts,
    retryHints: [...finding.retryHints],
    previousResponse: finding.previousResponse,
    metadata: {
      source: 'phase-guard-verification',
      failedPhases: [...finding.failedPhases],
      mode: finding.mode,
      ...finding.reviewedStep,
    },
  };
}

/**
 * Whether `open` is a gate review the finding joins.
 *
 * Not an interrupt hold (no `gate_verdict` resolves one), not a review that already carries the
 * structural id, not an empty review, and not a review of a DIFFERENT step: a review opened for
 * the step a run just advanced onto is about that step, and the answer being graded is not its.
 * Identity is compared only where both sides state it, node id before ordinal.
 */
function absorbsStructuralFinding(open: PendingGateReview, finding: StructuralFinding): boolean {
  if (isUnknownInterruptPending(open)) return false;
  if (open.gateIds.length === 0 || open.gateIds.includes(finding.gateId)) return false;

  const graded = finding.reviewedStep;
  if (!('nodeId' in graded)) return true;

  const reviewedNodeId = open.metadata?.['nodeId'];
  if (typeof reviewedNodeId === 'string') return reviewedNodeId === graded.nodeId;
  const reviewedStepNumber = open.metadata?.['stepNumber'];
  if (typeof reviewedStepNumber === 'number') return reviewedStepNumber === graded.stepNumber;
  return true;
}

function mergeFinding(open: PendingGateReview, finding: StructuralFinding): PendingGateReview {
  return {
    ...open,
    combinedPrompt: [open.combinedPrompt, finding.feedback]
      .filter((part) => part.trim().length > 0)
      .join('\n\n---\n\n'),
    gateIds: [...open.gateIds, finding.gateId],
    // Structural hints first: they name what is missing from THIS answer, and the renderer
    // shows only the first three.
    retryHints: [...finding.retryHints, ...(open.retryHints ?? [])],
    previousResponse: finding.previousResponse,
    metadata: {
      ...open.metadata,
      failedPhases: [...finding.failedPhases],
      mode: finding.mode,
      ...finding.reviewedStep,
    },
  };
}
