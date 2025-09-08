/**
 * Comprehensive type definitions for the MCP Prompts Server
 * Consolidates all type definitions from across the application
 * 
 * This module provides unified type definitions for the 3-tier execution architecture,
 * including strategy patterns, chain orchestration, and performance monitoring.
 */

// Import PromptData specifically for use within this module
import type { PromptData } from "../types.js";

// ===== Core Types =====

/**
 * Definition of an argument for a prompt
 */
export interface PromptArgument {
  /** Name of the argument */
  name: string;
  /** Optional description of the argument */
  description?: string;
  /** Whether this argument is required */
  required: boolean;
  /** Optional CAGEERF component association */
  cageerfComponent?: 'context' | 'analysis' | 'goals' | 'execution' | 'evaluation' | 'refinement' | 'framework';
}

/**
 * A category for organizing prompts
 */
export interface Category {
  /** Unique identifier for the category */
  id: string;
  /** Display name for the category */
  name: string;
  /** Description of the category */
  description: string;
}

// Import and re-export other types from the existing types.ts
export type {
  Config,
  Message,
  MessageContent,
  MessageRole,
  PromptData, // Ensure PromptData from ../types.js is re-exported
  PromptFile,
  PromptsConfig,
  PromptsConfigFile,
  PromptsFile,
  ServerConfig,
  TextMessageContent,
  TransportConfig,
  TransportsConfig,
  // New analysis configuration types
  AnalysisMode,
  LLMProvider,
  LLMIntegrationConfig,
  SemanticAnalysisConfig,
  AnalysisConfig,
  // Logging configuration types
  LoggingConfig,
} from "../types.js";

// ===== Execution Engine Types =====

/**
 * Execution strategy type enumeration - THREE-TIER MODEL
 * Used by ExecutionEngine's strategy pattern for different execution modes
 * 
 * - prompt: Basic variable substitution, no framework processing (fastest)
 * - template: Framework-aware execution with methodology guidance
 * - chain: Sequential execution using prompts and/or templates (includes former workflow capabilities)
 */
export type ExecutionStrategyType = 'prompt' | 'template' | 'chain'; // Phase 2: Removed workflow

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
  inputs: Record<string, any>;
  /** Strategy-specific and user options */
  options: Record<string, any>;
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
    context?: any;
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
    args: Record<string, any>
  ): Promise<UnifiedExecutionResult>;

  /**
   * Validate if this strategy can handle the given prompt
   * @param prompt The prompt to validate
   */
  canHandle(prompt: ConvertedPrompt): boolean;

  /**
   * Get strategy-specific default options
   */
  getOptions(): Record<string, any>;
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

// ===== Additional Types from index.ts =====

// Text Reference System Types
export interface TextReference {
  id: string;
  title: string;
  content: string;
  createdAt: number;
  lastUsed: number;
}

export interface TextReferenceStore {
  references: TextReference[];
  maxAge: number; // Maximum age in milliseconds before cleanup
  maxSize: number; // Maximum number of references to store
}

// Conversation History Types
export interface ConversationHistoryItem {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  isProcessedTemplate?: boolean; // Flag to indicate if this is a processed template rather than original user input
}

// Chain Execution Types - Enhanced for Advanced Chain Capabilities
export interface ChainStep {
  // Core chain step properties
  promptId: string; // ID of the prompt to execute in this step
  stepName: string; // Name of this step
  executionType?: 'prompt' | 'template'; // Whether to use basic prompt or framework-aware template execution
  inputMapping?: Record<string, string>; // Maps chain inputs to this step's inputs
  outputMapping?: Record<string, string>; // Maps this step's outputs to chain outputs
  qualityGates?: GateDefinition[]; // Optional custom quality gates for this step
  
  // NEW: Advanced chain capabilities (optional - preserves backward compatibility)
  dependencies?: string[]; // Step IDs that must complete before this step (enables dependency resolution)
  parallelGroup?: string; // Group ID for parallel execution (steps with same group run concurrently)
  timeout?: number; // Step-specific timeout in milliseconds
  retries?: number; // Number of retries for this step
  // onError removed - workflow types eliminated
  stepType?: 'prompt' | 'tool' | 'gate' | 'condition'; // Extended step types beyond prompt execution
  // config removed - workflow types eliminated
}

export interface ChainExecutionState {
  chainId: string;
  currentStepIndex: number;
  totalSteps: number;
  stepResults: Record<string, string>;
  startTime: number;
}

export interface ChainExecutionResult {
  results: Record<string, string>;
  messages: {
    role: "user" | "assistant";
    content: { type: "text"; text: string };
  }[];
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
  // retryPolicy removed - workflow types eliminated
  advancedGateValidation?: boolean;      // Use comprehensive gate validation
  stepConfirmation?: boolean;            // Require confirmation before executing each step
  continueOnFailure?: boolean;           // Continue chain execution even if non-critical steps fail
}

/**
 * Advanced Chain Execution Context
 * Extended context for chains with advanced capabilities
 */
export interface AdvancedChainExecutionContext {
  chainId: string;
  chainName: string;
  startTime: number;
  executionOptions: EnhancedChainExecutionOptions;
  
  // Enhanced step tracking
  allSteps: ChainStep[];                 // All steps in the chain
  completedSteps: Set<string>;           // Step IDs that have completed successfully
  failedSteps: Set<string>;              // Step IDs that have failed
  skippedSteps: Set<string>;             // Step IDs that were skipped due to dependencies/conditions
  stepResults: Record<string, StepResult>; // Detailed results from each step
  
  // Dependency management (workflow types removed)
  // dependencyGraph removed - workflow types eliminated
  executionPlan?: {
    executionOrder: string[];             // Topologically sorted step execution order
    parallelGroups: Map<string, string[]>; // Parallel execution groups
    // dependencyGraph removed - workflow types eliminated
  };
  
  // Advanced execution state
  currentPhase: 'planning' | 'executing' | 'completed' | 'failed';
  activeParallelGroups: Map<string, string[]>; // Currently executing parallel groups
  retryCount: Record<string, number>;    // Retry attempts per step
  
  // Gate validation tracking
  gateValidationResults: Record<string, GateStatus[]>; // Gate results per step
}

// ConvertedPrompt interface (enhanced from existing usage in codebase)
export interface ConvertedPrompt {
  id: string;
  name: string;
  description: string;
  category: string;
  systemMessage?: string;
  userMessageTemplate: string;
  arguments: Array<{
    name: string;
    description?: string;
    required: boolean;
  }>;
  // Chain-related properties
  isChain?: boolean; // Whether this prompt is a chain of prompts
  chainSteps?: ChainStep[];
  tools?: boolean; // Whether this prompt should use available tools
  /** Defines behavior when prompt is invoked without its defined arguments */
  onEmptyInvocation?: "execute_if_possible" | "return_template";
  // Gate validation properties
  gates?: GateDefinition[];
  executionMode?: 'prompt' | 'template' | 'chain'; // 3-tier execution model
  requiresExecution?: boolean; // Whether this prompt should be executed rather than returned
}

// Prompt Loading Types
export interface PromptFileContent {
  systemMessage?: string;
  userMessageTemplate: string;
  isChain?: boolean;
  chainSteps?: ChainStep[];
}

export interface CategoryPromptsResult {
  promptsData: PromptData[]; // Use the directly imported PromptData
  categories: Category[];
}

// API Response Types
export interface ApiResponse {
  success: boolean;
  message: string;
  data?: any;
}

export interface ToolResponse {
  content: Array<{
    type: "text";
    text: string;
  }>;
  isError?: boolean;
  // NOTE: Removed nextAction field - MCP protocol ignores custom fields
  // LLM guidance now provided via structured content sections instead
}

// Server Management Types
export interface ServerRefreshOptions {
  restart?: boolean;
  reason?: string;
}

export interface ServerState {
  isStarted: boolean;
  transport: string;
  port?: number;
  startTime: number;
}

// File Operation Types
export interface FileOperation {
  (): Promise<boolean>;
}

export interface ModificationResult {
  success: boolean;
  message: string;
}

// Template Processing Types
export interface TemplateContext {
  specialContext?: Record<string, string>;
  toolsEnabled?: boolean;
}

// Validation Types
export interface ValidationResult {
  valid: boolean;
  errors?: string[];
  sanitizedArgs?: Record<string, any>;
}

// Express and Transport Types
export interface ExpressRequest {
  body: any;
  params: Record<string, string>;
  headers: Record<string, string>;
  ip: string;
  method: string;
  url: string;
}

export interface ExpressResponse {
  json: (data: any) => void;
  status: (code: number) => ExpressResponse;
  send: (data: any) => void;
  setHeader: (name: string, value: string) => void;
  end: () => void;
  sendStatus: (code: number) => void;
  on: (event: string, callback: () => void) => void;
}

// Gate Validation Types
export type GateRequirementType = 
  | 'content_length'
  | 'keyword_presence'
  | 'format_validation'
  | 'section_validation'
  | 'custom'
  // New content quality gates
  | 'readability_score'
  | 'grammar_quality'
  | 'tone_analysis'
  // New structure gates
  | 'hierarchy_validation'
  | 'link_validation'
  | 'code_quality'
  | 'structure' // Added for chain step structure validation
  // New pattern matching gates
  | 'pattern_matching'
  // New completeness gates
  | 'required_fields'
  | 'completeness_score'
  | 'completeness'
  // New chain-specific gates
  | 'step_continuity' // Added for chain step continuity validation
  | 'framework_compliance' // Added for framework compliance validation
  // New security gates
  | 'security_validation'
  | 'citation_validation'
  // New security gates
  | 'security_scan'
  | 'privacy_compliance'
  | 'content_policy'
  // New workflow gates
  | 'dependency_validation'
  | 'context_consistency'
  | 'resource_availability';

export interface GateRequirement {
  type: GateRequirementType;
  criteria: any;
  weight?: number;
  required?: boolean;
}

export interface GateDefinition {
  id: string;
  name: string;
  type: 'validation' | 'approval' | 'condition' | 'quality';
  requirements: GateRequirement[];
  failureAction: 'stop' | 'retry' | 'skip' | 'rollback';
  retryPolicy?: {
    maxRetries: number;
    retryDelay: number;
  };
}

export interface GateEvaluationResult {
  requirementId: string;
  passed: boolean;
  score?: number;
  message?: string;
  details?: any;
}

export interface GateStatus {
  gateId: string;
  passed: boolean;
  requirements: GateRequirement[];
  evaluationResults: GateEvaluationResult[];
  timestamp: number;
  retryCount?: number;
}

export interface ExecutionState {
  type: 'single' | 'chain'; // Phase 2: Removed workflow, single can handle complex templates
  promptId: string;
  status: 'pending' | 'running' | 'waiting_gate' | 'completed' | 'failed' | 'retrying';
  currentStep?: number;
  totalSteps?: number;
  gates: GateStatus[];
  results: Record<string, any>;
  metadata: {
    startTime: number;
    endTime?: number;
    executionMode?: 'prompt' | 'template' | 'chain'; // Phase 2: Removed workflow
    stepConfirmation?: boolean;
    gateValidation?: boolean;
  };
}

export interface StepResult {
  content: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  timestamp: number;
  validationResults?: ValidationResult[];
  gateResults?: GateStatus[];
  metadata?: Record<string, any>;
}

// Enhanced Chain Execution Types
export interface EnhancedChainExecutionState {
  chainId: string;
  currentStepIndex: number;
  totalSteps: number;
  startTime: number;
  status: 'pending' | 'running' | 'waiting_gate' | 'completed' | 'failed';
  stepResults: Record<string, StepResult>;
  gates: Record<string, GateStatus>;
  executionMode: 'auto' | 'chain'; // Phase 2: Removed workflow, auto can handle templates
  gateValidation: boolean;
  stepConfirmation: boolean;
}

/**
 * Chain execution progress tracking interface
 * Provides detailed progress information for automatic chain execution
 */
export interface ChainExecutionProgress {
  chainId: string;
  chainName: string;
  currentStep: number;
  totalSteps: number;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'paused';
  steps: ChainStepProgress[];
  startTime: number;
  endTime?: number;
  duration?: number;
  errorCount: number;
  autoExecute: boolean;
}

/**
 * Individual step progress in chain execution
 */
export interface ChainStepProgress {
  stepIndex: number;
  stepName: string;
  promptId: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  startTime?: number;
  endTime?: number;
  duration?: number;
  result?: string;
  error?: string;
  gateResults?: GateStatus[];
}

/**
 * Auto-execution configuration for chains
 */
export interface AutoExecutionConfig {
  enabled: boolean;
  stepConfirmation: boolean;
  gateValidation: boolean;
  pauseOnError: boolean;
  maxRetries: number;
  retryDelay: number; // milliseconds
}

// Constants and Enums
export const MAX_HISTORY_SIZE = 100;

export enum LogLevel {
  DEBUG = "DEBUG",
  INFO = "INFO",
  WARN = "WARN",
  ERROR = "ERROR",
}

export enum TransportType {
  STDIO = "stdio",
  SSE = "sse",
}

export enum ExecutionMode {
  AUTO = "auto",
  TEMPLATE = "template", 
  CHAIN = "chain",
}

export enum StepStatus {
  PENDING = "pending",
  RUNNING = "running",
  COMPLETED = "completed",
  FAILED = "failed",
  SKIPPED = "skipped",
}

export enum GateType {
  VALIDATION = "validation",
  APPROVAL = "approval",
  CONDITION = "condition",
  QUALITY = "quality",
}

// ===== End of Type Definitions =====
// Phase 2: Workflow foundation types completely removed - chains handle all multi-step execution
