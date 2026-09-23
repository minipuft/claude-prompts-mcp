// @lifecycle canonical - Sole owner of which review a verdict, report or gate_action answers.
/**
 * Review target resolution (primitive rework row 3.2).
 *
 * A review is keyed by the node it grades (`ChainSession.reviews[nodeId]`), and that node is not
 * always the one the run stands on: a phase-guard review grades the step a capture just walked
 * past, a detached node's review opens on its late report, and a final-step review outlives the
 * walk past the last node. So the answer to "which review does this call address" is decided
 * here, once, from the record — never re-derived from the run's position by each verdict path.
 *
 * Pure: reads the map it is given, writes nothing.
 */

import type { GateReview } from '#shared/types/chain-execution.js';

/** The review a call addresses, or the named reason there is none. */
type ReviewTarget =
  | { readonly kind: 'review'; readonly nodeId: string }
  | { readonly kind: 'refuse'; readonly reason: 'unknown-node' | 'no-review' };

interface ReviewTargetInput {
  /** The run's review store, `ChainSession.reviews`. */
  readonly reviews: Readonly<Record<string, GateReview>>;
  /** The node the run stands on; `null` once it walked past its last node. */
  readonly currentNodeId: string | null;
  /** Every node id of the run — what tells a node with no review from a node that does not exist. */
  readonly nodeIds: readonly string[];
  /** The node a `HANDOFF RESULT` trailer names, when the call carried one. */
  readonly trailerNodeId?: string;
}

/**
 * Resolve the review a call addresses.
 *
 * 1. **A trailer names the node**, and it wins: its review, else `unknown-node` when the run has
 *    no such node, else `no-review`.
 * 2. **No trailer**: the review of the node the run stands on, unless that one is a detached
 *    node's (only a trailer answers those); else the run's one non-detached review, which grades
 *    a node the run has already left.
 * 3. Otherwise `no-review`.
 *
 * @throws when the run holds two non-detached reviews: the store keeps at most one, so two means
 *   the store's invariant broke, and choosing either would answer a review nobody addressed.
 */
export function resolveReviewTarget(input: ReviewTargetInput): ReviewTarget {
  const { reviews, currentNodeId, nodeIds, trailerNodeId } = input;
  if (trailerNodeId !== undefined) {
    if (!nodeIds.includes(trailerNodeId)) {
      return { kind: 'refuse', reason: 'unknown-node' };
    }
    return reviews[trailerNodeId] === undefined
      ? { kind: 'refuse', reason: 'no-review' }
      : { kind: 'review', nodeId: trailerNodeId };
  }

  const current = currentNodeId === null ? undefined : reviews[currentNodeId];
  if (currentNodeId !== null && current !== undefined && current.kind !== 'detached') {
    return { kind: 'review', nodeId: currentNodeId };
  }

  const stepReviewNodes = Object.entries(reviews)
    .filter(([, review]) => review.kind !== 'detached')
    .map(([nodeId]) => nodeId);
  if (stepReviewNodes.length > 1) {
    throw new Error(
      `A run holds ${stepReviewNodes.length} step reviews (${stepReviewNodes.join(', ')}); the store keeps at most one`
    );
  }
  const [only] = stepReviewNodes;
  return only === undefined
    ? { kind: 'refuse', reason: 'no-review' }
    : { kind: 'review', nodeId: only };
}
