// @lifecycle canonical - Persists gate enable/disable state across runtime.
/**
 * Gate System Manager - Runtime State Management
 *
 * Provides runtime enable/disable functionality for the gates system,
 * following the same pattern as FrameworkStateStore for consistency.
 */

import { EventEmitter } from 'events';

import type { StateStoreOptions } from '#infra/database/stores/interface.js';

import { SqliteEngine } from '#infra/database/sqlite-engine.js';
import { SqliteStateStore } from '#infra/database/stores/sqlite-store.js';
import { Logger } from '#infra/logging/index.js';
import {
  DEFAULT_IDENTITY_SCOPE_ID,
  resolveContinuityScopeId,
} from '#shared/utils/request-identity-scope.js';

/** The `kv_state` discriminator every gate toggle is written under. */
const GATE_STATE_KEY = 'gates';

/**
 * Gate system state interface
 */
export interface GateSystemState {
  enabled: boolean;
  enabledAt: Date;
  enableReason: string;
  isHealthy: boolean;
  validationMetrics: {
    totalValidations: number;
    successfulValidations: number;
    averageValidationTime: number;
    lastValidationTime: Date | null;
  };
}

/**
 * Gate system health status
 */
export interface GateSystemHealth {
  status: 'healthy' | 'degraded' | 'disabled';
  enabled: boolean;
  totalValidations: number;
  successRate: number;
  averageValidationTime: number;
  lastValidationTime: Date | null;
  issues: string[];
}

/**
 * Persisted gate state (saved to SQLite)
 */
export interface PersistedGateSystemState {
  enabled: boolean;
  enabledAt: string;
  enableReason: string;
  validationMetrics: {
    totalValidations: number;
    successfulValidations: number;
    averageValidationTime: number;
    lastValidationTime: string | null;
  };
}

/**
 * Gate system enable/disable request
 */
export interface GateSystemToggleRequest {
  enabled: boolean;
  reason?: string;
}

/**
 * Construction options.
 */
export interface GateStateStoreOptions {
  /**
   * The launch workspace scope — the key a toggle arriving with no identity of its own is
   * written under, and the key the advertised tool surface reads. Used only to adopt a
   * pre-isolation `default` row into it; unscoped calls still resolve to `default`.
   */
  defaultScope?: StateStoreOptions;
}

/**
 * Gate system events
 */
export interface GateSystemEvents {
  'system-enabled': [reason: string];
  'system-disabled': [reason: string];
  'health-changed': [health: GateSystemHealth];
  'validation-completed': [success: boolean, executionTime: number];
}

/**
 * Gate System Manager - Runtime state management
 */
export class GateStateStore extends EventEmitter {
  private scopedStates: Map<string, GateSystemState> = new Map();
  private logger: Logger;
  /** The server's `state.db`; undefined exactly when a `stateStore` was injected instead. */
  private readonly stateDbPath: string | undefined;
  private stateStore?: SqliteStateStore<PersistedGateSystemState>;
  private healthCheckInterval?: NodeJS.Timeout;
  private readonly defaultScope?: StateStoreOptions;

  /**
   * @param stateStoreOrDbPath an injected store, or the path of the server's `state.db` to open
   *   one against. Required: before B.62 it was optional and an absent value opened
   *   `runtime-state/state.db` relative to whatever the process's working directory was.
   */
  constructor(
    logger: Logger,
    stateStoreOrDbPath: SqliteStateStore<PersistedGateSystemState> | string,
    options: GateStateStoreOptions = {}
  ) {
    super();
    this.logger = logger;
    this.defaultScope = options.defaultScope;

    if (stateStoreOrDbPath instanceof SqliteStateStore) {
      this.stateStore = stateStoreOrDbPath;
      this.stateDbPath = undefined;
    } else {
      this.stateDbPath = stateStoreOrDbPath;
    }

    // Initialize default scope state
    this.scopedStates.set('default', GateStateStore.createDefaultState());

    this.logger.debug('GateStateStore initialized');
  }

  private static createDefaultState(): GateSystemState {
    return {
      enabled: true,
      enabledAt: new Date(),
      enableReason: 'System initialization (default enabled)',
      isHealthy: true,
      validationMetrics: {
        totalValidations: 0,
        successfulValidations: 0,
        averageValidationTime: 0,
        lastValidationTime: null,
      },
    };
  }

  private resolveStateKey(scope?: StateStoreOptions): string {
    return resolveContinuityScopeId(scope);
  }

  private getOrCreateScopedState(scope?: StateStoreOptions): GateSystemState {
    const key = this.resolveStateKey(scope);
    let state = this.scopedStates.get(key);
    if (!state) {
      state = GateStateStore.createDefaultState();
      this.scopedStates.set(key, state);
    }
    return state;
  }

  /**
   * Initialize the gate system manager
   */
  async initialize(): Promise<void> {
    try {
      // Load persisted state if available
      await this.loadPersistedStates();

      // Start health monitoring
      this.startHealthMonitoring();

      const launchState = this.getOrCreateScopedState(this.defaultScope);
      this.logger.info(
        `🚪 Gate System Manager initialized - System ${launchState.enabled ? 'enabled' : 'disabled'}`
      );
    } catch (error) {
      this.logger.error('Failed to initialize GateStateStore:', error);
      throw error;
    }
  }

  /**
   * Load every persisted gate toggle, one row per scope.
   *
   * All of them, at startup, because `isGateSystemEnabled` is synchronous: it is read while the
   * tool schema is built, with no await in reach. A scope missing from memory used to be created
   * ENABLED without consulting SQLite, and the only scope loaded here was the literal `default`
   * — so a toggle written under a workspace survived in `state.db` and was never read back.
   * Measured 2026-09-14: `system_control gates disable` narrowed `prompt_engine` until the next
   * restart, then the three gate parameters came back. Loading only the launch scope would fix
   * STDIO and leave every HTTP identity beyond it with the same miss.
   *
   * The row's `tenant_id` is the in-memory key: `SqliteStateStore.save` writes
   * `resolveContinuityScopeId` of the scope there, which is what `resolveStateKey` computes.
   */
  private async loadPersistedStates(): Promise<void> {
    const stateStore = await this.ensureStateStore();
    const loadedKeys = new Set<string>();

    try {
      const rows = stateStore.query<{ tenant_id: string; state: unknown }>(
        `SELECT tenant_id, state FROM ${stateStore.getTableName()} WHERE key = ?`,
        [GATE_STATE_KEY]
      );

      for (const row of rows) {
        const persistedState: unknown =
          typeof row.state === 'string' ? JSON.parse(row.state) : row.state;
        if (!this.isValidPersistedState(persistedState)) {
          this.logger.warn(
            `⚠️ Invalid gate state format for scope '${row.tenant_id}', using defaults`
          );
          continue;
        }
        this.applyPersistedState(
          this.getOrCreateScopedState({ continuityScopeId: row.tenant_id }),
          persistedState
        );
        loadedKeys.add(row.tenant_id);
      }

      this.logger.info(`✅ Loaded gate system state for ${loadedKeys.size} scope(s)`);
    } catch (error) {
      this.logger.warn(
        `⚠️ Failed to load gate system state: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      this.logger.info('📁 Using default gate system state');
      return;
    }

    await this.adoptLegacyGlobalState(loadedKeys);
  }

  /**
   * Adopt the pre-isolation `default` row into the launch scope, once.
   *
   * Before 2026-08-27 a toggle with no resolvable identity was written under `default`; since
   * then the same toggle is written under the launch workspace, and nothing reads `default` for
   * it. Without this, an operator who disabled gates before that change finds them enabled again.
   * Copied rather than moved, as `FrameworkStateStore` does: other workspaces sharing this
   * `state.db` may not have adopted it yet. Once the launch scope has its own row, that row wins
   * and this is a no-op.
   */
  private async adoptLegacyGlobalState(loadedKeys: ReadonlySet<string>): Promise<void> {
    const launchKey = this.resolveStateKey(this.defaultScope);
    if (
      launchKey === DEFAULT_IDENTITY_SCOPE_ID ||
      loadedKeys.has(launchKey) ||
      !loadedKeys.has(DEFAULT_IDENTITY_SCOPE_ID)
    ) {
      return;
    }

    const legacyState = this.getOrCreateScopedState();
    const launchState = this.getOrCreateScopedState(this.defaultScope);
    launchState.enabled = legacyState.enabled;
    launchState.enabledAt = new Date(legacyState.enabledAt);
    launchState.enableReason = legacyState.enableReason;

    await this.saveStateToFile(this.defaultScope);
    this.logger.info(
      `✅ Adopted pre-isolation gate state (${legacyState.enabled ? 'enabled' : 'disabled'}) for scope '${launchKey}'`
    );
  }

  private applyPersistedState(target: GateSystemState, persisted: PersistedGateSystemState): void {
    target.enabled = persisted.enabled;
    target.enabledAt = new Date(persisted.enabledAt);
    target.enableReason = persisted.enableReason;
    target.validationMetrics = {
      ...target.validationMetrics,
      ...persisted.validationMetrics,
      lastValidationTime: persisted.validationMetrics.lastValidationTime
        ? new Date(persisted.validationMetrics.lastValidationTime)
        : null,
    };
  }

  private async ensureStateStore(): Promise<SqliteStateStore<PersistedGateSystemState>> {
    // Initialize SQLite state store if not injected via constructor
    if (!this.stateStore) {
      if (this.stateDbPath === undefined) {
        // The constructor sets exactly one of the two, so this is a broken invariant, not a state.
        throw new Error('GateStateStore has neither an injected store nor a state.db path.');
      }
      const dbManager = await SqliteEngine.getInstance(this.logger, { dbPath: this.stateDbPath });
      this.stateStore = new SqliteStateStore<PersistedGateSystemState>(
        dbManager,
        {
          tableName: 'kv_state',
          key: GATE_STATE_KEY,
          stateColumn: 'state',
          defaultState: () => ({
            enabled: true,
            enabledAt: new Date().toISOString(),
            enableReason: 'System initialization (default enabled)',
            validationMetrics: {
              totalValidations: 0,
              successfulValidations: 0,
              averageValidationTime: 0,
              lastValidationTime: null,
            },
          }),
        },
        this.logger
      );
    }
    return this.stateStore;
  }

  /**
   * Save current state to SQLite
   */
  private async saveStateToFile(scope?: StateStoreOptions): Promise<void> {
    if (!this.stateStore) {
      this.logger.warn('GateStateStore: stateStore not initialized, skipping save');
      return;
    }

    const currentState = this.getOrCreateScopedState(scope);
    const stateToSave: PersistedGateSystemState = {
      enabled: currentState.enabled,
      enabledAt: currentState.enabledAt.toISOString(),
      enableReason: currentState.enableReason,
      validationMetrics: {
        ...currentState.validationMetrics,
        lastValidationTime:
          currentState.validationMetrics.lastValidationTime?.toISOString() || null,
      },
    };

    await this.stateStore.save(stateToSave, scope);
    this.logger.debug('Gate system state persisted to SQLite');
  }

  /**
   * Validate persisted state structure
   */
  private isValidPersistedState(state: any): state is PersistedGateSystemState {
    return (
      state &&
      typeof state.enabled === 'boolean' &&
      typeof state.enabledAt === 'string' &&
      typeof state.enableReason === 'string' &&
      state.validationMetrics &&
      typeof state.validationMetrics.totalValidations === 'number'
    );
  }

  /**
   * Check if gate system is enabled
   */
  isGateSystemEnabled(scope?: StateStoreOptions): boolean {
    return this.getOrCreateScopedState(scope).enabled;
  }

  /**
   * Enable the gate system
   */
  async enableGateSystem(
    reason: string = 'User request',
    scope?: StateStoreOptions
  ): Promise<void> {
    const currentState = this.getOrCreateScopedState(scope);
    if (currentState.enabled) {
      this.logger.debug('Gate system already enabled');
      return;
    }

    currentState.enabled = true;
    currentState.enabledAt = new Date();
    currentState.enableReason = reason;
    currentState.isHealthy = true;

    await this.saveStateToFile(scope);

    this.emit('system-enabled', reason);
    this.emit('health-changed', this.getSystemHealth(scope));

    this.logger.info(`🟢 Gate System enabled: ${reason}`);
  }

  /**
   * Disable the gate system
   */
  async disableGateSystem(
    reason: string = 'User request',
    scope?: StateStoreOptions
  ): Promise<void> {
    const currentState = this.getOrCreateScopedState(scope);
    if (!currentState.enabled) {
      this.logger.debug('Gate system already disabled');
      return;
    }

    currentState.enabled = false;
    currentState.enableReason = `Disabled: ${reason}`;

    await this.saveStateToFile(scope);

    this.emit('system-disabled', reason);
    this.emit('health-changed', this.getSystemHealth(scope));

    this.logger.info(`🔴 Gate System disabled: ${reason}`);
  }

  /**
   * Get current system health
   */
  getSystemHealth(scope?: StateStoreOptions): GateSystemHealth {
    const currentState = this.getOrCreateScopedState(scope);
    const metrics = currentState.validationMetrics;
    const successRate =
      metrics.totalValidations > 0
        ? (metrics.successfulValidations / metrics.totalValidations) * 100
        : 100;

    let status: 'healthy' | 'degraded' | 'disabled' = 'healthy';
    const issues: string[] = [];

    if (!currentState.enabled) {
      status = 'disabled';
    } else if (successRate < 80 && metrics.totalValidations > 10) {
      status = 'degraded';
      issues.push('Low validation success rate');
    } else if (metrics.averageValidationTime > 1000) {
      status = 'degraded';
      issues.push('High validation latency');
    }

    return {
      status,
      enabled: currentState.enabled,
      totalValidations: metrics.totalValidations,
      successRate: Math.round(successRate * 100) / 100,
      averageValidationTime: Math.round(metrics.averageValidationTime * 100) / 100,
      lastValidationTime: metrics.lastValidationTime,
      issues,
    };
  }

  /**
   * Record a validation execution for metrics.
   *
   * **No caller as of 2026-08-19.** Its only one was `LightweightGateSystem.validateContent`,
   * deleted with `GateValidator` when every criteria type moved to a pipeline stage. So
   * `getSystemHealth`'s `totalValidations`, `successRate` and `lastValidationTime` now read
   * their initial values forever — a reader without a producer, and the reason this method is
   * kept rather than deleted with its caller: the health projection still exists and needs a
   * writer, not amputation.
   *
   * Revives when gate review reports its ground-truth results here (the natural producer is
   * `20-gate-review-stage.ts`, which now knows every verification outcome and their durations).
   * Delete instead if that is judged not worth wiring — but do it together with the health
   * fields, so no reader is left describing a number nothing computes.
   */
  recordValidation(success: boolean, executionTime: number, scope?: StateStoreOptions): void {
    const currentState = this.getOrCreateScopedState(scope);
    const metrics = currentState.validationMetrics;

    metrics.totalValidations++;
    if (success) {
      metrics.successfulValidations++;
    }

    // Update average execution time using running average
    metrics.averageValidationTime =
      (metrics.averageValidationTime * (metrics.totalValidations - 1) + executionTime) /
      metrics.totalValidations;

    metrics.lastValidationTime = new Date();

    // Save state periodically (every 10 validations)
    if (metrics.totalValidations % 10 === 0) {
      this.saveStateToFile(scope).catch((error) => {
        this.logger.error('Failed to save validation metrics:', error);
      });
    }

    // Emit event
    this.emit('validation-completed', success, executionTime);

    this.logger.debug(
      `Validation recorded: ${success ? 'success' : 'failure'} (${executionTime}ms)`
    );
  }

  /**
   * Get current state for inspection
   */
  getCurrentState(scope?: StateStoreOptions): GateSystemState {
    return { ...this.getOrCreateScopedState(scope) };
  }

  /**
   * Start health monitoring
   */
  private startHealthMonitoring(): void {
    // Check system health every 30 seconds (default scope only)
    this.healthCheckInterval = setInterval(() => {
      const health = this.getSystemHealth();
      const defaultState = this.getOrCreateScopedState();

      // Only emit health changes if status actually changed
      const previousStatus = defaultState.isHealthy;
      const currentlyHealthy = health.status === 'healthy';

      if (previousStatus !== currentlyHealthy) {
        defaultState.isHealthy = currentlyHealthy;
        this.emit('health-changed', health);

        if (!currentlyHealthy) {
          this.logger.warn(`🚨 Gate system health degraded: ${health.issues.join(', ')}`);
        }
      }
    }, 30000);
  }

  /**
   * Cleanup resources
   */
  async cleanup(): Promise<void> {
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }

    // Final state save
    await this.saveStateToFile();

    this.logger.debug('GateStateStore cleanup completed');
  }
}

/**
 * Create a gate system manager instance
 */
export function createGateStateStore(
  logger: Logger,
  stateStoreOrDbPath: SqliteStateStore<PersistedGateSystemState> | string,
  options: GateStateStoreOptions = {}
): GateStateStore {
  return new GateStateStore(logger, stateStoreOrDbPath, options);
}
