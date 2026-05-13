// @lifecycle canonical - Persists gate enable/disable state across runtime.
/**
 * Gate System Manager - Runtime State Management
 *
 * Provides runtime enable/disable functionality for the gates system,
 * following the same pattern as FrameworkStateStore for consistency.
 */

import { EventEmitter } from 'events';

import { SqliteEngine } from '../../infra/database/sqlite-engine.js';
import { SqliteStateStore } from '../../infra/database/stores/sqlite-store.js';
import { Logger } from '../../infra/logging/index.js';
import { resolveContinuityScopeId } from '../../shared/utils/request-identity-scope.js';

import type { StateStoreOptions } from '../../infra/database/stores/interface.js';

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
  private readonly serverRoot: string;
  private stateStore?: SqliteStateStore<PersistedGateSystemState>;
  private healthCheckInterval?: NodeJS.Timeout;

  constructor(
    logger: Logger,
    stateStoreOrDir?: SqliteStateStore<PersistedGateSystemState> | string
  ) {
    super();
    this.logger = logger;

    if (stateStoreOrDir instanceof SqliteStateStore) {
      this.stateStore = stateStoreOrDir;
      this.serverRoot = '';
    } else {
      this.serverRoot = stateStoreOrDir ?? '';
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
      await this.loadStateFromFile();

      // Start health monitoring
      this.startHealthMonitoring();

      const defaultState = this.getOrCreateScopedState();
      this.logger.info(
        `🚪 Gate System Manager initialized - System ${defaultState.enabled ? 'enabled' : 'disabled'}`
      );
    } catch (error) {
      this.logger.error('Failed to initialize GateStateStore:', error);
      throw error;
    }
  }

  /**
   * Load state from SQLite
   */
  private async loadStateFromFile(scope?: StateStoreOptions): Promise<void> {
    // Initialize SQLite state store if not injected via constructor
    if (!this.stateStore) {
      const dbManager = await SqliteEngine.getInstance(this.serverRoot, this.logger);
      this.stateStore = new SqliteStateStore<PersistedGateSystemState>(
        dbManager,
        {
          tableName: 'kv_state',
          key: 'gates',
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

    const currentState = this.getOrCreateScopedState(scope);

    try {
      const persistedState = await this.stateStore.load(scope);

      if (this.isValidPersistedState(persistedState)) {
        currentState.enabled = persistedState.enabled;
        currentState.enabledAt = new Date(persistedState.enabledAt);
        currentState.enableReason = persistedState.enableReason;
        currentState.validationMetrics = {
          ...currentState.validationMetrics,
          ...persistedState.validationMetrics,
          lastValidationTime: persistedState.validationMetrics.lastValidationTime
            ? new Date(persistedState.validationMetrics.lastValidationTime)
            : null,
        };

        this.logger.info(
          `✅ Loaded gate system state: ${persistedState.enabled ? 'enabled' : 'disabled'}`
        );
      } else {
        this.logger.warn('⚠️ Invalid gate state format, using defaults');
        await this.saveStateToFile(scope);
      }
    } catch (error) {
      this.logger.warn(
        `⚠️ Failed to load gate system state: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      this.logger.info('📁 Using default gate system state');
    }
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
  private isValidPersistedState(state: any): boolean {
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
   * Record a validation execution for metrics
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
  stateStoreOrDir?: SqliteStateStore<PersistedGateSystemState> | string
): GateStateStore {
  return new GateStateStore(logger, stateStoreOrDir);
}
