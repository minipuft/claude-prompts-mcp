// @lifecycle canonical - Type definitions for the P4 adaptive chain-mutation decision.

import type { ChainNode } from '#shared/types/chain-execution.js';
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
  /**
   * A run-level insertion cap the SUBMISSION declared — today only a Workflow IR's
   * `budget.maxInsertions` (P6 Tier 5), read back off the run's blueprint on every step.
   *
   * NARROWING ONLY. {@link MAX_INSERTIONS_PER_RUN} stays the ceiling and this value can only
   * lower it: the policy takes the minimum of the two, so a declared 99 does not buy 99
   * insertions. Absent means "server default", which is NOT the same as 0 — a submission
   * declaring `maxInsertions: 0` opts out of adaptive insertion entirely, and that has to stay
   * distinguishable from declaring nothing.
   */
  readonly maxInsertions?: number;
}

/** OQ-P4-5: hard ceiling on insertions per run, independent of how many distinct unknowns
 * triggered them. */
export const MAX_INSERTIONS_PER_RUN = 3;

/**
 * Reserved synthetic gate id for the hard-pause a blocking unknown raises when
 * `budget.pauseOnBlocking` is on (D-2).
 *
 * Same reservation pattern as `PHASE_GUARD_GATE_ID = '__phase_guard__'`
 * (`stages/19-phase-guard-verification-stage.ts`) and the `__gate_review__` synthetic step:
 * a double-underscore id no authored gate may take, so a `pendingGateReview` carrying it is
 * unambiguously server-minted.
 *
 * Declared HERE rather than in the stage that sets the review, because the policy that decides
 * the interrupt is the thing that owns the id, and every later consumer — stage 16 (sets the
 * review), stage 13 (surfaces it on resume), `GateVerdictProcessor` (clears it) and
 * `response-assembler` (renders it) — is inside `engine/`, so all four import it without
 * crossing a layer boundary. The Python hook side (`session_state.py`) carries the literal, not
 * an import, exactly as it does for the phase-guard id.
 */
export const UNKNOWN_INTERRUPT_GATE_ID = '__unknown_interrupt__';

/**
 * One remaining node, reduced to the three fields the interrupt payload publishes.
 *
 * Deliberately NOT `ChainNode`: `origin`/`originUnknownId` are server-side provenance and the
 * interrupt is a client-facing proposal surface. A caller authoring a replacement remainder
 * needs identity, which prompt runs, and what the step is called — nothing else.
 */
export interface InterruptNodeSummary {
  readonly id: string;
  readonly promptId: string;
  readonly stepName: string;
}

/**
 * The structured account a blocking unknown owes its caller (OQ-1).
 *
 * Pure data, camelCase, transport-agnostic. The snake_case wire shape published as
 * `structuredContent.chain_interrupt` (plan §Interrupt payload) is assembled downstream by
 * `response-assembler` — it additionally carries `resume.chain_id` and the verb list, neither of
 * which this module can see: `decideInterrupt` takes no run identity and no contract metadata.
 */
export interface ChainInterrupt {
  /** Only member today. Named rather than boolean so a second cause is additive (F-1). */
  readonly reason: 'blocking_unknown';
  /** The open blocking unknown that motivated the interrupt. */
  readonly unknownId: string;
  readonly statement: string;
  /**
   * Steps the open blocking unknowns DECLARED they affect, via `target_step_id` (OQ-2).
   *
   * Declared links only. Textual scanning of step names or statements was rejected as a
   * heuristic: the server reacts to what an observation declares, never to what it mentions.
   */
  readonly affectedStepIds: readonly string[];
  /** The run's nodes strictly after the current one, in run order, AFTER any insertion applied
   * on this same call. This is the plan the caller is being invited to replace. */
  readonly remainingNodes: readonly InterruptNodeSummary[];
  /** Mirrors `budget.pauseOnBlocking` (D-2). `true` means the run is holding on the synthetic
   * {@link UNKNOWN_INTERRUPT_GATE_ID} review; `false` means the interrupt is advisory and the
   * run continues into the inserted investigation step. */
  readonly paused: boolean;
}

/**
 * Inputs to `decideInterrupt`. Plain data in, plain data out — same posture as
 * {@link DecideMutationInput} and the sibling decision modules.
 */
export interface DecideInterruptInput {
  /** The unknowns ledger AFTER this call's delta has been applied. The interrupt is a function
   * of what is OPEN, not of what was just declared: a blocking unknown that stays open keeps the
   * run interrupted on every later step until it is resolved. */
  readonly ledger: readonly UnknownLedgerEntry[];
  /** The run's node list in order, after any mutation applied on this call. Full
   * {@link ChainNode}s rather than a bare id array, because `remainingNodes` publishes
   * `promptId`/`stepName`. */
  readonly nodes: readonly ChainNode[];
  /** The node the run is standing at; `null` once the run has advanced past its terminal node. */
  readonly currentNodeId: string | null;
  /** The run's declared `budget.pauseOnBlocking`, read back off the blueprint. Absent means the
   * default (`false`), which is NOT distinguishable from an explicit `false` and does not need
   * to be — unlike `maxInsertions`, this knob has no server default to narrow. */
  readonly pauseOnBlocking?: boolean;
}
