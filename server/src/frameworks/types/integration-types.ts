/**
 * Integration Layer Type Definitions
 *
 * Contains all types related to cross-system integration, framework-semantic
 * coordination, and MCP tool integration. These types support the integration
 * layer that coordinates between different systems.
 */

import type { ConvertedPrompt } from '../../execution/types.js';
import type { ContentAnalysisResult } from '../../semantic/configurable-semantic-analyzer.js';
import type { FrameworkDefinition, FrameworkExecutionContext } from './methodology-types.js';

/**
 * Integrated analysis result combining semantic intelligence and framework methodology
 */
export interface IntegratedAnalysisResult {
  // Semantic analysis results - PROMPT INTELLIGENCE
  semanticAnalysis: ContentAnalysisResult;

  // Framework execution context - METHODOLOGY GUIDANCE
  frameworkContext: FrameworkExecutionContext | null;

  // Integration metadata
  integration: {
    frameworkSelectionReason: string;
    semanticFrameworkAlignment: number; // How well semantic criteria match selected framework
    alternativeFrameworks: FrameworkDefinition[];
    consensusMetrics: {
      confidenceAlignment: number;
      complexityMatch: number;
      executionTypeCompatibility: number;
    };
  };

  // Combined execution recommendations
  recommendations: {
    executionApproach: string;
    expectedPerformance: {
      processingTime: number;
      memoryUsage: string;
      cacheable: boolean;
    };
    qualityAssurance: string[];
    optimizations: string[];
  };

  // Phase 4: Prompt guidance coordination results
  promptGuidance?: {
    guidanceApplied: boolean;
    enhancedPrompt?: any;
    systemPromptInjection?: any;
    templateEnhancement?: any;
    processingTimeMs: number;
    confidenceScore: number;
  };
}

/**
 * Framework switching configuration
 */
export interface FrameworkSwitchingConfig {
  enableAutomaticSwitching: boolean;
  switchingThreshold: number; // Confidence threshold for switching
  preventThrashing: boolean; // Prevent rapid framework switches
  switchingCooldownMs: number;
  blacklistedFrameworks: string[];
  preferredFrameworks: string[];
}

/**
 * Framework alignment result
 */
export interface FrameworkAlignmentResult {
  overallAlignment: number;
  detailedMetrics: {
    confidenceAlignment: number;
    complexityMatch: number;
    executionTypeCompatibility: number;
  };
}

/**
 * Framework usage insights
 */
export interface FrameworkUsageInsights {
  totalAnalyses: number;
  frameworkUsage: Record<string, FrameworkUsageMetrics & { framework: FrameworkDefinition }>;
  recommendations: string[];
}

/**
 * Framework usage metrics
 */
export interface FrameworkUsageMetrics {
  usageCount: number;
  averageProcessingTime: number;
  averageAlignmentScore: number;
  lastUsed: Date;
}

/**
 * Framework switch recommendation
 */
export interface FrameworkSwitchRecommendation {
  currentFramework: FrameworkDefinition;
  recommendedFramework: FrameworkDefinition;
  reason: string;
  expectedImprovement: number;
}

/**
 * MCP tool integration context
 */
export interface MCPToolIntegrationContext {
  /** Active MCP tool making the request */
  activeTool: 'prompt_engine' | 'prompt_manager' | 'system_control';
  /** Request parameters from MCP tool */
  requestParameters: Record<string, any>;
  /** User preferences from MCP tool context */
  userPreferences: {
    preferredFramework?: string;
    enableFrameworkGuidance?: boolean;
    customConfiguration?: Record<string, any>;
  };
  /** Integration metadata */
  metadata: {
    requestId: string;
    timestamp: Date;
    clientType: 'stdio' | 'sse' | 'unknown';
  };
}

/**
 * MCP tool integration result
 */
export interface MCPToolIntegrationResult {
  /** Whether integration was successful */
  success: boolean;
  /** Integration result data */
  result: any;
  /** Framework context used in integration */
  frameworkContext: FrameworkExecutionContext | null;
  /** Integration metrics */
  metrics: {
    processingTime: number;
    frameworkSwitchOccurred: boolean;
    enhancementsApplied: number;
  };
  /** Any errors that occurred */
  errors: string[];
  /** Integration warnings */
  warnings: string[];
}

/**
 * Semantic integration configuration
 */
export interface SemanticIntegrationConfig {
  /** Whether to enable framework-semantic integration */
  enabled: boolean;
  /** Confidence threshold for framework recommendations */
  confidenceThreshold: number;
  /** Whether to use semantic analysis for framework selection */
  useSemanticFrameworkSelection: boolean;
  /** Integration mode */
  mode: 'passive' | 'active' | 'intelligent';
}

/**
 * Cross-system integration status
 */
export interface CrossSystemIntegrationStatus {
  /** Status of framework system integration */
  frameworkSystem: {
    status: 'healthy' | 'degraded' | 'error';
    lastCheck: Date;
    issues: string[];
  };
  /** Status of semantic analysis integration */
  semanticAnalysis: {
    status: 'healthy' | 'degraded' | 'error';
    lastCheck: Date;
    capabilities: string[];
    limitations: string[];
  };
  /** Status of MCP tools integration */
  mcpTools: {
    status: 'healthy' | 'degraded' | 'error';
    lastCheck: Date;
    activeTool: string | null;
    toolErrors: Record<string, string[]>;
  };
  /** Status of execution system integration */
  executionSystem: {
    status: 'healthy' | 'degraded' | 'error';
    lastCheck: Date;
    executionStrategies: string[];
  };
}

/**
 * Integration performance metrics
 */
export interface IntegrationPerformanceMetrics {
  /** Total number of integrations performed */
  totalIntegrations: number;
  /** Success rate of integrations */
  successRate: number;
  /** Average integration processing time */
  averageProcessingTime: number;
  /** Framework switching statistics */
  frameworkSwitching: {
    totalSwitches: number;
    successfulSwitches: number;
    averageSwitchTime: number;
  };
  /** Semantic analysis performance */
  semanticAnalysis: {
    totalAnalyses: number;
    averageAnalysisTime: number;
    cacheHitRate: number;
  };
  /** MCP tool integration performance */
  mcpToolIntegration: {
    toolUsage: Record<string, number>;
    averageToolResponseTime: number;
    errorRate: number;
  };
}

/**
 * Integration event for monitoring and logging
 */
export interface IntegrationEvent {
  /** Event type */
  type: 'framework_switch' | 'semantic_analysis' | 'mcp_tool_call' | 'integration_error';
  /** Event timestamp */
  timestamp: Date;
  /** Event source */
  source: string;
  /** Event data */
  data: Record<string, any>;
  /** Event severity */
  severity: 'info' | 'warn' | 'error';
  /** Correlation ID for tracking related events */
  correlationId?: string;
}

/**
 * Framework-semantic integration service interface
 */
export interface IFrameworkSemanticIntegration {
  /**
   * Analyze prompt with framework integration
   */
  analyzeWithFrameworkIntegration(
    prompt: ConvertedPrompt,
    userFrameworkPreference?: string
  ): Promise<IntegratedAnalysisResult>;

  /**
   * Get framework usage insights
   */
  getFrameworkUsageInsights(): FrameworkUsageInsights;

  /**
   * Evaluate framework switch recommendation
   */
  evaluateFrameworkSwitch(
    prompt: ConvertedPrompt,
    currentResult: IntegratedAnalysisResult
  ): Promise<FrameworkSwitchRecommendation | null>;

  /**
   * Get integration performance metrics
   */
  getPerformanceMetrics(): IntegrationPerformanceMetrics;

  /**
   * Get cross-system integration status
   */
  getIntegrationStatus(): CrossSystemIntegrationStatus;
}

/**
 * MCP tool integration service interface
 */
export interface IMCPToolIntegration {
  /**
   * Handle MCP tool request with framework integration
   */
  handleToolRequest(
    context: MCPToolIntegrationContext
  ): Promise<MCPToolIntegrationResult>;

  /**
   * Register MCP tool for integration
   */
  registerTool(
    toolName: string,
    integrationHandler: (context: MCPToolIntegrationContext) => Promise<any>
  ): void;

  /**
   * Get MCP tool integration metrics
   */
  getToolMetrics(): Record<string, {
    callCount: number;
    averageResponseTime: number;
    errorRate: number;
    lastUsed: Date;
  }>;
}

/**
 * Integration configuration for the entire system
 */
export interface SystemIntegrationConfig {
  /** Framework-semantic integration configuration */
  semanticIntegration: SemanticIntegrationConfig;
  /** Framework switching configuration */
  frameworkSwitching: FrameworkSwitchingConfig;
  /** MCP tool integration settings */
  mcpToolIntegration: {
    enabled: boolean;
    timeoutMs: number;
    retryAttempts: number;
    enableMetrics: boolean;
  };
  /** Performance monitoring settings */
  performanceMonitoring: {
    enabled: boolean;
    metricsRetentionDays: number;
    alertThresholds: {
      errorRate: number;
      responseTime: number;
      memoryUsage: number;
    };
  };
}