// @lifecycle canonical - Cross-cutting chain execution types used by engine/, modules/, and mcp/.
/**
 * Chain Execution Types
 *
 * Types that are consumed across multiple architectural layers (engine, modules, mcp).
 * Relocated from mcp/tools/prompt-engine/core/types.ts and engine/execution/types.ts
 * to shared/ to respect the dependency direction: shared → engine → modules → mcp.
 */

/**
 * What just happened to a step. Call sites report a milestone; {@link StepMetadata} derives the
 * sticky {@link StepLifecycle} from it and stamps the matching substate timestamp.
 *
 * `rendered` and `responded` both map to lifecycle `working` — they are distinguished only by
 * which timestamp gets set, which is precisely the distinction a single enum could not express.
 *
 * `skipped` (P4) is the one milestone that is never reported by an executing step: it is asserted
 * by `ChainSessionStore.markNodeSkipped` about a step that will now never execute. It is a
 * milestone rather than a separate marker so that skipping reuses the existing lifecycle
 * plumbing end to end — `setStepState` preserves substate, the `milestone` column persists it,
 * and `run-registry.toStepStates` reconstructs it after a cold load with no new machinery.
 */
export type StepMilestone = 'pending' | 'rendered' | 'responded' | 'completed' | 'skipped';

/**
 * A named item of chain-run context a step's `visibility` declaration can withhold from or
 * expose to that step's render (P5 OQ-P5-1: ruled item-kind addressing for v1 — node-id-addressed
 * exposure hard-depended on `ParsedCommandSnapshot.steps` carrying a nodeId, which it now does as
 * of P6 Tier 2. The blocker is gone; widening this union to node-addressed items is a separate
 * vocabulary decision, not a plumbing one).
 *
 * Tier 1 (schema + type threading) is additive only: declaring `visibility` on a chain step
 * threads it through parsing and persistence, but nothing reads it yet. Consumption is Tier 2-3.
 */
export type VisibilityItem = 'previous_step_output' | 'chain_history' | 'unknowns_ledger';

// `enum StepState` (PENDING | RENDERED | RESPONSE_CAPTURED | COMPLETED) was removed here.
// Its two transient members had no counterpart in the sticky-terminal model: RENDERED and
// RESPONSE_CAPTURED are not states, they are progress *within* `working`, and are now carried
// by the {@link StepSubstate} timestamps (`renderedAt`, `respondedAt`). Use {@link StepLifecycle}.

/**
 * SEP-1686-aligned chain run lifecycle. Terminal states (`completed`, `failed`, `cancelled`)
 * are sticky — once reached, transitions out are forbidden.
 *
 * Vocabulary matches the MCP Tasks spec (SEP-1686) but is not exposed over the wire;
 * this is internal data-model alignment only. Protocol surface (tasks/get, tasks/result,
 * etc.) is deferred until the spec stabilizes.
 */
export type ChainRunStatus = 'working' | 'input_required' | 'completed' | 'failed' | 'cancelled';

/**
 * Per-step lifecycle. Subset of {@link ChainRunStatus} plus `pending` (pre-execution) and
 * `skipped` (P4: the mutation policy retired this step before it ran).
 * Sticky terminal states. Non-sticky progress within `working` is captured by
 * {@link StepSubstate} flags.
 *
 * `skipped` is terminal and is NOT a member of {@link ChainRunStatus} — a run is never skipped,
 * only a step within it. It has no `execution_records` row: a step that never executed produces
 * no execution record, so nothing widens the record status vocabulary in practice.
 */
export type StepLifecycle =
  'pending' | 'working' | 'input_required' | 'completed' | 'failed' | 'cancelled' | 'skipped';

/**
 * Non-sticky progress flags meaningful only when the enclosing step is in `working`.
 * Each timestamp records when the corresponding milestone was reached (epoch ms).
 *
 * Replaces the substate-as-enum granularity of the retired `StepState` enum
 * (RENDERED / RESPONSE_CAPTURED) — multiple substates can be true simultaneously,
 * which is naturally expressed as flags rather than as a single enum value.
 */
export interface StepSubstate {
  renderedAt?: number;
  respondedAt?: number;
  validatingSince?: number;
}

/**
 * Discriminated reason for a step or chain in {@link ChainRunStatus} `input_required`
 * or {@link StepLifecycle} `input_required`. Hooks switch on `kind` to render the
 * correct prompt or enforcement message.
 */
export type InputRequiredReason =
  | { kind: 'awaiting_response' }
  | { kind: 'gate_review'; gateId: string; attempt: number }
  | { kind: 'shell_verification'; commands: string[] }
  | { kind: 'evidence_missing'; missing: string[] };

/**
 * Minimal structural contract for a gate verdict captured on an {@link ExecutionRecord}.
 * Engine code should map its richer `ParsedGateVerdict` (engine/gates/core/gate-verdict-contract)
 * to this shared shape when emitting records — same pattern as
 * {@link import('./chain-session.js').ParsedCommandSnapshot}.
 */
export interface GateVerdictSummary {
  gateId: string;
  verdict: 'PASS' | 'FAIL';
  rationale?: string;
  timestamp: number;
  attempt?: number;
}

/**
 * Declarative evidence contract attached to a prompt or chain step via frontmatter
 * `completion.requires`. The pipeline blocks step advancement when required fields are
 * missing from the captured response (subject to {@link blockOnMissing}).
 *
 * Defaults: `blockOnMissing` SHOULD be treated as `true` when the field is omitted
 * (consumers are responsible for applying the default; interfaces cannot encode defaults).
 */
export interface EvidenceContract {
  requires: string[];
  optional?: string[];
  blockOnMissing: boolean;
}

/**
 * Runtime evidence payload extracted from a step response and validated against
 * the step's {@link EvidenceContract}. Index signature allows extension fields
 * authored on a per-prompt basis without changing this shape.
 */
export interface EvidencePayload {
  summary?: string;
  changedFiles?: string[];
  validations?: Array<{
    command: string;
    status: 'passed' | 'failed' | 'skipped';
    outputSummary?: string;
    reason?: string;
  }>;
  risks?: string[];
  followups?: string[];
  [key: string]: unknown;
}

/**
 * Run-level complexity facts observed by the server at the moment a chain run reaches
 * a terminal state. Record-only: nothing derives a score, weight, or routing decision
 * from these numbers (master decision D4). They exist so a future consumer has real
 * history to reason about, not so the runtime can react to them.
 *
 * `gatesFired` counts gate VERDICT SUBMISSIONS (not distinct gate ids); `gateRetries`
 * counts the subset of those submissions whose verdict was FAIL.
 *
 * `nodesInserted`/`nodesSkipped` (P4) count what the adaptive mutation policy did to the run's
 * node list. Both are derived from the node list and its step states at read time — the same
 * posture as `unknownsOpened`, which reads the ledger rather than a parallel counter, because a
 * counter alongside a list that already holds the fact is a second source that can drift.
 * `stepsPlanned` is the node count AFTER any insertions, so `stepsPlanned - nodesInserted` is
 * what the run started with.
 *
 * `interruptsRaised`/`remaindersAccepted` (D-8) are the surviving record of the mid-chain
 * interrupt once the run's ledger and node rows are gone — both are `ephemeral` and PID-deleted,
 * so `execution_records` is the only place this signal outlives the process. Derived at read
 * time from the same two lists, for the reason the four counters above are:
 *
 * - `interruptsRaised` counts BLOCKING LEDGER ENTRIES, not raise events. `decideInterrupt` is a
 *   function of what is OPEN rather than of a delta, so it re-raises on every step while an
 *   unknown stays open; counting events would report "how many steps ran while blocked", which
 *   is a different fact and one `stepsPlanned` already bounds. One blocking unknown = one
 *   interrupt, whether the run saw it once or six times. Resolved entries still count: the
 *   interrupt WAS raised, and the run's history is what this column records.
 * - `remaindersAccepted` counts DISTINCT unknown ids that spent a remainder, which is exactly
 *   the unit `replaceRemainder`'s per-unknown-id cap counts, so the number and the cap can never
 *   disagree about what "a remainder" is.
 */
export interface RunTelemetry {
  stepsPlanned: number;
  gatesFired: number;
  gateRetries: number;
  unknownsOpened: number;
  unknownsClosed: number;
  nodesInserted: number;
  nodesSkipped: number;
  interruptsRaised: number;
  remaindersAccepted: number;
}

/**
 * Durable per-step (or per-chain when `stepNumber` is null) execution record.
 * One record is appended for each significant lifecycle transition; the resulting
 * series forms the queryable execution log.
 *
 * Persisted to the `execution_records` table. The `executionId` is a ULID so records
 * sort lexicographically by creation order without requiring a separate timestamp index.
 */
export interface ExecutionRecord {
  executionId: string;
  sessionId: string;
  chainId?: string;
  stepNumber?: number;
  /**
   * Stable node identity of the step this record describes. Undefined on run-level terminal
   * records, which describe a run rather than a node. `stepNumber` stays the ordinal at write
   * time — a historical stamp, so the append-only log never renumbers when a run reorders.
   */
  nodeId?: string;
  promptId?: string;
  status: StepLifecycle;
  substate?: StepSubstate;
  inputRequired?: InputRequiredReason;
  startedAt: number;
  completedAt?: number;
  evidence?: EvidencePayload;
  gateVerdicts: GateVerdictSummary[];
  errorMessage?: string;
  organizationId?: string;
  workspaceId?: string;
  /**
   * Run-level telemetry ({@link RunTelemetry}), populated ONLY on terminal records
   * (`completed` / `failed` / `cancelled`). Per-step `working` rows leave these
   * undefined by design — they are run summaries, not per-step facts.
   */
  stepsPlanned?: number;
  gatesFired?: number;
  gateRetries?: number;
  unknownsOpened?: number;
  unknownsClosed?: number;
  nodesInserted?: number;
  nodesSkipped?: number;
  interruptsRaised?: number;
  remaindersAccepted?: number;
  /**
   * S8 delegation-acknowledgment audit, populated ONLY on capture-time `completed` step rows
   * for a step that was BOTH delegated and gated — the one row type where the fact exists
   * (`resolveDelegationSkipped`). `true`: the captured output lacks the contracted
   * `Proposed Gate Review:` block, so the parent likely answered inline instead of spawning.
   * `false`: the block is present. Undefined everywhere else — non-delegated steps, delegated
   * steps with no gates (acknowledgment structurally unobservable), render/terminal rows.
   */
  delegationSkipped?: boolean;
}

/**
 * Embedded in `prompt_engine` tool responses so the agent currently driving the chain
 * has zero-extra-call access to its own execution status. Companion to the
 * `v_execution_status` SQL view used by out-of-process consumers (Python hooks).
 */
export interface ExecutionStatusBlock {
  runStatus: ChainRunStatus;
  chainId?: string;
  currentStep: number;
  totalSteps: number;
  inputRequired?: InputRequiredReason;
  evidenceRequired?: string[];
  lastActivity: number;
}

/**
 * HookRegistry-bound chain lifecycle event surface. Subscribers switch on `type`.
 * `step.*` events carry stepNumber; `chain.*` events apply to the run as a whole.
 */
export type ChainLifecycleEvent =
  | { type: 'step.rendered'; sessionId: string; stepNumber: number }
  | {
      type: 'step.input_required';
      sessionId: string;
      stepNumber: number;
      reason: InputRequiredReason;
    }
  | { type: 'step.response_captured'; sessionId: string; stepNumber: number }
  | {
      type: 'step.evidence_validated';
      sessionId: string;
      stepNumber: number;
      payload: EvidencePayload;
    }
  | { type: 'step.blocked'; sessionId: string; stepNumber: number; reason: string }
  | { type: 'step.completed'; sessionId: string; stepNumber: number }
  | { type: 'step.failed'; sessionId: string; stepNumber: number; error: string }
  | { type: 'chain.cancelled'; sessionId: string }
  | { type: 'chain.completed'; sessionId: string };

/**
 * Metadata tracked for each chain step as it transitions through its lifecycle.
 *
 * Two-tier by design: `state` holds the sticky {@link StepLifecycle} value, while the
 * timestamps below record non-sticky progress *within* `working`. Several timestamps may
 * be set at once, which is why they are flags rather than a single enum value — the
 * distinction the retired `StepState` enum could not express.
 *
 * `renderedAt` and `respondedAt` are the sole discriminators between a step that has only
 * been rendered and one whose response was captured; both are `state: 'working'`.
 */
export interface StepMetadata {
  state: StepLifecycle;
  isPlaceholder: boolean;
  renderedAt?: number;
  respondedAt?: number;
  completedAt?: number;
  /**
   * Phase-guard section headers this step's prompt ACTUALLY declared, verbatim, captured at
   * render time. Not derivable from `phases.yaml` after the fact: that is the source the guard
   * already reads, so re-deriving it would make declared and guarded identical by construction
   * and the advisory branch unreachable. Absent means "no declaration was recorded for this
   * step", which `19-phase-guard-verification-stage` treats as nothing being declared — it can
   * only make blocking rarer, never more frequent.
   */
  declaredSections?: string[];
}

/**
 * History entry captured for each manual gate review attempt.
 */
export interface GateReviewHistoryEntry {
  timestamp: number;
  status: 'pending' | 'pass' | 'fail' | 'retry' | string;
  reasoning?: string;
  reviewer?: string;
}

/**
 * Execution context snapshot attached to a gate review prompt.
 */
export interface GateReviewExecutionContext {
  originalArgs: Record<string, unknown>;
  previousResults: Record<number, string>;
  currentStep?: number;
  totalSteps?: number;
  chainId?: string;
  sessionId?: string;
}

/**
 * Gate review prompt configuration for quality validation.
 */
export interface GateReviewPrompt {
  gateId?: string;
  gateName?: string;
  criteriaSummary: string;
  promptTemplate?: string;
  explicitInstructions?: string[];
  retryHints?: string[];
  previousResponse?: string;
  executionContext?: GateReviewExecutionContext;
  metadata?: Record<string, unknown>;
}

/**
 * Pending gate review payload stored on the session manager so multi-turn
 * reviews can resume after the user responds through the MCP session.
 */
export interface PendingGateReview {
  combinedPrompt: string;
  gateIds: string[];
  prompts: GateReviewPrompt[];
  createdAt: number;
  attemptCount: number;
  maxAttempts: number;
  retryHints?: string[];
  previousResponse?: string;
  /**
   * Extensible metadata. Known keys:
   * - `source`: Origin subsystem (e.g., 'phase-guard-verification', 'gate-enforcement')
   * - `phaseGuardContext`: When phase guards evaluated — `{ allPassed: boolean, phaseCount: number, evaluatedAt: number }`
   * - `failedPhases`: Phase names that failed phase guard checks (phase-guard-sourced reviews only)
   * - `mode`: Phase guard config mode ('enforce' | 'warn')
   */
  metadata?: Record<string, unknown>;
  history?: GateReviewHistoryEntry[];
}

/**
 * Serializable snapshot of pending shell verification state persisted to chain sessions.
 * Enables bounce-back resume across MCP requests (ephemeral ExecutionContext loses this state).
 * Mirrors engine-layer PendingShellVerification without importing engine types.
 */
export interface PendingShellVerificationSnapshot {
  gateId: string;
  shellVerify: {
    /** Mirrors `ShellVerifyGate.command`: argv from a gate file, string from `:: verify:`. */
    command: string | string[];
    timeout?: number;
    workingDir?: string;
    preset?: 'fast' | 'full' | 'extended';
    loop?: boolean;
    maxIterations?: number;
  };
  attemptCount: number;
  maxAttempts: number;
  previousResults: Array<{
    passed: boolean;
    exitCode: number;
    stdout: string;
    stderr: string;
    durationMs: number;
    command: string;
    timedOut?: boolean;
  }>;
  originalGoal?: string;
  sourceGateIds?: string[];
}

/**
 * Framework execution context for prompt processing.
 */
export interface FormatterExecutionContext {
  executionId: string;
  executionType: 'single' | 'chain';
  startTime: number;
  endTime: number;
  frameworkUsed?: string;
  frameworkEnabled: boolean;
  success: boolean;
  stepsExecuted?: number;
  /** Public identifier surfaced to MCP clients */
  chainId?: string;
  /** Internal session handle retained for analytics/logging */
  sessionId?: string;
  chainProgress?: {
    currentStep?: number;
    totalSteps?: number;
    status: 'in_progress' | 'complete';
  };
}

/**
 * Stable node identity for a chain step.
 *
 * Minted once at parse time and frozen for the lifetime of a run: `id` is never recomputed and
 * never renumbered, which is what lets P4 insert or reorder steps without invalidating anything
 * already addressed by node id.
 */
export interface ChainNode {
  id: string;
  promptId: string;
  stepName: string;
  /**
   * Provenance (P4, schema v23). `'inserted'` marks a node the mutation policy added mid-run;
   * `'remainder'` marks one a caller-authored replacement plan contributed (D-8); everything
   * else was in the run when it started.
   *
   * The three values are DISTINCT accounting classes, not shades of one: `'inserted'` counts
   * against the adaptive-insertion cap, `'remainder'` against the remainder cap, and neither
   * count may absorb the other. Widening the union needed no schema bump — the column is
   * `TEXT NOT NULL` with no CHECK and no DDL default (verified 2026-08-30 against
   * `sqlite-engine.ts`'s `chain_run_nodes` DDL), so a new member is a new string, not a
   * migration. `reconstructNodeOrigin` is the one reader that must learn it.
   *
   * OPTIONAL rather than required, and absence means `'planned'`. `ChainNode` is minted at four
   * unrelated sites (`13-session-stage.buildChainNodes`, `ChainSessionStore.resolveCreationNodes`,
   * `run-registry.reconstructSession`, and test helpers), and only the mutation path has an
   * opinion here — a required field would force three call sites to restate the default. The
   * persisted column is NOT NULL: the writer resolves `origin ?? 'planned'`, and reconstruction
   * always sets it explicitly, so a node that has been through storage is never ambiguous.
   */
  origin?: 'planned' | 'inserted' | 'remainder';
  /**
   * The declared unknown id whose blocking discovery caused this node to be inserted, or whose
   * interrupt the accepted remainder answered. Present on `origin: 'inserted'` and
   * `origin: 'remainder'` nodes. Read by the mutation policy's per-unknown-id insertion cap
   * (OQ-P4-5) and by `replaceRemainder`'s per-unknown-id remainder cap, which is why it is
   * carried as data instead of parsed back out of `id`.
   */
  originUnknownId?: string;
}

/**
 * Chain state, addressed by stable node identity rather than by position.
 *
 * Integer positions are still what the hook projection, the state blob, and the rendering
 * contract emit — but they are *derived* here (`shared/utils/node-order.ts`: `ordinalOf`,
 * `totalOf`, `currentOrdinal`) rather than stored, so a run's identity survives reordering.
 */
export interface ChainState {
  /** Node the run is standing at. `null` means the run advanced past its terminal node. */
  currentNodeId: string | null;
  /** Run order, frozen at creation. P4 mutates this inside the persistence transaction. */
  nodes: ChainNode[];
  lastUpdated: number;
  /** Map of node id -> lifecycle metadata */
  stepStates?: Map<string, StepMetadata>;
}
