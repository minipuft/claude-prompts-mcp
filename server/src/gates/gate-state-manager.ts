// @lifecycle canonical - Persists gate enable/disable state across runtime.
/**
 * Gate System Manager - Runtime State Management
 *
 * Provides runtime enable/disable functionality for the gates system,
 * following the same pattern as FrameworkStateManager for consistency.
 */

import { EventEmitter } from 'events';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

import { Logger } from '../logging/index.js';
import { atomicWriteFile } from '../utils/atomic-file-write.js';

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
export class GateSystemManager extends EventEmitter {
  private currentState: GateSystemState;
  private logger: Logger;
  private stateFilePath: string;
  private healthCheckInterval?: NodeJS.Timeout;

  constructor(logger: Logger, stateDirectory?: string) {
    super();
    this.logger = logger;

    // Default state - gates enabled by default
    this.currentState = {
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

    // Set up state file path (default to server runtime-state resolving from module location)
    const resolvedBaseDir =
      stateDirectory ||
      path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'runtime-state');
    this.stateFilePath = path.join(path.resolve(resolvedBaseDir), 'gate-system-state.json');

    this.logger.debug(`GateSystemManager initialized with state file: ${this.stateFilePath}`);
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

      this.logger.info(
        `🚪 Gate System Manager initialized - System ${this.currentState.enabled ? 'enabled' : 'disabled'}`
      );
    } catch (error) {
      this.logger.error('Failed to initialize GateSystemManager:', error);
      throw error;
    }
  }

  /**
   * Load state from persistent storage
   */
  private async loadStateFromFile(): Promise<void> {
    try {
      // Ensure state directory exists
      await fs.mkdir(path.dirname(this.stateFilePath), { recursive: true });

      // Try to load existing state
      const stateData = await fs.readFile(this.stateFilePath, 'utf-8');
      const persistedState = JSON.parse(stateData);

      // Validate and restore state
      if (this.isValidPersistedState(persistedState)) {
        this.currentState.enabled = persistedState.enabled;
        this.currentState.enabledAt = new Date(persistedState.enabledAt);
        this.currentState.enableReason = persistedState.enableReason;
        this.currentState.validationMetrics = {
          ...this.currentState.validationMetrics,
          ...persistedState.validationMetrics,
          lastValidationTime: persistedState.validationMetrics.lastValidationTime
            ? new Date(persistedState.validationMetrics.lastValidationTime)
            : null,
        };

        this.logger.info(
          `✅ Loaded persisted gate system state: ${persistedState.enabled ? 'enabled' : 'disabled'}`
        );
      } else {
        this.logger.warn('⚠️ Invalid persisted gate state format, using defaults');
        await this.saveStateToFile(); // Save valid defaults
      }
    } catch (error) {
      if ((error as any).code === 'ENOENT') {
        // No state file exists yet - use defaults and create initial state
        this.logger.info('📁 No existing gate system state found, using defaults');
        await this.saveStateToFile();
      } else {
        this.logger.error('Failed to load gate system state:', error);
        // Continue with defaults but don't fail initialization
      }
    }
  }

  /**
   * Save current state to persistent storage
   */
  private async saveStateToFile(): Promise<void> {
    try {
      const stateToSave = {
        enabled: this.currentState.enabled,
        enabledAt: this.currentState.enabledAt.toISOString(),
        enableReason: this.currentState.enableReason,
        validationMetrics: {
          ...this.currentState.validationMetrics,
          lastValidationTime:
            this.currentState.validationMetrics.lastValidationTime?.toISOString() || null,
        },
        savedAt: new Date().toISOString(),
      };

      // Use atomic write to prevent data corruption from concurrent processes
      await atomicWriteFile(this.stateFilePath, JSON.stringify(stateToSave, null, 2));
      this.logger.debug('Gate system state saved to file');
    } catch (error) {
      this.logger.error('Failed to save gate system state:', error);
      // Don't throw - this shouldn't break the system
    }
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
  isGateSystemEnabled(): boolean {
    return this.currentState.enabled;
  }

  /**
   * Enable the gate system
   */
  async enableGateSystem(reason: string = 'User request'): Promise<void> {
    if (this.currentState.enabled) {
      this.logger.debug('Gate system already enabled');
      return;
    }

    this.currentState.enabled = true;
    this.currentState.enabledAt = new Date();
    this.currentState.enableReason = reason;
    this.currentState.isHealthy = true;

    // Save state to file
    await this.saveStateToFile();

    // Emit events
    this.emit('system-enabled', reason);
    this.emit('health-changed', this.getSystemHealth());

    this.logger.info(`🟢 Gate System enabled: ${reason}`);
  }

  /**
   * Disable the gate system
   */
  async disableGateSystem(reason: string = 'User request'): Promise<void> {
    if (!this.currentState.enabled) {
      this.logger.debug('Gate system already disabled');
      return;
    }

    this.currentState.enabled = false;
    this.currentState.enableReason = `Disabled: ${reason}`;

    // Save state to file
    await this.saveStateToFile();

    // Emit events
    this.emit('system-disabled', reason);
    this.emit('health-changed', this.getSystemHealth());

    this.logger.info(`🔴 Gate System disabled: ${reason}`);
  }

  /**
   * Get current system health
   */
  getSystemHealth(): GateSystemHealth {
    const metrics = this.currentState.validationMetrics;
    const successRate =
      metrics.totalValidations > 0
        ? (metrics.successfulValidations / metrics.totalValidations) * 100
        : 100;

    let status: 'healthy' | 'degraded' | 'disabled' = 'healthy';
    const issues: string[] = [];

    if (!this.currentState.enabled) {
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
      enabled: this.currentState.enabled,
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
  recordValidation(success: boolean, executionTime: number): void {
    const metrics = this.currentState.validationMetrics;

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
      this.saveStateToFile().catch((error) => {
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
  getCurrentState(): GateSystemState {
    return { ...this.currentState };
  }

  /**
   * Start health monitoring
   */
  private startHealthMonitoring(): void {
    // Check system health every 30 seconds
    this.healthCheckInterval = setInterval(() => {
      const health = this.getSystemHealth();

      // Only emit health changes if status actually changed
      const previousStatus = this.currentState.isHealthy;
      const currentlyHealthy = health.status === 'healthy';

      if (previousStatus !== currentlyHealthy) {
        this.currentState.isHealthy = currentlyHealthy;
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

    this.logger.debug('GateSystemManager cleanup completed');
  }
}

/**
 * Create a gate system manager instance
 */
export function createGateSystemManager(
  logger: Logger,
  stateDirectory?: string
): GateSystemManager {
  return new GateSystemManager(logger, stateDirectory);
}
