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
import { ArgumentHistoryTracker, TextReferenceStore } from '../text-refs/index.js';

import type {
  StepLifecycle,
  StepMilestone,
  ChainNode,
  ChainRunStatus,
  GateReviewHistoryEntry,
  PendingGateReview,
  PendingShellVerificationSnapshot,
  RunTelemetry,
  StepMetadata,
  GateReviewPrompt,
} from '#shared/types/chain-execution.js';
import type {
  ChainSession,
  ChainSessionLookupOptions,
  ChainSessionService,
  ChainSessionSummary,
  GateReviewOutcomeUpdate,
  ParsedCommandSnapshot,
  SessionBlueprint,
  UnknownLedgerEntry,
  UnknownObservation,
} from '#shared/types/chain-session.js';
import type { Logger } from '#shared/types/index.js';
import type { DatabasePort, StateStoreOptions } from '#shared/types/persistence.js';

// Single owner of unknowns-ledger transition rules. Imported rather than restated here so
// the rules cannot drift between the capture seam that validates and the store that persists.
import { computeUnknownLedger } from '#engine/execution/capture/unknown-observation-processor.js';
import { isTerminalRunStatus } from '#shared/types/chain-session.js';
import { parseRunNumber, stripRunNumber } from '#shared/utils/chain-id-codec.js';
// Node identity is what the store addresses by; every integer position it emits is derived
// here and nowhere else, so the projection arithmetic has exactly one definition.
import {
  currentOrdinal,
  mintInsertionId,
  mintSequentialIds,
  nextAfter,
  nodeIdAt,
  ordinalOf,
  totalOf,
} from '#shared/utils/node-order.js';
import { resolveContinuityScopeId } from '#shared/utils/request-identity-scope.js';

/**
 * Derive the sticky lifecycle value a milestone implies. `rendered` and `responded` are both
 * progress *within* `working`; they are told apart by the substate timestamp, not by this value.
 */
function lifecycleForMilestone(milestone: StepMilestone): StepLifecycle {
  switch (milestone) {
    case 'pending':
      return 'pending';
    case 'completed':
      return 'completed';
    case 'skipped':
      return 'skipped';
    default:
      return 'working';
  }
}

/**
 * Step lifecycles that may not be transitioned out of.
 *
 * `completed` was the only one until P4; `skipped` joins it because a step the mutation policy
 * retired must not be re-rendered by a later capture — the whole point of the skip is that the
 * client never sees it again.
 */
const TERMINAL_STEP_LIFECYCLES: ReadonlySet<StepLifecycle> = new Set<StepLifecycle>([
  'completed',
  'skipped',
]);

/** Step lifecycles that mean "this step has already been rendered, run, or retired". */
function hasStepStarted(state: StepLifecycle | undefined): boolean {
  return state !== undefined && state !== 'pending';
}

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
  /**
   * Workspace scope stamped on the `chain_sessions` hook projection.
   *
   * Distinct from `pidScope`: `chain_sessions.run_owner_pid` is the server PID, which isolates one
   * running server's rows from another's but says nothing about which project they belong to.
   * The scope columns answer that, and until this was supplied they were written NULL and
   * repaired by a startup backfill on the next boot.
   */
  defaultScope?: StateStoreOptions;
}

const DEFAULT_SESSION_TIMEOUT_MS = 24 * 60 * 60 * 1000;
const DEFAULT_REVIEW_SESSION_TIMEOUT_MS = 30 * 60 * 1000;
const DEFAULT_CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
const MAX_RUN_HISTORY = 10;

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
  private readonly defaultSessionTimeoutMs: number;
  private readonly reviewSessionTimeoutMs: number;
  private readonly cleanupIntervalMs: number;
  private cleanupIntervalHandle?: NodeJS.Timeout;
  private injectedDbEngine?: DatabasePort;
  private resolvedDbEngine?: DatabasePort;
  private readonly serverPid = String(process.pid);
  private readonly pidScope: StateStoreOptions = { continuityScopeId: String(process.pid) };
  private readonly workspaceScope: StateStoreOptions | undefined;

  /**
   * Scope for `chain_runs` rows.
   *
   * Merged, not chosen: the PID decides `run_owner_pid` (which server owns the run) while the
   * workspace fills `workspace_id`/`organization_id` (which project it belongs to). They answer
   * different questions, and the registry resolves `run_owner_pid` from `continuityScopeId` first,
   * so adding the workspace keys cannot change run ownership. Passing `pidScope` alone — as this
   * did — left the scope columns NULL for a startup backfill to repair on the next boot.
   *
   * A getter rather than a constructor-computed field because `pidScope` is a field initializer
   * and `workspaceScope` is assigned in the constructor body.
   */
  private get runScope(): StateStoreOptions {
    return { ...this.pidScope, ...(this.workspaceScope ?? {}) };
  }
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

    this.defaultSessionTimeoutMs = options.defaultSessionTimeoutMs ?? DEFAULT_SESSION_TIMEOUT_MS;
    this.reviewSessionTimeoutMs =
      options.reviewSessionTimeoutMs ?? DEFAULT_REVIEW_SESSION_TIMEOUT_MS;
    this.cleanupIntervalMs = options.cleanupIntervalMs ?? DEFAULT_CLEANUP_INTERVAL_MS;
    this.workspaceScope = options.defaultScope;

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
    // The constructor's initialize() runs synchronously to its early return when no port
    // was provided, permanently disabling persistence — and the runtime composition always
    // late-binds the port through this setter, so without re-arming here every fresh
    // server ran with chain-session persistence silently dead (observed live 2026-08-11:
    // "Failed to save sessions: Cannot read properties of undefined (reading 'save')" on
    // every persist, empty chain_runs/chain_sessions while a run was active). Chain onto
    // initPromise so callers awaiting init observe the completed late load.
    if (!this.runRegistry) {
      this.initPromise = this.initPromise
        .then(async () => {
          if (this.runRegistry) return;
          await db.initialize();
          this.runRegistry = new DirectChainRunRegistry(db);
          await this.runRegistry.ensureInitialized();
          this.cleanupStalePidRows();
          await this.loadSessions();
        })
        .catch((error) => {
          this.logger.warn(
            `ChainSessionStore: late DatabasePort initialization failed: ${
              error instanceof Error ? error.message : String(error)
            }`
          );
        });
    }
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
      const sessions = await this.runRegistry.load(this.runScope);

      for (const session of sessions) {
        if (!(session.state.stepStates instanceof Map)) {
          session.state.stepStates = new Map();
        }

        // All persisted sessions become dormant until explicitly resumed
        session.lifecycle = 'dormant';
        this.activeSessions.set(session.sessionId, session);
      }

      // The three mapping dictionaries are rebuilt, not loaded — they are indexes over the chain
      // ids the sessions already carry, and persisting a derivable index alongside its source is
      // how the two come to disagree. `chainSessionMapping` inverts `session.chainId`;
      // `ensureRunMappingConsistency` derives the base mappings from it via `stripRunNumber`,
      // exactly as `registerRunHistory` does on the write path.
      this.chainSessionMapping.clear();
      this.baseChainMapping.clear();
      this.runChainToBase.clear();
      for (const session of sessions) {
        const sessionIds = this.chainSessionMapping.get(session.chainId) ?? new Set<string>();
        sessionIds.add(session.sessionId);
        this.chainSessionMapping.set(session.chainId, sessionIds);
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

  /**
   * Persist chain sessions to durable storage. Wraps the SSOT per-row save and the
   * derived hook view in a single SQLite transaction so the two stay in
   * lockstep — either both committed or both rolled back.
   *
   * `chain_runs` + `chain_run_nodes` are the SSOT; `chain_sessions` (per-row) is a
   * projection of the active hook-relevant subset. See `projectToHookView` for
   * the projection contract.
   *
   * The live session objects are handed to the registry rather than a deep clone: the
   * registry writes columns and one residual document per run, so it reads each field once
   * and nothing outstays the synchronous write. The clone existed to turn `stepStates` into
   * an array for JSON, and `stepStates` is now rows.
   */
  private async persistSessions(): Promise<void> {
    const db = this.resolvedDbEngine;
    try {
      const sessions = Array.from(this.activeSessions.values());
      if (!db) {
        // No DB engine wired — fall back to non-transactional save (test contexts).
        await this.runRegistry.save(sessions, this.runScope);
        return;
      }
      db.beginTransaction();
      try {
        await this.runRegistry.save(sessions, this.runScope);
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
   * `chain_sessions` is a derived hook-read view of `chain_runs` + `chain_run_nodes`
   * (the SSOT). Those carry the full data model; this projection writes the active
   * hook-relevant subset as a single pre-shaped JSON row per run, so Python hooks get
   * the whole answer from one indexed PID-scoped SELECT rather than joining two tables
   * and re-deriving the ordinals themselves.
   *
   * Filter rule: a session is "active for hooks" if it has steps remaining or
   * a pending gate review / shell verification (see `isSessionActiveForHooks`).
   * `run_owner_pid` is the server PID for cross-client isolation.
   *
   * Must be called inside an active transaction. The caller (`persistSessions`)
   * owns the transaction boundary so blob save and projection succeed or fail
   * atomically.
   */
  private projectToHookView(db: DatabasePort): void {
    const activeRows = this.collectActiveSessionRows();
    db.run('DELETE FROM chain_sessions WHERE run_owner_pid = ?', [this.serverPid]);
    for (const row of activeRows) {
      db.run(
        `INSERT INTO chain_sessions (run_owner_pid, organization_id, workspace_id, chain_id, run_number, state, run_status, run_completed_at)
         VALUES (?, ?, ?, ?, 1, ?, ?, ?)`,
        [
          this.serverPid,
          this.workspaceScope?.organizationId ?? null,
          this.workspaceScope?.workspaceId ?? null,
          row.chainId,
          row.state,
          row.runStatus,
          row.runCompletedAt,
        ]
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
          // Positions, not identities: this blob is read by Python hooks across three repos,
          // and its integer keys are a cross-repo contract. Derived here so the store can be
          // node-keyed without the projection changing a byte.
          currentStep: currentOrdinal(session.state.nodes, session.state.currentNodeId),
          totalSteps: totalOf(session.state.nodes),
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
    const currentStep = currentOrdinal(session.state.nodes, session.state.currentNodeId);
    const totalSteps = totalOf(session.state.nodes);
    if (currentStep > 0 && currentStep < totalSteps) return true;
    return (
      currentStep > 0 &&
      currentStep === totalSteps &&
      (session.pendingGateReview != null || session.pendingShellVerification != null)
    );
  }

  /**
   * Collect run_owner_pid values from a table where the PID is dead (not alive).
   * Skips non-numeric IDs and optionally skips the current process PID.
   */
  // DB engine accessed via this.resolvedDbEngine (set in initialize or setDatabasePort)

  private collectDeadRunOwnerPids(db: DatabasePort, query: string, skipOwnPid: boolean): string[] {
    const rows = db.query<{ run_owner_pid: string }>(query);
    const dead: string[] = [];
    for (const row of rows) {
      const pid = parseInt(row.run_owner_pid, 10);
      if (isNaN(pid)) continue;
      if (skipOwnPid && row.run_owner_pid === this.serverPid) continue;
      try {
        process.kill(pid, 0);
      } catch {
        dead.push(row.run_owner_pid);
      }
    }
    return dead;
  }

  /**
   * Remove rows belonging to dead server processes from `chain_sessions` and from the
   * run tables. Called once at startup to prevent stale rows from blocking hooks or
   * consuming storage.
   *
   * The run-table delete is delegated to the registry rather than issued here. This module
   * deleting rows it does not own was a declared foreign-writer exception on the retired
   * blob table; recreating it against the new tables would have carried the exception across
   * a rewrite that could simply not need it.
   */
  private cleanupStalePidRows(): void {
    const db = this.resolvedDbEngine;
    if (!db) return;

    try {
      // Clean chain_sessions (per-row PID table for hooks)
      const staleSessions = this.collectDeadRunOwnerPids(
        db,
        'SELECT DISTINCT run_owner_pid FROM chain_sessions',
        false
      );
      for (const pid of staleSessions) {
        db.run('DELETE FROM chain_sessions WHERE run_owner_pid = ?', [pid]);
      }

      // Clean the PID-scoped run tables. The former `WHERE tenant_id = 'default'` sweep is gone
      // with the v20 rename: the column carries no DEFAULT, so nothing can mint a non-PID owner.
      const staleRuns = this.collectDeadRunOwnerPids(
        db,
        'SELECT DISTINCT run_owner_pid FROM chain_runs',
        true
      );
      this.runRegistry.deleteRunsForOwners(staleRuns);

      const totalCleaned = staleSessions.length + staleRuns.length;
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
        `[ChainSessionStore] Failed to persist sessions (${context}): ${
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
    options?: StateStoreOptions & { blueprint?: SessionBlueprint; nodes?: ChainNode[] }
  ): Promise<ChainSession> {
    await this.initPromise;
    const resolvedScope = options?.continuityScopeId ?? resolveContinuityScopeId(options);
    const nodes = this.resolveCreationNodes(chainId, totalSteps, options?.nodes);
    const session: ChainSession = {
      sessionId,
      chainId,
      state: {
        // A run starts standing at its first node; a zero-node run is complete on arrival.
        currentNodeId: nodes[0]?.id ?? null,
        nodes,
        lastUpdated: Date.now(),
        stepStates: new Map<string, StepMetadata>(),
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
   * Resolve the frozen node list for a new run.
   *
   * Explicit `nodes` win — they carry the ids minted at parse time, which is the only way an
   * authored `id:` reaches the store. Callers that know only a count (tests, gated single
   * prompts, any path with no parsed chain) get synthetic `n1..nK`, which keeps the legacy
   * `createSession(id, chain, totalSteps)` shape working. A mismatch between the two is a
   * caller bug, so it is logged rather than silently reconciled.
   */
  private resolveCreationNodes(
    chainId: string,
    totalSteps: number,
    explicitNodes?: ChainNode[]
  ): ChainNode[] {
    if (explicitNodes !== undefined && explicitNodes.length > 0) {
      if (totalSteps > 0 && explicitNodes.length !== totalSteps) {
        this.logger.warn(
          `[ChainSessionStore] Node list length ${explicitNodes.length} disagrees with totalSteps ${totalSteps} for chain ${chainId}; using the node list`
        );
      }
      // `origin` is normalized on entry rather than left for readers to default. The field is
      // optional on `ChainNode` because four unrelated sites mint one, but the store owns the
      // run's node list, so a node inside a session always carries its provenance — otherwise
      // the same node reads `undefined` in memory and 'planned' after a cold load, and every
      // consumer has to know which side of the round-trip it is holding.
      return explicitNodes.map((node) => ({ ...node, origin: node.origin ?? 'planned' }));
    }

    const count = Math.max(0, totalSteps);
    return mintSequentialIds(count).map((id, index) => ({
      id,
      promptId: chainId,
      stepName: `Step ${index + 1}`,
      origin: 'planned' as const,
    }));
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
      // Repair a run pointing at a node that is not in its own list (corrupt or partially
      // written state) by returning it to the first node — the position-keyed equivalent of
      // the old `currentStep < 1` repair. `null` is left alone: that is a completed run, not
      // a broken pointer.
      const { nodes, currentNodeId } = session.state;
      if (nodes.length > 0 && currentNodeId !== null && ordinalOf(nodes, currentNodeId) === -1) {
        session.state.currentNodeId = nodes[0]?.id ?? null;
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
    nodeId: string,
    milestone: StepMilestone,
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
      session.state.stepStates = new Map<string, StepMetadata>();
    }

    const existing = session.state.stepStates.get(nodeId);
    const now = Date.now();

    const metadata: StepMetadata = {
      state: lifecycleForMilestone(milestone),
      isPlaceholder,
      ...(existing?.renderedAt !== undefined
        ? { renderedAt: existing.renderedAt }
        : milestone === 'rendered'
          ? { renderedAt: now }
          : {}),
      ...(milestone === 'responded'
        ? { respondedAt: now }
        : existing?.respondedAt !== undefined
          ? { respondedAt: existing.respondedAt }
          : {}),
      ...(milestone === 'completed'
        ? { completedAt: now }
        : existing?.completedAt !== undefined
          ? { completedAt: existing.completedAt }
          : {}),
    };

    session.state.stepStates.set(nodeId, metadata);

    this.logger?.debug(
      `[StepLifecycle] Step ${nodeId} milestone ${milestone} -> state ${metadata.state} (placeholder: ${isPlaceholder})`
    );
    return true;
  }

  /**
   * Get step state for a specific step
   */
  getStepState(sessionId: string, nodeId: string): StepMetadata | undefined {
    const session = this.activeSessions.get(sessionId);
    if (!session?.state.stepStates) {
      return undefined;
    }
    return session.state.stepStates.get(nodeId);
  }

  /**
   * Transition step to a new state.
   *
   * Enforces step-lifecycle stickiness: a step in terminal `completed`
   * cannot be overwritten. Re-asserting the same terminal state is a no-op
   * (returns true to keep callers idempotent).
   */
  async transitionStepState(
    sessionId: string,
    nodeId: string,
    newMilestone: StepMilestone,
    isPlaceholder: boolean = false
  ): Promise<boolean> {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      this.logger?.warn(
        `[StepLifecycle] Cannot transition step state for non-existent session: ${sessionId}`
      );
      return false;
    }

    const currentMetadata = this.getStepState(sessionId, nodeId);
    const currentState = currentMetadata?.state;

    // Stickiness: refuse to overwrite a terminal step state with a different state. Re-asserting
    // the same terminal value stays a no-op success, which is why the comparison is against the
    // lifecycle the incoming milestone implies rather than against the milestone name.
    if (
      currentState !== undefined &&
      TERMINAL_STEP_LIFECYCLES.has(currentState) &&
      lifecycleForMilestone(newMilestone) !== currentState
    ) {
      this.logger.warn(
        `[StepLifecycle] Refusing to transition step ${nodeId} from terminal ${currentState} to ${newMilestone} (session ${sessionId})`
      );
      return false;
    }

    const fromLabel = currentState ?? 'NONE';
    this.logger.debug(
      `[StepLifecycle] Transitioning step ${nodeId} from ${fromLabel} to ${newMilestone}`
    );

    this.setStepState(sessionId, nodeId, newMilestone, isPlaceholder);

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
  isStepComplete(sessionId: string, nodeId: string): boolean {
    const metadata = this.getStepState(sessionId, nodeId);
    return metadata?.state === 'completed' && !metadata.isPlaceholder;
  }

  /**
   * Update session state after step rendering or completion
   * IMPORTANT: This method now handles both rendering (template storage) and completion
   */
  async updateSessionState(
    sessionId: string,
    nodeId: string,
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
    const milestone: StepMilestone = isPlaceholder ? 'rendered' : 'responded';

    // Update step state tracking
    this.setStepState(sessionId, nodeId, milestone, isPlaceholder);

    // NOTE: Step advancement is now handled by advanceStep() which should be called
    // ONLY after gate validation passes (or if no gates are configured).
    // This prevents the bug where retry would skip to the next step.
    this.logger?.debug(
      `[StepLifecycle] Step ${nodeId} ${isPlaceholder ? 'rendered as placeholder' : 'response captured'}, ` +
        `run remains at ${session.state.currentNodeId ?? 'complete'} (advancement deferred to advanceStep())`
    );

    session.state.lastUpdated = Date.now();
    session.lastActivity = Date.now();

    await this.persistStepResult(
      session,
      nodeId,
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
    nodeId: string,
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
      this.textReferenceStore.getChainStepMetadata(session.chainId, nodeId) || {};

    const mergedMetadata = {
      ...existingMetadata,
      ...(stepMetadata || {}),
      isPlaceholder: stepMetadata?.['isPlaceholder'] ?? false,
      updatedAt: Date.now(),
    };

    const isPlaceholder = mergedMetadata.isPlaceholder;

    // Update step state: if we're replacing a placeholder with real content, transition to RESPONSE_CAPTURED
    if (!isPlaceholder) {
      this.setStepState(sessionId, nodeId, 'responded', false);
      this.logger?.debug(
        `[StepLifecycle] Step ${nodeId} updated with real response, state transitioned to responded`
      );
    }

    await this.persistStepResult(
      session,
      nodeId,
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
    nodeId: string,
    options?: { preservePlaceholder?: boolean }
  ): Promise<boolean> {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      this.logger?.warn(
        `[StepLifecycle] Cannot complete step for non-existent session: ${sessionId}`
      );
      return false;
    }

    const existingMetadata = this.getStepState(sessionId, nodeId);
    const preservePlaceholder = Boolean(options?.preservePlaceholder);
    const isPlaceholder = preservePlaceholder ? Boolean(existingMetadata?.isPlaceholder) : false;

    // Transition to COMPLETED state while respecting placeholder metadata when requested
    this.setStepState(sessionId, nodeId, 'completed', isPlaceholder);

    // NOTE: Step advancement is now handled by advanceStep() which should be called
    // ONLY after gate validation passes. This prevents the retry-skip bug.
    this.logger?.debug(
      `[StepLifecycle] Step ${nodeId} marked COMPLETED${isPlaceholder ? ' (placeholder)' : ''}, ` +
        `run remains at ${session.state.currentNodeId ?? 'complete'} (call advanceStep() to advance)`
    );

    session.state.lastUpdated = Date.now();
    session.lastActivity = Date.now();

    await this.saveSessions();
    return true;
  }

  /**
   * Advance past `nodeId` after gate validation passes.
   * This should be called ONLY when:
   * - Gate review passes (PASS verdict)
   * - No gates are configured for this step
   * - Enforcement mode is advisory/informational (non-blocking)
   *
   * @param sessionId - The session identifier
   * @param nodeId - The node that was completed (the run moves to the node after it)
   * @returns the node now current plus its derived ordinal, or false if session not found
   */
  async advanceStep(
    sessionId: string,
    nodeId: string
  ): Promise<{ nodeId: string | null; ordinal: number } | false> {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      this.logger?.warn(
        `[StepLifecycle] Cannot advance step for non-existent session: ${sessionId}`
      );
      return false;
    }

    const nodes = session.state.nodes;
    const here = currentOrdinal(nodes, session.state.currentNodeId);
    const target = ordinalOf(nodes, nodeId);

    // Double-advance guard, now a position comparison between two derived ordinals rather than
    // a comparison against a stored counter. An unresolvable `nodeId` scores -1 and so lands in
    // this branch, reproducing the old no-op-on-garbage behaviour rather than advancing blind.
    if (here > target) {
      this.logger?.debug(
        `[StepLifecycle] Node ${nodeId || '(unresolved)'} already passed, run is at ordinal ${here}`
      );
      return { nodeId: session.state.currentNodeId, ordinal: here };
    }

    // `null` when `nodeId` is terminal: the run has moved past its last node.
    //
    // P4: skipped nodes are passed over here, INSIDE the single traversal owner, so the
    // completion latch below still sees the real end of the run — a run whose trailing nodes were
    // all skipped completes on this advance rather than parking on a node nothing will ever
    // render. Skipped nodes are deliberately NOT appended to `executionOrder`: that list is the
    // record of what the run actually executed, and it is read to reconstruct step results, so a
    // node with no result in it would read as an executed step with a missing response.
    let next = nextAfter(nodes, nodeId);
    let skippedPast = 0;
    while (next !== null && session.state.stepStates?.get(next)?.state === 'skipped') {
      skippedPast += 1;
      next = nextAfter(nodes, next);
    }
    if (skippedPast > 0) {
      this.logger.debug(
        `[StepLifecycle] Passed ${skippedPast} skipped node(s) after ${nodeId} (session ${sessionId})`
      );
    }

    session.state.currentNodeId = next;
    if (!session.executionOrder.includes(nodeId)) {
      session.executionOrder.push(nodeId);
    }

    session.state.lastUpdated = Date.now();
    session.lastActivity = Date.now();

    const ordinal = currentOrdinal(nodes, next);
    this.logger?.debug(
      `[StepLifecycle] Advanced past node ${nodeId} to ${next ?? 'run-complete'} (ordinal ${ordinal})`
    );

    await this.saveSessions();

    // The single decision point for run completion. Advancing past the terminal node is the
    // only event that ends a run normally, so the latch lives here rather than in whichever
    // pipeline stage happens to notice the ordinal went out of range — that inference ran in
    // three places and disagreed with the rendered footer, which is what let a client abandon
    // a run that still owed its final gate verdict. `transitionRunStatus` owns terminal
    // stickiness and idempotency, so re-advancing past the same node is a no-op here too.
    if (next === null) {
      await this.transitionRunStatus(sessionId, 'completed');
    }

    return { nodeId: next, ordinal };
  }

  /**
   * Insert a new node immediately after `afterNodeId` (P4 adaptive mutation).
   *
   * Lives beside `advanceStep` because the run's node list has exactly one owner, and an
   * insertion is a traversal-affecting write: the inserted node becomes the natural `nextAfter`
   * of the node the run is standing at, which is what makes it the next CTA with no extra
   * round-trip.
   *
   * Returns the minted node, or `null` when the insertion was refused. `null` rather than a
   * throw matches this store's posture everywhere else (`advanceStep`, `completeStep`,
   * `setStepState` all return a falsy value and warn) — but it is still an OBSERVABLE failure,
   * which a silent no-op returning a fabricated node would not be.
   *
   * Refused when:
   *  - the session does not exist
   *  - the run is in a terminal status (nothing will ever reach the new node)
   *  - `afterNodeId` is not in the run's node list
   *  - `afterNodeId` sits strictly BEHIND the node the run is standing at, which would place the
   *    new node before `currentNodeId` where traversal has already passed. Inserting after the
   *    CURRENT node is the intended case and is allowed.
   *
   * The new id is minted through `mintInsertionId`, so existing node ids are never renumbered —
   * every gate target, execution record and `executionOrder` entry addressed by id stays valid.
   */
  async insertNodeAfter(
    sessionId: string,
    afterNodeId: string,
    spec: {
      stepName: string;
      promptId: string;
      origin?: 'planned' | 'inserted';
      /** The declared unknown that motivated the insertion; stored so the per-unknown-id
       *  insertion cap can be recomputed from persisted rows after a cold load. */
      unknownId?: string;
    }
  ): Promise<ChainNode | null> {
    const session = this.activeSessions.get(sessionId);
    if (session === undefined) {
      this.logger.warn(
        `[ChainMutation] Cannot insert node into non-existent session: ${sessionId}`
      );
      return null;
    }

    if (isTerminalRunStatus(session.runStatus)) {
      this.logger.warn(
        `[ChainMutation] Refusing to insert after ${afterNodeId}: session ${sessionId} is terminal ('${session.runStatus ?? 'unknown'}')`
      );
      return null;
    }

    const nodes = session.state.nodes;
    const anchor = ordinalOf(nodes, afterNodeId);
    if (anchor === -1) {
      this.logger.warn(
        `[ChainMutation] Refusing to insert: node ${afterNodeId} is not in session ${sessionId}`
      );
      return null;
    }

    const here = currentOrdinal(nodes, session.state.currentNodeId);
    if (anchor < here) {
      this.logger.warn(
        `[ChainMutation] Refusing to insert after ${afterNodeId} (ordinal ${anchor}): run is already at ordinal ${here}, so the new node would never be reached`
      );
      return null;
    }

    const nodeId = mintInsertionId(
      spec.unknownId !== undefined ? `inv-${spec.unknownId}` : spec.stepName,
      nodes.map((node) => node.id)
    );
    const inserted: ChainNode = {
      id: nodeId,
      promptId: spec.promptId,
      stepName: spec.stepName,
      origin: spec.origin ?? 'inserted',
    };
    if (spec.unknownId !== undefined) {
      inserted.originUnknownId = spec.unknownId;
    }

    // `anchor` is 1-based, so it is already the array index one past the anchor node.
    nodes.splice(anchor, 0, inserted);

    session.state.lastUpdated = Date.now();
    session.lastActivity = Date.now();

    this.logger.debug(
      `[ChainMutation] Inserted node ${nodeId} after ${afterNodeId} at ordinal ${anchor + 1} of ${totalOf(nodes)} (session ${sessionId}, unknown ${spec.unknownId ?? 'none'})`
    );

    await this.saveSessions();
    return inserted;
  }

  /**
   * Retire a not-yet-executed node ahead of the run (P4 adaptive mutation).
   *
   * The node ROW is preserved — this is a lifecycle assertion, not a deletion — so ordinals of
   * the nodes around it do not shift and anything already addressed by id stays valid.
   * `advanceStep` is what makes the skip observable: it passes over `skipped` nodes when choosing
   * the next current node.
   *
   * `unknownId` is the resolution that motivated the skip. It is recorded in the log and NOT
   * persisted as a column: skips are uncapped in v1 (OQ-P4-5), so no reader needs to recover it,
   * and a column nothing reads is the value-dead class this schema has already produced twice.
   *
   * Returns `false` (and warns) rather than throwing, matching the sibling operations. Refused
   * when the session does not exist, the node is not in the run, the node has already started
   * (rendered / responded / completed — a step the client has seen cannot be un-shown), or the
   * node is not STRICTLY ahead of the current node (OQ-P4-2). Re-skipping an already-skipped node
   * is idempotent and returns `true`.
   */
  async markNodeSkipped(sessionId: string, nodeId: string, unknownId: string): Promise<boolean> {
    const session = this.activeSessions.get(sessionId);
    if (session === undefined) {
      this.logger.warn(`[ChainMutation] Cannot skip node in non-existent session: ${sessionId}`);
      return false;
    }

    const nodes = session.state.nodes;
    const target = ordinalOf(nodes, nodeId);
    if (target === -1) {
      this.logger.warn(
        `[ChainMutation] Refusing to skip: node ${nodeId} is not in session ${sessionId}`
      );
      return false;
    }

    const existing = this.getStepState(sessionId, nodeId)?.state;
    if (existing === 'skipped') {
      return true;
    }
    if (hasStepStarted(existing)) {
      this.logger.warn(
        `[ChainMutation] Refusing to skip node ${nodeId}: already in state '${existing}' (session ${sessionId})`
      );
      return false;
    }

    // OQ-P4-2: strictly ahead only. The current node is already rendered client-side, so
    // skipping it would desynchronize the client's view from run state with no way to signal
    // it. `currentOrdinal` returns `nodes.length + 1` once the run has advanced past its last
    // node, so a finished run rejects every target through this same comparison.
    const here = currentOrdinal(nodes, session.state.currentNodeId);
    if (target <= here) {
      this.logger.warn(
        `[ChainMutation] Refusing to skip node ${nodeId} (ordinal ${target}): run is at ordinal ${here}, and only strictly-ahead nodes may be skipped`
      );
      return false;
    }

    this.setStepState(sessionId, nodeId, 'skipped');

    session.state.lastUpdated = Date.now();
    session.lastActivity = Date.now();

    this.logger.debug(
      `[ChainMutation] Skipped node ${nodeId} (ordinal ${target}) in session ${sessionId}, resolved unknown ${unknownId}`
    );

    await this.saveSessions();
    return true;
  }

  /**
   * Persist a step result to storage and optional tracking systems.
   */
  private async persistStepResult(
    session: ChainSession,
    nodeId: string,
    stepResult: string,
    metadata: Record<string, any>,
    isPlaceholder: boolean
  ): Promise<void> {
    const metadataPayload = {
      ...metadata,
      isPlaceholder,
    };

    // The containers key by node id; the ordinal rides along because the *rendered* contract
    // (`stepN_result`, `previous_step_results` keys) is positional and must not shift.
    const ordinal = ordinalOf(session.state.nodes, nodeId);

    this.textReferenceStore.storeChainStepResult(
      session.chainId,
      nodeId,
      stepResult,
      metadataPayload,
      ordinal === -1 ? undefined : ordinal
    );

    if (this.argumentHistoryTracker && !isPlaceholder) {
      try {
        await this.argumentHistoryTracker.trackExecution({
          promptId: session.chainId,
          sessionId: session.sessionId,
          originalArgs: session.originalArgs || {},
          nodeId,
          ...(ordinal === -1 ? {} : { stepNumber: ordinal }),
          stepResult,
          metadata: {
            executionType: 'chain',
            chainId: session.chainId,
            ...metadataPayload,
          },
        });
      } catch (error) {
        this.logger?.error('[ChainSessionStore] Failed to track argument history entry', {
          chainId: session.chainId,
          nodeId,
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
    // No initializer: all three paths below (tracker success, tracker failure, no tracker)
    // assign it. `= {}` also pinned the type to `{}`, so the annotation is explicit now.
    let argumentContext: Record<string, unknown>;
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
          currentOrdinal(session.state.nodes, session.state.currentNodeId),
          totalOf(session.state.nodes)
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
      current_step: currentOrdinal(session.state.nodes, session.state.currentNodeId),
      total_steps: totalOf(session.state.nodes),
      // Ordinals, not node ids: this lands in the rendering context, whose shape templates
      // already depend on. The node ids live on `session.executionOrder`.
      execution_order: session.executionOrder.map((id) => ordinalOf(session.state.nodes, id)),
      current_node_id: session.state.currentNodeId,

      // Chain variables (step results, etc.) from TextReferenceStore
      ...chainVariables,

      // Original arguments - spread for template access AND nested for intent rendering
      ...argumentContext,
      original_args: argumentContext,
    };

    if (reviewContext && Object.keys(reviewContext.previousResults).length > 0) {
      contextData['previous_step_results'] = { ...reviewContext.previousResults };
    }

    // Omitted entirely while empty so a template can branch on presence, matching
    // previous_step_results above. Entries are copies: template consumers must not be
    // able to mutate live session state through the rendering context.
    const unknownsLedger = session.unknownsLedger;
    if (unknownsLedger !== undefined && unknownsLedger.length > 0) {
      contextData['unknowns_ledger'] = unknownsLedger.map((entry) => ({ ...entry }));
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
   * Project the run's record-only complexity facts. Pure read — no mutation, no persistence,
   * and no derived score of any kind (master decision D4).
   *
   * `unknownsOpened`/`unknownsClosed` are derived from the ledger rather than from their own
   * counters because the ledger is already cumulative: entries are never deleted, only
   * transitioned active -> resolved. A parallel counter would be a second, driftable source.
   *
   * `nodesInserted`/`nodesSkipped` (P4) follow the same rule against the node list: `origin`
   * and the step lifecycle already ARE the record of what the mutation policy did, and both
   * reconstruct from persisted rows on a cold load, so a resumed run reports the same numbers
   * a continuously-live one does. A skipped node is still IN the list, so a skip never lowers
   * `stepsPlanned`.
   *
   * This is the one telemetry source BOTH terminal-record writers read
   * (`21-formatting-stage.ts` on the completed/cancelled path, `prompt-execution-pipeline.ts`
   * on the failed path). Deriving a field anywhere else would give failed runs NULLs while
   * completed runs carried values — the partial-fix shape the run-telemetry suite rejects.
   */
  getRunTelemetry(sessionId: string, _scope?: StateStoreOptions): RunTelemetry | undefined {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      return undefined;
    }

    const ledger = session.unknownsLedger ?? [];
    const stepStates = session.state.stepStates;
    return {
      stepsPlanned: totalOf(session.state.nodes),
      gatesFired: session.gatesFiredCount ?? 0,
      gateRetries: session.gateRetriesCount ?? 0,
      unknownsOpened: ledger.length,
      unknownsClosed: ledger.filter((entry) => entry.state === 'resolved').length,
      nodesInserted: session.state.nodes.filter((node) => node.origin === 'inserted').length,
      nodesSkipped: session.state.nodes.filter(
        (node) => stepStates?.get(node.id)?.state === 'skipped'
      ).length,
    };
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
          `[ChainSessionStore] Attempted to update blueprint for non-existent session: ${sessionId}`
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
        `[ChainSessionStore] No pending gate review to reset for session: ${sessionId}`
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

    this.logger?.info?.(`[ChainSessionStore] Reset retry count for session: ${sessionId}`);
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

    // Run-cumulative counterparts to attemptCount, which is destroyed with the pending review
    // when a PASS clears it and so cannot answer "how many across the whole run". Record-only
    // (D4): nothing branches on these values.
    session.gatesFiredCount = (session.gatesFiredCount ?? 0) + 1;
    if (outcome.verdict === 'FAIL') {
      session.gateRetriesCount = (session.gateRetriesCount ?? 0) + 1;
    }

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
    const normalized = stripRunNumber(baseChainId);
    const history = this.baseChainMapping.get(normalized);
    if (history && history.length > 0) {
      return [...history];
    }

    if (this.chainSessionMapping.has(normalized)) {
      return [normalized];
    }

    const fallbackRuns = Array.from(this.chainSessionMapping.keys()).filter(
      (chainId) => stripRunNumber(chainId) === normalized
    );

    return fallbackRuns.sort((a, b) => {
      const runA = parseRunNumber(a) ?? 0;
      const runB = parseRunNumber(b) ?? 0;
      return runA - runB;
    });
  }

  getLatestSessionForBaseChain(baseChainId: string): ChainSession | undefined {
    const normalized = stripRunNumber(baseChainId);
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
    const normalized = stripRunNumber(chainId);
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
        // Summaries are a display projection: ints computed here, never stored.
        currentStep: currentOrdinal(session.state.nodes, session.state.currentNodeId),
        totalSteps: totalOf(session.state.nodes),
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
  /**
   * Remove one session and its artifacts.
   *
   * `scope` is honoured the same way `cancelChain` honours it: a session belonging to another
   * workspace is invisible and the call reports `false`. Without it this method read
   * `activeSessions` directly, so `system_control session clear` could destroy a session in a
   * workspace the caller had no view of — while `cancel`, one method away, enforced the boundary.
   * Omitting `scope` preserves the previous unscoped behaviour for the internal callers
   * (`cleanupStaleSessions`, `clearSessionsForChain`) that legitimately sweep every scope.
   */
  async clearSession(sessionId: string, scope?: StateStoreOptions): Promise<boolean> {
    const session = this.getSessionForMutation(sessionId, scope);
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
    const baseChainId = stripRunNumber(chainId);
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
    const baseChainId = stripRunNumber(chainId);
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
    const baseChainId = this.runChainToBase.get(chainId) ?? stripRunNumber(chainId);
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

  private ensureRunMappingConsistency(): void {
    for (const chainId of this.chainSessionMapping.keys()) {
      const baseChainId = stripRunNumber(chainId);
      if (!this.baseChainMapping.has(baseChainId)) {
        this.baseChainMapping.set(baseChainId, []);
      }
      const history = this.baseChainMapping.get(baseChainId)!;
      if (!history.includes(chainId)) {
        history.push(chainId);
        history.sort((a, b) => {
          const runA = parseRunNumber(a) ?? 0;
          const runB = parseRunNumber(b) ?? 0;
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
      // Was `+= session.state.currentStep` — an identity/cardinality coercion. The only
      // consumer is `averageStepsPerChain` (observability-resources.ts:210), which asks how
      // many STEPS a chain holds, not how far along it happens to be; summing positions made
      // the average drift with progress and never reached the true count until every run
      // finished. Node count is the cardinality that question wants.
      totalSteps += totalOf(session.state.nodes);
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
   * Apply a batch of typed unknown observations to the session's ledger.
   *
   * Transition rules are NOT restated here — `computeUnknownLedger` is their single
   * owner. This method owns only lookup, in-memory mutation and persistence, in that
   * order: an invalid batch throws before `session.unknownsLedger` is touched, and a
   * persist failure throws rather than reporting a success the disk does not back.
   */
  async applyUnknownObservations(
    sessionId: string,
    nodeId: string,
    observations: UnknownObservation[]
  ): Promise<UnknownLedgerEntry[]> {
    const session = this.activeSessions.get(sessionId);
    if (!session) {
      throw new Error(
        `Cannot apply unknown observations: session not found: ${sessionId}. The chain run may have been cleared.`
      );
    }

    // `discoveredAtStep`/`resolvedAtStep` are ordinals-at-write — a historical stamp of where
    // the run stood, not an address into it. Resolved here so the ledger keeps its number
    // shape while the caller addresses by identity.
    const stepOrdinal = ordinalOf(session.state.nodes, nodeId);

    // Throws on an invalid transition or cap overflow — before any mutation below.
    const nextLedger = computeUnknownLedger(
      session.unknownsLedger ?? [],
      observations,
      stepOrdinal === -1
        ? currentOrdinal(session.state.nodes, session.state.currentNodeId)
        : stepOrdinal
    );

    session.unknownsLedger = nextLedger;
    session.state.lastUpdated = Date.now();
    session.lastActivity = Date.now();

    await this.saveSessions();

    return nextLedger.map((entry) => ({ ...entry }));
  }

  /**
   * Cleanup the chain session manager and persist state
   * Prevents async handle leaks by finalizing all file operations
   */
  async cleanup(): Promise<void> {
    this.logger.info('Shutting down ChainSessionStore...');

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

    this.logger.info('ChainSessionStore cleanup complete');
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
        `[ChainSessionStore] Refusing to promote session ${session.sessionId} (${reason}): runStatus '${session.runStatus ?? 'unknown'}' is terminal`
      );
      return;
    }
    session.lifecycle = 'canonical';
    this.logger?.debug?.(
      `[ChainSessionStore] Promoted session ${session.sessionId} to canonical (${reason})`
    );
    this.persistSessionsAsync('lifecycle-promotion');
  }

  private buildChainMetadata(session: ChainSession): Record<string, any> | undefined {
    const blueprint = session.blueprint;
    const baseMetadata: Record<string, any> = {
      chainId: session.chainId,
      chainRunId: session.sessionId,
      totalSteps: totalOf(session.state.nodes),
      currentStep: currentOrdinal(session.state.nodes, session.state.currentNodeId),
      currentNodeId: session.state.currentNodeId,
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

    const currentStep = currentOrdinal(session.state.nodes, session.state.currentNodeId) || 1;
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

export type {
  ChainSession,
  ChainSessionService,
  ChainSessionSummary,
  SessionBlueprint,
} from '#shared/types/chain-session.js';

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
