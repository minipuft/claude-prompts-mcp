/**
 * Analytics Service Types
 *
 * Comprehensive type definitions for the analytics service that handles
 * execution monitoring, performance tracking, and system metrics collection
 * across all MCP tools without coupling to execution logic.
 */

/**
 * Core execution data collected from tools
 */
export interface ExecutionData {
  executionId: string;
  executionType: "prompt" | "template" | "chain";
  startTime: number;
  endTime: number;
  executionTime: number;
  success: boolean;
  frameworkUsed?: string;
  frameworkEnabled: boolean;
  stepsExecuted?: number;
  sessionId?: string;
  toolName: string; // prompt_engine, prompt_manager, system_control
  error?: string;
  memoryUsage?: {
    heapUsed: number;
    heapTotal: number;
    external: number;
  };
}

/**
 * Gate validation data for analytics tracking
 */
export interface GateValidationData {
  executionId: string;
  gateValidationEnabled: boolean;
  totalGates: number;
  passedGates: number;
  failedGates: number;
  validationTime: number;
  retryCount?: number;
  gateResults: Array<{
    gateId: string;
    gateName: string;
    passed: boolean;
    score?: number;
    evaluationTime?: number;
  }>;
}

/**
 * Framework switching data for methodology analytics
 */
export interface FrameworkSwitchData {
  switchId: string;
  fromFramework: string;
  toFramework: string;
  switchTime: number;
  reason?: string;
  switchSuccess: boolean;
  switchDuration: number;
}

/**
 * Aggregated execution statistics
 */
export interface ExecutionStats {
  totalExecutions: number;
  successfulExecutions: number;
  failedExecutions: number;
  averageExecutionTime: number;
  executionsByMode: {
    prompt: number;
    template: number;
    chain: number;
  };
  executionsByTool: {
    prompt_engine: number;
    prompt_manager: number;
    system_control: number;
  };
  lastUpdated: number;
}

/**
 * System performance metrics
 */
export interface SystemMetrics {
  uptime: number;
  memoryUsage: {
    heapUsed: number;
    heapTotal: number;
    external: number;
    rss: number;
  };
  averageResponseTime: number;
  requestsPerMinute: number;
  errorRate: number;
  performanceTrends: PerformanceTrend[];
}

/**
 * Performance trend data point
 */
export interface PerformanceTrend {
  timestamp: number;
  metric: "execution_time" | "memory_usage" | "success_rate" | "response_time";
  value: number;
  context?: string;
}

/**
 * Framework usage analytics
 */
export interface FrameworkUsage {
  currentFramework: string;
  frameworkSwitches: number;
  frameworkUsageTime: Record<string, number>; // framework -> total time used
  frameworkSwitchHistory: Array<{
    timestamp: number;
    fromFramework: string;
    toFramework: string;
    reason?: string;
  }>;
  frameworkPerformance: Record<string, {
    averageExecutionTime: number;
    successRate: number;
    usageCount: number;
  }>;
}

/**
 * Analytics event types for event-driven architecture
 */
export type AnalyticsEvent =
  | { type: 'execution:start'; data: Partial<ExecutionData> }
  | { type: 'execution:complete'; data: ExecutionData }
  | { type: 'execution:error'; data: ExecutionData }
  | { type: 'gate:validation'; data: GateValidationData }
  | { type: 'framework:switch'; data: FrameworkSwitchData }
  | { type: 'system:memory'; data: { timestamp: number; usage: SystemMetrics['memoryUsage'] } }
  | { type: 'system:performance'; data: PerformanceTrend };

/**
 * Analytics query options for data retrieval
 */
export interface AnalyticsQueryOptions {
  timeRange?: {
    start: number;
    end: number;
  };
  toolFilter?: string[];
  frameworkFilter?: string[];
  includePerformanceTrends?: boolean;
  includeTrendHistory?: boolean;
  maxResults?: number;
}

/**
 * Comprehensive analytics summary
 */
export interface AnalyticsSummary {
  executionStats: ExecutionStats;
  systemMetrics: SystemMetrics;
  frameworkUsage: FrameworkUsage;
  gateValidationStats: {
    totalValidations: number;
    validationSuccessRate: number;
    averageValidationTime: number;
    gateAdoptionRate: number;
  };
  recommendations: string[];
}