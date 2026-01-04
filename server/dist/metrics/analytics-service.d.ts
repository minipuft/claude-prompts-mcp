/**
 * Metrics Collector - Centralized Performance and Usage Metrics Collection
 *
 * Provides comprehensive metrics collection and reporting for all MCP tools
 * without coupling to execution logic. Uses event-driven architecture to
 * observe tool operations and provide detailed insights.
 */
import { EventEmitter } from 'events';
import { ExecutionData, GateValidationData, GateUsageMetric, FrameworkSwitchData, ExecutionStats, SystemMetrics, FrameworkUsage, AnalyticsQueryOptions, AnalyticsSummary, PipelineStageMetric, CommandExecutionMetric } from './types.js';
import { Logger } from '../logging/index.js';
/**
 * Centralized Metrics Collector
 */
export declare class MetricsCollector extends EventEmitter {
    private logger;
    private startTime;
    private executionStats;
    private systemMetrics;
    private frameworkUsage;
    private gateValidationStats;
    private gateUsageHistory;
    private executionHistory;
    private frameworkSwitchHistory;
    private performanceTrends;
    private pipelineStageHistory;
    private commandExecutionHistory;
    private memoryCheckInterval?;
    private readonly MAX_HISTORY_SIZE;
    constructor(logger: Logger);
    /**
     * Set up event listeners for analytics collection
     */
    private setupEventListeners;
    /**
     * Start performance monitoring
     */
    private startPerformanceMonitoring;
    /**
     * Record execution completion
     */
    recordExecution(executionData: ExecutionData): void;
    /**
     * Record execution error
     */
    recordExecutionError(executionData: ExecutionData): void;
    /**
     * Track execution (adapter for ResponseFormatter AnalyticsService interface)
     */
    trackExecution(data: {
        executionId: string;
        executionType: string;
        duration: number;
        frameworkUsed?: string;
        stepsExecuted?: number;
        success: boolean;
        sessionId?: string;
    }): void;
    /**
     * Track error (adapter for ResponseFormatter AnalyticsService interface)
     */
    trackError(data: {
        executionId: string;
        executionType: string;
        errorType: string;
        errorMessage: string;
        sessionId?: string;
    }): void;
    /**
     * Record gate validation
     */
    recordGateValidation(gateData: GateValidationData): void;
    /**
     * Record gate usage metrics emitted from enhancement stage.
     */
    recordGateUsage(metric: GateUsageMetric): void;
    /**
     * Record framework switch
     */
    recordFrameworkSwitch(switchData: FrameworkSwitchData): void;
    /**
     * Record an individual pipeline stage execution.
     */
    recordPipelineStage(metric: PipelineStageMetric): void;
    /**
     * Record command-level execution metrics emitted by the pipeline orchestrator.
     */
    recordCommandExecutionMetric(metric: CommandExecutionMetric): void;
    /**
     * Handle execution completion event
     */
    private handleExecutionComplete;
    /**
     * Handle execution error event
     */
    private handleExecutionError;
    /**
     * Handle gate validation event
     */
    private handleGateValidation;
    /**
     * Handle framework switch event
     */
    private handleFrameworkSwitch;
    /**
     * Handle performance trend event
     */
    private handlePerformanceTrend;
    /**
     * Record memory usage
     */
    private recordMemoryUsage;
    private createExecutionDataFromCommand;
    private mapExecutionModeToExecutionType;
    /**
     * Record performance trend
     */
    private recordPerformanceTrend;
    /**
     * Trim history arrays to max size
     */
    private trimHistory;
    /**
     * Get execution statistics
     */
    getExecutionStats(): ExecutionStats;
    /**
     * Get system metrics
     */
    getSystemMetrics(): SystemMetrics;
    /**
     * Get framework usage
     */
    getFrameworkUsage(): FrameworkUsage;
    /**
     * Get comprehensive analytics summary
     */
    getAnalyticsSummary(options?: AnalyticsQueryOptions): AnalyticsSummary;
    /**
     * Reset analytics data
     */
    resetAnalytics(): void;
    /**
     * Calculate success rate
     */
    private getSuccessRate;
    /**
     * Calculate error rate
     */
    private getErrorRate;
    /**
     * Calculate gate validation success rate
     */
    private getGateValidationSuccessRate;
    /**
     * Calculate average gate validation time
     */
    private getAverageGateValidationTime;
    /**
     * Calculate gate adoption rate
     */
    private getGateAdoptionRate;
    /**
     * Generate recommendations based on analytics
     */
    private generateRecommendations;
    /**
     * Cleanup on shutdown
     */
    shutdown(): void;
}
/**
 * Create analytics service instance
 */
export declare function createMetricsCollector(logger: Logger): MetricsCollector;
