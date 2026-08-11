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
  ChainRunStatus,
  ChainState,
  PendingGateReview,
  PendingShellVerificationSnapshot,
  RunTelemetry,
  StepMetadata,
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
    inlineGateIds?: string[];
    args?: Record<string, unknown>;
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
  currentStepId?: string;
  executionOrder: number[];
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

export interface PersistedChainRunRegistry {
  version?: number;
  runs?: Record<string, unknown>;
  runMapping?: Record<string, string[]>;
  baseRunMapping?: Record<string, string[]>;
  runToBase?: Record<string, string>;
  /** Legacy keys preserved for backward compatibility */
  sessions?: Record<string, unknown>;
  chainMapping?: Record<string, string[]>;
  baseChainMapping?: Record<string, string[]>;
  runChainToBase?: Record<string, string>;
}

export interface ChainSessionLookupOptions extends StateStoreOptions {
  includeDormant?: boolean;
}

export interface ChainSessionService {
  createSession(
    sessionId: string,
    chainId: string,
    totalSteps: number,
    originalArgs?: Record<string, unknown>,
    options?: StateStoreOptions & { blueprint?: SessionBlueprint }
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
    stepNumber: number,
    stepResult: string,
    metadata?: Record<string, unknown>
  ): Promise<boolean>;
  setStepState(
    sessionId: string,
    stepNumber: number,
    milestone: StepMilestone,
    isPlaceholder?: boolean
  ): boolean;
  getStepState(sessionId: string, stepNumber: number): StepMetadata | undefined;
  transitionStepState(
    sessionId: string,
    stepNumber: number,
    newMilestone: StepMilestone,
    isPlaceholder?: boolean
  ): Promise<boolean>;
  isStepComplete(sessionId: string, stepNumber: number): boolean;
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
    stepNumber: number,
    options?: { preservePlaceholder?: boolean; metadata?: Record<string, unknown> }
  ): Promise<boolean>;
  /**
   * Advance to the next step after gate validation passes.
   * Returns the new step number on success, or false if session not found.
   *
   * Callers MUST use the returned step number to sync pipeline context:
   *   const newStep = await mgr.advanceStep(id, step);
   *   if (newStep !== false) sessionContext.currentStep = newStep;
   *
   * Should be called ONLY when:
   * - Gate review passes (PASS verdict)
   * - No gates are configured for this step
   * - Enforcement mode is advisory/informational (non-blocking)
   */
  advanceStep(sessionId: string, stepNumber: number): Promise<number | false>;
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
   */
  applyUnknownObservations(
    sessionId: string,
    stepNumber: number,
    observations: UnknownObservation[]
  ): Promise<UnknownLedgerEntry[]>;
  cleanup(): Promise<void>;
}
