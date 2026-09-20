// @lifecycle canonical - Tracks active framework state and switching heuristics.
/**
 * Stateful Framework State Manager
 *
 * Manages the active framework state and provides framework switching capabilities.
 * This tracks switching mechanics (timing, success/failure, counts) and framework state.
 * This is separate from execution strategy analysis - it handles WHICH framework
 * to apply (built-in or custom) while semantic analysis handles execution strategies.
 */

import { EventEmitter } from 'events';

import { FrameworkManager, createFrameworkManager } from './framework-manager.js';
import { FrameworkDefinition, FrameworkSelectionCriteria } from './types/index.js';

import type { StateStoreOptions } from '#infra/database/stores/interface.js';
import type { McpNotificationEmitterPort } from '#shared/types/index.js';

import { SqliteEngine } from '#infra/database/sqlite-engine.js';
import { SqliteStateStore } from '#infra/database/stores/sqlite-store.js';
import { Logger } from '#infra/logging/index.js';
import { DEFAULT_FRAMEWORK_ID } from '#shared/utils/constants.js';
import { resolveContinuityScopeId } from '#shared/utils/request-identity-scope.js';

/** The `kv_state` discriminator every framework state row is written under. */
const FRAMEWORK_STATE_KEY = 'framework';

/**
 * Persisted framework state (saved to file)
 */
export interface PersistedFrameworkState {
  version: string;
  frameworkSystemEnabled: boolean;
  activeFramework: string;
  lastSwitchedAt: string;
  switchReason: string;
}

/**
 * Construction options for {@link FrameworkStateStore}.
 *
 * An object rather than positional parameters: the constructor reached the 4-parameter
 * limit, and callers previously had to pass `undefined` for an injected store just to
 * reach the argument after it.
 */
export interface FrameworkStateStoreOptions {
  /** Pre-built store; supply to inject a test double or share an engine. */
  stateStore?: SqliteStateStore<PersistedFrameworkState>;
  /**
   * Reads the configured default framework each time it is needed: for scopes with no persisted
   * row, and as the fallback when the selected framework is missing or removed. A function rather
   * than a value, so a change to `frameworks.defaultFramework` while the server runs applies
   * without a restart. Absent means {@link DEFAULT_FRAMEWORK_ID}.
   */
  defaultFramework?: () => string;
  /** Scope applied when a caller supplies none — the project this process serves. */
  defaultScope?: StateStoreOptions;
}

/**
 * Framework state information
 */
export interface FrameworkState {
  activeFramework: string;
  previousFramework: string | null;
  switchedAt: Date;
  switchReason: string;
  isHealthy: boolean;
  frameworkSystemEnabled: boolean; // NEW: Controls whether framework system is enabled/disabled
  switchingMetrics: {
    switchCount: number;
    averageResponseTime: number;
    errorCount: number;
  };
}

/**
 * Framework switch request
 */
export interface FrameworkSwitchRequest {
  targetFramework: string;
  reason?: string;
  criteria?: FrameworkSelectionCriteria;
}

/**
 * Framework system health information
 */
export interface FrameworkSystemHealth {
  status: 'healthy' | 'degraded' | 'error';
  activeFramework: string;
  frameworkSystemEnabled: boolean; // NEW: Whether framework system is enabled
  availableFrameworks: string[];
  lastSwitchTime: Date | null;
  switchingMetrics: {
    totalSwitches: number;
    successfulSwitches: number;
    failedSwitches: number;
    averageResponseTime: number;
  };
  issues: string[];
}

/**
 * Stateful Framework State Manager Events
 */
export interface FrameworkStateStoreEvents {
  'framework-switched': (previousFramework: string, newFramework: string, reason: string) => void;
  'framework-error': (framework: string, error: Error) => void;
  'health-changed': (health: FrameworkSystemHealth) => void;
  'framework-system-toggled': (enabled: boolean, reason: string) => void; // NEW: Framework system enabled/disabled
}

/**
 * Stateful Framework State Manager
 *
 * Maintains framework state across operations and provides switching capabilities
 */
export class FrameworkStateStore extends EventEmitter {
  private logger: Logger;
  private frameworkManager: FrameworkManager | null = null;
  private scopedStates: Map<string, FrameworkState> = new Map();
  /** The scope each `scopedStates` key was resolved from, so the state under a key can be saved. */
  private scopesByKey: Map<string, StateStoreOptions | undefined> = new Map();
  private switchHistory: Array<{ from: string; to: string; timestamp: Date; reason: string }> = [];
  private switchingMetrics = {
    totalSwitches: 0,
    successfulSwitches: 0,
    failedSwitches: 0,
    averageResponseTime: 0,
    errorCount: 0,
  };
  private isInitialized: boolean = false;
  /** The server's `state.db`, opened when no `stateStore` was injected. */
  private readonly stateDbPath: string;
  private readonly readDefaultFramework: () => string;
  private readonly defaultScope?: StateStoreOptions;
  private stateStore?: SqliteStateStore<PersistedFrameworkState>;
  private notificationEmitter?: McpNotificationEmitterPort;

  constructor(logger: Logger, stateDbPath: string, options: FrameworkStateStoreOptions = {}) {
    super();
    this.logger = logger;
    this.stateDbPath = stateDbPath;
    this.readDefaultFramework = options.defaultFramework ?? (() => DEFAULT_FRAMEWORK_ID);
    this.defaultScope = options.defaultScope;

    if (options.stateStore) {
      this.stateStore = options.stateStore;
    }

    // Seed the process's own scope, not the literal 'default' bucket — otherwise the
    // first read would miss it and re-seed under the real key.
    const defaultKey = resolveContinuityScopeId(this.defaultScope);
    this.scopedStates.set(
      defaultKey,
      FrameworkStateStore.createDefaultState(this.readDefaultFramework())
    );
    this.scopesByKey.set(defaultKey, this.defaultScope);
  }

  /**
   * Scope to use when a caller supplies none.
   *
   * One server process serves one project, so an absent scope means "this project",
   * not "the global bucket". Without this every unscoped read — which is most of the
   * execution path — would share one row across every project.
   */
  private effectiveScope(scope?: StateStoreOptions): StateStoreOptions | undefined {
    return scope ?? this.defaultScope;
  }

  private static createDefaultState(defaultFramework: string): FrameworkState {
    return {
      activeFramework: defaultFramework,
      previousFramework: null,
      switchedAt: new Date(),
      switchReason: 'Initial framework selection',
      isHealthy: true,
      frameworkSystemEnabled: false,
      switchingMetrics: {
        switchCount: 0,
        averageResponseTime: 0,
        errorCount: 0,
      },
    };
  }

  private resolveStateKey(scope?: StateStoreOptions): string {
    return resolveContinuityScopeId(this.effectiveScope(scope));
  }

  private getOrCreateScopedState(scope?: StateStoreOptions): FrameworkState {
    const key = this.resolveStateKey(scope);
    let state = this.scopedStates.get(key);
    if (!state) {
      state = FrameworkStateStore.createDefaultState(this.readDefaultFramework());
      this.scopedStates.set(key, state);
      this.scopesByKey.set(key, this.effectiveScope(scope));
    }
    return state;
  }

  /**
   * Initialize the framework state manager
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      this.logger.debug('FrameworkStateStore already initialized');
      return;
    }

    // Load persisted state before setting up framework manager
    await this.loadPersistedState();
    this.loadRemainingScopes();

    this.logger.info('Initializing Framework State Manager...');

    try {
      // The one framework manager the server uses: the tools adopt it, and `resource_manager` and
      // hot reload change the frameworks it holds. Its registry reads the framework loader as it is
      // now, so the loader must already be configured with the workspace directories.
      // Given the same reader, so its own fallback answers the value this store falls back to.
      const frameworkManager = await createFrameworkManager(this.logger, {
        defaultFramework: this.readDefaultFramework,
      });
      this.frameworkManager = frameworkManager;

      // Validated against the frameworks the server actually has, workspace ones included.
      const persistedFramework = this.getOrCreateScopedState().activeFramework;
      if (frameworkManager.getFramework(persistedFramework) === undefined) {
        await this.selectConfiguredDefault(
          frameworkManager,
          undefined,
          `Persisted framework '${persistedFramework}' not found`
        );
      }

      this.isInitialized = true;
      // Linked once initialized, so removing a framework moves the selections held here.
      frameworkManager.setFrameworkStateStore(this);
      this.logger.info(
        `Framework State Manager initialized with active framework: ${this.getOrCreateScopedState().activeFramework}`
      );

      // Emit initial health status
      this.emit('health-changed', this.getSystemHealth());
    } catch (error) {
      this.logger.error('Failed to initialize Framework State Manager:', error);
      throw error;
    }
  }

  /**
   * Get current framework state
   */
  getCurrentState(scope?: StateStoreOptions): FrameworkState {
    this.ensureInitialized();
    return { ...this.getOrCreateScopedState(scope) };
  }

  /**
   * Load persisted state from SQLite
   */
  private async loadPersistedState(scope?: StateStoreOptions): Promise<void> {
    // Initialize SQLite state store if not injected via constructor
    if (!this.stateStore) {
      const dbManager = await SqliteEngine.getInstance(this.logger, { dbPath: this.stateDbPath });
      await dbManager.initialize();
      this.stateStore = new SqliteStateStore<PersistedFrameworkState>(
        dbManager,
        {
          tableName: 'kv_state',
          key: FRAMEWORK_STATE_KEY,
          stateColumn: 'state',
          defaultState: () => ({
            version: '1.0.0',
            frameworkSystemEnabled: false,
            activeFramework: this.readDefaultFramework(),
            lastSwitchedAt: new Date().toISOString(),
            switchReason: 'Initial framework selection',
          }),
        },
        this.logger
      );
    }

    const currentState = this.getOrCreateScopedState(scope);

    // Must be the effective scope, not the raw argument: startup calls this with none, and
    // reading the unscoped row there would load the global default while switches write to
    // the project's own row — state would diverge silently across restarts.
    const effective = this.effectiveScope(scope);

    try {
      // `load()` synthesizes a valid-looking default when no row exists, so it cannot answer
      // "has this scope ever been written?". Only `exists()` can, and that answer is what
      // decides between using this scope's state and adopting the pre-scoping global row —
      // and, below, between an absent row (expected, quiet) and a corrupt one (a real warning).
      const stateExists = await this.stateStore.exists(effective);
      const persistedState = stateExists ? await this.stateStore.load(effective) : undefined;

      if (persistedState != null && this.isValidPersistedState(persistedState)) {
        currentState.frameworkSystemEnabled = persistedState.frameworkSystemEnabled;
        currentState.activeFramework = persistedState.activeFramework;
        currentState.switchedAt = new Date(persistedState.lastSwitchedAt);
        currentState.switchReason = persistedState.switchReason;

        this.logger.info(
          `✅ Loaded framework state: ${
            persistedState.frameworkSystemEnabled ? 'enabled' : 'disabled'
          }, active: ${persistedState.activeFramework}`
        );
        return;
      }

      // No row for this scope is the common, expected case on a fresh runtime root — not a
      // warning-worthy condition. Only a row that exists and still failed validation above is
      // actually corrupt.
      if (!stateExists) {
        this.logger.debug('No saved framework state found; using defaults');
      } else {
        this.logger.warn('⚠️ Invalid framework state, falling back to defaults');
      }
    } catch (error) {
      this.logger.warn(
        `⚠️ Failed to load framework state: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }

    if (await this.adoptLegacyGlobalState(currentState, scope)) {
      return;
    }

    this.logger.info('📁 No framework state found, using defaults');
    await this.saveStateToFile(scope);
  }

  /**
   * Read back every scope other than this process's own, once, at startup.
   *
   * {@link loadPersistedState} loads one scope, and `getOrCreateScopedState` builds a fresh
   * default for any other without consulting SQLite — it is synchronous, so it cannot. One
   * process serving several workspaces over HTTP therefore answered every one of them with
   * defaults, and a toggle or switch written under a workspace survived in `state.db` and was
   * never read again. `GateStateStore.loadPersistedStates` loads every row for the same reason.
   *
   * The row's `tenant_id` is the in-memory key: `SqliteStateStore.save` writes
   * `resolveContinuityScopeId` of the scope there, which is what `resolveStateKey` computes.
   */
  private loadRemainingScopes(): void {
    // An injected store (tests, shared engines) need not be SQL-backed.
    if (this.stateStore == null || typeof this.stateStore.query !== 'function') {
      this.logger.debug('Framework state store is not SQL-backed; skipping cross-scope load');
      return;
    }

    try {
      const rows = this.stateStore.query<{ tenant_id: string; state: unknown }>(
        `SELECT tenant_id, state FROM ${this.stateStore.getTableName()} WHERE key = ?`,
        [FRAMEWORK_STATE_KEY]
      );

      for (const row of rows) {
        if (this.scopedStates.has(row.tenant_id)) continue;

        const persisted: unknown =
          typeof row.state === 'string' ? JSON.parse(row.state) : row.state;
        if (!this.isValidPersistedState(persisted)) {
          this.logger.warn(
            `⚠️ Invalid framework state format for scope '${row.tenant_id}', using defaults`
          );
          continue;
        }

        // The resolved scope id read back out of the column `resolveContinuityScopeId` wrote,
        // which reads `continuityScopeId` first — so this round-trips exactly, and no
        // `workspaceId` is recoverable from it. `GateStateStore.loadPersistedStates` does the
        // same for the same reason.
        const state = this.getOrCreateScopedState({ continuityScopeId: row.tenant_id });
        state.frameworkSystemEnabled = persisted.frameworkSystemEnabled;
        state.activeFramework = persisted.activeFramework;
        state.switchedAt = new Date(persisted.lastSwitchedAt);
        state.switchReason = persisted.switchReason;
      }
    } catch (error) {
      this.logger.warn(
        `⚠️ Failed to load framework state for other scopes: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
    }
  }

  /**
   * Adopt the pre-scoping global row the first time a real scope loads.
   *
   * Before scope ids existed every project shared one row written under `default`. A
   * scoped lookup cannot match it (`findRowByScope` only queries its own scope), so
   * without this the first launch after upgrading would silently revert to the config
   * default and read as a reset. Copied rather than moved: other scopes may not have
   * migrated yet, and the row is small.
   *
   * @returns true if legacy state was adopted and persisted under the scope.
   */
  private async adoptLegacyGlobalState(
    currentState: FrameworkState,
    scope?: StateStoreOptions
  ): Promise<boolean> {
    const effective = this.effectiveScope(scope);
    // Nothing to migrate from when the caller already IS the global scope.
    if (this.stateStore == null || resolveContinuityScopeId(effective) === 'default') {
      return false;
    }

    try {
      if (!(await this.stateStore.exists())) {
        return false;
      }

      const legacyState = await this.stateStore.load();
      if (!this.isValidPersistedState(legacyState)) {
        return false;
      }

      currentState.frameworkSystemEnabled = legacyState.frameworkSystemEnabled;
      currentState.activeFramework = legacyState.activeFramework;
      currentState.switchedAt = new Date(legacyState.lastSwitchedAt);
      currentState.switchReason = legacyState.switchReason;

      await this.saveStateToFile(scope);
      this.logger.info(
        `✅ Adopted pre-scoping framework state (${legacyState.activeFramework}) for this project`
      );
      return true;
    } catch (error) {
      this.logger.warn(
        `⚠️ Could not adopt pre-scoping framework state: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return false;
    }
  }

  /**
   * Save current state to SQLite.
   * Throws on failure so callers can handle persistence errors appropriately.
   */
  private async saveStateToFile(scope?: StateStoreOptions): Promise<void> {
    if (!this.stateStore) {
      throw new Error('FrameworkStateStore: stateStore not initialized');
    }

    const currentState = this.getOrCreateScopedState(scope);
    const persistedState: PersistedFrameworkState = {
      version: '1.0.0',
      frameworkSystemEnabled: currentState.frameworkSystemEnabled,
      activeFramework: currentState.activeFramework,
      lastSwitchedAt: currentState.switchedAt.toISOString(),
      switchReason: currentState.switchReason,
    };

    await this.stateStore.save(persistedState, this.effectiveScope(scope));
    this.logger.debug('Framework state persisted to SQLite');
  }

  /**
   * Validate persisted state structure
   * Note: activeFramework can be any string (supports custom framework types)
   */
  private isValidPersistedState(state: any): state is PersistedFrameworkState {
    return (
      state &&
      typeof state.version === 'string' &&
      typeof state.frameworkSystemEnabled === 'boolean' &&
      typeof state.activeFramework === 'string' &&
      state.activeFramework.length > 0 &&
      typeof state.lastSwitchedAt === 'string' &&
      typeof state.switchReason === 'string'
    );
  }

  /**
   * Get active framework definition
   */
  getActiveFramework(): FrameworkDefinition {
    this.ensureInitialized();
    const defaultState = this.getOrCreateScopedState();
    const framework = this.frameworkManager!.getFramework(defaultState.activeFramework);
    if (!framework) {
      throw new Error(`Active framework '${defaultState.activeFramework}' not found`);
    }
    return framework;
  }

  /**
   * Get the underlying FrameworkManager for resource access.
   * Returns null if not initialized.
   */
  getFrameworkManager(): FrameworkManager | null {
    return this.frameworkManager;
  }

  /**
   * Move every selection naming a framework the manager no longer has to the configured default.
   *
   * `FrameworkManager.removeFramework` calls this after a framework is removed. Each move is
   * persisted before this returns, and `framework-switched` is emitted so tool descriptions follow.
   *
   * @throws when a move fails to persist, or the configured default framework is not registered.
   */
  async selectDefaultForRemovedFrameworks(): Promise<void> {
    const manager = this.ensureInitialized();
    for (const [key, state] of [...this.scopedStates]) {
      if (!manager.has(state.activeFramework)) {
        await this.selectConfiguredDefault(
          manager,
          this.scopesByKey.get(key),
          `Active framework '${state.activeFramework}' was removed`
        );
      }
    }
  }

  /**
   * Point one scope's selection at the configured default framework and persist it.
   *
   * The one recovery for a selection naming a framework the manager does not have, whether it was
   * missing at startup or removed while the server ran. It selects `frameworks.defaultFramework`,
   * the framework an operator declared, rather than whichever framework is listed first, and reads
   * it now rather than at startup. Memory is updated first, and a failed persist propagates to the
   * caller.
   */
  private async selectConfiguredDefault(
    manager: FrameworkManager,
    scope: StateStoreOptions | undefined,
    reason: string
  ): Promise<void> {
    const defaultFramework = this.readDefaultFramework();
    if (manager.getFramework(defaultFramework) === undefined) {
      throw new Error(
        `${reason}, and the configured default framework '${defaultFramework}' is not ` +
          `registered either. Set frameworks.defaultFramework to a registered framework.`
      );
    }

    const state = this.getOrCreateScopedState(scope);
    const previous = state.activeFramework;
    const switchReason = `${reason}; selected the configured default framework '${defaultFramework}'`;
    this.scopedStates.set(this.resolveStateKey(scope), {
      ...state,
      activeFramework: defaultFramework,
      previousFramework: previous,
      switchedAt: new Date(),
      switchReason,
    });
    this.switchHistory.push({
      from: previous,
      to: defaultFramework,
      timestamp: new Date(),
      reason: switchReason,
    });

    await this.saveStateToFile(scope);

    this.logger.warn(switchReason);
    this.emit('framework-switched', previous, defaultFramework, switchReason);
    this.announceFrameworkChanged(previous, defaultFramework, switchReason);
  }

  /**
   * Switch to a different framework (persistence layer only).
   * Validation is handled by FrameworkManager - this method trusts the input.
   *
   * @param request - Framework switch request (already validated by FrameworkManager)
   * @returns true on success, throws on persistence failure
   */
  async switchFramework(
    request: FrameworkSwitchRequest,
    scope?: StateStoreOptions
  ): Promise<boolean> {
    this.ensureInitialized();

    const startTime = performance.now();
    this.switchingMetrics.totalSwitches++;

    const currentState = this.getOrCreateScopedState(scope);

    // Check if already active (case-insensitive since FrameworkManager normalizes to lowercase)
    if (currentState.activeFramework.toLowerCase() === request.targetFramework.toLowerCase()) {
      this.logger.info(`Framework '${request.targetFramework}' is already active`);
      return true;
    }

    // Perform the switch - no validation needed, FrameworkManager already did that
    const previousFramework = currentState.activeFramework;
    const switchReason = request.reason || `Switched to ${request.targetFramework}`;

    // Update scoped state in-place
    const key = this.resolveStateKey(scope);
    const updatedState: FrameworkState = {
      activeFramework: request.targetFramework,
      previousFramework: previousFramework,
      switchedAt: new Date(),
      switchReason: switchReason,
      isHealthy: true,
      frameworkSystemEnabled: currentState.frameworkSystemEnabled,
      switchingMetrics: {
        switchCount: currentState.switchingMetrics.switchCount + 1,
        averageResponseTime: currentState.switchingMetrics.averageResponseTime,
        errorCount: currentState.switchingMetrics.errorCount,
      },
    };
    this.scopedStates.set(key, updatedState);

    // Record switch history
    this.switchHistory.push({
      from: previousFramework,
      to: request.targetFramework,
      timestamp: new Date(),
      reason: switchReason,
    });

    // Save state to file - throws on failure per async-error-handling rules
    await this.saveStateToFile(scope);

    const switchTime = performance.now() - startTime;
    this.updateSwitchingMetrics(switchTime, true);

    this.logger.info(
      `✅ Framework switch successful: '${previousFramework}' -> '${request.targetFramework}' (${switchTime.toFixed(1)}ms)`
    );

    // Emit events
    this.emit('framework-switched', previousFramework, request.targetFramework, switchReason);
    this.emit('health-changed', this.getSystemHealth());
    this.announceFrameworkChanged(previousFramework, request.targetFramework, switchReason);

    return true;
  }

  /**
   * Push the active-framework change to connected clients.
   *
   * Called from both writers of `activeFramework` — the requested switch above and the
   * fallback in `switchToDefault` — immediately after that writer's own
   * `await this.saveStateToFile(scope)` returns, and never before: a client told the framework
   * changed would render the new one's guidance against state that may still fail to persist
   * (`saveStateToFile` throws rather than swallowing, per the state mutation contract).
   *
   * The fallback is announced for the same reason the requested switch is: from a client's
   * side they are the same fact, and a silent fallback is how a client keeps attributing
   * output to the framework it last asked for. `this.emit` is the in-process listener
   * channel; it reaches no client, which is why this sits beside it rather than inside it.
   */
  private announceFrameworkChanged(from: string, to: string, reason: string): void {
    this.notificationEmitter?.emitFrameworkChanged({ from, to, reason });
  }

  /** Late-bind the client push channel; built by the composition root after this store. */
  setNotificationEmitter(emitter: McpNotificationEmitterPort): void {
    this.notificationEmitter = emitter;
  }

  /**
   * Get framework system health
   */
  getSystemHealth(scope?: StateStoreOptions): FrameworkSystemHealth {
    this.ensureInitialized();
    const defaultState = this.getOrCreateScopedState(scope);

    const issues: string[] = [];
    let status: 'healthy' | 'degraded' | 'error' = 'healthy';

    // Check for health issues
    if (defaultState.switchingMetrics.errorCount > 0) {
      issues.push(
        `${defaultState.switchingMetrics.errorCount} framework switching errors detected`
      );
      status = defaultState.switchingMetrics.errorCount > 5 ? 'error' : 'degraded';
    }

    if (!defaultState.isHealthy) {
      issues.push('Framework system is in unhealthy state');
      status = 'error';
    }

    const activeFramework = this.frameworkManager!.getFramework(defaultState.activeFramework);
    if (!activeFramework?.enabled) {
      issues.push(`Active framework '${defaultState.activeFramework}' is disabled`);
      status = 'error';
    }

    const lastSwitch = this.switchHistory[this.switchHistory.length - 1];
    const lastSwitchTime = lastSwitch ? lastSwitch.timestamp : null;

    return {
      status,
      activeFramework: defaultState.activeFramework,
      frameworkSystemEnabled: defaultState.frameworkSystemEnabled, // NEW: Include enabled state
      availableFrameworks: this.frameworkManager!.listFrameworks(true).map((f) => f.id),
      lastSwitchTime,
      switchingMetrics: { ...this.switchingMetrics },
      issues,
    };
  }

  /**
   * Get framework switch history
   */
  getSwitchHistory(
    limit?: number
  ): Array<{ from: string; to: string; timestamp: Date; reason: string }> {
    const history = [...this.switchHistory].reverse(); // Most recent first
    return limit ? history.slice(0, limit) : history;
  }

  /**
   * Reset switching performance metrics.
   *
   * @param scope the caller's continuity scope. `system_control analytics reset_metrics`
   *   reports the scoped state back, so resetting a different one would answer with
   *   counters it never touched.
   */
  resetMetrics(scope?: StateStoreOptions): void {
    const defaultState = this.getOrCreateScopedState(scope);
    this.switchingMetrics = {
      totalSwitches: 0,
      successfulSwitches: 0,
      failedSwitches: 0,
      averageResponseTime: 0,
      errorCount: 0,
    };

    defaultState.switchingMetrics = {
      switchCount: 0,
      averageResponseTime: 0,
      errorCount: 0,
    };

    this.logger.info('Framework state manager switching metrics reset');
  }

  /**
   * Enable the framework system for one continuity scope.
   *
   * @param scope the caller's scope, as {@link switchFramework} and
   *   `GateStateStore.enableGateSystem` take it. Omit to use this process's own project.
   *   Without it, `system_control framework enable` arriving over HTTP from one workspace
   *   read that workspace's state to decide whether the toggle was a no-op and then wrote
   *   the launch workspace's row — so the caller was told the system was enabled while its
   *   own scope stayed disabled and an unrelated project's flipped.
   */
  async enableFrameworkSystem(reason?: string, scope?: StateStoreOptions): Promise<void> {
    this.ensureInitialized();
    const defaultState = this.getOrCreateScopedState(scope);

    if (defaultState.frameworkSystemEnabled) {
      this.logger.info('Framework system is already enabled');
      return;
    }

    const enableReason = reason || 'Framework system enabled';

    defaultState.frameworkSystemEnabled = true;
    defaultState.switchReason = enableReason;
    defaultState.switchedAt = new Date();

    // Persistence throws so the caller can decide. Catching here reported the
    // toggle as applied while the database still held the old value, and the
    // success line below was printed either way.
    await this.saveStateToFile(scope);

    this.logger.info(`✅ Framework system enabled: ${enableReason}`);

    // Emit events
    this.emit('framework-system-toggled', true, enableReason);
    this.emit('health-changed', this.getSystemHealth(scope));
  }

  /**
   * Disable the framework system for one continuity scope.
   *
   * @param scope as {@link enableFrameworkSystem} takes it, for the same reason.
   */
  async disableFrameworkSystem(reason?: string, scope?: StateStoreOptions): Promise<void> {
    this.ensureInitialized();
    const defaultState = this.getOrCreateScopedState(scope);

    if (!defaultState.frameworkSystemEnabled) {
      this.logger.info('Framework system is already disabled');
      return;
    }

    const disableReason = reason || 'Framework system disabled';

    defaultState.frameworkSystemEnabled = false;
    defaultState.switchReason = disableReason;
    defaultState.switchedAt = new Date();

    // Persistence throws so the caller can decide, exactly as the enable path
    // above does. Both used to swallow it and report success regardless.
    await this.saveStateToFile(scope);

    this.logger.info(`🚫 Framework system disabled: ${disableReason}`);

    // Emit events
    this.emit('framework-system-toggled', false, disableReason);
    this.emit('health-changed', this.getSystemHealth(scope));
  }

  /**
   * Check if framework system is enabled.
   *
   * @param scope the scope to read. Omit to read this process's own project, which is what
   *   the execution path does — the same asymmetry `GateManager.isSystemEnabled` has.
   */
  isFrameworkSystemEnabled(scope?: StateStoreOptions): boolean {
    this.ensureInitialized();
    return this.getOrCreateScopedState(scope).frameworkSystemEnabled;
  }

  /**
   * Set framework system enabled state (for config loading)
   *
   * @param scope the scope to toggle; omit to use this process's own project, which is what
   *   the configuration listener wants.
   */
  async setFrameworkSystemEnabled(
    enabled: boolean,
    reason?: string,
    scope?: StateStoreOptions
  ): Promise<void> {
    if (enabled) {
      await this.enableFrameworkSystem(reason || 'Loaded from configuration', scope);
    } else {
      await this.disableFrameworkSystem(reason || 'Loaded from configuration', scope);
    }
  }

  // Private helper methods

  /** @returns the framework manager, which exists once the store is initialized. */
  private ensureInitialized(): FrameworkManager {
    if (!this.isInitialized || !this.frameworkManager) {
      throw new Error('FrameworkStateStore not initialized. Call initialize() first.');
    }
    return this.frameworkManager;
  }

  private updateSwitchingMetrics(responseTime: number, success: boolean): void {
    const defaultState = this.getOrCreateScopedState();
    if (success) {
      this.switchingMetrics.successfulSwitches++;
    } else {
      this.switchingMetrics.failedSwitches++;
    }

    // Update average response time for switching operations
    const totalOperations =
      this.switchingMetrics.successfulSwitches + this.switchingMetrics.failedSwitches;
    this.switchingMetrics.averageResponseTime =
      (this.switchingMetrics.averageResponseTime * (totalOperations - 1) + responseTime) /
      totalOperations;

    defaultState.switchingMetrics.averageResponseTime = this.switchingMetrics.averageResponseTime;
  }

  /**
   * Shutdown the framework state manager and cleanup resources
   * Prevents async handle leaks by persisting state and removing event listeners
   */
  async shutdown(): Promise<void> {
    this.logger.info('Shutting down FrameworkStateStore...');

    try {
      // Persist final state to disk
      await this.saveStateToFile();
      this.logger.debug('Framework state persisted during shutdown');
    } catch (error) {
      this.logger.warn('Error persisting state during shutdown:', error);
    }

    // Remove all event listeners
    this.removeAllListeners();
    this.logger.debug('Event listeners removed during shutdown');

    this.logger.info('FrameworkStateStore shutdown complete');
  }
}

/**
 * Create and initialize framework state manager
 */
export async function createFrameworkStateStore(
  logger: Logger,
  stateDbPath: string,
  options: FrameworkStateStoreOptions = {}
): Promise<FrameworkStateStore> {
  const manager = new FrameworkStateStore(logger, stateDbPath, options);
  await manager.initialize();
  return manager;
}
