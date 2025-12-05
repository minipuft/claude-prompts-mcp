// @lifecycle canonical - Analyzes gate performance metrics for diagnostics.
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
export class GatePerformanceAnalyzer {
  private gateMetrics = new Map<string, GatePerformanceMetrics>();
  private sessionStartTime: Date;
  private totalExecutions = 0;
  private logger: Logger;

  constructor(logger: Logger) {
    this.logger = logger;
    this.sessionStartTime = new Date();
    this.logger.debug('[GATE PERFORMANCE ANALYZER] Initialized');
  }

  /**
   * Record gate execution performance
   *
   * @param gateId - Gate identifier
   * @param executionTime - Time taken for gate execution (ms)
   * @param success - Whether the gate execution was successful
   */
  recordGateExecution(gateId: string, executionTime: number, success: boolean): void {
    this.logger.debug('[GATE PERFORMANCE ANALYZER] Recording execution:', {
      gateId,
      executionTime,
      success,
    });

    let metrics = this.gateMetrics.get(gateId);

    if (!metrics) {
      metrics = {
        gateId,
        avgExecutionTime: executionTime,
        successRate: success ? 1.0 : 0.0,
        retryRate: success ? 0.0 : 1.0,
        lastUsed: new Date(),
        usageCount: 1,
      };
    } else {
      // Update metrics with rolling average
      const totalTime = metrics.avgExecutionTime * metrics.usageCount + executionTime;
      metrics.usageCount++;
      metrics.avgExecutionTime = totalTime / metrics.usageCount;

      // Update success rate
      const totalSuccesses = metrics.successRate * (metrics.usageCount - 1) + (success ? 1 : 0);
      metrics.successRate = totalSuccesses / metrics.usageCount;

      // Update retry rate
      const totalRetries = metrics.retryRate * (metrics.usageCount - 1) + (success ? 0 : 1);
      metrics.retryRate = totalRetries / metrics.usageCount;

      metrics.lastUsed = new Date();
    }

    this.gateMetrics.set(gateId, metrics);
    this.totalExecutions++;
  }

  /**
   * Get performance analytics for all gates
   *
   * @returns Complete gate system analytics
   */
  getPerformanceAnalytics(): GateSystemAnalytics {
    const allMetrics = Array.from(this.gateMetrics.values());

    if (allMetrics.length === 0) {
      return {
        totalGates: 0,
        avgExecutionTime: 0,
        overallSuccessRate: 0,
        topPerformingGates: [],
        underperformingGates: [],
        recommendations: ['No gate performance data available yet'],
      };
    }

    // Calculate overall metrics
    const totalGates = allMetrics.length;
    const avgExecutionTime =
      allMetrics.reduce((sum, m) => sum + m.avgExecutionTime, 0) / totalGates;
    const overallSuccessRate = allMetrics.reduce((sum, m) => sum + m.successRate, 0) / totalGates;

    // Sort gates by performance
    const sortedByPerformance = [...allMetrics].sort((a, b) => {
      const scoreA = this.calculatePerformanceScore(a);
      const scoreB = this.calculatePerformanceScore(b);
      return scoreB - scoreA;
    });

    const topPerformingGates = sortedByPerformance.slice(0, 3).map((m) => m.gateId);

    const underperformingGates = sortedByPerformance
      .slice(-3)
      .filter((m) => this.calculatePerformanceScore(m) < 0.7)
      .map((m) => m.gateId);

    const recommendations = this.generateOptimizationRecommendations(allMetrics);

    return {
      totalGates,
      avgExecutionTime: Math.round(avgExecutionTime),
      overallSuccessRate: Math.round(overallSuccessRate * 100) / 100,
      topPerformingGates,
      underperformingGates,
      recommendations,
    };
  }

  /**
   * Get metrics for a specific gate
   *
   * @param gateId - Gate identifier
   * @returns Gate performance metrics or null if not found
   */
  getGateMetrics(gateId: string): GatePerformanceMetrics | null {
    const metrics = this.gateMetrics.get(gateId);
    return metrics ? { ...metrics } : null;
  }

  /**
   * Get performance trends for analysis
   *
   * @returns Array of performance trends
   */
  getPerformanceTrends(): PerformanceTrend[] {
    const trends: PerformanceTrend[] = [];

    for (const metrics of this.gateMetrics.values()) {
      const trend = this.calculateTrend(metrics);
      trends.push(trend);
    }

    return trends.sort((a, b) => Math.abs(b.changePercent) - Math.abs(a.changePercent));
  }

  /**
   * Calculate performance score for a gate (0-1, higher is better)
   */
  private calculatePerformanceScore(metrics: GatePerformanceMetrics): number {
    const successWeight = 0.6;
    const speedWeight = 0.3;
    const usageWeight = 0.1;

    // Normalize execution time (assuming 500ms is baseline)
    const speedScore = Math.max(0, Math.min(1, (500 - metrics.avgExecutionTime) / 500 + 0.5));

    // Normalize usage count (logarithmic scale)
    const usageScore = Math.min(1, Math.log10(metrics.usageCount + 1) / 2);

    return (
      metrics.successRate * successWeight + speedScore * speedWeight + usageScore * usageWeight
    );
  }

  /**
   * Calculate performance trend for a gate
   */
  private calculateTrend(metrics: GatePerformanceMetrics): PerformanceTrend {
    // Simple trend analysis based on recent performance
    // In a real implementation, this would track historical data

    let trend: 'improving' | 'declining' | 'stable' = 'stable';
    let changePercent = 0;
    let recommendation = 'Performance is stable';

    const performanceScore = this.calculatePerformanceScore(metrics);

    if (performanceScore > 0.8) {
      trend = 'improving';
      changePercent = 5; // Mock improvement
      recommendation = 'Excellent performance, consider as a model for other gates';
    } else if (performanceScore < 0.5) {
      trend = 'declining';
      changePercent = -10; // Mock decline
      recommendation = 'Performance needs attention, consider optimization';
    } else {
      trend = 'stable';
      changePercent = 0;
      recommendation = 'Performance is acceptable, monitor for changes';
    }

    return {
      gateId: metrics.gateId,
      trend,
      changePercent,
      recommendation,
    };
  }

  /**
   * Generate optimization recommendations based on metrics
   */
  private generateOptimizationRecommendations(allMetrics: GatePerformanceMetrics[]): string[] {
    const recommendations: string[] = [];

    // Check for slow gates
    const slowGates = allMetrics.filter((m) => m.avgExecutionTime > 300);
    if (slowGates.length > 0) {
      recommendations.push(
        `Optimize slow gates: ${slowGates.map((g) => g.gateId).join(', ')} (>${300}ms avg)`
      );
    }

    // Check for low success rates
    const unreliableGates = allMetrics.filter((m) => m.successRate < 0.8);
    if (unreliableGates.length > 0) {
      recommendations.push(
        `Improve reliability of: ${unreliableGates.map((g) => g.gateId).join(', ')} (<80% success)`
      );
    }

    // Check for unused gates
    const underusedGates = allMetrics.filter((m) => m.usageCount < 5);
    if (underusedGates.length > 0) {
      recommendations.push(
        `Review gate relevance: ${underusedGates.map((g) => g.gateId).join(', ')} (low usage)`
      );
    }

    // Overall system recommendations
    const avgSuccessRate =
      allMetrics.reduce((sum, m) => sum + m.successRate, 0) / allMetrics.length;
    if (avgSuccessRate < 0.85) {
      recommendations.push(
        'Overall system success rate is below optimal (85%), review gate criteria'
      );
    }

    if (recommendations.length === 0) {
      recommendations.push('Gate system performance is optimal, no immediate optimizations needed');
    }

    return recommendations;
  }

  /**
   * Reset all performance metrics
   */
  resetMetrics(): void {
    this.gateMetrics.clear();
    this.sessionStartTime = new Date();
    this.totalExecutions = 0;
    this.logger.info('[GATE PERFORMANCE ANALYZER] Performance metrics reset');
  }

  /**
   * Get session statistics
   */
  getSessionStatistics() {
    const sessionDuration = Date.now() - this.sessionStartTime.getTime();
    const avgExecutionsPerMinute = this.totalExecutions / (sessionDuration / 60000);

    return {
      sessionDuration: Math.round(sessionDuration / 1000), // seconds
      totalExecutions: this.totalExecutions,
      avgExecutionsPerMinute: Math.round(avgExecutionsPerMinute * 10) / 10,
      uniqueGatesUsed: this.gateMetrics.size,
      sessionStartTime: this.sessionStartTime.toISOString(),
    };
  }

  /**
   * Export metrics for external analysis
   */
  exportMetrics(): { metrics: GatePerformanceMetrics[]; session: any } {
    return {
      metrics: Array.from(this.gateMetrics.values()),
      session: this.getSessionStatistics(),
    };
  }
}

/**
 * Factory function for creating gate performance analyzer
 */
export function createGatePerformanceAnalyzer(logger: Logger): GatePerformanceAnalyzer {
  return new GatePerformanceAnalyzer(logger);
}
