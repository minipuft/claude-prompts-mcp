// @lifecycle canonical - Common type definitions for MCP tools.
/**
 * Shared Type Definitions for MCP Tools
 *
 * This file contains proper TypeScript interfaces to replace 'any' types
 * throughout the MCP tools system, improving type safety and development experience.
 *
 * Updated: 2025-09-28 - Consolidated with unified error handling system
 */

// Import consolidated error handling types
import { ErrorContext, ValidationResult } from '../../utils/errorHandling.js';

/**
 * MCP Tool callback extra parameter
 */
export interface ToolExtra {
  requestId?: string;
  clientInfo?: {
    name: string;
    version: string;
  };
  metadata?: Record<string, unknown>;
}

/**
 * Structured response interface for all MCP tools (compatible with ToolResponse)
 */
export interface StructuredToolResponse {
  content: Array<{
    type: 'text';
    text: string;
  }>;
  isError?: boolean;
  metadata?: {
    tool: string;
    action: string;
    timestamp: string;
    executionTime?: number;
    framework?: string;
    errorCode?: string;
    [key: string]: unknown;
  };
}

/**
 * Analytics data structure for system metrics
 */
export interface AnalyticsData {
  executions: {
    total: number;
    successful: number;
    failed: number;
    byTool: Record<string, number>;
    byAction: Record<string, number>;
  };
  performance: {
    averageExecutionTime: number;
    memoryUsage: {
      heapUsed: number;
      heapTotal: number;
      external: number;
    };
    cacheHitRate?: number;
  };
  frameworks: {
    activeFramework: string;
    switchCount: number;
    switchHistory: Array<{
      from: string;
      to: string;
      timestamp: string;
      reason?: string;
    }>;
  };
  timestamp: string;
}

/**
 * Response formatter interface with proper typing
 */
export interface TypedResponseFormatter {
  formatResponse<T>(content: T): StructuredToolResponse;
  formatErrorResponse(error: TypedError, context?: ResponseContext): StructuredToolResponse;
  setAnalyticsService(service: AnalyticsService): void;
}

/**
 * Response context for error formatting
 */
export interface ResponseContext {
  tool: string;
  action: string;
  requestId?: string;
  executionTime?: number;
  additionalInfo?: MetadataFields;
}

// ============================================================================
// PROPER ERROR TYPES ( Replace error: any)
// ============================================================================

/**
 * Base typed error interface
 */
export interface TypedError {
  name: string;
  message: string;
  code?: string;
  context?: ErrorContext;
  stack?: string;
  cause?: TypedError;
}

// Re-export ErrorContext from consolidated error handling
export type { ErrorContext, ValidationResult };

/**
 * Validation error with detailed information
 */
export interface ValidationError extends TypedError {
  name: 'ValidationError';
  field?: string;
  value?: unknown;
  constraint?: string;
  example?: string;
}

/**
 * Execution error with runtime context
 */
export interface ExecutionError extends TypedError {
  name: 'ExecutionError';
  executionId?: string;
  step?: string;
  retryCount?: number;
  isRetryable?: boolean;
}

/**
 * Configuration error
 */
export interface ConfigurationError extends TypedError {
  name: 'ConfigurationError';
  configKey?: string;
  configValue?: unknown;
  validValues?: unknown[];
}

/**
 * Framework error
 */
export interface FrameworkError extends TypedError {
  name: 'FrameworkError';
  framework?: string;
  operation?: string;
  supportedFrameworks?: string[];
}

/**
 * Type guard functions for errors
 */
export function isTypedError(error: unknown): error is TypedError {
  return typeof error === 'object' && error !== null && 'name' in error && 'message' in error;
}

export function isValidationError(error: unknown): error is ValidationError {
  return isTypedError(error) && error.name === 'ValidationError';
}

export function isExecutionError(error: unknown): error is ExecutionError {
  return isTypedError(error) && error.name === 'ExecutionError';
}

export function isConfigurationError(error: unknown): error is ConfigurationError {
  return isTypedError(error) && error.name === 'ConfigurationError';
}

export function isFrameworkError(error: unknown): error is FrameworkError {
  return isTypedError(error) && error.name === 'FrameworkError';
}

/**
 * Analytics service interface (matches MetricsCollector)
 */
export interface AnalyticsService {
  recordExecution(executionData: ExecutionData): void;
  getAnalyticsSummary(options?: AnalyticsOptions): AnalyticsSummary;
  recordFrameworkSwitch?(data: FrameworkSwitchData): void;
  recordGateValidation?(data: GateValidationData): void;
}

/**
 * Execution data for analytics
 */
export interface ExecutionData {
  executionId: string;
  tool: string;
  action: string;
  success: boolean;
  duration: number;
  executionType: 'single' | 'chain';
  startTime: number;
  endTime: number;
  framework?: string;
  errorCode?: string;
}

/**
 * Analytics options
 */
export interface AnalyticsOptions {
  timeRange?: {
    start: Date;
    end: Date;
  };
  includeDetails?: boolean;
  groupBy?: 'tool' | 'action' | 'framework';
}

/**
 * Analytics summary result
 */
export interface AnalyticsSummary {
  totalExecutions: number;
  successRate: number;
  averageExecutionTime: number;
  breakdown: {
    byTool: Record<string, number>;
    byAction: Record<string, number>;
    byFramework: Record<string, number>;
  };
  performance: {
    slowestExecutions: Array<{
      tool: string;
      action: string;
      duration: number;
      timestamp: string;
    }>;
    errorRate: number;
    memoryUsage: {
      average: number;
      peak: number;
    };
  };
}

/**
 * Framework switch data
 */
export interface FrameworkSwitchData {
  from: string;
  to: string;
  timestamp: string;
  reason?: string;
  success: boolean;
  duration?: number;
}

/**
 * Gate validation data
 */
export interface GateValidationData {
  gateId: string;
  gateName: string;
  passed: boolean;
  score?: number;
  executionTime: number;
  requirements: string[];
  context: {
    promptId: string;
    executionType: 'single' | 'chain';
    framework?: string;
  };
}

/**
 * Configuration value types
 */
export type ConfigValue = string | number | boolean | null | ConfigObject | ConfigArray;
export interface ConfigObject {
  [key: string]: ConfigValue;
}
export interface ConfigArray extends Array<ConfigValue> {}

// ============================================================================
// SPECIFIC ARGUMENT TYPES ( Replace any types)
// ============================================================================

/**
 * Prompt argument definition with strict typing
 */
export interface PromptArgumentDefinition {
  name: string;
  description?: string;
  required: boolean;
  type?: 'string' | 'number' | 'boolean' | 'object' | 'array';
  defaultValue?: ConfigValue;
  validation?: {
    pattern?: string;
    minLength?: number;
    maxLength?: number;
    allowedValues?: ConfigValue[];
  };
}

/**
 * Chain step definition with strict typing
 */
export interface ChainStepDefinition {
  promptId: string;
  stepName: string;
  inputMapping?: Record<string, string>;
  outputMapping?: Record<string, string>;
  conditions?: {
    skipIf?: string;
    stopIf?: string;
  };
}

/**
 * Prompt Manager action argument types
 */
export interface BasePromptManagerArgs {
  id?: string;
  name?: string;
  category?: string;
  description?: string;
  system_message?: string;
  user_message_template?: string;
  arguments?: PromptArgumentDefinition[];
  chain_steps?: ChainStepDefinition[];
  filter?: string;
  detail?: 'overview' | 'steps' | 'structure' | 'gates' | 'flow' | 'analysis' | 'raw' | 'full';
  format?: 'compact' | 'detailed' | 'json';
}

export type PromptManagerAction =
  | ({
      action: 'create';
      id: string;
      name: string;
      user_message_template: string;
    } & BasePromptManagerArgs)
  | ({ action: 'update'; id: string } & BasePromptManagerArgs & {
        section?:
          | 'name'
          | 'description'
          | 'system_message'
          | 'user_message_template'
          | 'arguments'
          | 'chain_steps';
        section_content?: string;
      })
  | { action: 'delete'; id: string }
  | { action: 'reload' }
  | ({ action: 'list' } & Pick<BasePromptManagerArgs, 'filter' | 'format'>)
  | ({ action: 'inspect'; id: string } & Pick<BasePromptManagerArgs, 'detail' | 'format'>);

/**
 * Prompt Engine argument types
 */
export interface PromptEngineArgs {
  command: string;
  force_restart?: boolean;
  options?: ExecutionOptions;
}

/**
 * Execution options with proper typing
 */
export interface ExecutionOptions {
  /**
   * Framework to apply. Accepts any registered framework ID.
   * Use frameworkManager.listFrameworks() to see available options.
   */
  framework?: string;
  llmValidation?: boolean;
  retryCount?: number;
  debugMode?: boolean;
  stepConfirmation?: boolean;
  context?: ExecutionContext;
}

/**
 * Execution context
 */
export interface ExecutionContext {
  sessionId?: string;
  previousResults?: Record<string, unknown>;
  userPreferences?: {
    outputFormat?: 'compact' | 'detailed' | 'json' | 'markdown';
    verboseMode?: boolean;
    autoExecution?: boolean;
  };
  systemState?: {
    activeFramework?: string;
    memoryUsage?: {
      heapUsed: number;
      heapTotal: number;
      external: number;
    };
  };
}

/**
 * System Control argument types
 */
export interface BaseSystemControlArgs {
  include_history?: boolean;
  include_metrics?: boolean;
  show_details?: boolean;
  reason?: string;
  confirm?: boolean;
  limit?: number;
  reset_analytics?: boolean;
  operation?: string;
}

export type SystemControlAction =
  | ({ action: 'status' } & Pick<
      BaseSystemControlArgs,
      'include_history' | 'include_metrics' | 'operation'
    >)
  | ({ action: 'framework'; framework?: string } & Pick<
      BaseSystemControlArgs,
      'reason' | 'show_details' | 'operation'
    >)
  | ({ action: 'analytics' } & Pick<
      BaseSystemControlArgs,
      'include_history' | 'reset_analytics' | 'limit' | 'confirm' | 'operation'
    >)
  | ({ action: 'config'; config?: ConfigObject; backup_path?: string } & Pick<
      BaseSystemControlArgs,
      'confirm' | 'operation'
    >)
  | ({ action: 'maintenance' } & Pick<BaseSystemControlArgs, 'reason' | 'confirm' | 'operation'>);

// ============================================================================
// REPLACEMENT TYPES FOR Record<string, any>
// ============================================================================

/**
 * Prompt execution arguments (replaces Record<string, any>)
 */
export interface PromptExecutionArgs {
  [key: string]: string | number | boolean | null | PromptExecutionArgs | PromptExecutionArgs[];
}

/**
 * Metadata fields (replaces Record<string, any>)
 */
export interface MetadataFields {
  tool: string;
  action: string;
  timestamp: string;
  executionTime?: number;
  framework?: string;
  errorCode?: string;
  [key: string]: string | number | boolean | null | undefined;
}

/**
 * Configuration update values
 */
export interface ConfigurationValues {
  [key: string]: ConfigValue;
}

/**
 * Chain execution results
 */
export interface ChainExecutionResults {
  [stepIndex: string]: {
    result: string;
    metadata: {
      startTime: number;
      endTime: number;
      status: 'completed' | 'failed' | 'skipped';
      error?: string;
    };
  };
}

/**
 * Enhanced configuration management
 */
export interface ConfigChangeResult {
  valid: boolean;
  error?: string;
  convertedValue?: ConfigValue;
  suggestion?: string;
}

/**
 * Prompt data with proper typing
 */
export interface TypedPromptData {
  id: string;
  name: string;
  description: string;
  category: string;
  system_message?: string;
  user_message_template: string;
  arguments: Array<{
    name: string;
    description?: string;
    required: boolean;
    type?: string;
    default?: ConfigValue;
  }>;
  chain_steps?: Array<{
    promptId: string;
    stepName: string;
    inputMapping?: Record<string, string>;
    outputMapping?: Record<string, string>;
  }>;
  metadata?: {
    created: string;
    modified: string;
    version: string;
    tags?: string[];
  };
}

/**
 * Filter parsing result with structured data
 */
export interface FilterParseResult {
  textSearch?: string;
  structured: {
    type?: string[];
    category?: string[];
    gates?: boolean;
    confidence?: {
      operator: '>' | '<' | '>=' | '<=' | '=';
      value: number;
    };
    created?: {
      operator: '>' | '<' | '>=' | '<=' | '=';
      value: Date;
    };
    complexity?: string[];
  };
  operators?: {
    and?: FilterParseResult[];
    or?: FilterParseResult[];
    not?: FilterParseResult;
  };
}

// ValidationResult now imported from execution/types.js - provides unified validation interface
// Import at top of file if needed for MCP tool usage

/**
 * Output formatting options
 */
export interface OutputOptions {
  format: 'compact' | 'detailed' | 'json' | 'markdown';
  includeMetadata: boolean;
  maxResults?: number;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
}

/**
 * Enhanced tool response with formatting options
 */
export interface EnhancedToolResponse extends StructuredToolResponse {
  outputOptions?: OutputOptions;
  pagination?: {
    page: number;
    pageSize: number;
    total: number;
    hasNext: boolean;
    hasPrevious: boolean;
  };
}
