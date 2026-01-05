// @lifecycle canonical - Tracks framework methodology state for prompt guidance orchestration.
/**
 * Methodology Tracker
 *
 * Tracks active methodology state and handles framework switching.
 * Consolidated from framework-state-manager for better separation of concerns.
 */

import { EventEmitter } from 'events';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { Logger } from '../../logging/index.js';
import {
  MethodologyHealth,
  MethodologyState,
  MethodologySwitchRequest,
  PersistedMethodologyState,
} from '../types/index.js';

/**
 * Methodology tracking configuration
 */
export interface MethodologyTrackerConfig {
  /** Server root directory for resolving relative paths */
  serverRoot: string;
  persistStateToDisk: boolean;
  stateFilePath: string;
  enableHealthMonitoring: boolean;
  healthCheckIntervalMs: number;
  maxSwitchHistory: number;
  enableMetrics: boolean;
}

/**
 * Methodology Tracker Events
 */
export interface MethodologyTrackerEvents {
  'methodology-switched': (previous: string, current: string, reason: string) => void;
  'methodology-error': (methodology: string, error: Error) => void;
  'health-changed': (health: MethodologyHealth) => void;
  'state-persisted': (state: PersistedMethodologyState) => void;
}

/**
 * Methodology Tracker
 *
 * Maintains methodology state across operations, handles switching,
 * and provides health monitoring for the methodology system.
 */
export class MethodologyTracker extends EventEmitter {
  private logger: Logger;
  private config: MethodologyTrackerConfig;
  private currentState: MethodologyState;
  private readonly rootPath: string;
  private switchHistory: Array<{
    from: string;
    to: string;
    timestamp: Date;
    reason: string;
    success: boolean;
  }> = [];
  private healthCheckTimer: NodeJS.Timeout | null = null;
  private switchingMetrics = {
    totalSwitches: 0,
    successfulSwitches: 0,
    failedSwitches: 0,
    averageResponseTime: 0,
    responseTimes: [] as number[],
  };

  constructor(logger: Logger, config?: Partial<MethodologyTrackerConfig>) {
    super();
    this.logger = logger;
    // Use provided serverRoot, fallback to cwd() - no env var dependency
    const rootPath = path.resolve(config?.serverRoot || process.cwd());
    this.rootPath = rootPath;
    const runtimeStatePath = path.join(rootPath, 'runtime-state', 'framework-state.json');

    const defaultConfig: MethodologyTrackerConfig = {
      serverRoot: rootPath,
      persistStateToDisk: true,
      stateFilePath: runtimeStatePath,
      enableHealthMonitoring: true,
      healthCheckIntervalMs: 30000, // 30 seconds
      maxSwitchHistory: 100,
      enableMetrics: true,
    };

    this.config = {
      ...defaultConfig,
      ...config,
      stateFilePath: config?.stateFilePath
        ? path.isAbsolute(config.stateFilePath)
          ? config.stateFilePath
          : path.resolve(rootPath, config.stateFilePath)
        : defaultConfig.stateFilePath,
    };

    // Initialize default state
    this.currentState = {
      activeMethodology: 'CAGEERF', // Default methodology
      previousMethodology: null,
      switchedAt: new Date(),
      switchReason: 'Initial state',
      isHealthy: true,
      methodologySystemEnabled: true,
      switchingMetrics: {
        switchCount: 0,
        averageResponseTime: 0,
        errorCount: 0,
      },
    };
  }

  /**
   * Initialize methodology tracker with state restoration
   */
  async initialize(): Promise<void> {
    this.logger.info('Initializing MethodologyTracker...');

    try {
      // Restore state from disk if enabled
      if (this.config.persistStateToDisk) {
        await this.restoreState();
      }

      // Start health monitoring if enabled
      if (this.config.enableHealthMonitoring) {
        this.startHealthMonitoring();
      }

      this.logger.info(
        `MethodologyTracker initialized with ${this.currentState.activeMethodology} methodology`
      );
    } catch (error) {
      this.logger.error('Failed to initialize MethodologyTracker:', error);
      throw error;
    }
  }

  /**
   * Switch to a different methodology
   * Consolidated from framework-state-manager.switchFramework()
   */
  async switchMethodology(request: MethodologySwitchRequest): Promise<boolean> {
    const startTime = Date.now();
    const previousMethodology = this.currentState.activeMethodology;
    const targetMethodology = request.targetMethodology;
    const reason = request.reason || 'Manual switch';

    this.logger.info(
      `Switching methodology: ${previousMethodology} -> ${targetMethodology} (${reason})`
    );

    try {
      // Validate switch request
      if (!this.validateSwitchRequest(request)) {
        throw new Error(`Invalid switch request: ${targetMethodology}`);
      }

      // Update state
      this.currentState = {
        ...this.currentState,
        previousMethodology,
        activeMethodology: targetMethodology,
        switchedAt: new Date(),
        switchReason: reason,
        switchingMetrics: {
          ...this.currentState.switchingMetrics,
          switchCount: this.currentState.switchingMetrics.switchCount + 1,
        },
      };

      // Record switch in history
      const switchRecord = {
        from: previousMethodology,
        to: targetMethodology,
        timestamp: new Date(),
        reason,
        success: true,
      };
      this.addToSwitchHistory(switchRecord);

      // Update metrics
      if (this.config.enableMetrics) {
        this.updateSwitchingMetrics(Date.now() - startTime, true);
      }

      // Persist state if enabled
      if (this.config.persistStateToDisk) {
        await this.persistState();
      }

      // Emit event
      this.emit('methodology-switched', previousMethodology, targetMethodology, reason);

      this.logger.info(
        `Methodology switch completed: ${previousMethodology} -> ${targetMethodology} in ${
          Date.now() - startTime
        }ms`
      );
      return true;
    } catch (error) {
      this.logger.error(`Failed to switch methodology to ${targetMethodology}:`, error);

      // Record failed switch
      this.addToSwitchHistory({
        from: previousMethodology,
        to: targetMethodology,
        timestamp: new Date(),
        reason,
        success: false,
      });

      // Update failure metrics
      if (this.config.enableMetrics) {
        this.updateSwitchingMetrics(Date.now() - startTime, false);
      }

      // Emit error event
      this.emit(
        'methodology-error',
        targetMethodology,
        error instanceof Error ? error : new Error(String(error))
      );

      return false;
    }
  }

  /**
   * Get current methodology state
   */
  getCurrentState(): MethodologyState {
    return { ...this.currentState };
  }

  /**
   * Get methodology system health
   */
  getSystemHealth(): MethodologyHealth {
    return {
      status: this.currentState.isHealthy ? 'healthy' : 'error',
      activeMethodology: this.currentState.activeMethodology,
      methodologySystemEnabled: this.currentState.methodologySystemEnabled,
      lastSwitchTime: this.currentState.switchedAt,
      switchingMetrics: {
        totalSwitches: this.switchingMetrics.totalSwitches,
        successfulSwitches: this.switchingMetrics.successfulSwitches,
        failedSwitches: this.switchingMetrics.failedSwitches,
        averageResponseTime: this.switchingMetrics.averageResponseTime,
      },
      issues: this.detectHealthIssues(),
    };
  }

  /**
   * Enable or disable the methodology system
   */
  async setMethodologySystemEnabled(
    enabled: boolean,
    reason: string = 'Manual toggle'
  ): Promise<void> {
    const previousState = this.currentState.methodologySystemEnabled;

    this.currentState.methodologySystemEnabled = enabled;
    this.currentState.switchReason = `System ${enabled ? 'enabled' : 'disabled'}: ${reason}`;

    this.logger.info(`Methodology system ${enabled ? 'enabled' : 'disabled'}: ${reason}`);

    // Persist state change
    if (this.config.persistStateToDisk) {
      await this.persistState();
    }

    // Emit event if state changed
    if (previousState !== enabled) {
      this.emit('methodology-system-toggled' as any, enabled, reason);
    }
  }

  /**
   * Get switch history
   */
  getSwitchHistory(): Array<{
    from: string;
    to: string;
    timestamp: Date;
    reason: string;
    success: boolean;
  }> {
    return [...this.switchHistory];
  }

  /**
   * Clear switch history
   */
  clearSwitchHistory(): void {
    this.switchHistory = [];
    this.logger.debug('Switch history cleared');
  }

  /**
   * Shutdown methodology tracker
   */
  async shutdown(): Promise<void> {
    this.logger.info('Shutting down MethodologyTracker...');

    // Stop health monitoring
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }

    // Persist final state
    if (this.config.persistStateToDisk) {
      await this.persistState();
    }

    // Remove all event listeners to prevent memory leaks
    this.removeAllListeners();
    this.logger.debug('Event listeners removed during shutdown');

    this.logger.info('MethodologyTracker shutdown complete');
  }

  /**
   * Validate switch request
   */
  private validateSwitchRequest(request: MethodologySwitchRequest): boolean {
    // Check if methodology system is enabled
    if (!this.currentState.methodologySystemEnabled) {
      this.logger.warn('Methodology switch rejected - system disabled');
      return false;
    }

    // Check if switching to same methodology
    if (request.targetMethodology === this.currentState.activeMethodology) {
      this.logger.debug(`Already using ${request.targetMethodology} methodology`);
      return true; // Not an error, but no switch needed
    }

    // Note: Framework validity is validated by FrameworkManager.getFramework()
    // which supports both built-in and custom frameworks from the registry.
    // MethodologyTracker accepts any non-empty string; actual validation
    // happens before reaching this layer.
    if (!request.targetMethodology || request.targetMethodology.trim() === '') {
      this.logger.error('Invalid methodology: empty or undefined');
      return false;
    }

    return true;
  }

  /**
   * Add switch record to history
   */
  private addToSwitchHistory(record: {
    from: string;
    to: string;
    timestamp: Date;
    reason: string;
    success: boolean;
  }): void {
    this.switchHistory.push(record);

    // Trim history if it exceeds maximum
    if (this.switchHistory.length > this.config.maxSwitchHistory) {
      this.switchHistory = this.switchHistory.slice(-this.config.maxSwitchHistory);
    }
  }

  /**
   * Update switching metrics
   */
  private updateSwitchingMetrics(responseTime: number, success: boolean): void {
    this.switchingMetrics.totalSwitches++;

    if (success) {
      this.switchingMetrics.successfulSwitches++;
    } else {
      this.switchingMetrics.failedSwitches++;
    }

    // Update response time metrics
    this.switchingMetrics.responseTimes.push(responseTime);
    if (this.switchingMetrics.responseTimes.length > 100) {
      this.switchingMetrics.responseTimes = this.switchingMetrics.responseTimes.slice(-100);
    }

    this.switchingMetrics.averageResponseTime =
      this.switchingMetrics.responseTimes.reduce((sum, time) => sum + time, 0) /
      this.switchingMetrics.responseTimes.length;

    // Update current state metrics
    this.currentState.switchingMetrics = {
      switchCount: this.switchingMetrics.totalSwitches,
      averageResponseTime: this.switchingMetrics.averageResponseTime,
      errorCount: this.switchingMetrics.failedSwitches,
    };
  }

  /**
   * Start health monitoring
   */
  private startHealthMonitoring(): void {
    this.healthCheckTimer = setInterval(() => {
      this.performHealthCheck();
    }, this.config.healthCheckIntervalMs);

    this.logger.debug(
      `Health monitoring started (interval: ${this.config.healthCheckIntervalMs}ms)`
    );
  }

  /**
   * Perform health check
   */
  private performHealthCheck(): void {
    const wasHealthy = this.currentState.isHealthy;
    const health = this.getSystemHealth();

    // Update health status
    this.currentState.isHealthy = health.status === 'healthy';

    // Emit health change event if status changed
    if (wasHealthy !== this.currentState.isHealthy) {
      this.emit('health-changed', health);
      this.logger.info(`Methodology system health changed: ${health.status}`);
    }
  }

  /**
   * Detect health issues
   */
  private detectHealthIssues(): string[] {
    const issues: string[] = [];

    // Check error rate
    const errorRate =
      this.switchingMetrics.totalSwitches > 0
        ? this.switchingMetrics.failedSwitches / this.switchingMetrics.totalSwitches
        : 0;

    if (errorRate > 0.1) {
      // More than 10% error rate
      issues.push(`High error rate: ${(errorRate * 100).toFixed(1)}%`);
    }

    // Check response time
    if (this.switchingMetrics.averageResponseTime > 1000) {
      // More than 1 second
      issues.push(
        `Slow switching: ${this.switchingMetrics.averageResponseTime.toFixed(0)}ms average`
      );
    }

    // Check if system is disabled
    if (!this.currentState.methodologySystemEnabled) {
      issues.push('Methodology system is disabled');
    }

    return issues;
  }

  /**
   * Persist state to disk
   */
  private async persistState(): Promise<void> {
    try {
      const persistedState: PersistedMethodologyState = {
        version: '1.0.0',
        methodologySystemEnabled: this.currentState.methodologySystemEnabled,
        activeMethodology: this.currentState.activeMethodology,
        lastSwitchedAt: this.currentState.switchedAt.toISOString(),
        switchReason: this.currentState.switchReason,
      };

      await fs.mkdir(path.dirname(this.config.stateFilePath), { recursive: true });
      await fs.writeFile(this.config.stateFilePath, JSON.stringify(persistedState, null, 2));
      this.emit('state-persisted', persistedState);
      this.logger.debug(`State persisted to ${this.config.stateFilePath}`);
    } catch (error) {
      this.logger.error('Failed to persist methodology state:', error);
    }
  }

  /**
   * Restore state from disk
   */
  private async restoreState(): Promise<void> {
    const persistedState = await this.readPersistedState();

    if (!persistedState) {
      this.logger.debug('Using default methodology state');
      return;
    }

    this.currentState = {
      ...this.currentState,
      activeMethodology: persistedState.activeMethodology,
      methodologySystemEnabled: persistedState.methodologySystemEnabled,
      switchedAt: new Date(persistedState.lastSwitchedAt),
      switchReason: persistedState.switchReason,
    };

    this.logger.info(
      `State restored from ${this.config.stateFilePath}: ${persistedState.activeMethodology}`
    );
  }

  private async readPersistedState(): Promise<PersistedMethodologyState | null> {
    try {
      const stateData = await fs.readFile(this.config.stateFilePath, 'utf-8');
      return JSON.parse(stateData);
    } catch (error: any) {
      if (error?.code !== 'ENOENT') {
        this.logger.warn(
          `Failed to read methodology state from ${this.config.stateFilePath}: ${
            error instanceof Error ? error.message : String(error)
          }`
        );
      }
      return null;
    }
  }

  /**
   * Update tracker configuration
   */
  updateConfig(config: Partial<MethodologyTrackerConfig>): void {
    const oldConfig = { ...this.config };
    this.config = { ...this.config, ...config };

    if (config.stateFilePath) {
      this.config.stateFilePath = path.isAbsolute(config.stateFilePath)
        ? config.stateFilePath
        : path.resolve(this.rootPath, config.stateFilePath);
    }

    // Restart health monitoring if interval changed
    if (
      oldConfig.healthCheckIntervalMs !== this.config.healthCheckIntervalMs &&
      this.config.enableHealthMonitoring
    ) {
      if (this.healthCheckTimer) {
        clearInterval(this.healthCheckTimer);
      }
      this.startHealthMonitoring();
    }

    this.logger.debug('MethodologyTracker configuration updated', config);
  }

  /**
   * Get current tracker configuration
   */
  getConfig(): MethodologyTrackerConfig {
    return { ...this.config };
  }
}

/**
 * Create and initialize a MethodologyTracker instance
 */
export async function createMethodologyTracker(
  logger: Logger,
  config?: Partial<MethodologyTrackerConfig>
): Promise<MethodologyTracker> {
  const tracker = new MethodologyTracker(logger, config);
  await tracker.initialize();
  return tracker;
}
