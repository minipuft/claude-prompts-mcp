// @lifecycle canonical - Manages chain session persistence and lifecycle promotion.
/**
 * Chain Session Store
 *
 * Manages chain execution sessions, providing the bridge between MCP session IDs
 * and the persisted chain state/step capture utilities. This enables stateful
 * chain execution across multiple MCP tool calls.
 *
 * CRITICAL: Uses SQLite-backed persistence to survive STDIO transport's ephemeral processes.
 * Sessions are saved to disk after every change and loaded on initialization.
 */

import { DirectChainRunRegistry, type ChainRunRegistry } from './run-registry.js';
import { StepState } from '../../shared/types/chain-execution.js';
import { isTerminalRunStatus } from '../../shared/types/chain-session.js';
import { resolveContinuityScopeId } from '../../shared/utils/request-identity-scope.js';
import { ArgumentHistoryTracker, TextReferenceStore } from '../text-refs/index.js';

import type {
  ChainSession,
  ChainSessionLookupOptions,
  ChainSessionService,
  ChainSessionSummary,
  GateReviewOutcomeUpdate,
  ParsedCommandSnapshot,
  PersistedChainRunRegistry,
  SessionBlueprint,
} from './types.js';
import type {
  ChainRunStatus,
  GateReviewHistoryEntry,
  PendingGateReview,
  PendingShellVerificationSnapshot,
  StepMetadata,
  GateReviewPrompt,
} from '../../shared/types/chain-execution.js';
import type { Logger } from '../../shared/types/index.js';
import type { DatabasePort, StateStoreOptions } from '../../shared/types/persistence.js';

/** Callback invoked when a session is cleared (cleanup or explicit). */
export type SessionClearedCallback = (
  sessionId: string,
  session: ChainSession
) => void | Promise<void>;

export interface ChainSessionStoreOptions {
  serverRoot?: string;
  defaultSessionTimeoutMs?: number;
  reviewSessionTimeoutMs?: number;
  cleanupIntervalMs?: number;
}

/** @deprecated Use ChainSessionStoreOptions */
export type ChainSessionManagerOptions = ChainSessionStoreOptions;

const DEFAULT_SESSION_TIMEOUT_MS = 24 * 60 * 60 * 1000;
const DEFAULT_REVIEW_SESSION_TIMEOUT_MS = 30 * 60 * 1000;
const DEFAULT_CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
const MAX_RUN_HISTORY = 10;
const CHAIN_RUN_STORE_VERSION = 2;

/**
 * Chain Session Store
 *
 * Coordinates session state between MCP protocol, step capture, and execution context tracking.
 * Provides session-aware context retrieval for chain execution.
 */
export class ChainSessionStore implements ChainSessionService {
  private logger: Logger;
  private textReferenceStore: TextReferenceStore;
  private argumentHistoryTracker?: ArgumentHistoryTracker;
  private activeSessions: Map<string, ChainSession> = new Map();
  private chainSessionMapping: Map<string, Set<string>> = new Map(); // chainId -> sessionIds
  private baseChainMapping: Map<string, string[]> = new Map(); // baseChainId -> ordered runIds
  private runChainToBase: Map<string, string> = new Map(); // runChainId -> baseChainId
  private runRegistry!: ChainRunRegistry;
  private readonly sessionClearedCallbacks: SessionClearedCallback[] = [];
  private readonly serverRoot: string;
  private readonly defaultSessionTimeoutMs: number;
  private readonly reviewSessionTimeoutMs: number;
  private readonly cleanupIntervalMs: number;
  private cleanupIntervalHandle?: NodeJS.Timeout;
  private injectedDbEngine?: DatabasePort;
  private resolvedDbEngine?: DatabasePort;
  private readonly serverPid = String(process.pid);
  private readonly pidScope: StateStoreOptions = { continuityScopeId: String(process.pid) };
  private initPromise!: Promise<void>;

  constructor(
    logger: Logger,
    textReferenceStore: TextReferenceStore,
    options: ChainSessionStoreOptions,
    dbEngineOrTracker?: DatabasePort | ArgumentHistoryTracker,
    sessionStore?: ChainRunRegistry
  ) {
    this.logger = logger;
    this.textReferenceStore = textReferenceStore;

    // Detect 4th arg type: DatabasePort (DI for tests) or ArgumentHistoryTracker
    if (dbEngineOrTracker instanceof ArgumentHistoryTracker) {
      this.argumentHistoryTracker = dbEngineOrTracker;
    } else if (dbEngineOrTracker !== undefined) {
      this.injectedDbEngine = dbEngineOrTracker;
    }

    this.serverRoot = options.serverRoot ?? '';
    this.defaultSessionTimeoutMs = options.defaultSessionTimeoutMs ?? DEFAULT_SESSION_TIMEOUT_MS;
    this.reviewSessionTimeoutMs =
      options.reviewSessionTimeoutMs ?? DEFAULT_REVIEW_SESSION_TIMEOUT_MS;
    this.cleanupIntervalMs = options.cleanupIntervalMs ?? DEFAULT_CLEANUP_INTERVAL_MS;

    // Store provided sessionStore or defer to initialize() for SQLite-backed default
    if (sessionStore) {
      this.runRegistry = sessionStore;
    }

    this.logger.debug('ChainSessionStore initialized with text reference manager integration');

    // Initialize asynchronously — store promise so callers can await it
    this.initPromise = this.initialize();
    this.startCleanupScheduler();
  }

  /** Late-bind DatabasePort (setter injection, matching codebase convention). */
  setDatabasePort(db: DatabasePort): void {
    this.injectedDbEngine = db;
    this.resolvedDbEngine = db;
  }

  /**
   * Initialize the manager asynchronously
   */
  private async initialize(): Promise<void> {
    try {
      // Create SQLite-backed registry if no custom store was provided
      if (!this.runRegistry) {
        const dbManager = this.injectedDbEngine;
        if (!dbManager) {
          this.logger.warn('ChainSessionStore: no DatabasePort provided, persistence disabled');
          return;
        }
        await dbManager.initialize();
        this.resolvedDbEngine = dbManager;
        this.runRegistry = new DirectChainRunRegistry(dbManager);
      }
      await this.runRegistry.ensureInitialized();
      this.cleanupStalePidRows();
      await this.loadSessions();
    } catch (error) {
      this.logger.warn(
        `Failed to initialize ChainSessionStore: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * Register a callback invoked when any session is cleared (explicit or stale cleanup).
   * Used by pipeline wiring to clean up cross-layer state (e.g., verify-state.db).
   */
  onSessionCleared(callback: SessionClearedCallback): void {
    this.sessionClearedCallbacks.push(callback);
  }

  /**
   * Fire-and-forget cleanup scheduler (unref to avoid blocking shutdown)
   */
  private startCleanupScheduler(): void {
    if (this.cleanupIntervalHandle) {
      this.cleanupIntervalHandle.unref();
      return;
    }

    this.cleanupIntervalHandle = setInterval(() => {
      this.cleanupStaleSessions().catch((error) => {
        this.logger.warn(
          `Failed to run scheduled session cleanup: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      });
    }, this.cleanupIntervalMs);

    this.cleanupIntervalHandle.unref();
  }

  /**
   * Load sessions from file (for STDIO transport persistence)
   */
  private async loadSessions(): Promise<void> {
    try {
      const parsed = await this.runRegistry.load(this.pidScope);

      const persistedSessions = parsed.runs ?? parsed.sessions ?? {};
      const persistedChainMapping = parsed.runMapping ?? parsed.chainMapping ?? {};
      const persistedBaseMapping = parsed.baseRunMapping ?? parsed.baseChainMapping ?? {};

      // Restore activeSessions Map
      for (const [sessionId, session] of Object.entries(persistedSessions)) {
        const chainSession = session as ChainSession;

        // Deserialize stepStates Map from array format
        if (chainSession.state.stepStates && Array.isArray(chainSession.state.stepStates)) {
          chainSession.state.stepStates = new Map(chainSession.state.stepStates as any);
        } else if (!chainSession.state.stepStates) {
          chainSession.state.stepStates = new Map();
        }

        // All persisted sessions become dormant until explicitly resumed
        chainSession.lifecycle = 'dormant';
        this.activeSessions.set(sessionId, chainSession);
      }

      // Restore chainSessionMapping Map
      for (const [chainId, sessionIds] of Object.entries(persistedChainMapping)) {
        this.chainSessionMapping.set(chainId, new Set(sessionIds));
      }

      this.baseChainMapping.clear();
      this.runChainToBase.clear();
      for (const [baseChainId, runChainIds] of Object.entries(persistedBaseMapping)) {
        this.baseChainMapping.set(baseChainId, [...runChainIds]);
      }

      if (parsed.runToBase ?? parsed.runChainToBase) {
        const runToBaseRecord = parsed.runToBase ?? parsed.runChainToBase;
        for (const [runChainId, baseChainId] of Object.entries(runToBaseRecord ?? {})) {
          if (typeof baseChainId === 'string') {
            this.runChainToBase.set(runChainId, baseChainId);
          }
        }
      }

      this.ensureRunMappingConsistency();

      this.logger.debug(
        `Loaded ${this.activeSessions.size} persisted chain runs from session store`
      );
    } catch (error) {
      this.logger.warn(
        `Failed to load persisted sessions: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * Save sessions to file (for STDIO transport persistence)
   */
  private async saveSessions(): Promise<void> {
    await this.persistSessions();
  }

  private serializeSessions(): PersistedChainRunRegistry {
    const serializedSessions: Record<string, any> = {};
    for (const [sessionId, session] of this.activeSessions) {
      const sessionCopy: any = JSON.parse(JSON.stringify(session));
      sessionCopy.lifecycle = session.lifecycle ?? 'canonical';
      if (session.state?.stepStates instanceof Map) {
        sessionCopy.state = sessionCopy.state ?? {};
        sessionCopy.state.stepStates = Array.from(session.state.stepStates.entries());
      }
      serializedSessions[sessionId] = sessionCopy;
    }

    return {
      version: CHAIN_RUN_STORE_VERSION,
      runs: serializedSessions,
      runMapping: Object.fromEntries(
        Array.from(this.chainSessionMapping.entries()).map(([chainId, sessionIds]) => [
          chainId,
          Array.from(sessionIds),
        ])
      ),
      baseRunMapping: Object.fromEntries(
        Array.from(this.baseChainMapping.entries()).map(([baseChainId, runIds]) => [
          baseChainId,
          [...runIds],
        ])
      ),
      runToBase: Object.fromEntries(this.runChainToBase.entries()),
    };
  }

  /**
   * Persist chain sessions to durable storage. Wraps the SSOT blob save and the
   * derived per-row hook view in a single SQLite transaction so the two stay in
   * lockstep — either both committed or both rolled back.
   *
   * `chain_run_registry` (blob) is the SSOT; `chain_sessions` (per-row) is a
   * projection of the active hook-relevant subset. See `projectToHookView` for
   * the projection contract.
   */
  private async persistSessions(): Promise<void> {
    const db = this.resolvedDbEngine;
    try {
      const data = this.serializeSessions();
      if (!db) {
        // No DB engine wired — fall back to non-transactional save (test contexts).
        await this.runRegistry.save(data, this.pidScope);
        return;
      }
      db.beginTransaction();
      try {
        await this.runRegistry.save(data, this.pidScope);
        this.projectToHookView(db);
        db.commit();
      } catch (txError) {
        db.rollback();
        throw txError;
      }
    } catch (error) {
      this.logger.error(
        `Failed to save sessions: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Project active canonical sessions into the per-row `chain_sessions` table.
   *
   * `chain_sessions` is a derived hook-read view of the `chain_run_registry`
   * blob (the SSOT). The blob carries the full data model (sessions + run
   * mappings + base mappings); this projection writes the active hook-relevant
   * subset in per-row form so Python hooks can do indexed PID-scoped queries
   * without parsing the JSON blob.
   *
   * Filter rule: a session is "active for hooks" if it has steps remaining or
   * a pending gate review / shell verification (see `isSessionActiveForHooks`).
   * `tenant_id` is the server PID for cross-client isolation.
   *
   * Must be called inside an active transaction. The caller (`persistSessions`)
   * owns the transaction boundary so blob save and projection succeed or fail
   * atomically.
   */
  private projectToHookView(db: DatabasePort): void {
    const activeRows = this.collectActiveSessionRows();
    db.run('DELETE FROM chain_sessions WHERE tenant_id = ?', [this.serverPid]);
    for (const row of activeRows) {
      db.run(
        `INSERT INTO chain_sessions (tenant_id, chain_id, run_number, state, run_status, run_completed_at)
         VALUES (?, ?, 1, ?, ?, ?)`,
        [this.serverPid, row.chainId, row.state, row.runStatus, row.runCompletedAt]
      );
    }
  }

  /**
   * Collect active canonical sessions that need hook visibility.
   * A session is "active" if it has steps remaining or pending review/verification.
   */
  private collectActiveSessionRows(): Array<{
    chainId: string;
    state: string;
    runStatus: ChainRunStatus;
    runCompletedAt: number | null;
  }> {
    const rows: Array<{
      chainId: string;
      state: string;
      runStatus: ChainRunStatus;
      runCompletedAt: number | null;
    }> = [];
    for (const session of this.activeSessions.values()) {
      if (session.lifecycle !== 'canonical') continue;
      if (!this.isSessionActiveForHooks(session)) continue;
      const runStatus: ChainRunStatus = session.runStatus ?? 'working';
      rows.push({
        chainId: session.chainId,
        runStatus,
        runCompletedAt: session.runCompletedAt ?? null,
        state: JSON.stringify({
          sessionId: session.sessionId,
          chainId: session.chainId,
          currentStep: session.state.currentStep,
          totalSteps: session.state.totalSteps,
          lastActivity: session.lastActivity,
          pendingGateReview: session.pendingGateReview ?? null,
          pendingShellVerification: session.pendingShellVerification ?? null,
          runStatus,
          runCompletedAt: session.runCompletedAt ?? null,
        }),
      });
    }
    return rows;
  }

  /** Whether a session should be visible to hooks (in-progress or pending review). */
  private isSessionActiveForHooks(session: ChainSession): boolean {
    if (isTerminalRunStatus(session.runStatus)) return false;
    const { currentStep, totalSteps } = session.state;
    if (currentStep > 0 && currentStep < totalSteps) return true;
    return (
      currentStep > 0 &&
      currentStep === totalSteps &&
      (session.pendingGateReview != null || session.pendingShellVerification != null)
    );
  }

  /**
   * Collect tenant_id values from a table where the PID is dead (not alive).
   * Skips non-numeric IDs and optionally skips the current process PID.
   */
  // DB engine accessed via this.resolvedDbEngine (set in initialize or setDatabasePort)

  private collectDeadPidTenants(db: DatabasePort, query: string, skipOwnPid: boolean): string[] {
    const rows = db.query<{ tenant_id: string }>(query);
    const dead: string[] = [];
    for (const row of rows) {
      const pid = parseInt(row.tenant_id, 10);
      if (isNaN(pid)) continue;
      if (skipOwnPid && row.tenant_id === this.serverPid) continue;
      try {
        process.kill(pid, 0);
      } catch {
        dead.push(row.tenant_id);
      }
    }
    return dead;
  }

  /**
   * Remove rows belonging to dead server processes from both chain_sessions
   * and chain_run_registry tables. Called once at startup to prevent stale
   * rows from blocking hooks or consuming storage.
   */
  private cleanupStalePidRows(): void {
    const db = this.resolvedDbEngine;
    if (!db) return;

    try {
      // Clean chain_sessions (per-row PID table for hooks)
      const staleSessions = this.collectDeadPidTenants(
        db,
        'SELECT DISTINCT tenant_id FROM chain_sessions',
        false
      );
      for (const pid of staleSessions) {
        db.run('DELETE FROM chain_sessions WHERE tenant_id = ?', [pid]);
      }

      // Clean chain_run_registry (PID-scoped blob rows) + legacy 'default' row
      db.run("DELETE FROM chain_run_registry WHERE tenant_id = 'default'");
      const staleRegistry = this.collectDeadPidTenants(
        db,
        'SELECT tenant_id FROM chain_run_registry',
        true
      );
      for (const pid of staleRegistry) {
        db.run('DELETE FROM chain_run_registry WHERE tenant_id = ?', [pid]);
      }

      const totalCleaned = staleSessions.length + staleRegistry.length;
      if (totalCleaned > 0) {
        this.logger.debug(`Cleaned up ${totalCleaned} stale PID rows from session/registry tables`);
      }
    } catch (error) {
      this.logger.debug(
        `cleanupStalePidRows failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  private persistSessionsAsync(context: string): void {
    this.saveSessions().catch((error) => {
      this.logger.warn(
        `[ChainSessionManager] Failed to persist sessions (${context}): ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    });
  }

  /**
   * Create a new chain session
   */
  async createSession(
    sessionId: string,
    chainId: string,
    totalSteps: number,
    originalArgs: Record<string, any> = {},
    options?: StateStoreOptions & { blueprint?: SessionBlueprint }
  ): Promise<ChainSession> {
    await this.initPromise;
    const resolvedScope = options?.continuityScopeId ?? resolveContinuityScopeId(options);
    const session: ChainSession = {
      sessionId,
      chainId,
      state: {
        // Chain sessions track steps using 1-based indexing to align with pipeline expectations
        currentStep: totalSteps > 0 ? 1 : 0,
        totalSteps,
        lastUpdated: Date.now(),
        stepStates: new Map<number, StepMetadata>(),
      },
      executionOrder: [],
      startTime: Date.now(),
      lastActivity: Date.now(),
      originalArgs,
      continuityScopeId: resolvedScope,
      ...(options?.blueprint !== undefined && {
        blueprint: this.cloneBlueprint(options.blueprint),
      }),
      lifecycle: 'canonical',
      runStatus: 'working',
    };

    this.activeSessions.set(sessionId, session);

    // Track chain to session mapping
    if (!this.chainSessionMapping.has(chainId)) {
      this.chainSessionMapping.set(chainId, new Set());
    }
    this.chainSessionMapping.get(chainId)!.add(sessionId);

    const baseChainId = this.registerRunHistory(chainId);
    await this.pruneExcessRuns(baseChainId);

    // Persist to file
    await this.saveSessions();

    this.logger.debug(
      `Created chain session ${sessionId} for chain ${chainId} with ${totalSteps} steps`
    );
    return session;
  }

  /**
   * Get session by ID
   */
  getSession(sessionId: string, scope?: StateStoreOptions): ChainSession | undefined {
    const session = this.activeSessions.get(sessionId);
    if (session) {
      // Scope filtering: if scope provided, only return if scope matches
      if (scope) {
        const resolvedScope = scope.continuityScopeId ?? resolveContinuityScopeId(scope);
        if (session.continuityScopeId && session.continuityScopeId !== resolvedScope) {
          return undefined;
        }
      }
      if (
        session.state.totalSteps > 0 &&
        (!session.state.currentStep || session.state.currentStep < 1)
      ) {
        session.state.currentStep = 1;
      }
      session.lastActivity = Date.now();
      this.promoteSessionLifecycle(session, 'session-id lookup');
    }
    return session;
  }

  /**
   * Set step state for a specific step
   */
  setStepState(
    sessionId: string,
    stepNumber: number,
    state: StepState,
    isPlaceholder: boolean = false
  ): boolean {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      this.logger?.warn(
        `[StepLifecycle] Cannot set step state for non-existent session: ${sessionId}`
      );
      return false;
    }

    if (!session.state.stepStates) {
      session.state.stepStates = new Map<number, StepMetadata>();
    }

    const existing = session.state.stepStates.get(stepNumber);
    const now = Date.now();

    const metadata: StepMetadata = {
      state,
      isPlaceholder,
      ...(existing?.renderedAt !== undefined
        ? { renderedAt: existing.renderedAt }
        : state === StepState.RENDERED
          ? { renderedAt: now }
          : {}),
      ...(state === StepState.RESPONSE_CAPTURED
        ? { respondedAt: now }
        : existing?.respondedAt !== undefined
          ? { respondedAt: existing.respondedAt }
          : {}),
      ...(state === StepState.COMPLETED
        ? { completedAt: now }
        : existing?.completedAt !== undefined
          ? { completedAt: existing.completedAt }
          : {}),
    };

    session.state.stepStates.set(stepNumber, metadata);

    this.logger?.debug(
      `[StepLifecycle] Step ${stepNumber} state set to ${state} (placeholder: ${isPlaceholder})`
    );
    return true;
  }

  /**
   * Get step state for a specific step
   */
  getStepState(sessionId: string, stepNumber: number): StepMetadata | undefined {
    const session = this.activeSessions.get(sessionId);
    if (!session?.state.stepStates) {
      return undefined;
    }
    return session.state.stepStates.get(stepNumber);
  }

  /**
   * Transition step to a new state.
   *
   * Enforces step-lifecycle stickiness: a step in StepState.COMPLETED (terminal)
   * cannot be overwritten. Re-asserting the same terminal state is a no-op
   * (returns true to keep callers idempotent).
   */
  async transitionStepState(
    sessionId: string,
    stepNumber: number,
    newState: StepState,
    isPlaceholder: boolean = false
  ): Promise<boolean> {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      this.logger?.warn(
        `[StepLifecycle] Cannot transition step state for non-existent session: ${sessionId}`
      );
      return false;
    }

    const currentMetadata = this.getStepState(sessionId, stepNumber);
    const currentState = currentMetadata?.state;

    // Stickiness: refuse to overwrite a terminal step state with a different state.
    if (currentState === StepState.COMPLETED && newState !== StepState.COMPLETED) {
      this.logger.warn(
        `[StepLifecycle] Refusing to transition step ${stepNumber} from terminal ${currentState} to ${newState} (session ${sessionId})`
      );
      return false;
    }

    const fromLabel = currentState ?? 'NONE';
    this.logger.debug(
      `[StepLifecycle] Transitioning step ${stepNumber} from ${fromLabel} to ${newState}`
    );

    this.setStepState(sessionId, stepNumber, newState, isPlaceholder);

    await this.saveSessions();

    return true;
  }

  /**
   * Transition the run-level lifecycle status. Refuses transitions out of terminal
   * states (completed/failed/cancelled). Re-asserting the same terminal status is
   * a no-op (returns true) to keep callers idempotent.
   */
  async transitionRunStatus(
    sessionId: string,
    target: ChainRunStatus,
    scope?: StateStoreOptions
  ): Promise<boolean> {
    const session = this.getSessionForMutation(sessionId, scope);
    if (session === undefined) {
      this.logger.warn(
        `[ChainRunStatus] Cannot transition run status for non-existent or out-of-scope session: ${sessionId}`
      );
      return false;
    }

    const currentStatus: ChainRunStatus = session.runStatus ?? 'working';

    if (currentStatus === target) {
      return true;
    }

    if (isTerminalRunStatus(currentStatus)) {
      this.logger.warn(
        `[ChainRunStatus] Refusing to transition session ${sessionId} from terminal status '${currentStatus}' to '${target}'`
      );
      return false;
    }

    session.runStatus = target;
    if (isTerminalRunStatus(target)) {
      session.runCompletedAt = Date.now();
    }
    session.lastActivity = Date.now();

    this.logger.debug(
      `[ChainRunStatus] Transitioned session ${sessionId} from '${currentStatus}' to '${target}'`
    );

    await this.saveSessions();
    return true;
  }

  /**
   * Cancel a chain session. Idempotent on already-cancelled sessions. Refuses
   * sessions already in terminal completed/failed (a terminal state cannot be
   * overridden by cancel — call sites should check status first).
   *
   * Side effects:
   *  - runStatus → 'cancelled'
   *  - non-terminal step states (PENDING/RENDERED/RESPONSE_CAPTURED) → COMPLETED is reserved
   *    for the SEP-1686 StepLifecycle migration; here we leave step metadata untouched and
   *    rely on runStatus terminality + step-level stickiness to prevent further progression.
   */
  async cancelChain(sessionId: string, scope?: StateStoreOptions): Promise<boolean> {
    const session = this.getSessionForMutation(sessionId, scope);
    if (session === undefined) {
      this.logger.warn(
        `[ChainRunStatus] Cannot cancel non-existent or out-of-scope session: ${sessionId}`
      );
      return false;
    }

    const currentStatus: ChainRunStatus = session.runStatus ?? 'working';
    if (currentStatus === 'cancelled') {
      return true;
    }
    if (currentStatus === 'completed' || currentStatus === 'failed') {
      this.logger.warn(
        `[ChainRunStatus] Refusing to cancel session ${sessionId} in terminal status '${currentStatus}'`
      );
      return false;
    }

    session.runStatus = 'cancelled';
    session.runCompletedAt = Date.now();
    session.lastActivity = Date.now();

    this.logger.info(`[ChainRunStatus] Cancelled session ${sessionId} (was '${currentStatus}')`);

    await this.saveSessions();
    return true;
  }

  /**
   * Resolve a session for state-mutating operations with optional scope filtering.
   * Returns undefined if session does not exist or scope mismatch.
   */
  private getSessionForMutation(
    sessionId: string,
    scope?: StateStoreOptions
  ): ChainSession | undefined {
    const session = this.activeSessions.get(sessionId);
    if (session === undefined) return undefined;
    if (scope !== undefined) {
      const resolvedScope = scope.continuityScopeId ?? resolveContinuityScopeId(scope);
      const sessionScope = session.continuityScopeId;
      if (sessionScope !== undefined && sessionScope !== resolvedScope) {
        return undefined;
      }
    }
    return session;
  }

  /**
   * Check if a step is complete (not a placeholder and in COMPLETED state)
   */
  isStepComplete(sessionId: string, stepNumber: number): boolean {
    const metadata = this.getStepState(sessionId, stepNumber);
    return metadata?.state === StepState.COMPLETED && !metadata.isPlaceholder;
  }

  /**
   * Update session state after step rendering or completion
   * IMPORTANT: This method now handles both rendering (template storage) and completion
   */
  async updateSessionState(
    sessionId: string,
    stepNumber: number,
    stepResult: string,
    stepMetadata?: Record<string, any>
  ): Promise<boolean> {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      if (this.logger) {
        this.logger.warn(`Attempted to update non-existent session: ${sessionId}`);
      }
      return false;
    }

    const metadataRecord = {
      ...(stepMetadata || {}),
      isPlaceholder: stepMetadata?.['isPlaceholder'] ?? false,
      storedAt: Date.now(),
    };

    const isPlaceholder = metadataRecord.isPlaceholder;

    // Determine the appropriate state based on whether this is a placeholder
    const stepState = isPlaceholder ? StepState.RENDERED : StepState.RESPONSE_CAPTURED;

    // Update step state tracking
    this.setStepState(sessionId, stepNumber, stepState, isPlaceholder);

    // NOTE: Step advancement is now handled by advanceStep() which should be called
    // ONLY after gate validation passes (or if no gates are configured).
    // This prevents the bug where retry would skip to the next step.
    this.logger?.debug(
      `[StepLifecycle] Step ${stepNumber} ${isPlaceholder ? 'rendered as placeholder' : 'response captured'}, ` +
        `currentStep remains ${session.state.currentStep} (advancement deferred to advanceStep())`
    );

    session.state.lastUpdated = Date.now();
    session.lastActivity = Date.now();

    await this.persistStepResult(
      session,
      stepNumber,
      stepResult,
      metadataRecord,
      metadataRecord.isPlaceholder
    );

    // Persist to file
    await this.saveSessions();

    return true;
  }

  /**
   * Update an existing step result (e.g., replace placeholder with LLM output)
   */
  async updateStepResult(
    sessionId: string,
    stepNumber: number,
    stepResult: string,
    stepMetadata?: Record<string, any>
  ): Promise<boolean> {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      if (this.logger) {
        this.logger.warn(`Attempted to update result for non-existent session: ${sessionId}`);
      }
      return false;
    }

    const existingMetadata =
      this.textReferenceStore.getChainStepMetadata(session.chainId, stepNumber) || {};

    const mergedMetadata = {
      ...existingMetadata,
      ...(stepMetadata || {}),
      isPlaceholder: stepMetadata?.['isPlaceholder'] ?? false,
      updatedAt: Date.now(),
    };

    const isPlaceholder = mergedMetadata.isPlaceholder;

    // Update step state: if we're replacing a placeholder with real content, transition to RESPONSE_CAPTURED
    if (!isPlaceholder) {
      this.setStepState(sessionId, stepNumber, StepState.RESPONSE_CAPTURED, false);
      this.logger?.debug(
        `[StepLifecycle] Step ${stepNumber} updated with real response, state transitioned to RESPONSE_CAPTURED`
      );
    }

    await this.persistStepResult(
      session,
      stepNumber,
      stepResult,
      mergedMetadata,
      mergedMetadata.isPlaceholder
    );

    session.lastActivity = Date.now();
    session.state.lastUpdated = Date.now();

    await this.saveSessions();
    return true;
  }

  /**
   * Mark a step as COMPLETED and advance the step counter
   * This should be called AFTER the step response has been captured and validated
   */
  async completeStep(
    sessionId: string,
    stepNumber: number,
    options?: { preservePlaceholder?: boolean }
  ): Promise<boolean> {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      this.logger?.warn(
        `[StepLifecycle] Cannot complete step for non-existent session: ${sessionId}`
      );
      return false;
    }

    const existingMetadata = this.getStepState(sessionId, stepNumber);
    const preservePlaceholder = Boolean(options?.preservePlaceholder);
    const isPlaceholder = preservePlaceholder ? Boolean(existingMetadata?.isPlaceholder) : false;

    // Transition to COMPLETED state while respecting placeholder metadata when requested
    this.setStepState(sessionId, stepNumber, StepState.COMPLETED, isPlaceholder);

    // NOTE: Step advancement is now handled by advanceStep() which should be called
    // ONLY after gate validation passes. This prevents the retry-skip bug.
    this.logger?.debug(
      `[StepLifecycle] Step ${stepNumber} marked COMPLETED${isPlaceholder ? ' (placeholder)' : ''}, ` +
        `currentStep remains ${session.state.currentStep} (call advanceStep() to advance)`
    );

    session.state.lastUpdated = Date.now();
    session.lastActivity = Date.now();

    await this.saveSessions();
    return true;
  }

  /**
   * Advance to the next step after gate validation passes.
   * This should be called ONLY when:
   * - Gate review passes (PASS verdict)
   * - No gates are configured for this step
   * - Enforcement mode is advisory/informational (non-blocking)
   *
   * @param sessionId - The session identifier
   * @param stepNumber - The step that was completed (will advance to stepNumber + 1)
   * @returns true if advanced successfully, false if session not found
   */
  async advanceStep(sessionId: string, stepNumber: number): Promise<number | false> {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      this.logger?.warn(
        `[StepLifecycle] Cannot advance step for non-existent session: ${sessionId}`
      );
      return false;
    }

    // Only advance if we're at or before this step (prevent double-advancement)
    if (session.state.currentStep > stepNumber) {
      this.logger?.debug(
        `[StepLifecycle] Step ${stepNumber} already passed, currentStep is ${session.state.currentStep}`
      );
      return session.state.currentStep;
    }

    session.state.currentStep = stepNumber + 1;
    if (!session.executionOrder.includes(stepNumber)) {
      session.executionOrder.push(stepNumber);
    }

    session.state.lastUpdated = Date.now();
    session.lastActivity = Date.now();

    this.logger?.debug(
      `[StepLifecycle] Advanced from step ${stepNumber} to step ${session.state.currentStep}`
    );

    await this.saveSessions();
    return session.state.currentStep;
  }

  /**
   * Persist a step result to storage and optional tracking systems.
   */
  private async persistStepResult(
    session: ChainSession,
    stepNumber: number,
    stepResult: string,
    metadata: Record<string, any>,
    isPlaceholder: boolean
  ): Promise<void> {
    const metadataPayload = {
      ...metadata,
      isPlaceholder,
    };

    this.textReferenceStore.storeChainStepResult(
      session.chainId,
      stepNumber,
      stepResult,
      metadataPayload
    );

    if (this.argumentHistoryTracker && !isPlaceholder) {
      try {
        await this.argumentHistoryTracker.trackExecution({
          promptId: session.chainId,
          sessionId: session.sessionId,
          originalArgs: session.originalArgs || {},
          stepNumber,
          stepResult,
          metadata: {
            executionType: 'chain',
            chainId: session.chainId,
            ...metadataPayload,
          },
        });
      } catch (error) {
        this.logger?.error('[ChainSessionManager] Failed to track argument history entry', {
          chainId: session.chainId,
          stepNumber,
          error,
        });
      }
    }
  }

  /**
   * Get chain context for session - this is the critical method for fixing contextData
   */
  getChainContext(sessionId: string, _scope?: StateStoreOptions): Record<string, any> {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      this.logger.debug(`No session found for ${sessionId}, returning empty context`);
      return {};
    }

    // Get chain variables from text reference manager (single source of truth)
    const chainVariables = this.textReferenceStore.buildChainVariables(session.chainId);

    // Get original arguments + previous results from ArgumentHistoryTracker (with graceful fallback)
    let argumentContext = {};
    let reviewContext:
      | {
          originalArgs: Record<string, unknown>;
          previousResults: Record<number, string>;
          currentStep?: number;
          totalSteps?: number;
        }
      | undefined;
    if (this.argumentHistoryTracker) {
      try {
        reviewContext = this.argumentHistoryTracker.buildReviewContext(
          sessionId,
          session.state.currentStep
        );
        argumentContext = reviewContext.originalArgs;
      } catch (error) {
        // Fallback to session's originalArgs if tracker fails
        this.logger.debug(
          `Failed to get arguments from ArgumentHistoryTracker, using session originalArgs: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
        argumentContext = session.originalArgs;
      }
    } else {
      // Fallback to session's originalArgs if tracker not available
      argumentContext = session.originalArgs;
    }

    // Merge with session-specific context
    const contextData: Record<string, any> = {
      // Core session info
      chain_run_id: sessionId,
      chain_id: session.chainId,
      current_step: session.state.currentStep,
      total_steps: session.state.totalSteps,
      execution_order: session.executionOrder,

      // Chain variables (step results, etc.) from TextReferenceStore
      ...chainVariables,

      // Original arguments - spread for template access AND nested for intent rendering
      ...argumentContext,
      original_args: argumentContext,
    };

    if (reviewContext && Object.keys(reviewContext.previousResults).length > 0) {
      contextData['previous_step_results'] = { ...reviewContext.previousResults };
    }

    const currentStepArgs = this.getCurrentStepArgs(session);
    if (currentStepArgs && Object.keys(currentStepArgs).length > 0) {
      contextData['currentStepArgs'] = currentStepArgs;
      // Expose step arguments as {{input}} for template access
      contextData['input'] = currentStepArgs;
    }

    const chainMetadata = this.buildChainMetadata(session);
    if (chainMetadata) {
      contextData['chain_metadata'] = chainMetadata;
    }

    this.logger.debug(
      `Retrieved context for session ${sessionId}: ${
        Object.keys(contextData).length
      } context variables (including ${Object.keys(argumentContext).length} original arguments)`
    );
    return contextData;
  }

  /**
   * Get original arguments for session
   */
  getOriginalArgs(sessionId: string): Record<string, any> {
    const session = this.activeSessions.get(sessionId);
    return session?.originalArgs || {};
  }

  getSessionBlueprint(sessionId: string, _scope?: StateStoreOptions): SessionBlueprint | undefined {
    const session = this.activeSessions.get(sessionId);
    if (!session?.blueprint) {
      return undefined;
    }
    return this.cloneBlueprint(session.blueprint);
  }

  async updateSessionBlueprint(sessionId: string, blueprint: SessionBlueprint): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      if (this.logger) {
        this.logger.warn(
          `[ChainSessionManager] Attempted to update blueprint for non-existent session: ${sessionId}`
        );
      }
      return;
    }

    session.blueprint = this.cloneBlueprint(blueprint);
    await this.saveSessions();
  }

  getInlineGateIds(sessionId: string, _scope?: StateStoreOptions): string[] | undefined {
    const session = this.activeSessions.get(sessionId);
    if (!session?.blueprint?.parsedCommand) {
      return undefined;
    }

    const inlineIds = this.collectInlineGateIds(session.blueprint.parsedCommand);
    return inlineIds.length > 0 ? inlineIds : undefined;
  }

  async setPendingGateReview(sessionId: string, review: PendingGateReview): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      if (this.logger) {
        this.logger.warn(
          `Attempted to set pending gate review for non-existent session: ${sessionId}`
        );
      }
      return;
    }

    session.pendingGateReview = {
      ...review,
      gateIds: [...review.gateIds],
      prompts: review.prompts.map((prompt) => {
        const mappedPrompt: GateReviewPrompt = {
          ...prompt,
        };
        if (prompt.explicitInstructions !== undefined) {
          mappedPrompt.explicitInstructions = [...prompt.explicitInstructions];
        }
        if (prompt.metadata !== undefined) {
          mappedPrompt.metadata = { ...prompt.metadata };
        }
        return mappedPrompt;
      }),
      ...(review.retryHints !== undefined && { retryHints: [...review.retryHints] }),
      ...(review.history !== undefined && {
        history: review.history.map((entry) => ({ ...entry })),
      }),
      ...(review.metadata !== undefined && { metadata: { ...review.metadata } }),
    };

    await this.saveSessions();
  }

  getPendingGateReview(sessionId: string): PendingGateReview | undefined {
    const session = this.activeSessions.get(sessionId);
    if (!session?.pendingGateReview) {
      return undefined;
    }

    const review = session.pendingGateReview;
    return {
      ...review,
      gateIds: [...review.gateIds],
      prompts: review.prompts.map((prompt) => {
        const mappedPrompt: GateReviewPrompt = {
          ...prompt,
        };
        if (prompt.explicitInstructions !== undefined) {
          mappedPrompt.explicitInstructions = [...prompt.explicitInstructions];
        }
        if (prompt.metadata !== undefined) {
          mappedPrompt.metadata = { ...prompt.metadata };
        }
        return mappedPrompt;
      }),
      ...(review.retryHints !== undefined && { retryHints: [...review.retryHints] }),
      ...(review.history !== undefined && {
        history: review.history.map((entry) => ({ ...entry })),
      }),
      ...(review.metadata !== undefined && { metadata: { ...review.metadata } }),
    };
  }

  /**
   * Check if the retry limit has been exceeded for a pending gate review.
   * Returns true if attemptCount >= maxAttempts.
   * @remarks Uses DEFAULT_RETRY_LIMIT (2) when maxAttempts not specified.
   */
  isRetryLimitExceeded(sessionId: string): boolean {
    const review = this.getPendingGateReview(sessionId);
    if (!review) {
      return false;
    }
    // Import would create circular dependency, so we inline the default (2)
    // This matches DEFAULT_RETRY_LIMIT from gates/constants.ts
    const maxAttempts = review.maxAttempts ?? 2;
    return (review.attemptCount ?? 0) >= maxAttempts;
  }

  /**
   * Reset the retry count for a pending gate review.
   * Used when user chooses to retry after retry exhaustion.
   */
  async resetRetryCount(sessionId: string): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (!session?.pendingGateReview) {
      this.logger?.debug?.(
        `[ChainSessionManager] No pending gate review to reset for session: ${sessionId}`
      );
      return;
    }

    // Reset attempt count and log in history
    session.pendingGateReview.attemptCount = 0;
    session.pendingGateReview.history = session.pendingGateReview.history ?? [];
    session.pendingGateReview.history.push({
      timestamp: Date.now(),
      status: 'reset',
      reasoning: 'User requested retry after exhaustion',
    });

    await this.saveSessions();

    this.logger?.info?.(`[ChainSessionManager] Reset retry count for session: ${sessionId}`);
  }

  async clearPendingGateReview(sessionId: string): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (!session?.pendingGateReview) {
      return;
    }

    delete session.pendingGateReview;
    await this.saveSessions();
  }

  async setPendingShellVerification(
    sessionId: string,
    state: PendingShellVerificationSnapshot
  ): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      this.logger?.warn?.(
        `Attempted to set pending shell verification for non-existent session: ${sessionId}`
      );
      return;
    }

    session.pendingShellVerification = { ...state };
    await this.saveSessions();
  }

  getPendingShellVerification(sessionId: string): PendingShellVerificationSnapshot | undefined {
    const session = this.activeSessions.get(sessionId);
    return session?.pendingShellVerification ? { ...session.pendingShellVerification } : undefined;
  }

  async clearPendingShellVerification(sessionId: string): Promise<void> {
    const session = this.activeSessions.get(sessionId);
    if (!session?.pendingShellVerification) {
      return;
    }

    delete session.pendingShellVerification;
    await this.saveSessions();
  }

  async recordGateReviewOutcome(
    sessionId: string,
    outcome: GateReviewOutcomeUpdate
  ): Promise<'cleared' | 'pending'> {
    const session = this.activeSessions.get(sessionId);
    if (!session?.pendingGateReview) {
      this.logger?.warn(
        `[GateReview] Attempted to record verdict for non-existent session: ${sessionId}`
      );
      return 'pending';
    }

    const review = session.pendingGateReview;
    const timestamp = Date.now();

    review.history ??= [];
    const historyEntry: GateReviewHistoryEntry = {
      timestamp,
      status: outcome.verdict.toLowerCase(),
      ...(outcome.rationale !== undefined && { reasoning: outcome.rationale }),
      ...(outcome.reviewer !== undefined && { reviewer: outcome.reviewer }),
    };
    review.history.push(historyEntry);
    review.previousResponse = outcome.rawVerdict;
    review.attemptCount = (review.attemptCount ?? 0) + 1;

    let result: 'cleared' | 'pending';
    if (outcome.verdict === 'PASS') {
      delete session.pendingGateReview;
      this.logger?.info('[GateReview] Cleared pending review', {
        sessionId,
        gateIds: review.gateIds,
      });
      result = 'cleared';
    } else {
      this.logger?.info('[GateReview] Review failed, awaiting remediation', {
        sessionId,
        gateIds: review.gateIds,
      });
      result = 'pending';
    }

    await this.saveSessions();
    return result;
  }

  /**
   * Check if session exists and is active
   */
  hasActiveSession(sessionId: string): boolean {
    return this.activeSessions.has(sessionId);
  }

  /**
   * Check if chain has any active sessions
   */
  hasActiveSessionForChain(chainId: string): boolean {
    const sessionIds = this.chainSessionMapping.get(chainId);
    if (!sessionIds) {
      return false;
    }

    for (const sessionId of sessionIds) {
      const session = this.activeSessions.get(sessionId);
      if (session && !this.isDormantSession(session)) {
        return true;
      }
    }
    return false;
  }

  getRunHistory(baseChainId: string): string[] {
    const normalized = this.extractBaseChainId(baseChainId);
    const history = this.baseChainMapping.get(normalized);
    if (history && history.length > 0) {
      return [...history];
    }

    if (this.chainSessionMapping.has(normalized)) {
      return [normalized];
    }

    const fallbackRuns = Array.from(this.chainSessionMapping.keys()).filter(
      (chainId) => this.extractBaseChainId(chainId) === normalized
    );

    return fallbackRuns.sort((a, b) => {
      const runA = this.getRunNumber(a) ?? 0;
      const runB = this.getRunNumber(b) ?? 0;
      return runA - runB;
    });
  }

  getLatestSessionForBaseChain(baseChainId: string): ChainSession | undefined {
    const normalized = this.extractBaseChainId(baseChainId);
    const history = this.baseChainMapping.get(normalized);

    if (history && history.length > 0) {
      for (let idx = history.length - 1; idx >= 0; idx -= 1) {
        const runChainId = history[idx];
        if (runChainId === undefined) {
          continue;
        }
        const sessionIds = this.chainSessionMapping.get(runChainId);
        if (!sessionIds) {
          continue;
        }
        for (const sessionId of sessionIds) {
          const session = this.activeSessions.get(sessionId);
          if (session && !this.isDormantSession(session)) {
            return session;
          }
        }
      }
    }

    return this.getActiveSessionForChain(normalized);
  }

  getSessionByChainIdentifier(
    chainId: string,
    options?: ChainSessionLookupOptions
  ): ChainSession | undefined {
    const includeDormant = options?.includeDormant ?? false;
    const scopeFilter = this.resolveScopeFilter(options);

    // Scope-aware lookup: find best matching session across active/dormant states
    const found = this.findScopedSessionForChain(chainId, scopeFilter, includeDormant);
    if (found) {
      if (found.lifecycle === 'dormant') {
        this.promoteSessionLifecycle(found, 'explicit chain resume');
      }
      return found;
    }

    // Try base chain fallback
    const normalized = this.extractBaseChainId(chainId);
    const baseFallback = this.findScopedSessionForChain(normalized, scopeFilter, includeDormant);
    if (baseFallback) {
      if (baseFallback.lifecycle === 'dormant') {
        this.promoteSessionLifecycle(baseFallback, 'explicit base chain resume');
      }
      return baseFallback;
    }

    return undefined;
  }

  /**
   * Find the best session for a chainId that matches the scope filter.
   * Prefers active over dormant, most recent by lastActivity.
   */
  private findScopedSessionForChain(
    chainId: string,
    scopeFilter: string | undefined,
    includeDormant: boolean
  ): ChainSession | undefined {
    const sessionIds = this.chainSessionMapping.get(chainId);
    if (!sessionIds || sessionIds.size === 0) return undefined;

    let bestActive: ChainSession | undefined;
    let bestDormant: ChainSession | undefined;
    let bestActiveTime = 0;
    let bestDormantTime = 0;

    for (const sessionId of sessionIds) {
      const session = this.activeSessions.get(sessionId);
      if (!session || !this.matchesScope(session, scopeFilter)) continue;

      if (this.isDormantSession(session)) {
        if (includeDormant && session.lastActivity > bestDormantTime) {
          bestDormant = session;
          bestDormantTime = session.lastActivity;
        }
      } else if (session.lastActivity > bestActiveTime) {
        bestActive = session;
        bestActiveTime = session.lastActivity;
      }
    }

    return bestActive ?? bestDormant;
  }

  listActiveSessions(limit: number = 50, scope?: StateStoreOptions): ChainSessionSummary[] {
    const scopeFilter = this.resolveScopeFilter(scope);
    const summaries: ChainSessionSummary[] = [];
    for (const session of this.activeSessions.values()) {
      if (this.isDormantSession(session)) {
        continue;
      }
      if (!this.matchesScope(session, scopeFilter)) {
        continue;
      }
      const promptName = session.blueprint?.parsedCommand?.convertedPrompt?.name;
      const promptId =
        session.blueprint?.parsedCommand?.convertedPrompt?.id ??
        session.blueprint?.parsedCommand?.promptId;
      const summary: ChainSessionSummary = {
        sessionId: session.sessionId,
        chainId: session.chainId,
        currentStep: session.state.currentStep,
        totalSteps: session.state.totalSteps,
        pendingReview: Boolean(session.pendingGateReview),
        lastActivity: session.lastActivity,
        startTime: session.startTime,
        ...(promptName !== undefined && { promptName }),
        ...(promptId !== undefined && { promptId }),
      };
      summaries.push(summary);
    }

    summaries.sort((a, b) => b.lastActivity - a.lastActivity);
    return limit > 0 ? summaries.slice(0, limit) : summaries;
  }

  /**
   * Get active session for chain (returns first active session)
   */
  getActiveSessionForChain(chainId: string): ChainSession | undefined {
    const sessionIds = this.chainSessionMapping.get(chainId);
    if (!sessionIds || sessionIds.size === 0) {
      return undefined;
    }

    // Return the most recently active session
    let mostRecentSession: ChainSession | undefined;
    let mostRecentActivity = 0;

    for (const sessionId of sessionIds) {
      const session = this.activeSessions.get(sessionId);
      if (session && !this.isDormantSession(session) && session.lastActivity > mostRecentActivity) {
        mostRecentSession = session;
        mostRecentActivity = session.lastActivity;
      }
    }

    return mostRecentSession;
  }

  /**
   * Clear session
   */
  async clearSession(sessionId: string): Promise<boolean> {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      return false;
    }

    // Notify listeners before removing session (so they can inspect session state)
    await this.notifySessionCleared(sessionId, session);

    await this.removeSessionArtifacts(sessionId);

    // Remove from chain mapping
    const chainSessions = this.chainSessionMapping.get(session.chainId);
    if (chainSessions) {
      chainSessions.delete(sessionId);
      if (chainSessions.size === 0) {
        this.chainSessionMapping.delete(session.chainId);
        this.removeRunFromBaseTracking(session.chainId);
        this.textReferenceStore.clearChainStepResults(session.chainId);
      }
    }

    // Persist to file
    await this.saveSessions();

    if (this.logger) {
      this.logger.debug(`Cleared session ${sessionId} for chain ${session.chainId}`);
    }
    return true;
  }

  /**
   * Clear all sessions for a chain
   */
  async clearSessionsForChain(chainId: string, scope?: StateStoreOptions): Promise<void> {
    const scopeFilter = this.resolveScopeFilter(scope);
    const baseChainId = this.extractBaseChainId(chainId);
    const runChainIds = chainId === baseChainId ? [...this.getRunHistory(baseChainId)] : [chainId];

    if (runChainIds.length === 0 && this.chainSessionMapping.has(chainId)) {
      runChainIds.push(chainId);
    }

    for (const runChainId of runChainIds) {
      await this.removeRunChainSessionsForScope(runChainId, scopeFilter);
      this.textReferenceStore.clearChainStepResults(runChainId);
      this.removeRunFromBaseTracking(runChainId);
    }

    // Persist to file
    await this.saveSessions();

    if (this.logger) {
      this.logger.debug(`Cleared all sessions for chain ${chainId}`);
    }
  }

  /**
   * Cleanup stale sessions (older than 24 hours)
   */
  async cleanupStaleSessions(): Promise<number> {
    const now = Date.now();
    const reviewThreshold = now - this.reviewSessionTimeoutMs;
    const defaultThreshold = now - this.defaultSessionTimeoutMs;
    let cleaned = 0;

    const staleSessionIds: string[] = [];
    for (const [sessionId, session] of this.activeSessions) {
      const isReviewSession = session.chainId.startsWith('prompt-review-');
      const threshold = isReviewSession ? reviewThreshold : defaultThreshold;
      if (session.lastActivity < threshold) {
        staleSessionIds.push(sessionId);
      }
    }

    for (const sessionId of staleSessionIds) {
      const session = this.activeSessions.get(sessionId);
      await this.clearSession(sessionId);
      cleaned++;
      if (session?.chainId?.startsWith('prompt-review-')) {
        this.logger?.info('[GateReview] Cleaned abandoned prompt review session', {
          sessionId,
          chainId: session.chainId,
          lastActivity: session?.lastActivity,
        });
      }
    }

    if (cleaned > 0) {
      this.logger?.info(
        `Cleaned up ${cleaned} stale chain sessions (default timeout ${this.defaultSessionTimeoutMs}ms, review timeout ${this.reviewSessionTimeoutMs}ms)`
      );
    }

    return cleaned;
  }

  private registerRunHistory(chainId: string): string {
    const baseChainId = this.extractBaseChainId(chainId);
    const history = this.baseChainMapping.get(baseChainId) ?? [];

    const existingIndex = history.indexOf(chainId);
    if (existingIndex >= 0) {
      history.splice(existingIndex, 1);
    }

    history.push(chainId);
    this.baseChainMapping.set(baseChainId, history);
    this.runChainToBase.set(chainId, baseChainId);
    return baseChainId;
  }

  private async pruneExcessRuns(baseChainId: string): Promise<void> {
    const history = this.baseChainMapping.get(baseChainId);
    if (!history) {
      return;
    }

    while (history.length > MAX_RUN_HISTORY) {
      const removedChainId = history.shift();
      if (!removedChainId) {
        break;
      }

      const removedSessions = await this.removeRunChainSessions(removedChainId);
      this.textReferenceStore.clearChainStepResults(removedChainId);
      this.removeRunFromBaseTracking(removedChainId);

      this.logger?.info(
        `Pruned oldest run ${removedChainId} for base ${baseChainId} (keeping ${MAX_RUN_HISTORY} runs)`,
        { removedSessions }
      );
    }

    if (history.length === 0) {
      this.baseChainMapping.delete(baseChainId);
    }
  }

  private async removeRunChainSessions(chainId: string): Promise<string[]> {
    const sessionIds = this.chainSessionMapping.get(chainId);
    const removedSessions: string[] = [];

    if (sessionIds) {
      for (const sessionId of sessionIds) {
        await this.removeSessionArtifacts(sessionId);
        removedSessions.push(sessionId);
      }
      this.chainSessionMapping.delete(chainId);
    }

    return removedSessions;
  }

  private async notifySessionCleared(sessionId: string, session: ChainSession): Promise<void> {
    for (const callback of this.sessionClearedCallbacks) {
      try {
        await callback(sessionId, session);
      } catch (error) {
        this.logger.warn(
          `Session-cleared callback failed for ${sessionId}: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }
  }

  private async removeSessionArtifacts(sessionId: string): Promise<void> {
    if (this.argumentHistoryTracker) {
      try {
        await this.argumentHistoryTracker.clearSession(sessionId);
        this.logger.debug(`Cleared argument history for session ${sessionId}`);
      } catch (error) {
        this.logger.warn(
          `Failed to clear argument history for session ${sessionId}: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
    }

    this.activeSessions.delete(sessionId);
  }

  private removeRunFromBaseTracking(chainId: string): void {
    const baseChainId = this.runChainToBase.get(chainId) ?? this.extractBaseChainId(chainId);
    const history = this.baseChainMapping.get(baseChainId);
    if (history) {
      const filtered = history.filter((entry) => entry !== chainId);
      if (filtered.length > 0) {
        this.baseChainMapping.set(baseChainId, filtered);
      } else {
        this.baseChainMapping.delete(baseChainId);
      }
    }

    this.runChainToBase.delete(chainId);
  }

  private extractBaseChainId(chainId: string): string {
    return chainId.replace(/#\d+$/, '');
  }

  private getRunNumber(chainId: string): number | undefined {
    const match = chainId.match(/#(\d+)$/);
    if (!match) {
      return undefined;
    }
    const matchGroup = match[1];
    if (matchGroup === undefined) {
      return undefined;
    }
    return Number.parseInt(matchGroup, 10);
  }

  private ensureRunMappingConsistency(): void {
    for (const chainId of this.chainSessionMapping.keys()) {
      const baseChainId = this.extractBaseChainId(chainId);
      if (!this.baseChainMapping.has(baseChainId)) {
        this.baseChainMapping.set(baseChainId, []);
      }
      const history = this.baseChainMapping.get(baseChainId)!;
      if (!history.includes(chainId)) {
        history.push(chainId);
        history.sort((a, b) => {
          const runA = this.getRunNumber(a) ?? 0;
          const runB = this.getRunNumber(b) ?? 0;
          return runA - runB;
        });
      }

      if (!this.runChainToBase.has(chainId)) {
        this.runChainToBase.set(chainId, baseChainId);
      }
    }

    for (const [runChainId, baseChainId] of Array.from(this.runChainToBase.entries())) {
      if (!this.chainSessionMapping.has(runChainId)) {
        this.runChainToBase.delete(runChainId);
        const history = this.baseChainMapping.get(baseChainId);
        if (history) {
          const filtered = history.filter((entry) => entry !== runChainId);
          if (filtered.length > 0) {
            this.baseChainMapping.set(baseChainId, filtered);
          } else {
            this.baseChainMapping.delete(baseChainId);
          }
        }
      }
    }
  }

  /**
   * Get session statistics
   */
  getSessionStats(): {
    totalSessions: number;
    totalChains: number;
    averageStepsPerChain: number;
    oldestSessionAge: number;
  } {
    const totalSessions = this.activeSessions.size;
    const totalChains = this.chainSessionMapping.size;

    let totalSteps = 0;
    let oldestSessionTime = Date.now();

    for (const session of this.activeSessions.values()) {
      totalSteps += session.state.currentStep;
      if (session.startTime < oldestSessionTime) {
        oldestSessionTime = session.startTime;
      }
    }

    return {
      totalSessions,
      totalChains,
      averageStepsPerChain: totalChains > 0 ? totalSteps / totalChains : 0,
      oldestSessionAge: Date.now() - oldestSessionTime,
    };
  }

  /**
   * Validate session integrity
   */
  validateSession(sessionId: string): { valid: boolean; issues: string[] } {
    const session = this.activeSessions.get(sessionId);
    const issues: string[] = [];

    if (!session) {
      issues.push('Session not found');
      return { valid: false, issues };
    }

    // Check for stale session
    const hoursSinceActivity = (Date.now() - session.lastActivity) / 3600000;
    if (hoursSinceActivity > 1) {
      issues.push(`Session stale: ${hoursSinceActivity.toFixed(1)} hours since last activity`);
    }

    return { valid: issues.length === 0, issues };
  }

  /**
   * Cleanup the chain session manager and persist state
   * Prevents async handle leaks by finalizing all file operations
   */
  async cleanup(): Promise<void> {
    this.logger.info('Shutting down ChainSessionManager...');

    try {
      if (this.cleanupIntervalHandle !== undefined) {
        clearInterval(this.cleanupIntervalHandle);
        // Use Object.assign to safely clear the optional property
        Object.assign(this, { cleanupIntervalHandle: undefined });
        this.logger.debug('Chain session cleanup scheduler cleared');
      }

      // Perform final state save to persist any pending session data
      await this.saveSessions();
      this.logger.debug('Chain sessions persisted during cleanup');
    } catch (error) {
      this.logger.warn('Error persisting sessions during cleanup:', error);
    }

    // Clear in-memory state
    this.activeSessions.clear();
    this.chainSessionMapping.clear();
    this.baseChainMapping.clear();
    this.runChainToBase.clear();
    this.logger.debug('In-memory session state cleared');

    this.logger.info('ChainSessionManager cleanup complete');
  }

  private isDormantSession(session?: ChainSession | null): boolean {
    return session?.lifecycle === 'dormant';
  }

  private promoteSessionLifecycle(session: ChainSession, reason: string): void {
    if (session.lifecycle === 'canonical') {
      return;
    }
    if (isTerminalRunStatus(session.runStatus)) {
      this.logger.warn(
        `[ChainSessionManager] Refusing to promote session ${session.sessionId} (${reason}): runStatus '${session.runStatus ?? 'unknown'}' is terminal`
      );
      return;
    }
    session.lifecycle = 'canonical';
    this.logger?.debug?.(
      `[ChainSessionManager] Promoted session ${session.sessionId} to canonical (${reason})`
    );
    this.persistSessionsAsync('lifecycle-promotion');
  }

  private getDormantSessionForChain(chainId: string): ChainSession | undefined {
    const sessionIds = this.chainSessionMapping.get(chainId);
    if (!sessionIds) {
      return undefined;
    }

    for (const sessionId of sessionIds) {
      const session = this.activeSessions.get(sessionId);
      if (session && this.isDormantSession(session)) {
        return session;
      }
    }
    return undefined;
  }

  private getDormantSessionForBaseChain(baseChainId: string): ChainSession | undefined {
    const normalized = this.extractBaseChainId(baseChainId);
    const history = this.baseChainMapping.get(normalized) ?? [];
    for (let idx = history.length - 1; idx >= 0; idx -= 1) {
      const runChainId = history[idx];
      if (runChainId === undefined) {
        continue;
      }
      const dormantSession = this.getDormantSessionForChain(runChainId);
      if (dormantSession) {
        return dormantSession;
      }
    }

    return this.getDormantSessionForChain(normalized);
  }

  private buildChainMetadata(session: ChainSession): Record<string, any> | undefined {
    const blueprint = session.blueprint;
    const baseMetadata: Record<string, any> = {
      chainId: session.chainId,
      chainRunId: session.sessionId,
      totalSteps: session.state.totalSteps,
      currentStep: session.state.currentStep,
    };

    if (!blueprint) {
      return baseMetadata;
    }

    const parsed = blueprint.parsedCommand;
    const convertedPrompt = parsed?.convertedPrompt;
    const plan = blueprint.executionPlan;

    const metadata: Record<string, any> = {
      ...baseMetadata,
      promptId: convertedPrompt?.id ?? parsed?.promptId ?? session.chainId,
      name: convertedPrompt?.name ?? parsed?.promptId ?? session.chainId,
      description: convertedPrompt?.description,
      category: convertedPrompt?.category,
      gates: plan?.gates ?? [],
      strategy: plan?.strategy,
      inlineGateIds: this.collectInlineGateIds(parsed),
    };

    return metadata;
  }

  private collectInlineGateIds(parsedCommand?: ParsedCommandSnapshot): string[] {
    if (!parsedCommand) {
      return [];
    }

    const ids = new Set<string>();

    const recordIds = (values?: string[]) => {
      if (!Array.isArray(values)) {
        return;
      }
      for (const id of values) {
        if (typeof id === 'string' && id.trim().length > 0) {
          ids.add(id);
        }
      }
    };

    recordIds(parsedCommand.inlineGateIds);

    if (Array.isArray(parsedCommand.steps)) {
      for (const step of parsedCommand.steps) {
        recordIds(step.inlineGateIds);
      }
    }

    return Array.from(ids);
  }

  private getCurrentStepArgs(session: ChainSession): Record<string, unknown> | undefined {
    const blueprintSteps = session.blueprint?.parsedCommand?.steps;
    if (!Array.isArray(blueprintSteps) || blueprintSteps.length === 0) {
      return undefined;
    }

    const currentStep =
      typeof session.state.currentStep === 'number' ? session.state.currentStep : 1;
    const maxIndex = blueprintSteps.length - 1;
    const resolvedIndex = Math.min(Math.max(currentStep - 1, 0), maxIndex);
    const args = blueprintSteps[resolvedIndex]?.args;
    if (!args || Object.keys(args).length === 0) {
      return undefined;
    }
    return { ...args };
  }

  private cloneBlueprint(blueprint: SessionBlueprint): SessionBlueprint {
    return JSON.parse(JSON.stringify(blueprint)) as SessionBlueprint;
  }

  // --- Scope filtering helpers ---

  /**
   * Resolve scope filter string from optional scope options.
   * Returns undefined when no scope filtering should be applied.
   * Checks explicit continuityScopeId first, then resolves from workspaceId/organizationId.
   */
  private resolveScopeFilter(scope?: StateStoreOptions): string | undefined {
    if (!scope) return undefined;
    // Direct continuityScopeId takes precedence over workspace/org resolution
    if (scope.continuityScopeId && scope.continuityScopeId !== 'default') {
      return scope.continuityScopeId;
    }
    const resolved = resolveContinuityScopeId(scope);
    return resolved === 'default' ? undefined : resolved;
  }

  /**
   * Check if a session matches the resolved scope filter.
   * If no filter is set (undefined), all sessions match.
   */
  private matchesScope(session: ChainSession, scopeFilter: string | undefined): boolean {
    if (!scopeFilter) return true;
    return session.continuityScopeId === scopeFilter;
  }

  /**
   * Remove sessions for a chain that match the scope filter.
   * If no scope filter, removes all sessions for the chain (backward compatible).
   */
  private async removeRunChainSessionsForScope(
    chainId: string,
    scopeFilter: string | undefined
  ): Promise<string[]> {
    if (!scopeFilter) {
      return this.removeRunChainSessions(chainId);
    }

    const sessionIds = this.chainSessionMapping.get(chainId);
    const removedSessions: string[] = [];

    if (sessionIds) {
      for (const sessionId of [...sessionIds]) {
        const session = this.activeSessions.get(sessionId);
        if (session && this.matchesScope(session, scopeFilter)) {
          await this.removeSessionArtifacts(sessionId);
          sessionIds.delete(sessionId);
          removedSessions.push(sessionId);
        }
      }
      // Clean up mapping if all sessions removed
      if (sessionIds.size === 0) {
        this.chainSessionMapping.delete(chainId);
      }
    }

    return removedSessions;
  }
}

/** @deprecated Use ChainSessionStore */
export const ChainSessionManager = ChainSessionStore;
/** @deprecated Use ChainSessionStore */
// eslint-disable-next-line no-redeclare
export type ChainSessionManager = ChainSessionStore;

export type {
  ChainSession,
  ChainSessionService,
  ChainSessionSummary,
  SessionBlueprint,
} from './types.js';

/**
 * Create and configure a chain session store
 */
export function createChainSessionStore(
  logger: Logger,
  textReferenceStore: TextReferenceStore,
  serverRoot: string,
  options?: Omit<ChainSessionStoreOptions, 'serverRoot'>,
  argumentHistoryTracker?: ArgumentHistoryTracker
): ChainSessionStore {
  return new ChainSessionStore(
    logger,
    textReferenceStore,
    {
      serverRoot,
      ...options,
    },
    argumentHistoryTracker
  );
}

/** @deprecated Use createChainSessionStore */
export const createChainSessionManager = createChainSessionStore;
