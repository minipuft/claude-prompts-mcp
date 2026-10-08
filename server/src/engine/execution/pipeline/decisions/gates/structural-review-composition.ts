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

import type { GateReview, PendingGateReview } from '#shared/types/chain-execution.js';

/** The one synthetic gate id minted by the phase-guard composition owner. */
export const PHASE_GUARD_GATE_ID = '__phase_guard__';

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
    structuralGateIds: structuralMembership(undefined, finding.gateId),
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
 * synthetic structural id (an authored definition collision may join), not an empty review,
 * and not a review of a DIFFERENT step: a review opened for
 * the step a run just advanced onto is about that step, and the answer being graded is not its.
 * Identity is compared only where both sides state it, node id before ordinal.
 */
function absorbsStructuralFinding(open: PendingGateReview, finding: StructuralFinding): boolean {
  if (isUnknownInterruptPending(open)) return false;
  if (open.gateIds.length === 0) return false;
  if (
    open.gateIds.includes(finding.gateId) &&
    !(finding.gateId === PHASE_GUARD_GATE_ID && hasAuthoredStructuralDefinition(open))
  )
    return false;

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
    gateIds: [...new Set([...open.gateIds, finding.gateId])],
    structuralGateIds: structuralMembership(open, finding.gateId),
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

/** An authored definition with the same id remains a tool requirement, not a synthetic exception. */
function hasAuthoredStructuralDefinition(review: PendingGateReview): boolean {
  const definitions = review.semanticContext?.definitions ?? {};
  return (
    Object.hasOwn(definitions, PHASE_GUARD_GATE_ID) &&
    definitions[PHASE_GUARD_GATE_ID]?.definition['id'] === PHASE_GUARD_GATE_ID
  );
}

function structuralMembership(open: PendingGateReview | undefined, gateId: string): string[] {
  return gateId === PHASE_GUARD_GATE_ID ||
    open?.structuralGateIds?.includes(PHASE_GUARD_GATE_ID) === true
    ? [PHASE_GUARD_GATE_ID]
    : [];
}

/**
 * A server-marked finding, or the contextless legacy structural review that predates the marker.
 * A frozen authored id without structural membership is not a finding, whatever its kind/source.
 */
export function hasStructuralFinding(review: PendingGateReview | undefined): boolean {
  if (review?.gateIds.includes(PHASE_GUARD_GATE_ID) !== true) return false;
  if (review.structuralGateIds?.includes(PHASE_GUARD_GATE_ID) === true) return true;
  return review.structuralGateIds === undefined && review.semanticContext === undefined;
}

/**
 * Select tool-runner work only; the complete gateIds and structural hold remain unchanged.
 * Kind/source labels and prefixes confer no exception. Legacy reviews without the server marker
 * keep every id; a frozen authored definition wins over structural membership on an id collision.
 */
export function selectToolReviewGateIds(review: PendingGateReview): string[] {
  const synthetic =
    review.structuralGateIds?.includes(PHASE_GUARD_GATE_ID) === true &&
    !hasAuthoredStructuralDefinition(review);
  return review.gateIds.filter((gateId) => gateId !== PHASE_GUARD_GATE_ID || !synthetic);
}

/**
 * Remove the previous structural grade before a replacement is graded (Stage19's late-report
 * path). Preserve any authored requirement sharing the synthetic id, and keep unrelated review
 * authority, budget and history. The actual passing grade, not tool selection, settles the hold.
 * Clearing prompt/hints is exact for detached reviews: they open without either, so those lines
 * came from the previous grade that the replacement supersedes.
 */
export function withoutStructuralFinding(review: GateReview): GateReview {
  if (!hasStructuralFinding(review)) return review;
  const {
    failedPhases: _phases,
    mode: _mode,
    source: _source,
    ...metadata
  } = review.metadata ?? {};
  if (_source !== undefined && _source !== 'phase-guard-verification') metadata['source'] = _source;
  return {
    ...review,
    gateIds: hasAuthoredStructuralDefinition(review)
      ? [...review.gateIds]
      : review.gateIds.filter((gateId) => gateId !== PHASE_GUARD_GATE_ID),
    structuralGateIds: review.structuralGateIds?.filter((gateId) => gateId !== PHASE_GUARD_GATE_ID),
    combinedPrompt: '',
    retryHints: [],
    metadata,
  };
}
