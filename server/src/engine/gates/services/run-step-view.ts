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

import type { ChainSessionService } from '#shared/types/index.js';
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

    return { nodeIds, skippedNodeIds };
  };
}
