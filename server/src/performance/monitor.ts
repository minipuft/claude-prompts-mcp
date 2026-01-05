// @lifecycle canonical - Collects performance metrics for MCP server.
/**
 * Performance Monitoring System
 *
 * Comprehensive performance tracking and optimization for the MCP server
 * Focuses on execution metrics, memory usage, and system health monitoring
 */

import * as os from 'os';

import { Logger } from '../logging/index.js';
// REMOVED: ExecutionCoordinator - modular chain system removed

export interface PerformanceMetrics {
  timestamp: number;

  // Memory metrics
  memory: {
    heapUsed: number;
    heapTotal: number;
    external: number;
    rss: number;
  };

  // Execution metrics
  execution: {
    totalExecutions: number;
    averageExecutionTime: number;
    successRate: number;
    activeExecutions: number;
  };

  // System metrics
  system: {
    uptime: number;
    cpuUsage: number[]; // [user percentage, system percentage]
    loadAverage: number[];
  };

  // Chain-specific metrics
  chains: {
    activeChains: number;
    averageChainLength: number;
    chainSuccessRate: number;
    averageChainExecutionTime: number;
  };
}

export interface PerformanceThresholds {
  memoryThreshold: number; // MB
  executionTimeThreshold: number; // ms
  successRateThreshold: number; // percentage
  chainExecutionTimeThreshold: number; // ms
}

export interface PerformanceAlert {
  level: 'warning' | 'error' | 'critical';
  category: 'memory' | 'execution' | 'chains' | 'system';
  message: string;
  timestamp: number;
  metrics?: Partial<PerformanceMetrics>;
  recommendation?: string;
}

/**
 * Performance monitoring and optimization system
 */
export class PerformanceMonitor {
  private logger: Logger;
  // REMOVED: executionCoordinator - modular chain system removed

  // Performance tracking
  private metricsHistory: PerformanceMetrics[] = [];
  private maxHistorySize = 1000; // Keep last 1000 measurements
  private monitoringInterval: NodeJS.Timeout | undefined;
  private alertingCallbacks: ((alert: PerformanceAlert) => void)[] = [];

  // Performance thresholds
  private thresholds: PerformanceThresholds = {
    memoryThreshold: 512, // MB
    executionTimeThreshold: 5000, // 5 seconds
    successRateThreshold: 95, // 95%
    chainExecutionTimeThreshold: 30000, // 30 seconds
  };

  // CPU tracking for delta calculation
  private previousCpuUsage: NodeJS.CpuUsage | null = null;
  private previousCpuTime = 0;

  // Optimization state
  private optimizationScheduled = false;
  private lastOptimization = 0;
  private optimizationInterval = 300000; // 5 minutes

  constructor(logger: Logger, thresholds?: Partial<PerformanceThresholds>) {
    this.logger = logger;

    if (thresholds) {
      this.thresholds = { ...this.thresholds, ...thresholds };
    }
  }

  // REMOVED: setExecutionCoordinator - ExecutionCoordinator removed

  /**
   * Check if we're running in a test environment
   */
  private isTestEnvironment(): boolean {
    const env = process.env;
    return (
      env['NODE_ENV'] === 'test' ||
      process.argv.includes('--suppress-debug') ||
      process.argv.includes('--test-mode') ||
      // Detect GitHub Actions CI environment
      env['GITHUB_ACTIONS'] === 'true' ||
      env['CI'] === 'true' ||
      // Detect common test runner patterns
      process.argv.some(
        (arg) => arg.includes('test') || arg.includes('jest') || arg.includes('mocha')
      ) ||
      // Detect if called from integration test scripts
      (process.argv[1]?.includes('tests/scripts/') ?? false)
    );
  }

  /**
   * Start performance monitoring
   * SUPPRESSED in test environments to prevent hanging processes
   */
  startMonitoring(intervalMs: number = 30000): void {
    // Default: 30 seconds
    if (this.monitoringInterval) {
      this.stopMonitoring();
    }

    // Skip performance monitoring in test environments to prevent hanging processes
    if (this.isTestEnvironment()) {
      this.logger.debug('Performance monitoring suppressed in test environment');
      return;
    }

    this.logger.info(`Starting performance monitoring (interval: ${intervalMs}ms)`);

    // Take initial measurement
    this.collectMetrics();

    // Set up regular monitoring
    this.monitoringInterval = setInterval(() => {
      this.collectMetrics();
      this.checkThresholds();
      this.scheduleOptimization();
    }, intervalMs);
  }

  /**
   * Stop performance monitoring
   */
  stopMonitoring(): void {
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = undefined;
      this.logger.info('Performance monitoring stopped');
    }
  }

  /**
   * Collect current performance metrics
   */
  collectMetrics(): PerformanceMetrics {
    const timestamp = Date.now();
    const memoryUsage = process.memoryUsage();
    const currentCpuUsage = process.cpuUsage();

    // Calculate CPU percentage from deltas
    let cpuPercentage = [0, 0]; // [user%, system%]
    if (this.previousCpuUsage && this.previousCpuTime) {
      const timeDelta = timestamp - this.previousCpuTime; // milliseconds
      const userDelta = currentCpuUsage.user - this.previousCpuUsage.user; // microseconds
      const systemDelta = currentCpuUsage.system - this.previousCpuUsage.system; // microseconds

      if (timeDelta > 0) {
        // Convert to percentages (microseconds to milliseconds, then percentage)
        const userPercent = (userDelta / 1000 / timeDelta) * 100;
        const systemPercent = (systemDelta / 1000 / timeDelta) * 100;
        cpuPercentage = [Math.min(userPercent, 100), Math.min(systemPercent, 100)];
      }
    }

    // Store current values for next calculation
    this.previousCpuUsage = currentCpuUsage;
    this.previousCpuTime = timestamp;

    // Get execution metrics if available
    let executionMetrics = {
      totalExecutions: 0,
      averageExecutionTime: 0,
      successRate: 100,
      activeExecutions: 0,
    };

    // REMOVED: ExecutionCoordinator metrics - execution handled by PromptExecutionService
    // Default execution metrics since ExecutionCoordinator removed

    const metrics: PerformanceMetrics = {
      timestamp,
      memory: {
        heapUsed: Math.round(memoryUsage.heapUsed / 1024 / 1024), // MB
        heapTotal: Math.round(memoryUsage.heapTotal / 1024 / 1024), // MB
        external: Math.round(memoryUsage.external / 1024 / 1024), // MB
        rss: Math.round(memoryUsage.rss / 1024 / 1024), // MB
      },
      execution: executionMetrics,
      system: {
        uptime: Math.round(process.uptime()),
        cpuUsage: cpuPercentage, // CPU percentage [user%, system%]
        loadAverage: process.platform !== 'win32' ? os.loadavg() : [0, 0, 0],
      },
      chains: this.calculateChainMetrics(),
    };

    // Store metrics with history management
    this.metricsHistory.push(metrics);
    if (this.metricsHistory.length > this.maxHistorySize) {
      this.metricsHistory.shift();
    }

    this.logger.debug(
      `Performance metrics collected - Memory: ${metrics.memory.heapUsed}MB, Executions: ${metrics.execution.totalExecutions}`
    );

    return metrics;
  }

  /**
   * Get performance metrics history
   */
  getMetricsHistory(count?: number): PerformanceMetrics[] {
    if (count && count < this.metricsHistory.length) {
      return this.metricsHistory.slice(-count);
    }
    return [...this.metricsHistory];
  }

  /**
   * Get latest performance metrics
   */
  getLatestMetrics(): PerformanceMetrics | undefined {
    return this.metricsHistory[this.metricsHistory.length - 1];
  }

  /**
   * Register alerting callback
   */
  onAlert(callback: (alert: PerformanceAlert) => void): void {
    this.alertingCallbacks.push(callback);
  }

  /**
   * Get performance summary over time period
   */
  getPerformanceSummary(periodMs: number = 3600000):
    | {
        // Default: 1 hour
        averageMemory: number;
        peakMemory: number;
        averageExecutionTime: number;
        totalExecutions: number;
        successRate: number;
        alertsGenerated: number;
      }
    | undefined {
    const cutoffTime = Date.now() - periodMs;
    const relevantMetrics = this.metricsHistory.filter((m) => m.timestamp >= cutoffTime);

    if (relevantMetrics.length === 0) {
      return undefined;
    }

    const avgMemory =
      relevantMetrics.reduce((sum, m) => sum + m.memory.heapUsed, 0) / relevantMetrics.length;
    const peakMemory = Math.max(...relevantMetrics.map((m) => m.memory.heapUsed));

    const latestMetrics = relevantMetrics[relevantMetrics.length - 1];
    const earliestMetrics = relevantMetrics[0];

    if (!latestMetrics || !earliestMetrics) {
      return undefined;
    }

    const totalExecutions =
      latestMetrics.execution.totalExecutions - earliestMetrics.execution.totalExecutions;

    return {
      averageMemory: Math.round(avgMemory),
      peakMemory,
      averageExecutionTime: latestMetrics.execution.averageExecutionTime,
      totalExecutions,
      successRate: latestMetrics.execution.successRate,
      alertsGenerated: 0, // Could be implemented with alert history
    };
  }

  /**
   * Force performance optimization
   */
  async optimizePerformance(): Promise<{
    memoryFreed: number;
    optimizationsApplied: string[];
  }> {
    const beforeMemory = process.memoryUsage().heapUsed;
    const optimizations: string[] = [];

    this.logger.info('Starting performance optimization');

    // 1. Trigger garbage collection if available
    if (global.gc) {
      global.gc();
      optimizations.push('Garbage collection executed');
    }

    // REMOVED: Execution history cleanup - ExecutionCoordinator removed

    // 3. Trim metrics history if needed
    if (this.metricsHistory.length > this.maxHistorySize * 0.8) {
      const trimCount = Math.floor(this.metricsHistory.length * 0.2);
      this.metricsHistory.splice(0, trimCount);
      optimizations.push(`Metrics history trimmed (${trimCount} entries)`);
    }

    const afterMemory = process.memoryUsage().heapUsed;
    const memoryFreed = Math.max(0, beforeMemory - afterMemory);

    this.lastOptimization = Date.now();
    this.optimizationScheduled = false;

    this.logger.info(
      `Performance optimization completed - ${optimizations.length} optimizations applied, ${Math.round(memoryFreed / 1024 / 1024)}MB freed`
    );

    return {
      memoryFreed: Math.round(memoryFreed / 1024 / 1024), // MB
      optimizationsApplied: optimizations,
    };
  }

  /**
   * Calculate chain-specific metrics
   */
  private calculateChainMetrics(): PerformanceMetrics['chains'] {
    // REMOVED: ExecutionCoordinator chain metrics - using defaults
    // Chain metrics now tracked by PromptExecutionService if needed
    return {
      activeChains: 0,
      averageChainLength: 0,
      chainSuccessRate: 100,
      averageChainExecutionTime: 0,
    };
  }

  /**
   * Check performance thresholds and generate alerts
   */
  private checkThresholds(): void {
    const latest = this.getLatestMetrics();
    if (!latest) return;

    const alerts: PerformanceAlert[] = [];

    // Memory threshold check
    if (latest.memory.heapUsed > this.thresholds.memoryThreshold) {
      alerts.push({
        level:
          latest.memory.heapUsed > this.thresholds.memoryThreshold * 1.5 ? 'critical' : 'warning',
        category: 'memory',
        message: `High memory usage: ${latest.memory.heapUsed}MB (threshold: ${this.thresholds.memoryThreshold}MB)`,
        timestamp: latest.timestamp,
        metrics: { memory: latest.memory },
        recommendation:
          'Consider running performance optimization or reducing execution concurrency',
      });
    }

    // Execution time threshold check
    if (latest.execution.averageExecutionTime > this.thresholds.executionTimeThreshold) {
      alerts.push({
        level: 'warning',
        category: 'execution',
        message: `Slow execution times: ${latest.execution.averageExecutionTime}ms average (threshold: ${this.thresholds.executionTimeThreshold}ms)`,
        timestamp: latest.timestamp,
        metrics: { execution: latest.execution },
        recommendation: 'Review prompt complexity and chain configurations',
      });
    }

    // Success rate threshold check
    if (latest.execution.successRate < this.thresholds.successRateThreshold) {
      alerts.push({
        level: 'error',
        category: 'execution',
        message: `Low success rate: ${latest.execution.successRate.toFixed(1)}% (threshold: ${this.thresholds.successRateThreshold}%)`,
        timestamp: latest.timestamp,
        metrics: { execution: latest.execution },
        recommendation: 'Investigate execution failures and improve error handling',
      });
    }

    // Chain execution time threshold check
    if (latest.chains.averageChainExecutionTime > this.thresholds.chainExecutionTimeThreshold) {
      alerts.push({
        level: 'warning',
        category: 'chains',
        message: `Slow chain execution: ${latest.chains.averageChainExecutionTime}ms average (threshold: ${this.thresholds.chainExecutionTimeThreshold}ms)`,
        timestamp: latest.timestamp,
        metrics: { chains: latest.chains },
        recommendation: 'Optimize chain steps and reduce chain complexity',
      });
    }

    // Send alerts
    alerts.forEach((alert) => {
      this.logger.warn(`Performance alert [${alert.level}]: ${alert.message}`);
      this.alertingCallbacks.forEach((callback) => callback(alert));
    });
  }

  /**
   * Schedule performance optimization if needed
   */
  private scheduleOptimization(): void {
    if (this.optimizationScheduled) return;

    const timeSinceLastOptimization = Date.now() - this.lastOptimization;
    const latest = this.getLatestMetrics();

    if (!latest) return;

    // Schedule optimization if:
    // 1. It's been long enough since last optimization
    // 2. Memory usage is high
    // 3. Execution history is large
    const shouldOptimize =
      timeSinceLastOptimization > this.optimizationInterval ||
      latest.memory.heapUsed > this.thresholds.memoryThreshold * 0.8;
    // REMOVED: Execution history check - ExecutionCoordinator removed

    if (shouldOptimize) {
      this.optimizationScheduled = true;

      // Schedule optimization in next tick to avoid blocking current operations
      setImmediate(() => {
        this.optimizePerformance().catch((error) => {
          this.logger.error('Performance optimization failed:', error);
          this.optimizationScheduled = false;
        });
      });
    }
  }
}

/**
 * Factory function to create a performance monitor
 */
export function createPerformanceMonitor(
  logger: Logger,
  thresholds?: Partial<PerformanceThresholds>
): PerformanceMonitor {
  return new PerformanceMonitor(logger, thresholds);
}
