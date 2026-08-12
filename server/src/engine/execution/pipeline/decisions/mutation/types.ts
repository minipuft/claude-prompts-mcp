// @lifecycle canonical - Type definitions for the P4 adaptive chain-mutation decision.

import type { UnknownLedgerEntry, UnknownObservation } from '#shared/types/chain-session.js';
import type { NodeOrderInput } from '#shared/utils/node-order.js';

/**
 * Named rejection reasons for `{ kind: 'none' }`. Every rejection is a distinct branch so a
 * caller (and a test) can tell "nothing qualified" apart from "something qualified but was
 * capped or targeted an invalid step" — a bare boolean or a generic `false` would collapse all
 * four into one unobservable outcome.
 *
 * - `no-trigger`    — the delta contained no qualifying discovery or resolution at all.
 * - `cap-reached`   — a qualifying blocking discovery existed but OQ-P4-5's cap rejected it
 *                      (either this unknown id already received its one insertion, or the run
 *                      already holds 3 insertions).
 * - `target-absent` — a qualifying irrelevant resolution existed but its ledger entry names no
 *                      `targetStepId`, or names one that is not in `nodes` (deleted/never
 *                      existed). Both read as "there is nothing valid to skip".
 * - `target-passed` — the named target exists but its ordinal is at-or-behind `currentNodeId`
 *                      (OQ-P4-2: the policy may not skip the current node or a node already
 *                      passed).
 */
export type MutationNoneReason = 'no-trigger' | 'cap-reached' | 'target-passed' | 'target-absent';

/**
 * A deterministic mutation decision for one step's observation delta.
 *
 * Pure data — `decideMutation` never applies this. The caller (stage 16, Tier 3) owns turning
 * `insert_investigation`/`skip_node` into real `ChainSessionStore` calls; this module answers
 * only "what, if anything, should happen" for a single step's delta, and returns at most one
 * mutation per call (see {@link decideMutation} docblock for the insert-vs-skip precedence
 * rule).
 */
export type ChainMutation =
  | {
      readonly kind: 'insert_investigation';
      /** The node the new investigation step is inserted immediately after — always the node
       * the triggering discovery was declared at (`currentNodeId`), never a later position. */
      readonly afterNodeId: string;
      readonly unknownId: string;
      /** The discovery observation's statement, carried through as the inserted step's content
       * per OQ-P4-1's synthetic-inline-node default. */
      readonly statement: string;
    }
  | {
      readonly kind: 'skip_node';
      readonly nodeId: string;
      readonly unknownId: string;
    }
  | {
      readonly kind: 'none';
      readonly reason: MutationNoneReason;
    };

/**
 * Inputs to {@link decideMutation}. Deliberately not `ExecutionContext` or any pipeline type —
 * this module lives in `decisions/`, which by convention (sibling `gates/enforcement-mode.ts`,
 * `injection/injection-decision-service.ts`) takes plain data in and returns plain data out.
 *
 * `insertedUnknownIds` is additive beyond the plan's originally sketched five-field shape
 * (`{ delta, ledger, nodes, currentNodeId, insertedCount }`) — see implementation-notes
 * D-T1-1. A scalar `insertedCount` alone cannot answer "has THIS unknown id already received
 * its one insertion" (OQ-P4-5's per-unknown-id cap), and `decideMutation` must stay pure, so
 * the caller (Tier 3) is expected to track and pass this set alongside the run-wide count.
 */
export interface DecideMutationInput {
  /** This step's observation batch — the delta the step just declared, not the whole ledger. */
  readonly delta: readonly UnknownObservation[];
  /** The unknowns ledger AFTER `delta` has already been applied via `computeUnknownLedger`.
   * Resolution-time lookups (`targetStepId`, final `blocking` state) read from here rather than
   * re-deriving observation defaults, so this module never restates ledger transition rules. */
  readonly ledger: readonly UnknownLedgerEntry[];
  /** The run's node list in order. Accepts `ChainNode[]` or a bare id array — whatever
   * `shared/utils/node-order.ts` accepts, since target-existence and ordinal checks are
   * delegated to it rather than reimplemented here. */
  readonly nodes: NodeOrderInput;
  /** The node the run is currently standing at; `null` once the run has advanced past its
   * terminal node. */
  readonly currentNodeId: string | null;
  /** Count of insertions already applied earlier in this run (OQ-P4-5's 3-per-run cap). */
  readonly insertedCount: number;
  /** Unknown ids that have already received an investigation insertion earlier in this run
   * (OQ-P4-5's 1-per-unknown-id cap). */
  readonly insertedUnknownIds: readonly string[];
}

/** OQ-P4-5: hard ceiling on insertions per run, independent of how many distinct unknowns
 * triggered them. */
export const MAX_INSERTIONS_PER_RUN = 3;
