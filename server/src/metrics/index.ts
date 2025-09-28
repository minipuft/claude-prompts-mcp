/**
 * Metrics Module Exports
 *
 * Centralized exports for the metrics collector and related types.
 * Provides event-driven metrics collection separated from execution logic.
 */

// Metrics collector
export {
  MetricsCollector,
  createMetricsCollector
} from './analytics-service.js';

// Types
export type {
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