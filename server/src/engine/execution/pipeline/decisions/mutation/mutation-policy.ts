// @lifecycle canonical - Sole owner of the P4 adaptive chain-mutation decision (insert + skip).

import { MAX_INSERTIONS_PER_RUN } from './types.js';

import type { ChainMutation, DecideMutationInput } from './types.js';

import { currentOrdinal, ordinalOf } from '#shared/utils/node-order.js';

/**
 * Decide what, if anything, a step's typed unknown observations should mutate about the run's
 * remaining node list.
 *
 * Pure: no I/O, no mutation of `input`, no pipeline/context dependency — matches the sibling
 * decision modules (`gates/enforcement-mode.ts::resolveEnforcementMode`,
 * `injection/injection-decision-service.ts`). The caller (stage 16, Tier 3) applies the
 * returned {@link ChainMutation} via `ChainSessionStore.insertNodeAfter` /
 * `markNodeSkipped`; this function never touches storage.
 *
 * Precedence: **insert takes priority over skip** when a single delta qualifies for both — a
 * blocking unknown is the more urgent signal (D2/OQ-P4-1: the model can still make forward
 * progress uncertain, while an irrelevant-resolution skip is a pure optimization). Insertion is
 * therefore evaluated first, unconditionally: if a qualifying blocking discovery is present in
 * `delta`, its outcome (insert, or `cap-reached` if capped) is returned WITHOUT ever consulting
 * the skip candidate, even when the skip candidate would otherwise have succeeded. Only when no
 * blocking discovery qualifies does skip evaluation run at all.
 *
 * "One mutation max per call" reduces to "first qualifying observation, per direction, wins" —
 * this function never needs to try a second discovery or a second resolution within the same
 * delta once one has been chosen; see {@link decideInsertion} / {@link decideSkip}.
 */
export function decideMutation(input: DecideMutationInput): ChainMutation {
  const insertion = decideInsertion(input);
  if (insertion !== undefined) {
    return insertion;
  }

  const skip = decideSkip(input);
  if (skip !== undefined) {
    return skip;
  }

  return { kind: 'none', reason: 'no-trigger' };
}

/**
 * The insertion half of the policy.
 *
 * Selects the FIRST `unknown_discovered` observation in `delta` whose corresponding ledger
 * entry is blocking (`entry.blocking === true`, not the observation's own `blocking` field —
 * the ledger already resolved the `?? false` default via `computeUnknownLedger`, so consulting
 * it here avoids restating that default). A non-blocking discovery is not a candidate at all
 * and is skipped over in the search, exactly like a delta with no discovery.
 *
 * Returns `undefined` (not a `{kind:'none'}` mutation) when no candidate exists, so the caller
 * can fall through to {@link decideSkip} without special-casing "no-trigger" twice.
 */
function decideInsertion(input: DecideMutationInput): ChainMutation | undefined {
  if (input.currentNodeId === null) {
    // No node to insert after — the run has already advanced past its terminal node. This is
    // not one of the four named none-reasons because it is not a rejection of a qualifying
    // candidate; it means insertion cannot be evaluated at all, so no candidate is even sought.
    return undefined;
  }

  for (const observation of input.delta) {
    if (observation.type !== 'unknown_discovered') {
      continue;
    }

    const entry = input.ledger.find((candidate) => candidate.id === observation.id);
    if (entry?.blocking !== true) {
      continue;
    }

    if (input.insertedUnknownIds.includes(observation.id)) {
      return { kind: 'none', reason: 'cap-reached' };
    }
    if (input.insertedCount >= MAX_INSERTIONS_PER_RUN) {
      return { kind: 'none', reason: 'cap-reached' };
    }

    return {
      kind: 'insert_investigation',
      afterNodeId: input.currentNodeId,
      unknownId: observation.id,
      statement: observation.statement,
    };
  }

  return undefined;
}

/**
 * The skip half of the policy.
 *
 * Selects the FIRST `unknown_resolved` observation in `delta` with `resolution === 'irrelevant'`
 * — regardless of whether its ledger entry carries a `targetStepId`. Selecting on type +
 * resolution alone (not on target presence) is deliberate: an irrelevant resolution with no
 * declared target is a real, distinguishable outcome (`target-absent`), not "no candidate
 * found". Collapsing that into `no-trigger` would make a caller unable to tell "nothing
 * resolved irrelevant this step" apart from "something did, but named no skip target" — the
 * exact silent-drop failure mode this reason vocabulary exists to prevent.
 *
 * Once a candidate is chosen, no other resolution observation in the same delta is considered
 * — same "first qualifying, one mutation max" rule as insertion.
 */
function decideSkip(input: DecideMutationInput): ChainMutation | undefined {
  const candidate = input.delta.find(
    (observation) =>
      observation.type === 'unknown_resolved' && observation.resolution === 'irrelevant'
  );
  if (candidate === undefined) {
    return undefined;
  }

  const entry = input.ledger.find((ledgerEntry) => ledgerEntry.id === candidate.id);
  const targetStepId = entry?.targetStepId;
  if (targetStepId === undefined) {
    return { kind: 'none', reason: 'target-absent' };
  }

  const targetOrdinal = ordinalOf(input.nodes, targetStepId);
  if (targetOrdinal === -1) {
    return { kind: 'none', reason: 'target-absent' };
  }

  // OQ-P4-2: strictly ahead of current, not at-or-behind. `currentOrdinal` already folds
  // `currentNodeId === null` (run finished) into `nodes.length + 1`, which is greater than any
  // real target ordinal — so a finished run correctly rejects every target as target-passed
  // without a separate null check here.
  const current = currentOrdinal(input.nodes, input.currentNodeId);
  if (targetOrdinal <= current) {
    return { kind: 'none', reason: 'target-passed' };
  }

  return { kind: 'skip_node', nodeId: targetStepId, unknownId: candidate.id };
}
