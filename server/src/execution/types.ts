/**
 * Execution System Type Definitions
 *
 * Contains all types related to prompt execution, strategies, contexts, and results.
 * This includes execution strategies, converted prompts, contexts, and chain execution.
 */

import type { PromptArgument, GateDefinition } from '../prompts/types.js';

/**
 * Execution strategy type enumeration - THREE-TIER MODEL
 * Used by ExecutionEngine's strategy pattern for different execution modes
 *
 * - prompt: Basic variable substitution, no framework processing (fastest)
 * - template: Framework-aware execution with methodology guidance
 * - chain: Sequential execution using prompts and/or templates (includes former workflow capabilities)
 */
export type ExecutionStrategyType = 'prompt' | 'template' | 'chain';

/**
 * Execution types for semantic analysis
 */
export type ExecutionType = "template" | "chain" | "auto";

/**
 * Enhanced chain step definition
 */
export interface ChainStep {
  // Core chain step properties
  promptId: string; // ID of the prompt to execute in this step
  stepName: string; // Name of this step
  executionType?: 'prompt' | 'template'; // Whether to use basic prompt or framework-aware template execution
  inputMapping?: Record<string, string>; // Maps chain inputs to this step's inputs
  outputMapping?: Record<string, string>; // Maps this step's outputs to chain outputs
  qualityGates?: GateDefinition[]; // Optional custom quality gates for this step

  // Advanced chain capabilities (optional - preserves backward compatibility)
  dependencies?: string[]; // Step IDs that must complete before this step (enables dependency resolution)
  parallelGroup?: string; // Group ID for parallel execution (steps with same group run concurrently)
  timeout?: number; // Step-specific timeout in milliseconds
  retries?: number; // Number of retries for this step
  stepType?: 'prompt' | 'tool' | 'gate' | 'condition'; // Extended step types beyond prompt execution
}

/**
 * Comprehensive converted prompt for execution context
 * Consolidates all previous ConvertedPrompt definitions
 */
export interface ConvertedPrompt {
  id: string;
  name: string;
  description: string;
  category: string;
  systemMessage?: string;
  userMessageTemplate: string;
  arguments: PromptArgument[];
  // Chain-related properties (isChain removed - now derived from chainSteps presence)
  chainSteps?: ChainStep[];
  tools?: boolean; // Whether this prompt should use available tools
  /** Defines behavior when prompt is invoked without its defined arguments */
  onEmptyInvocation?: "execute_if_possible" | "return_template";
  // Gate validation properties
  gates?: GateDefinition[];
  executionMode?: 'prompt' | 'template' | 'chain'; // 3-tier execution model
  requiresExecution?: boolean; // Whether this prompt should be executed rather than returned
}

/**
 * Base execution context for all strategies
 * Provides common execution metadata across all strategy types
 */
export interface BaseExecutionContext {
  /** Unique execution identifier */
  id: string;
  /** Strategy type being used */
  type: ExecutionStrategyType;
  /** Execution start timestamp */
  startTime: number;
  /** Input parameters for execution */
  inputs: Record<string, string | number | boolean | null>;
  /** Strategy-specific and user options */
  options: Record<string, string | number | boolean | null | unknown[]>;
}

/**
 * Chain step execution result
 */
export interface ChainStepResult {
  result: string;
  metadata: {
    startTime: number;
    endTime: number;
    duration: number;
    status: 'completed' | 'failed' | 'skipped';
    error?: string;
  };
}

/**
 * Chain execution result structure
 */
export interface ChainExecutionResult {
  results: Record<string, string>;
  messages: {
    role: "user" | "assistant";
    content: { type: "text"; text: string };
  }[];
}

/**
 * Unified execution result interface
 * Standardizes results across all execution strategies
 */
export interface UnifiedExecutionResult {
  /** Unique execution identifier */
  executionId: string;
  /** Strategy type that was used */
  type: ExecutionStrategyType;
  /** Final execution status */
  status: 'completed' | 'failed' | 'timeout' | 'cancelled';
  /** Execution start timestamp */
  startTime: number;
  /** Execution end timestamp */
  endTime: number;
  /** Strategy-specific result content */
  result: string | ChainExecutionResult;
  /** Error information if execution failed */
  error?: {
    message: string;
    code?: string;
    context?: Record<string, unknown>;
  };
}

/**
 * Base execution strategy interface
 * Defines the contract that all execution strategies must implement
 */
export interface ExecutionStrategy {
  /** Strategy type identifier */
  readonly type: ExecutionStrategyType;

  /**
   * Execute using this strategy
   * @param context Base execution context
   * @param promptId ID of prompt to execute
   * @param args Execution arguments
   */
  execute(
    context: BaseExecutionContext,
    promptId: string,
    args: Record<string, string | number | boolean | null>
  ): Promise<UnifiedExecutionResult>;

  /**
   * Validate if this strategy can handle the given prompt
   * @param prompt The prompt to validate
   */
  canHandle(prompt: ConvertedPrompt): boolean;

  /**
   * Get strategy-specific default options
   */
  getOptions(): Record<string, string | number | boolean | null | unknown[]>;
}

/**
 * Execution engine statistics
 * Comprehensive performance and usage metrics
 */
export interface ExecutionStats {
  /** Total number of executions */
  totalExecutions: number;
  /** Number of prompt strategy executions */
  promptExecutions: number;
  /** Number of chain strategy executions */
  chainExecutions: number;
  /** Number of failed executions */
  failedExecutions: number;
  /** Average execution time in milliseconds */
  averageExecutionTime: number;
  /** Currently active executions */
  activeExecutions: number;
  /** Conversation manager statistics */
  conversationStats: any;
}

/**
 * Performance metrics for ExecutionEngine monitoring
 * Provides detailed performance and health metrics
 */
export interface PerformanceMetrics {
  /** Strategy cache hit rate (0.0 to 1.0) */
  cacheHitRate: number;
  /** Memory usage information */
  memoryUsage: {
    /** Size of strategy selection cache */
    strategyCacheSize: number;
    /** Number of stored execution times */
    executionTimesSize: number;
    /** Number of currently active executions */
    activeExecutionsSize: number;
  };
  /** Execution health metrics */
  executionHealth: {
    /** Success rate (0.0 to 1.0) */
    successRate: number;
    /** Average execution time in milliseconds */
    averageTime: number;
    /** Number of recent executions tracked */
    recentExecutions: number;
  };
}

/**
 * Enhanced Chain Execution Options
 * Extends basic chain execution with optional advanced capabilities
 * All advanced options are optional to preserve backward compatibility
 */
export interface EnhancedChainExecutionOptions {
  // Existing basic options (maintained for backward compatibility)
  allowStepFailures?: boolean;          // Allow individual steps to fail without stopping chain
  trackStepResults?: boolean;           // Track results from each step for use in subsequent steps
  useConversationContext?: boolean;     // Include conversation history in step execution
  processTemplates?: boolean;           // Process Nunjucks templates in step prompts

  // NEW: Advanced execution options (all optional - default to false/simple behavior)
  enableDependencyResolution?: boolean;  // Enable step dependency resolution and topological ordering
  enableParallelExecution?: boolean;     // Enable parallel execution of steps in same parallel group
  executionTimeout?: number;             // Chain-wide timeout in milliseconds (overrides individual step timeouts)
  advancedGateValidation?: boolean;      // Use comprehensive gate validation
  stepConfirmation?: boolean;            // Require confirmation before executing each step
  continueOnFailure?: boolean;           // Continue chain execution even if non-critical steps fail
}

/**
 * Chain execution state
 */
export interface ChainExecutionState {
  chainId: string;
  currentStepIndex: number;
  totalSteps: number;
  stepResults: Record<string, string>;
  startTime: number;
}

/**
 * Template processing context
 */
export interface TemplateContext {
  specialContext?: Record<string, string>;
  toolsEnabled?: boolean;
}

/**
 * Validation error detail structure
 */
export interface ValidationError {
  field: string;
  message: string;
  code: string;
  suggestion?: string;
  example?: string;
}

/**
 * Validation warning structure
 */
export interface ValidationWarning {
  field: string;
  message: string;
  suggestion?: string;
}

/**
 * Unified validation result structure
 * Supports both simple validation and comprehensive gate validation
 */
export interface ValidationResult {
  /** Whether validation passed (supports both 'valid' and 'passed' patterns) */
  valid: boolean;
  /** Alternative field name for gate validation compatibility */
  passed?: boolean;
  /** Detailed validation errors */
  errors?: ValidationError[];
  /** Validation warnings */
  warnings?: ValidationWarning[];
  /** Sanitized arguments for simple validation */
  sanitizedArgs?: Record<string, string | number | boolean | null>;

  // Extended fields for gate validation (optional)
  /** Gate that was validated (for gate validation) */
  gateId?: string;
  /** Individual check results (for comprehensive validation) */
  checks?: ValidationCheck[];
  /** Hints for improvement on failure (for gate validation) */
  retryHints?: string[];
  /** Validation metadata (for comprehensive validation) */
  metadata?: {
    validationTime: number;
    checksPerformed: number;
    llmValidationUsed: boolean;
  };

  // Argument-specific validation (optional)
  /** Argument name (for argument validation) */
  argumentName?: string;
  /** Original value before processing */
  originalValue?: unknown;
  /** Processed value after validation */
  processedValue?: string | number | boolean | null;
  /** Applied validation rules */
  appliedRules?: string[];
}

/**
 * Individual validation check result (used in comprehensive validation)
 */
export interface ValidationCheck {
  /** Type of check performed */
  type: string;
  /** Did this check pass */
  passed: boolean;
  /** Score if applicable (0.0-1.0) */
  score?: number;
  /** Details about the check */
  message: string;
  /** Additional context */
  details?: Record<string, any>;
}