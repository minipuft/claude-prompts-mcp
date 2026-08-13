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

import type {
  StepMilestone,
  ChainNode,
  ChainRunStatus,
  ChainState,
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
}

export type ChainSessionLifecycle = 'dormant' | 'canonical';

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
   * Pending gate review awaiting user verdict.
   * @remarks Infrastructure for pause/resume validation. APIs implemented but not yet auto-triggered.
   * Planned for future semantic layer gate enforcement.
   */
  pendingGateReview?: PendingGateReview;
  /** Pending shell verification state for bounce-back resume across MCP requests. */
  pendingShellVerification?: PendingShellVerificationSnapshot;
  blueprint?: SessionBlueprint;
  lifecycle?: ChainSessionLifecycle;
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
   * recordGateReviewOutcome. Distinct from `pendingGateReview.attemptCount`, which is
   * destroyed whenever the pending review clears on PASS and so cannot answer
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
 * (`currentNodeId === null`).
 *
 * Identity-based on purpose. The ordinal comparison this replaces (`currentStep >= totalSteps`)
 * reports a run *standing on* its final step as finished — the completion lie that made a
 * banner-obeying client abandon a run that still owed one gate verdict. `runStatus` is the
 * primary signal because the store latches it at the moment the run passes its terminal node;
 * `currentNodeId === null` is the same fact read off the state document, and covers a session
 * loaded from a pre-latch blob.
 */
export const isRunComplete = (session: {
  runStatus?: ChainRunStatus;
  state: { currentNodeId: string | null };
}): boolean => isTerminalRunStatus(session.runStatus) || session.state.currentNodeId === null;

export interface GateReviewOutcomeUpdate {
  verdict: 'PASS' | 'FAIL';
  rationale?: string;
  rawVerdict: string;
  reviewer?: string;
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
  setPendingGateReview(sessionId: string, review: PendingGateReview): Promise<void>;
  getPendingGateReview(sessionId: string): PendingGateReview | undefined;
  clearPendingGateReview(sessionId: string): Promise<void>;
  setPendingShellVerification(
    sessionId: string,
    state: PendingShellVerificationSnapshot
  ): Promise<void>;
  getPendingShellVerification(sessionId: string): PendingShellVerificationSnapshot | undefined;
  clearPendingShellVerification(sessionId: string): Promise<void>;
  isRetryLimitExceeded(sessionId: string): boolean;
  resetRetryCount(sessionId: string): Promise<void>;
  recordGateReviewOutcome(
    sessionId: string,
    outcome: GateReviewOutcomeUpdate
  ): Promise<'cleared' | 'pending'>;
  clearSession(sessionId: string): Promise<boolean>;
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
    isPlaceholder?: boolean
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
