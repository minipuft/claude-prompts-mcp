/**
 * Metrics Collector - Centralized Performance and Usage Metrics Collection
 *
 * Provides comprehensive metrics collection and reporting for all MCP tools
 * without coupling to execution logic. Uses event-driven architecture to
 * observe tool operations and provide detailed insights.
 */

import { EventEmitter } from 'events';
import { Logger } from '../logging/index.js';
import {
  ExecutionData,
  GateValidationData,
  FrameworkSwitchData,
  ExecutionStats,
  SystemMetrics,
  FrameworkUsage,
  AnalyticsEvent,
  AnalyticsQueryOptions,
  AnalyticsSummary,
  PerformanceTrend
} from './types.js';

/**
 * Centralized Metrics Collector
 */
export class MetricsCollector extends EventEmitter {
  private logger: Logger;
  private startTime: number;

  // Analytics data storage
  private executionStats: ExecutionStats;
  private systemMetrics: SystemMetrics;
  private frameworkUsage: FrameworkUsage;
  private gateValidationStats = {
    totalValidations: 0,
    successfulValidations: 0,
    totalValidationTime: 0,
    validationHistory: [] as GateValidationData[]
  };

  // Raw data storage for queries
  private executionHistory: ExecutionData[] = [];
  private frameworkSwitchHistory: FrameworkSwitchData[] = [];
  private performanceTrends: PerformanceTrend[] = [];

  // Performance monitoring
  private memoryCheckInterval?: NodeJS.Timeout;
  private readonly MAX_HISTORY_SIZE = 1000;

  constructor(logger: Logger) {
    super();
    this.logger = logger;
    this.startTime = Date.now();

    // Initialize analytics data
    this.executionStats = {
      totalExecutions: 0,
      successfulExecutions: 0,
      failedExecutions: 0,
      averageExecutionTime: 0,
      executionsByMode: {
        prompt: 0,
        template: 0,
        chain: 0
      },
      executionsByTool: {
        prompt_engine: 0,
        prompt_manager: 0,
        system_control: 0
      },
      lastUpdated: Date.now()
    };

    this.systemMetrics = {
      uptime: 0,
      memoryUsage: {
        heapUsed: 0,
        heapTotal: 0,
        external: 0,
        rss: 0
      },
      averageResponseTime: 0,
      requestsPerMinute: 0,
      errorRate: 0,
      performanceTrends: []
    };

    this.frameworkUsage = {
      currentFramework: 'CAGEERF', // Default framework
      frameworkSwitches: 0,
      frameworkUsageTime: {},
      frameworkSwitchHistory: [],
      frameworkPerformance: {}
    };

    this.setupEventListeners();
    this.startPerformanceMonitoring();

    this.logger.info('AnalyticsService initialized with event-driven collection');
  }

  /**
   * Set up event listeners for analytics collection
   */
  private setupEventListeners(): void {
    this.on('execution:complete', this.handleExecutionComplete.bind(this));
    this.on('execution:error', this.handleExecutionError.bind(this));
    this.on('gate:validation', this.handleGateValidation.bind(this));
    this.on('framework:switch', this.handleFrameworkSwitch.bind(this));
    this.on('system:performance', this.handlePerformanceTrend.bind(this));
  }

  /**
   * Start performance monitoring
   */
  private startPerformanceMonitoring(): void {
    // Monitor memory usage every 30 seconds
    this.memoryCheckInterval = setInterval(() => {
      this.recordMemoryUsage();
    }, 30000);
  }

  /**
   * Record execution completion
   */
  recordExecution(executionData: ExecutionData): void {
    this.emit('execution:complete', executionData);
  }

  /**
   * Record execution error
   */
  recordExecutionError(executionData: ExecutionData): void {
    this.emit('execution:error', executionData);
  }

  /**
   * Record gate validation
   */
  recordGateValidation(gateData: GateValidationData): void {
    this.emit('gate:validation', gateData);
  }

  /**
   * Record framework switch
   */
  recordFrameworkSwitch(switchData: FrameworkSwitchData): void {
    this.emit('framework:switch', switchData);
  }

  /**
   * Handle execution completion event
   */
  private handleExecutionComplete(executionData: ExecutionData): void {
    // Update execution statistics
    this.executionStats.totalExecutions++;

    if (executionData.success) {
      this.executionStats.successfulExecutions++;
    } else {
      this.executionStats.failedExecutions++;
    }

    // Update average execution time
    const totalTime = this.executionStats.averageExecutionTime * (this.executionStats.totalExecutions - 1);
    this.executionStats.averageExecutionTime =
      (totalTime + executionData.executionTime) / this.executionStats.totalExecutions;

    // Update execution by mode
    if (this.executionStats.executionsByMode[executionData.executionType] !== undefined) {
      this.executionStats.executionsByMode[executionData.executionType]++;
    }

    // Update execution by tool
    if (this.executionStats.executionsByTool[executionData.toolName as keyof typeof this.executionStats.executionsByTool] !== undefined) {
      this.executionStats.executionsByTool[executionData.toolName as keyof typeof this.executionStats.executionsByTool]++;
    }

    // Update framework performance
    if (executionData.frameworkUsed) {
      if (!this.frameworkUsage.frameworkPerformance[executionData.frameworkUsed]) {
        this.frameworkUsage.frameworkPerformance[executionData.frameworkUsed] = {
          averageExecutionTime: 0,
          successRate: 0,
          usageCount: 0
        };
      }

      const perf = this.frameworkUsage.frameworkPerformance[executionData.frameworkUsed];
      const totalTime = perf.averageExecutionTime * perf.usageCount;
      perf.usageCount++;
      perf.averageExecutionTime = (totalTime + executionData.executionTime) / perf.usageCount;

      // Update success rate
      const prevSuccesses = perf.successRate * (perf.usageCount - 1);
      const newSuccesses = prevSuccesses + (executionData.success ? 1 : 0);
      perf.successRate = newSuccesses / perf.usageCount;
    }

    // Store execution history
    this.executionHistory.push(executionData);
    this.trimHistory(this.executionHistory);

    // Record performance trend
    this.recordPerformanceTrend('execution_time', executionData.executionTime, executionData.toolName);

    this.executionStats.lastUpdated = Date.now();

    this.logger.debug(`Analytics updated: Total executions: ${this.executionStats.totalExecutions}, Success rate: ${this.getSuccessRate()}%`);
  }

  /**
   * Handle execution error event
   */
  private handleExecutionError(executionData: ExecutionData): void {
    // Error handling is included in handleExecutionComplete
    this.handleExecutionComplete(executionData);
  }

  /**
   * Handle gate validation event
   */
  private handleGateValidation(gateData: GateValidationData): void {
    this.gateValidationStats.totalValidations++;

    if (gateData.passedGates === gateData.totalGates) {
      this.gateValidationStats.successfulValidations++;
    }

    this.gateValidationStats.totalValidationTime += gateData.validationTime;
    this.gateValidationStats.validationHistory.push(gateData);
    this.trimHistory(this.gateValidationStats.validationHistory);

    this.logger.debug(`Gate validation recorded: ${gateData.passedGates}/${gateData.totalGates} passed`);
  }

  /**
   * Handle framework switch event
   */
  private handleFrameworkSwitch(switchData: FrameworkSwitchData): void {
    this.frameworkUsage.frameworkSwitches++;
    this.frameworkUsage.currentFramework = switchData.toFramework;

    this.frameworkUsage.frameworkSwitchHistory.push({
      timestamp: switchData.switchTime,
      fromFramework: switchData.fromFramework,
      toFramework: switchData.toFramework,
      reason: switchData.reason
    });

    this.frameworkSwitchHistory.push(switchData);
    this.trimHistory(this.frameworkSwitchHistory);

    this.logger.debug(`Framework switch recorded: ${switchData.fromFramework} → ${switchData.toFramework}`);
  }

  /**
   * Handle performance trend event
   */
  private handlePerformanceTrend(trend: PerformanceTrend): void {
    this.performanceTrends.push(trend);
    this.systemMetrics.performanceTrends.push(trend);
    this.trimHistory(this.performanceTrends);
    this.trimHistory(this.systemMetrics.performanceTrends);
  }

  /**
   * Record memory usage
   */
  private recordMemoryUsage(): void {
    const usage = process.memoryUsage();
    this.systemMetrics.memoryUsage = {
      heapUsed: usage.heapUsed,
      heapTotal: usage.heapTotal,
      external: usage.external,
      rss: usage.rss
    };

    this.recordPerformanceTrend('memory_usage', usage.heapUsed, 'system');
  }

  /**
   * Record performance trend
   */
  private recordPerformanceTrend(
    metric: PerformanceTrend['metric'],
    value: number,
    context?: string
  ): void {
    const trend: PerformanceTrend = {
      timestamp: Date.now(),
      metric,
      value,
      context
    };

    this.emit('system:performance', trend);
  }

  /**
   * Trim history arrays to max size
   */
  private trimHistory<T>(array: T[]): void {
    if (array.length > this.MAX_HISTORY_SIZE) {
      array.splice(0, array.length - this.MAX_HISTORY_SIZE);
    }
  }

  /**
   * Get execution statistics
   */
  getExecutionStats(): ExecutionStats {
    return { ...this.executionStats };
  }

  /**
   * Get system metrics
   */
  getSystemMetrics(): SystemMetrics {
    this.systemMetrics.uptime = Date.now() - this.startTime;
    this.systemMetrics.errorRate = this.getErrorRate();
    this.systemMetrics.averageResponseTime = this.executionStats.averageExecutionTime;

    return { ...this.systemMetrics };
  }

  /**
   * Get framework usage
   */
  getFrameworkUsage(): FrameworkUsage {
    return { ...this.frameworkUsage };
  }

  /**
   * Get comprehensive analytics summary
   */
  getAnalyticsSummary(options?: AnalyticsQueryOptions): AnalyticsSummary {
    const gateStats = {
      totalValidations: this.gateValidationStats.totalValidations,
      validationSuccessRate: this.getGateValidationSuccessRate(),
      averageValidationTime: this.getAverageGateValidationTime(),
      gateAdoptionRate: this.getGateAdoptionRate()
    };

    const recommendations = this.generateRecommendations();

    return {
      executionStats: this.getExecutionStats(),
      systemMetrics: this.getSystemMetrics(),
      frameworkUsage: this.getFrameworkUsage(),
      gateValidationStats: gateStats,
      recommendations
    };
  }

  /**
   * Reset analytics data
   */
  resetAnalytics(): void {
    this.executionStats = {
      totalExecutions: 0,
      successfulExecutions: 0,
      failedExecutions: 0,
      averageExecutionTime: 0,
      executionsByMode: {
        prompt: 0,
        template: 0,
        chain: 0
      },
      executionsByTool: {
        prompt_engine: 0,
        prompt_manager: 0,
        system_control: 0
      },
      lastUpdated: Date.now()
    };

    this.gateValidationStats = {
      totalValidations: 0,
      successfulValidations: 0,
      totalValidationTime: 0,
      validationHistory: []
    };

    this.frameworkUsage.frameworkSwitches = 0;
    this.frameworkUsage.frameworkSwitchHistory = [];
    this.frameworkUsage.frameworkPerformance = {};

    this.executionHistory = [];
    this.frameworkSwitchHistory = [];
    this.performanceTrends = [];
    this.systemMetrics.performanceTrends = [];

    this.logger.info('Analytics data reset');
  }

  /**
   * Calculate success rate
   */
  private getSuccessRate(): number {
    if (this.executionStats.totalExecutions === 0) return 100;
    return Math.round((this.executionStats.successfulExecutions / this.executionStats.totalExecutions) * 100);
  }

  /**
   * Calculate error rate
   */
  private getErrorRate(): number {
    if (this.executionStats.totalExecutions === 0) return 0;
    return this.executionStats.failedExecutions / this.executionStats.totalExecutions;
  }

  /**
   * Calculate gate validation success rate
   */
  private getGateValidationSuccessRate(): number {
    if (this.gateValidationStats.totalValidations === 0) return 100;
    return (this.gateValidationStats.successfulValidations / this.gateValidationStats.totalValidations) * 100;
  }

  /**
   * Calculate average gate validation time
   */
  private getAverageGateValidationTime(): number {
    if (this.gateValidationStats.totalValidations === 0) return 0;
    return this.gateValidationStats.totalValidationTime / this.gateValidationStats.totalValidations;
  }

  /**
   * Calculate gate adoption rate
   */
  private getGateAdoptionRate(): number {
    if (this.executionStats.totalExecutions === 0) return 0;
    return (this.gateValidationStats.totalValidations / this.executionStats.totalExecutions) * 100;
  }

  /**
   * Generate recommendations based on analytics
   */
  private generateRecommendations(): string[] {
    const recommendations: string[] = [];

    // Performance recommendations
    if (this.executionStats.averageExecutionTime > 5000) {
      recommendations.push('Average execution time is high (>5s). Consider optimizing prompt complexity or system resources.');
    }

    // Memory recommendations
    const memoryUtilization = this.systemMetrics.memoryUsage.heapUsed / this.systemMetrics.memoryUsage.heapTotal;
    if (memoryUtilization > 0.8) {
      recommendations.push('High memory utilization detected (>80%). Monitor for memory leaks.');
    }

    // Gate adoption recommendations
    const gateAdoption = this.getGateAdoptionRate();
    if (gateAdoption < 50) {
      recommendations.push('Low gate validation adoption (<50%). Consider enabling gates for better quality assurance.');
    }

    // Error rate recommendations
    if (this.getErrorRate() > 0.1) {
      recommendations.push('High error rate detected (>10%). Review failed executions for patterns.');
    }

    // Framework recommendations
    const frameworks = Object.keys(this.frameworkUsage.frameworkPerformance);
    if (frameworks.length > 1) {
      const bestFramework = frameworks.reduce((best, current) => {
        const bestPerf = this.frameworkUsage.frameworkPerformance[best];
        const currentPerf = this.frameworkUsage.frameworkPerformance[current];
        return currentPerf.successRate > bestPerf.successRate ? current : best;
      });

      if (this.frameworkUsage.currentFramework !== bestFramework) {
        recommendations.push(`Consider switching to ${bestFramework} framework for better performance (${Math.round(this.frameworkUsage.frameworkPerformance[bestFramework].successRate * 100)}% success rate).`);
      }
    }

    return recommendations;
  }

  /**
   * Cleanup on shutdown
   */
  shutdown(): void {
    if (this.memoryCheckInterval) {
      clearInterval(this.memoryCheckInterval);
    }
    this.removeAllListeners();
    this.logger.info('AnalyticsService shutdown complete');
  }
}

/**
 * Create analytics service instance
 */
export function createMetricsCollector(logger: Logger): MetricsCollector {
  return new MetricsCollector(logger);
}