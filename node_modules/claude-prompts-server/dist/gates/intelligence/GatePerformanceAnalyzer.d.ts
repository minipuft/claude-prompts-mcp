/**
 * Gate Performance Analyzer - Performance Metrics & Optimization
 *
 * Single responsibility: Track gate performance metrics and provide optimization recommendations.
 * Clean dependencies: Only logger for performance tracking.
 */
import { GatePerformanceMetrics, GateSystemAnalytics } from '../core/gate-definitions.js';
import type { Logger } from '../../logging/index.js';
/**
 * Performance trend data
 */
interface PerformanceTrend {
    gateId: string;
    trend: 'improving' | 'declining' | 'stable';
    changePercent: number;
    recommendation: string;
}
/**
 * Gate performance analyzer with metrics tracking and optimization recommendations
 */
export declare class GatePerformanceAnalyzer {
    private gateMetrics;
    private sessionStartTime;
    private totalExecutions;
    private logger;
    constructor(logger: Logger);
    /**
     * Record gate execution performance
     *
     * @param gateId - Gate identifier
     * @param executionTime - Time taken for gate execution (ms)
     * @param success - Whether the gate execution was successful
     */
    recordGateExecution(gateId: string, executionTime: number, success: boolean): void;
    /**
     * Get performance analytics for all gates
     *
     * @returns Complete gate system analytics
     */
    getPerformanceAnalytics(): GateSystemAnalytics;
    /**
     * Get metrics for a specific gate
     *
     * @param gateId - Gate identifier
     * @returns Gate performance metrics or null if not found
     */
    getGateMetrics(gateId: string): GatePerformanceMetrics | null;
    /**
     * Get performance trends for analysis
     *
     * @returns Array of performance trends
     */
    getPerformanceTrends(): PerformanceTrend[];
    /**
     * Calculate performance score for a gate (0-1, higher is better)
     */
    private calculatePerformanceScore;
    /**
     * Calculate performance trend for a gate
     */
    private calculateTrend;
    /**
     * Generate optimization recommendations based on metrics
     */
    private generateOptimizationRecommendations;
    /**
     * Reset all performance metrics
     */
    resetMetrics(): void;
    /**
     * Get session statistics
     */
    getSessionStatistics(): {
        sessionDuration: number;
        totalExecutions: number;
        avgExecutionsPerMinute: number;
        uniqueGatesUsed: number;
        sessionStartTime: string;
    };
    /**
     * Export metrics for external analysis
     */
    exportMetrics(): {
        metrics: GatePerformanceMetrics[];
        session: any;
    };
}
/**
 * Factory function for creating gate performance analyzer
 */
export declare function createGatePerformanceAnalyzer(logger: Logger): GatePerformanceAnalyzer;
export {};
