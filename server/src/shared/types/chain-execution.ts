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
 */
export type StepMilestone = 'pending' | 'rendered' | 'responded' | 'completed';

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
 * Per-step lifecycle. Subset of {@link ChainRunStatus} plus `pending` (pre-execution).
 * Sticky terminal states. Non-sticky progress within `working` is captured by
 * {@link StepSubstate} flags.
 */
export type StepLifecycle =
  | 'pending'
  | 'working'
  | 'input_required'
  | 'completed'
  | 'failed'
  | 'cancelled';

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
    command: string;
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
 * Chain state information with per-step lifecycle tracking.
 */
export interface ChainState {
  currentStep: number;
  totalSteps: number;
  lastUpdated: number;
  /** Map of step number -> lifecycle metadata */
  stepStates?: Map<number, StepMetadata>;
}
