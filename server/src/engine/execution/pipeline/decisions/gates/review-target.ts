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
  | { readonly kind: 'refuse'; readonly reason: 'unknown-node' | 'no-review' }
  | { readonly kind: 'refuse'; readonly reason: 'ambiguous'; readonly nodeIds: readonly string[] };

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
 *    a node the run has already left. With several open (the store keeps one review per node),
 *    `ambiguous`, naming them: choosing one would answer a review nobody addressed.
 * 3. Otherwise `no-review`.
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
    return { kind: 'refuse', reason: 'ambiguous', nodeIds: stepReviewNodes };
  }
  const [only] = stepReviewNodes;
  return only === undefined
    ? { kind: 'refuse', reason: 'no-review' }
    : { kind: 'review', nodeId: only };
}

/**
 * The node whose review a client is SHOWN when its call names none — what stage 13 publishes,
 * stage 20 renders and the hooks' `pendingGateReview` key carries: the review a bare verdict
 * answers ({@link resolveReviewTarget}), else, with several step reviews open, the earliest the
 * store holds (the order they opened). Showing none would leave a held run re-rendering its step
 * with no word of the owed verdicts (measured 2026-09-23); a bare verdict on the shown review is
 * still refused as ambiguous, naming every open node. A detached node's review is never shown
 * here — only a trailer answers one. PURE.
 */
export function resolveShownReview(run: {
  readonly reviews?: Readonly<Record<string, GateReview>>;
  readonly state: { readonly currentNodeId: string | null };
}): string | undefined {
  const target = resolveReviewTarget({
    reviews: run.reviews ?? {},
    currentNodeId: run.state.currentNodeId,
    nodeIds: [],
  });
  if (target.kind === 'review') return target.nodeId;
  return target.reason === 'ambiguous' ? target.nodeIds[0] : undefined;
}
