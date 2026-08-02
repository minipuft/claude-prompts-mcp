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
import {
  FrameworkDefinition,
  FrameworkExecutionContext,
  FrameworkSelectionCriteria,
} from './types/index.js';

import type { StateStoreOptions } from '#infra/database/stores/interface.js';

import { SqliteEngine } from '#infra/database/sqlite-engine.js';
import { SqliteStateStore } from '#infra/database/stores/sqlite-store.js';
import { Logger } from '#infra/logging/index.js';
import { DEFAULT_FRAMEWORK_ID } from '#shared/utils/constants.js';
import { resolveContinuityScopeId } from '#shared/utils/request-identity-scope.js';

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
  /** Framework for scopes with no persisted row. Defaults to {@link DEFAULT_FRAMEWORK_ID}. */
  defaultFramework?: string;
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
  private switchHistory: Array<{ from: string; to: string; timestamp: Date; reason: string }> = [];
  private switchingMetrics = {
    totalSwitches: 0,
    successfulSwitches: 0,
    failedSwitches: 0,
    averageResponseTime: 0,
    errorCount: 0,
  };
  private isInitialized: boolean = false;
  private readonly serverRoot: string;
  private readonly defaultFramework: string;
  private readonly defaultScope?: StateStoreOptions;
  private stateStore?: SqliteStateStore<PersistedFrameworkState>;

  constructor(logger: Logger, serverRoot: string, options: FrameworkStateStoreOptions = {}) {
    super();
    this.logger = logger;
    this.serverRoot = serverRoot;
    this.defaultFramework = options.defaultFramework ?? DEFAULT_FRAMEWORK_ID;
    this.defaultScope = options.defaultScope;

    if (options.stateStore) {
      this.stateStore = options.stateStore;
    }

    // Seed the process's own scope, not the literal 'default' bucket — otherwise the
    // first read would miss it and re-seed under the real key.
    this.scopedStates.set(
      resolveContinuityScopeId(this.defaultScope),
      FrameworkStateStore.createDefaultState(this.defaultFramework)
    );
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
      state = FrameworkStateStore.createDefaultState(this.defaultFramework);
      this.scopedStates.set(key, state);
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

    this.logger.info('Initializing Framework State Manager...');

    try {
      // Initialize framework manager
      this.frameworkManager = await createFrameworkManager(this.logger, {
        defaultFramework: this.defaultFramework,
      });

      const defaultState = this.getOrCreateScopedState();

      // Validate persisted framework exists, fallback to default if not
      const persistedFramework = defaultState.activeFramework;
      let validatedFramework = this.frameworkManager.getFramework(persistedFramework);

      if (!validatedFramework) {
        // Persisted framework no longer exists - fallback to first available
        const availableFrameworks = this.frameworkManager.listFrameworks().map((f) => f.id);
        const fallbackId = availableFrameworks[0];

        if (!fallbackId) {
          throw new Error('No frameworks available - cannot initialize');
        }

        this.logger.warn(
          `Persisted framework '${persistedFramework}' not found, falling back to '${fallbackId}'`
        );

        // Update state with valid framework
        defaultState.activeFramework = fallbackId;
        defaultState.switchReason = `Auto-recovered from missing framework '${persistedFramework}'`;
        defaultState.switchedAt = new Date();

        // Persist the corrected state
        await this.saveStateToFile();

        validatedFramework = this.frameworkManager.getFramework(fallbackId);
      }

      if (!validatedFramework) {
        throw new Error(`Failed to validate framework after fallback`);
      }

      this.isInitialized = true;
      this.logger.info(
        `Framework State Manager initialized with active framework: ${defaultState.activeFramework}`
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
      const dbManager = await SqliteEngine.getInstance(this.serverRoot, this.logger);
      await dbManager.initialize();
      this.stateStore = new SqliteStateStore<PersistedFrameworkState>(
        dbManager,
        {
          tableName: 'kv_state',
          key: 'framework',
          stateColumn: 'state',
          defaultState: () => ({
            version: '1.0.0',
            frameworkSystemEnabled: false,
            activeFramework: this.defaultFramework,
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
      // decides between using this scope's state and adopting the pre-scoping global row.
      const persistedState = (await this.stateStore.exists(effective))
        ? await this.stateStore.load(effective)
        : undefined;

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

      this.logger.warn('⚠️ Invalid framework state, falling back to defaults');
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
   * Get all available frameworks
   */
  getAvailableFrameworks(): FrameworkDefinition[] {
    this.ensureInitialized();
    return this.frameworkManager!.listFrameworks(true); // Only enabled frameworks
  }

  /**
   * Get the underlying FrameworkManager for resource access.
   * Returns null if not initialized.
   */
  getFrameworkManager(): FrameworkManager | null {
    return this.frameworkManager;
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

    return true;
  }

  /**
   * Generate execution context using active framework
   */
  generateExecutionContext(
    prompt: any,
    criteria?: FrameworkSelectionCriteria
  ): FrameworkExecutionContext | null {
    this.ensureInitialized();
    const defaultState = this.getOrCreateScopedState();

    // Return null if framework system is disabled
    if (!defaultState.frameworkSystemEnabled) {
      return null;
    }

    // Use framework manager to generate context with active framework
    const mergedCriteria: FrameworkSelectionCriteria = {
      userPreference: defaultState.activeFramework,
      ...criteria,
    };

    return this.frameworkManager!.generateExecutionContext(prompt, mergedCriteria);
  }

  /**
   * Get framework system health
   */
  getSystemHealth(): FrameworkSystemHealth {
    this.ensureInitialized();
    const defaultState = this.getOrCreateScopedState();

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
   * Reset switching performance metrics
   */
  resetMetrics(): void {
    const defaultState = this.getOrCreateScopedState();
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
   * Enable the framework system
   */
  async enableFrameworkSystem(reason?: string): Promise<void> {
    this.ensureInitialized();
    const defaultState = this.getOrCreateScopedState();

    if (defaultState.frameworkSystemEnabled) {
      this.logger.info('Framework system is already enabled');
      return;
    }

    const enableReason = reason || 'Framework system enabled';

    defaultState.frameworkSystemEnabled = true;
    defaultState.switchReason = enableReason;
    defaultState.switchedAt = new Date();

    this.logger.info(`✅ Framework system enabled: ${enableReason}`);

    // Save state to file - await to ensure persistence
    try {
      await this.saveStateToFile();
    } catch (error) {
      this.logger.error(
        `Failed to persist framework enable state: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    // Emit events
    this.emit('framework-system-toggled', true, enableReason);
    this.emit('health-changed', this.getSystemHealth());
  }

  /**
   * Disable the framework system
   */
  async disableFrameworkSystem(reason?: string): Promise<void> {
    this.ensureInitialized();
    const defaultState = this.getOrCreateScopedState();

    if (!defaultState.frameworkSystemEnabled) {
      this.logger.info('Framework system is already disabled');
      return;
    }

    const disableReason = reason || 'Framework system disabled';

    defaultState.frameworkSystemEnabled = false;
    defaultState.switchReason = disableReason;
    defaultState.switchedAt = new Date();

    this.logger.info(`🚫 Framework system disabled: ${disableReason}`);

    // Save state to file - await to ensure persistence
    try {
      await this.saveStateToFile();
    } catch (error) {
      this.logger.error(
        `Failed to persist framework disable state: ${error instanceof Error ? error.message : String(error)}`
      );
    }

    // Emit events
    this.emit('framework-system-toggled', false, disableReason);
    this.emit('health-changed', this.getSystemHealth());
  }

  /**
   * Check if framework system is enabled
   */
  isFrameworkSystemEnabled(): boolean {
    this.ensureInitialized();
    return this.getOrCreateScopedState().frameworkSystemEnabled;
  }

  /**
   * Set framework system enabled state (for config loading)
   */
  async setFrameworkSystemEnabled(enabled: boolean, reason?: string): Promise<void> {
    if (enabled) {
      await this.enableFrameworkSystem(reason || 'Loaded from configuration');
    } else {
      await this.disableFrameworkSystem(reason || 'Loaded from configuration');
    }
  }

  // Private helper methods

  private ensureInitialized(): void {
    if (!this.isInitialized || !this.frameworkManager) {
      throw new Error('FrameworkStateStore not initialized. Call initialize() first.');
    }
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
  serverRoot: string,
  options: FrameworkStateStoreOptions = {}
): Promise<FrameworkStateStore> {
  const manager = new FrameworkStateStore(logger, serverRoot, options);
  await manager.initialize();
  return manager;
}
