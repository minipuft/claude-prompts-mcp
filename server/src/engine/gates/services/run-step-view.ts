// @lifecycle canonical - Narrow read model of a run's step identities, for gate step targeting.
//
// P4 row 4.1 / OQ-P4-3. A temporary gate may name its step by ordinal (`target_step_number`) or
// by stable node id (`target_step_id`). Once the adaptive mutation policy can insert and retire
// nodes mid-run, an ordinal stops naming the step it was authored against: inserting a node
// ahead of it silently retargets the gate one step later. So the gate layer needs two facts
// about the live run — the node order, and which nodes have been retired.
//
// Deliberately a narrow view + provider rather than an injected `ChainSessionService`: the gate
// layer needs exactly these two lists, and a provider keeps the dependency to a function type
// (the `ActiveFrameworkIdProvider` pattern already used by `GateEnhancementService`) instead of
// widening the gate layer's reach into the whole session store.

import type { ChainSession, ChainSessionService } from '#shared/types/index.js';
import type { StateStoreOptions } from '#shared/types/persistence.js';

export interface RunStepView {
  /** The run's live node ids, in run order. */
  readonly nodeIds: readonly string[];
  /**
   * Node ids the mutation policy retired (`milestone='skipped'`). A gate whose resolved target
   * is one of these must never fire: the step it was authored against will not execute, and
   * firing it against a different step would be a silent retarget (OQ-P4-3).
   */
  readonly skippedNodeIds: readonly string[];
  /**
   * The node the run is standing at, or `null` once the run has walked off its last node.
   *
   * The SAME fact stage 13 publishes as `sessionContext.currentNodeId` and stage 14 resolves
   * steps against (`session.state.currentNodeId`) — read one hop earlier, because gate
   * enhancement is stage 11 and no session context exists yet. Not a second notion of "current":
   * there is one, it lives on the run, and this is it.
   *
   * `undefined` only when there is no run to ask (the call that STARTS a chain), which is
   * exactly the case where the run would stand at its first node.
   */
  readonly currentNodeId?: string | null;
  /**
   * Provenance of the node the run is standing at — present ONLY when the mutation policy
   * INSERTED that node mid-run (P5-F4, closing the last surviving P4-F3 shape).
   *
   * An inserted node has no parse-time step by construction, so the gate walk never visits it and
   * nothing publishes a review scope for it; both readers then fall back to the run-wide
   * accumulator, which is exactly the defect P5 Tier 4 closed everywhere else. The owner's ruling
   * is that such a node INHERITS the review of the node its triggering unknown blocked, so the
   * gate layer needs one more fact about the live run: which node that is.
   *
   * Resolved HERE rather than in the gate service on purpose. This module is the established seam
   * for run facts entering gate selection, and the join it performs — node → `originUnknownId` →
   * ledger entry → `targetStepId` — reads two session-owned collections (`state.nodes` and
   * `unknownsLedger`). Doing it in `GateEnhancementService` would make the gate layer import
   * ledger internals for one field.
   *
   * Absent on every planned node, which is what keeps an unmutated run byte-identical: the
   * inheritance branch is entered only when this field exists.
   */
  readonly currentNodeOrigin?: InsertedNodeOrigin;
}

/** Why the current node exists, when it was inserted rather than planned. */
export interface InsertedNodeOrigin {
  readonly origin: 'inserted';
  /** The declared unknown whose blocking discovery caused the insertion, when the node names one. */
  readonly originUnknownId?: string;
  /**
   * The node that unknown blocked (`UnknownLedgerEntry.targetStepId`) — the review scope to
   * inherit. Absent when the unknown named no target, or when its ledger entry is gone: there is
   * then nothing to inherit, which is a distinct outcome from inheriting an empty set.
   */
  readonly unknownTargetNodeId?: string;
}

/** Resolves the run behind a chain id. Returns undefined when there is no run (yet). */
export type RunStepViewProvider = (
  chainId: string,
  scope?: StateStoreOptions
) => RunStepView | undefined;

/**
 * Build the provider from a session store.
 *
 * `includeDormant` because a run reloaded from rows stays dormant until explicitly resumed, and
 * a gate registered on the resuming call must still see that run's node list — a dormant run is
 * the normal state for every resume.
 */
export function createRunStepViewProvider(store: ChainSessionService): RunStepViewProvider {
  return (chainId, scope) => {
    const session = store.getSessionByChainIdentifier(chainId, {
      includeDormant: true,
      ...(scope ?? {}),
    });
    if (session === undefined) {
      return undefined;
    }

    const nodeIds = session.state.nodes.map((node) => node.id);
    const skippedNodeIds = nodeIds.filter(
      (nodeId) => store.getStepState(session.sessionId, nodeId)?.state === 'skipped'
    );

    const view: RunStepView = {
      nodeIds,
      skippedNodeIds,
      currentNodeId: session.state.currentNodeId,
    };

    const currentNodeOrigin = resolveInsertedNodeOrigin(session);
    return currentNodeOrigin === undefined ? view : { ...view, currentNodeOrigin };
  };
}

/**
 * The current node's insertion provenance, or undefined when it was planned (or absent).
 *
 * Reads the ledger entry rather than re-deriving the target from the node id: `mintInsertionId`'s
 * slugify is lossy, so the id is not a decodable inverse — the same reason `origin_unknown_id`
 * exists as a column instead of being parsed back out of the id.
 */
function resolveInsertedNodeOrigin(session: ChainSession): InsertedNodeOrigin | undefined {
  const currentNodeId = session.state.currentNodeId;
  if (typeof currentNodeId !== 'string' || currentNodeId.length === 0) {
    return undefined;
  }

  const currentNode = session.state.nodes.find((node) => node.id === currentNodeId);
  if (currentNode?.origin !== 'inserted') {
    return undefined;
  }

  const originUnknownId = currentNode.originUnknownId;
  if (originUnknownId === undefined) {
    return { origin: 'inserted' };
  }

  const entry = session.unknownsLedger?.find((candidate) => candidate.id === originUnknownId);
  const unknownTargetNodeId = entry?.targetStepId;

  return unknownTargetNodeId === undefined
    ? { origin: 'inserted', originUnknownId }
    : { origin: 'inserted', originUnknownId, unknownTargetNodeId };
}
