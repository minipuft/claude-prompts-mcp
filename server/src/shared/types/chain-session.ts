// @lifecycle canonical - Cross-cutting chain session types used by engine/, modules/, and mcp/.
/**
 * Chain Session Types
 *
 * Types for chain session management consumed across architectural layers.
 * Relocated from modules/chains/types.ts to shared/ to respect the dependency
 * direction: shared → engine → modules → mcp.
 *
 * Note: SessionBlueprint.parsedCommand uses ParsedCommandSnapshot (a minimal
 * structural contract) rather than the full engine-layer ParsedCommand type.
 * Engine code should cast to ParsedCommand when full type access is needed.
 */

import { unreportedDetachedNodeIds } from './chain-execution.js';

import type {
  StepMilestone,
  ChainNode,
  ChainRunStatus,
  ChainState,
  GateReview,
  GateReviewPhase,
  PendingGateReview,
  PendingShellVerificationSnapshot,
  RunTelemetry,
  StepMetadata,
  VisibilityItem,
} from './chain-execution.js';
import type { ExecutionModifiers, ExecutionPlan } from './core-config.js';
import type { StateStoreOptions } from './persistence.js';

// Re-export StepMilestone for consumers that previously imported StepState via modules/chains/types.ts
export type { StepMilestone };

// Re-export SEP-1686-aligned execution-lifecycle types so consumers can continue importing
// from chain-session.ts without reaching into chain-execution.ts directly.
export type {
  ChainLifecycleEvent,
  ChainRunStatus,
  EvidenceContract,
  EvidencePayload,
  ExecutionRecord,
  ExecutionStatusBlock,
  GateVerdictSummary,
  InputRequiredReason,
  RunTelemetry,
  StepLifecycle,
  StepSubstate,
  VisibilityItem,
} from './chain-execution.js';

/**
 * The run-level budget declarations that outlive the submission that carried them.
 *
 * A submitted Workflow IR declares five budget fields (`WorkflowBudget`,
 * `modules/workflow-ir/types.ts`). Two of them — `maxNodes` and `maxFanOut` — are answered
 * entirely at validation time from the submission itself and have no reader afterwards, so
 * persisting them would be two write-only fields. These three DO have post-validation consumers,
 * which is why they are the only three here:
 *
 * - `maxInsertions` is read by the P4 adaptive-mutation policy on every LATER request of the run
 *   (each chain step is its own MCP call), so the cap has to survive the call that declared it.
 * - `declaredCostCeiling` is RECORD-ONLY (D4/D6, OQ-P6-3): nothing compares it to anything. It is
 *   kept so a run's declared intent is readable back off the run, not so the server can act on it.
 * - `pauseOnBlocking` is read back per step by the blocking-unknown interrupt (D-2), the same way
 *   `maxInsertions` is — a knob declared once on the first call has to be answerable on the
 *   twentieth.
 *
 * **This interface is the FIRST of four strippers a budget field must pass.** The others are
 * `compileBudget` (IR path), `normalizeChainBudget` (YAML path) and the stage-16 readback. Each
 * projects a named subset, so a field added to `workflowBudgetSchema` alone is silently dropped
 * three times and the readback reads `undefined` forever while typechecking perfectly (measured
 * 2026-08-30, DEV-T0-3). Adding one here means adding it in all four places, with a test per hop.
 *
 * Carried on {@link ParsedCommandSnapshot} rather than on {@link ChainSession} directly: the
 * blueprint is already cloned into the run's residual document and restored on resume, so this
 * needs no column, no `createSession` parameter and no new persistence path.
 */
export interface DeclaredRunBudget {
  /** ENFORCED at runtime — may only NARROW `MAX_INSERTIONS_PER_RUN`, never widen it. */
  maxInsertions?: number;
  /** RECORD-ONLY — never enforced, never compared against a server-side estimate. */
  declaredCostCeiling?: number;
  /**
   * BEHAVIOURAL DIAL (D-2) — `true` makes a blocking unknown hard-pause the run on the synthetic
   * `__unknown_interrupt__` review instead of continuing into the inserted investigation step.
   *
   * Absent means the default, `false`. Unlike `maxInsertions` there is no server value to narrow,
   * so absent and explicit-`false` are the same posture and nothing needs to tell them apart.
   */
  pauseOnBlocking?: boolean;
}

/**
 * Minimal structural contract for parsed commands stored in session blueprints.
 * Covers the fields accessed through blueprint consumers across layers.
 * Engine code should cast to the full ParsedCommand type when needed.
 */
export interface ParsedCommandSnapshot {
  promptId?: string;
  commandType?: 'single' | 'chain';
  chainId?: string;
  convertedPrompt?: {
    id?: string;
    name?: string;
    description?: string;
    category?: string;
  };
  steps?: Array<{
    /**
     * Stable node identity for this parse-time step — the SAME id space as {@link ChainNode.id}
     * and `GateSpecification.target_step_id`, minted once at parse time and frozen for the run.
     *
     * Declared here (P6 Tier 2, closing P4-F2) because the value was already travelling: the
     * blueprint clone is `JSON.parse(JSON.stringify(...))`, so a `ChainStepPrompt.nodeId` survived
     * into this slot by serialization accident while the type denied it existed. A field that is
     * present but undeclared is reachable only by cast, and a cast is how a structural narrowing
     * hides — so every consumer that wanted to address the blueprint by identity indexed it by
     * array position instead, which is exactly the drift P4 mutation introduces (P6-F1).
     *
     * `undefined` means "this step carries no node identity" — a legacy chain addressed by
     * ordinal (P3 D10 keeps `nodeId` optional on `ChainStepPrompt`). It is NOT the same as a
     * resolved-but-absent target, which the node-addressing readers spell `null`; see
     * `GateEnhancementService.filterGatesForTarget` for the canonical statement of that split.
     * Do not introduce a third state here.
     */
    nodeId?: string;
    inlineGateIds?: string[];
    args?: Record<string, unknown>;
    /** Additive only (P5 Tier 1) — no consumer reads this yet. */
    visibility?: { withhold?: VisibilityItem[]; expose?: VisibilityItem[] };
  }>;
  inlineGateIds?: string[];
  namedInlineGates?: unknown[];
  modifiers?: ExecutionModifiers;
  promptArgs?: Record<string, unknown>;
  /**
   * Run-level budget declared by a submitted Workflow IR (P6 Tier 5). Absent on every other
   * submission path — a `>>chain` and a symbolic chain declare no budget, and absence means
   * "server defaults", never "zero".
   */
  budget?: DeclaredRunBudget;
}

export type ChainSessionLifecycle = 'dormant' | 'canonical';

/**
 * Which half of the one remainder mechanism a submission is asking for (OQ-A1).
 *
 * `'replace'` is the answer to a blocking unknown that invalidated the plan's SHAPE — every node
 * strictly after the current one goes. `'append'` extends the plan without disturbing it, and is
 * the shape a leading-`-->` command string parses into, so both spellings meet at one store call.
 */
export type RemainderMode = 'replace' | 'append';

/**
 * One node of a caller-authored remainder, reduced to what the STORE needs.
 *
 * Deliberately not `WorkflowNode`: the IR node carries mapping, gate, framework and visibility
 * declarations that belong to the compile path, and `shared/` may not reach into `modules/` for
 * a value. The caller (row 2.3) validates a submission against the IR schemas and projects the
 * accepted nodes onto this shape; the store's job is identity, ordering and provenance.
 *
 * WHAT THIS SHAPE CARRIES IS A CLOSED DECISION, not an accident of what was needed first
 * (row A.5). A remainder node has NO parse-time counterpart in `parsedCommand.steps`, so the
 * renderer synthesizes its step from the NODE alone (`operators/node-step-projection.ts`
 * `synthesizeStep`). Every field the node does not carry is therefore a field the run can never
 * see, however well-formed the submission was — which is why `RemainderProcessor` REFUSES the
 * IR-node fields absent here instead of accepting and dropping them, and why
 * `remainder-node-fields.test.ts` fails when a new IR node field is neither carried nor refused.
 */
export interface RemainderNodeSpec {
  readonly promptId: string;
  readonly stepName: string;
  /**
   * The id the caller declared, when it declared one. Honoured when free; otherwise a
   * collision-suffixed id is minted from it, because a remainder may never rename a node the run
   * already carries — gate targets, execution records and `executionOrder` address nodes by id.
   */
  readonly id?: string;
  /**
   * Resolved arguments for the step (row A.5).
   *
   * Carried rather than refused because the append spelling already parses `key="value"` pairs
   * to satisfy `validateWorkflowIR`'s required-argument check — refusing them would refuse
   * appends of every prompt with a required argument. Before A.5 they satisfied that check and
   * were then dropped, so an appended step rendered with no arguments at all.
   */
  readonly args?: Record<string, unknown>;
  /**
   * Declared context isolation — the `==>` operator's declaration (row A.5).
   *
   * The DECLARATION, exactly as `WorkflowNode.delegated` is: the runtime flag on a rendered step
   * still has its own producer (stage 06 for parse-time steps, `synthesizeStep` for these).
   */
  readonly delegated?: boolean;
}

/**
 * Named refusal causes for {@link ChainSessionStore.replaceRemainder}.
 *
 * Same posture as `MutationNoneReason` (`decisions/mutation/types.ts`): every refusal is its own branch so a caller (and a
 * test) can tell "the run is over" from "the cap is spent" from "that node is already running".
 * A single boolean would collapse four different client-facing answers into one unobservable
 * outcome — and this method's refusals ARE client-facing, since row 2.2 requires a refusal to
 * name its reason back to the submitter.
 *
 * - `session-unknown`      — no such run in this process.
 * - `run-terminal`         — the run has finished, or has advanced past its terminal node, so
 *                            there is no "after the current node" to write into. One reason
 *                            rather than two: both mean the same thing to a caller, and neither
 *                            is recoverable by re-submitting.
 * - `empty-remainder`      — the submission carried no nodes. Distinguished from a successful
 *                            no-op because "replace the remainder with nothing" is a request to
 *                            truncate the run, which this method does not perform.
 * - `cap-reached`          — this unknown id already spent its one remainder, or the run has
 *                            spent its per-run ceiling.
 * - `node-already-started` — a node in the range `'replace'` would remove has already been
 *                            rendered to the client and cannot be un-shown (the OQ-P4-2
 *                            boundary `markNodeSkipped` draws, applied to a range).
 */
export type RemainderRejectionReason =
  'session-unknown' | 'run-terminal' | 'empty-remainder' | 'cap-reached' | 'node-already-started';

/** The outcome of a remainder submission: the nodes that landed, or a named refusal. */
export type RemainderOutcome =
  | {
      readonly kind: 'applied';
      readonly mode: RemainderMode;
      /** The nodes as they entered the run — minted ids, `origin` and `originUnknownId` set. */
      readonly nodes: readonly ChainNode[];
    }
  | {
      readonly kind: 'rejected';
      readonly reason: RemainderRejectionReason;
    };

/**
 * A single typed observation a chain step declares about a run-scoped unknown.
 * `unknown_discovered` opens a ledger entry; `unknown_resolved` closes one.
 */
export interface UnknownObservation {
  type: 'unknown_discovered' | 'unknown_resolved';
  /** Stable kebab-case slug identifying the unknown within the run. */
  id: string;
  statement: string;
  /** Required iff type === 'unknown_resolved'. */
  resolution?: 'answered' | 'irrelevant';
  /** Discovered-only. Defaults to false. */
  blocking?: boolean;
  /**
   * Discovered-only. Stable node id (kebab-case or `nK`) of the downstream step the P4
   * mutation policy skips if this unknown later resolves `irrelevant`. Snake_case here
   * (not `targetStepId`) because this interface is the exact runtime shape the Zod
   * `unknownDiscoveredSchema` parse produces — there is no field-renaming layer between the
   * MCP request and this type, matching the precedent already set by the sibling
   * `GateSpecification['target_step_id']` union member in `execution.ts`.
   */
  target_step_id?: string;
}

/** A ledger row tracking one unknown's lifecycle across a chain run. */
export interface UnknownLedgerEntry {
  id: string;
  statement: string;
  state: 'active' | 'resolved';
  resolution?: 'answered' | 'irrelevant';
  resolutionStatement?: string;
  blocking: boolean;
  discoveredAtStep: number;
  resolvedAtStep?: number;
  /**
   * Carried from `UnknownObservation.target_step_id` at discovery time (camelCase here,
   * matching this interface's existing `discoveredAtStep`/`resolvedAtStep` convention rather
   * than the wire's snake_case). Present only when the discovering observation named one;
   * still readable at resolution time, which is the point — the mutation policy consults it
   * when an `unknown_resolved` observation carries `resolution: 'irrelevant'`.
   */
  targetStepId?: string;
}

export interface SessionBlueprint {
  parsedCommand: ParsedCommandSnapshot;
  executionPlan: ExecutionPlan;
  gateInstructions?: string;
}

export interface ChainSession {
  sessionId: string;
  chainId: string;
  state: ChainState;
  /** Node ids in the order they were advanced past. Length = steps actually executed. */
  executionOrder: string[];
  startTime: number;
  lastActivity: number;
  originalArgs: Record<string, unknown>;
  /** Continuity scope ID for tenant isolation. Sessions with matching scope are visible to each other. */
  continuityScopeId?: string;
  /**
   * Every open gate review of the run, keyed by the node it grades — the one review store, and
   * the only review field the residual document persists. Absent when no review is open.
   *
   * A detached (`await: run`) node's review (`kind: 'detached'`, row 4.8) opens against its LATE
   * report, when the run already stands elsewhere. The store keeps one review per node and never
   * lets one node's review displace another's (`ChainSessionService.setReview`), so a review of a
   * node the run has left can stand beside the current node's. Any open review holds the run open
   * (`nodesHoldingRunOpen`).
   */
  reviews?: Record<string, GateReview>;
  /** Pending shell verification state for bounce-back resume across MCP requests. */
  pendingShellVerification?: PendingShellVerificationSnapshot;
  blueprint?: SessionBlueprint;
  lifecycle?: ChainSessionLifecycle;
  /**
   * Single-use handoff token (2A). Minted by the owning server on
   * `prompt_engine(chain_id, handoff:true)`, stored on the run row, and nulled when another
   * session claims the run. Present only between mint and claim.
   */
  handoffToken?: string;
  /**
   * SEP-1686-aligned run-level status. Sticky on terminal values
   * ('completed' | 'failed' | 'cancelled') — once set, transitions are refused.
   * Defaults to 'working' on createSession.
   */
  runStatus?: ChainRunStatus;
  /** Timestamp set when runStatus transitions to 'completed' (or other terminal). */
  runCompletedAt?: number;
  /** Run-scoped unknowns ledger, populated via applyUnknownObservations. */
  unknownsLedger?: UnknownLedgerEntry[];
  /**
   * Cumulative count of gate verdict submissions this run, incremented in
   * recordGateReviewOutcome. Distinct from a review's `attemptCount`, which is
   * destroyed whenever the review clears on PASS and so cannot answer
   * "how many across the whole run".
   */
  gatesFiredCount?: number;
  /** Cumulative count of the subset of those submissions whose verdict was FAIL. */
  gateRetriesCount?: number;
}

/** Terminal run-status values — sticky once entered. */
export const TERMINAL_RUN_STATUSES: readonly ChainRunStatus[] = [
  'completed',
  'failed',
  'cancelled',
] as const;

export const isTerminalRunStatus = (status: ChainRunStatus | undefined): boolean =>
  status !== undefined && (TERMINAL_RUN_STATUSES as readonly string[]).includes(status);

/**
 * True when a run has finished: its status is terminal, or it has advanced past its last node
 * (`currentNodeId === null`) and nothing holds it open ({@link isRunHeldOpen}).
 *
 * Identity-based on purpose. The ordinal comparison this replaces (`currentStep >= totalSteps`)
 * reports a run *standing on* its final step as finished — the completion lie that made a
 * banner-obeying client abandon a run that still owed one gate verdict. `runStatus` is latched by
 * the pipeline's one completion point (after the stage loop, once the call is graded), so
 * `currentNodeId === null` with no hold is the same fact read earlier in that call, and covers a
 * session loaded from a pre-latch blob. An open review holds the run through
 * {@link nodesHoldingRunOpen}, the one derivation — no second review clause here.
 */
export const isRunComplete = (session: RunHoldFacts & { runStatus?: ChainRunStatus }): boolean =>
  isTerminalRunStatus(session.runStatus) ||
  (session.state.currentNodeId === null && !isRunHeldOpen(session));

/**
 * True when a run has walked past its last node but may not complete yet: a detached
 * (`await: run`) node it spawned has not reported (Tier 4), or a review of one of its nodes is
 * still open. Such a run is NOT complete — its status stays non-terminal, and a resume reaches it
 * to deliver the owed result or verdict (or a cancel). PURE; {@link nodesHoldingRunOpen} is the
 * one derivation.
 */
export const isRunHeldOpen = (run: RunHoldFacts): boolean =>
  run.state.currentNodeId === null && nodesHoldingRunOpen(run).length > 0;

/** What {@link nodesHoldingRunOpen} reads off a run. */
export interface RunHoldFacts {
  readonly state: {
    readonly currentNodeId: string | null;
    readonly nodes?: readonly Pick<ChainNode, 'id'>[];
    readonly stepStates?: ReadonlyMap<string, StepMetadata>;
  };
  readonly reviews?: Readonly<Record<string, unknown>>;
}

/**
 * The nodes a run may not complete without: every detached node still owed its result
 * (`unreportedDetachedNodeIds`), and every node with an open review of any kind — a detached
 * node's late-report review (row 4.8), a step's gate review, or the phase guard's structural
 * review of the final answer (P4.157, which opens AFTER the capture walked the run past its last
 * node). The one derivation the completion guard, `isRunComplete` and the held-run render read.
 * PURE.
 */
export function nodesHoldingRunOpen(run: RunHoldFacts): string[] {
  const owed = unreportedDetachedNodeIds(run.state.nodes ?? [], run.state.stepStates);
  const underReview = Object.keys(run.reviews ?? {}).filter((nodeId) => !owed.includes(nodeId));
  return [...owed, ...underReview];
}

/** Selects a detached node's review; absent, a review method addresses the current-step slot. */
export interface ReviewSlot {
  readonly nodeId: string;
}

/**
 * The current-step review of `reviews`: the review at `currentNodeId` unless that one is
 * detached, else the first non-detached review in the map (a phase-guard or final-step review
 * grades a node the run has already left). With several open that fallback picks one without a
 * node to name — a caller that must address one review resolves it through `resolveReviewTarget`,
 * which refuses the ambiguity. PURE.
 */
export function currentStepReview(
  reviews: Readonly<Record<string, GateReview>> | undefined,
  currentNodeId: string | null
): GateReview | undefined {
  if (reviews === undefined) return undefined;
  const here = currentNodeId === null ? undefined : reviews[currentNodeId];
  if (here !== undefined && here.kind !== 'detached') return here;
  return Object.values(reviews).find((review) => review.kind !== 'detached');
}

/**
 * The phase a review written in the pre-3.1 shape stands in: its own `phase` when it carries one,
 * else the `metadata.phase` a detached review persisted before `phase` existed (row 4.8, reached
 * only by `run-registry`'s legacy load — no writer sets that key any more), else `exhausted` once
 * its attempts are spent, else awaiting a verdict. PURE.
 */
function deriveReviewPhase(review: PendingGateReview): GateReviewPhase {
  if (review.phase !== undefined) return review.phase;
  const recorded = review.metadata?.['phase'];
  if (
    recorded === 'awaiting-verdict' ||
    recorded === 'awaiting-replacement' ||
    recorded === 'exhausted'
  ) {
    return recorded;
  }
  return review.attemptCount >= review.maxAttempts ? 'exhausted' : 'awaiting-verdict';
}

/**
 * The node a review written in the pre-3.1 shape grades: its own `nodeId`, else the `nodeId` its
 * metadata records (the phase guard's graded step), else the node the run stands on, else the
 * node it last left (a final-step review, after the walk past the last node). PURE.
 */
function resolveReviewedNodeId(
  review: PendingGateReview,
  run: {
    readonly state: { readonly currentNodeId: string | null };
    readonly executionOrder: readonly string[];
  }
): string | undefined {
  const recorded = review.metadata?.['nodeId'];
  return (
    review.nodeId ??
    (typeof recorded === 'string' && recorded.length > 0 ? recorded : undefined) ??
    run.state.currentNodeId ??
    run.executionOrder[run.executionOrder.length - 1]
  );
}

/**
 * Stamp a review written in the pre-3.1 shape with its identity and phase. `slot` names a
 * detached node's review; without one the review is the current step's, `structural` when the
 * phase guard opened it and `gate` otherwise — a kind already on the review is kept, so a gate
 * review a structural finding joined stays `gate`. PURE.
 *
 * @throws when no node can be resolved (a run that stands nowhere and never advanced), or when a
 *   review stamped `detached` is written to the current-step slot.
 */
export function stampLegacyReview(
  review: PendingGateReview,
  run: {
    readonly state: { readonly currentNodeId: string | null };
    readonly executionOrder: readonly string[];
  },
  slot?: ReviewSlot
): GateReview {
  if (slot !== undefined) {
    return { ...review, nodeId: slot.nodeId, kind: 'detached', phase: deriveReviewPhase(review) };
  }
  if (review.kind === 'detached') {
    throw new Error(`A detached review of '${review.nodeId}' was written without its node slot`);
  }
  const nodeId = resolveReviewedNodeId(review, run);
  if (nodeId === undefined) {
    throw new Error('A gate review was written to a run that has no node to key it by');
  }
  const kind =
    review.kind ??
    (review.metadata?.['source'] === 'phase-guard-verification' ? 'structural' : 'gate');
  return { ...review, nodeId, kind, phase: deriveReviewPhase(review) };
}

/** What the run's gate counters read off a verdict. */
export interface GateReviewOutcomeUpdate {
  verdict: 'PASS' | 'FAIL';
}

export interface ChainSessionSummary {
  sessionId: string;
  chainId: string;
  currentStep: number;
  totalSteps: number;
  pendingReview: boolean;
  lastActivity: number;
  startTime: number;
  promptName?: string;
  promptId?: string;
}

// Chain runs persist as `chain_runs` + `chain_run_nodes` rows. `ChainRunRegistry.load/save`
// exchange `ChainSession` directly, so no persisted-shape type sits between the store and
// storage — the columns and the residual document ARE the persisted shape.

export interface ChainSessionLookupOptions extends StateStoreOptions {
  includeDormant?: boolean;
}

/**
 * Outcome of claiming a handed-off run (plan 2A). The registry produces the first three; the
 * store adds `no-blueprint` after inspecting what it received (OQ-1: a run nothing can resume
 * is refused rather than loaded).
 */
export type ChainHandoffClaimResult =
  | { status: 'claimed'; session: ChainSession }
  | { status: 'unknown-token' }
  | { status: 'workspace-mismatch'; rowWorkspaceId: string; claimantWorkspaceId: string }
  | { status: 'no-blueprint'; chainId: string };

export interface ChainSessionService {
  /**
   * Create a run.
   *
   * `totalSteps` remains the cardinality of the run; `options.nodes` supplies the run's frozen
   * identity list. Callers that have parsed steps pass `nodes` (ids minted at parse time);
   * callers that only know a count get `mintSequentialIds(totalSteps)` synthesized for them, so
   * the legacy call shape keeps working.
   */
  createSession(
    sessionId: string,
    chainId: string,
    totalSteps: number,
    originalArgs?: Record<string, unknown>,
    options?: StateStoreOptions & { blueprint?: SessionBlueprint; nodes?: ChainNode[] }
  ): Promise<ChainSession>;
  getSession(sessionId: string, scope?: StateStoreOptions): ChainSession | undefined;
  hasActiveSession(sessionId: string): boolean;
  hasActiveSessionForChain(chainId: string): boolean;
  getActiveSessionForChain(chainId: string): ChainSession | undefined;
  getSessionByChainIdentifier(
    chainId: string,
    options?: ChainSessionLookupOptions
  ): ChainSession | undefined;
  getLatestSessionForBaseChain(chainId: string): ChainSession | undefined;
  getRunHistory(baseChainId: string): string[];
  getChainContext(sessionId: string, scope?: StateStoreOptions): Record<string, unknown>;
  /**
   * Pure read projection of the run's record-only complexity facts. Returns undefined
   * when the session is not found (mirrors getSession). Performs no scoring — see
   * {@link RunTelemetry}.
   */
  getRunTelemetry(sessionId: string, scope?: StateStoreOptions): RunTelemetry | undefined;
  getOriginalArgs(sessionId: string): Record<string, unknown>;
  getSessionBlueprint(sessionId: string, scope?: StateStoreOptions): SessionBlueprint | undefined;
  updateSessionBlueprint(sessionId: string, blueprint: SessionBlueprint): Promise<void>;
  getInlineGateIds(sessionId: string, scope?: StateStoreOptions): string[] | undefined;
  /**
   * Store `review` at `reviews[review.nodeId]`, replacing only that node's review: one review per
   * node, and every other node's review stays open.
   */
  setReview(sessionId: string, review: GateReview): Promise<void>;
  /** Remove the review of `nodeId`, whatever its kind; every other node's review stays open. */
  clearReview(sessionId: string, nodeId: string): Promise<void>;
  /**
   * `slot` selects a detached node's review (row 4.8); absent, the current-step slot.
   *
   * @deprecated stamped: (as of 2026-09-23 · flips when `setPendingGateReview` has no `src`
   * caller; stages 16, 19 and 20 still write through it) — stamps the review's identity (`stampLegacyReview`) and delegates to {@link setReview}.
   */
  setPendingGateReview(
    sessionId: string,
    review: PendingGateReview,
    slot?: ReviewSlot
  ): Promise<void>;
  getPendingGateReview(sessionId: string, slot?: ReviewSlot): GateReview | undefined;
  clearPendingGateReview(sessionId: string, slot?: ReviewSlot): Promise<void>;
  setPendingShellVerification(
    sessionId: string,
    state: PendingShellVerificationSnapshot
  ): Promise<void>;
  getPendingShellVerification(sessionId: string): PendingShellVerificationSnapshot | undefined;
  clearPendingShellVerification(sessionId: string): Promise<void>;
  /** Count one verdict in the run's gate counters; the review it answered is not touched. */
  recordGateReviewOutcome(sessionId: string, outcome: GateReviewOutcomeUpdate): Promise<void>;
  clearSession(sessionId: string, scope?: StateStoreOptions): Promise<boolean>;
  clearSessionsForChain(chainId: string, scope?: StateStoreOptions): Promise<void>;
  listActiveSessions(limit?: number, scope?: StateStoreOptions): ChainSessionSummary[];
  updateSessionState(
    sessionId: string,
    nodeId: string,
    stepResult: string,
    metadata?: Record<string, unknown>
  ): Promise<boolean>;
  setStepState(
    sessionId: string,
    nodeId: string,
    milestone: StepMilestone,
    isPlaceholder?: boolean,
    declaredSections?: readonly string[]
  ): boolean;
  /**
   * Record what a render declared to the model for `nodeId`, leaving the node's lifecycle where it
   * stands. A node with no record yet is marked `rendered`, since a render is what is recorded.
   */
  recordStepDeclaration(
    sessionId: string,
    nodeId: string,
    declaredSections: readonly string[]
  ): boolean;
  getStepState(sessionId: string, nodeId: string): StepMetadata | undefined;
  transitionStepState(
    sessionId: string,
    nodeId: string,
    newMilestone: StepMilestone,
    isPlaceholder?: boolean
  ): Promise<boolean>;
  isStepComplete(sessionId: string, nodeId: string): boolean;
  /**
   * Mark a detached (`await: run`) node spawned — its brief was rendered. Idempotent; persisted.
   * The one way a node enters the detached lifecycle the completion guard reads (Tier 4).
   */
  markNodeSpawned(sessionId: string, nodeId: string): Promise<boolean>;
  /**
   * Ask for `completed` on a run standing past its last node — the pipeline's one completion
   * point (after the stage loop; stage 16 also asks on a late-report call whose reply names the
   * outcome). `advanceStep` never
   * completes a run. `transitionRunStatus` still decides; false while anything holds the run.
   */
  completeHeldRun(sessionId: string): Promise<boolean>;
  /**
   * Transition the run-level lifecycle status. Refuses transitions out of terminal
   * states (completed/failed/cancelled). Returns true on accepted transition,
   * false on rejection (terminal-stickiness violation or session not found).
   */
  transitionRunStatus(
    sessionId: string,
    target: ChainRunStatus,
    scope?: StateStoreOptions
  ): Promise<boolean>;
  /**
   * Cancel a chain session. Idempotent: already-cancelled sessions return true.
   * Sets runStatus to 'cancelled' and propagates cancellation to non-terminal
   * step states. Returns false only if session is not found or is in a terminal
   * non-cancelled state (completed/failed).
   */
  cancelChain(sessionId: string, scope?: StateStoreOptions): Promise<boolean>;
  /**
   * Mint a single-use handoff token for a live run (plan 2A). Minting again rotates it.
   * Undefined for an unknown, out-of-scope, or terminal run.
   */
  mintHandoffToken(
    sessionId: string,
    scope?: StateStoreOptions
  ): Promise<{ token: string; chainId: string; sessionId: string } | undefined>;
  /** Claim a run minted elsewhere and load it here; every refusal names its reason (plan 2A). */
  claimHandoff(token: string): Promise<ChainHandoffClaimResult>;
  completeStep(
    sessionId: string,
    nodeId: string,
    options?: { preservePlaceholder?: boolean; metadata?: Record<string, unknown> }
  ): Promise<boolean>;
  /**
   * Advance past `nodeId` after gate validation passes.
   *
   * Returns the node the run now stands at plus its derived ordinal, or `false` when the
   * session does not exist. `nodeId: null` in the result means the run advanced past its
   * terminal node; its `ordinal` is then `totalSteps + 1`, the sentinel the position-keyed
   * arithmetic produced.
   *
   * A `nodeId` that is absent from the run (including the empty string, which callers use when
   * they cannot resolve one) is treated as already-passed: the run is left untouched and its
   * current position is returned.
   *
   * Callers MUST use the returned ordinal to sync pipeline context:
   *   const advanced = await mgr.advanceStep(id, nodeId);
   *   if (advanced !== false) sessionContext.currentStep = advanced.ordinal;
   *
   * Should be called ONLY when:
   * - Gate review passes (PASS verdict)
   * - No gates are configured for this step
   * - Enforcement mode is advisory/informational (non-blocking)
   */
  advanceStep(
    sessionId: string,
    nodeId: string
  ): Promise<{ nodeId: string | null; ordinal: number } | false>;
  /**
   * Insert a node immediately after `afterNodeId` (P4 adaptive mutation).
   *
   * Resolves to the minted node, or `null` when the insertion was refused — the session is
   * unknown, the run is terminal, `afterNodeId` is not in the run, or `afterNodeId` sits behind
   * the node the run is standing at (the new node would never be reached). Existing node ids are
   * never renumbered, so anything already addressed by id survives the insertion.
   *
   * `origin` defaults to `'inserted'`; `unknownId` is persisted so the per-unknown-id insertion
   * cap can be recomputed from rows after a cold load.
   */
  insertNodeAfter(
    sessionId: string,
    afterNodeId: string,
    spec: {
      stepName: string;
      promptId: string;
      origin?: 'planned' | 'inserted';
      unknownId?: string;
    }
  ): Promise<ChainNode | null>;
  /**
   * Apply a caller-authored remainder to the run's plan (OQ-3 / OQ-A1).
   *
   * `mode: 'replace'` swaps every node STRICTLY after the current one for `nodes`;
   * `mode: 'append'` leaves the existing remainder alone and adds `nodes` after it. Both
   * spellings of an append — the structured `remainder: {mode:'append'}` parameter and a
   * leading-`-->` command string — take this one method (OQ-A1: one mechanism, two spellings),
   * so validation, caps and recorded provenance cannot diverge between them.
   *
   * Atomic and awaited: the in-memory node list and the persisted rows move together inside one
   * transaction, and a persistence failure THROWS rather than reporting success (the state
   * mutation contract in `architecture.md` — validate, mutate, await persist, only then report).
   * A REFUSAL is not a failure and does not throw: it comes back as
   * `{kind:'rejected', reason}` with a named {@link RemainderRejectionReason}, the same
   * observable-rejection vocabulary `MutationNoneReason` uses, because "the cap is spent" and
   * "the database is down" are different facts and a caller answers them differently.
   *
   * Every applied node carries `origin: 'remainder'` and `originUnknownId: unknownId`, which is
   * what makes both caps recomputable from persisted rows after a cold load.
   */
  replaceRemainder(
    sessionId: string,
    nodes: readonly RemainderNodeSpec[],
    unknownId: string,
    mode: RemainderMode
  ): Promise<RemainderOutcome>;
  /**
   * Retire a not-yet-executed node ahead of the run (P4 adaptive mutation).
   *
   * The row is preserved and its lifecycle becomes `'skipped'`; `advanceStep` passes over it.
   * Resolves `true` on success and on a repeat skip (idempotent), `false` when refused — the
   * session is unknown, the node is not in the run, the node has already started, or the node is
   * not STRICTLY ahead of the current node (OQ-P4-2: the current node is already rendered
   * client-side and cannot be un-shown).
   */
  markNodeSkipped(sessionId: string, nodeId: string, unknownId: string): Promise<boolean>;
  /** Register a callback invoked when any session is cleared (explicit or stale cleanup). */
  onSessionCleared(
    callback: (sessionId: string, session: ChainSession) => void | Promise<void>
  ): void;
  /**
   * Apply a batch of typed unknown observations to the session's ledger.
   *
   * Validates transitions: resolving requires an existing active id; a
   * re-discover of an existing id is an idempotent statement update rather
   * than a duplicate entry. Mutates the session's `unknownsLedger`, awaits
   * persistence, and throws on persist failure. Invalid transitions surface
   * as tool-result validation errors rather than being silently dropped.
   *
   * Returns the full updated ledger.
   *
   * `nodeId` addresses the step reporting the observations. Ledger entries record the
   * *ordinal at write time* (`discoveredAtStep`/`resolvedAtStep` stay numbers) — that is a
   * historical stamp, not an address, and is deliberately out of the identity flip's scope.
   */
  applyUnknownObservations(
    sessionId: string,
    nodeId: string,
    observations: UnknownObservation[]
  ): Promise<UnknownLedgerEntry[]>;
  cleanup(): Promise<void>;
}
