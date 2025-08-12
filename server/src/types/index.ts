/**
 * Comprehensive type definitions for the MCP Prompts Server
 * Consolidates all type definitions from across the application
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
  RegistrationMode,
  ServerConfig,
  TextMessageContent,
  TransportConfig,
  TransportsConfig,
} from "../types.js";

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

// Chain Execution Types
export interface ChainStep {
  promptId: string; // ID of the prompt to execute in this step
  stepName: string; // Name of this step
  inputMapping?: Record<string, string>; // Maps chain inputs to this step's inputs
  outputMapping?: Record<string, string>; // Maps this step's outputs to chain outputs
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
  executionMode?: 'auto' | 'template' | 'chain' | 'workflow';
  requiresExecution?: boolean; // Whether this prompt should be executed rather than returned
  // Workflow-related properties
  isWorkflow?: boolean; // Whether this prompt is a workflow
  workflowDefinition?: Workflow; // Full workflow definition
  workflowId?: string; // Reference to registered workflow
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
  // New completeness gates
  | 'required_fields'
  | 'completeness_score'
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
  type: 'single' | 'chain' | 'workflow';
  promptId: string;
  status: 'pending' | 'running' | 'waiting_gate' | 'completed' | 'failed' | 'retrying';
  currentStep?: number;
  totalSteps?: number;
  gates: GateStatus[];
  results: Record<string, any>;
  metadata: {
    startTime: number;
    endTime?: number;
    executionMode?: 'auto' | 'template' | 'chain' | 'workflow';
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
  executionMode: 'auto' | 'chain' | 'workflow';
  gateValidation: boolean;
  stepConfirmation: boolean;
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
  WORKFLOW = "workflow",
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

// ===== Workflow Foundation Types =====

/**
 * Runtime targets for workflow execution
 */
export type RuntimeTarget = 'desktop' | 'cli' | 'server' | 'web';

/**
 * Workflow step configuration
 */
export interface StepConfig {
  /** Prompt ID for prompt steps */
  promptId?: string;
  /** Tool name for tool steps */
  toolName?: string;
  /** Gate ID for gate steps */
  gateId?: string;
  /** Condition expression for condition steps */
  condition?: string;
  /** Parameters for step execution */
  parameters?: Record<string, any>;
  /** Timeout in milliseconds */
  timeout?: number;
}

/**
 * Error handling configuration for workflow steps
 */
export interface ErrorHandling {
  /** Action to take on step failure */
  action: 'stop' | 'skip' | 'retry' | 'rollback';
  /** Maximum retries for this step */
  maxRetries?: number;
  /** Fallback step to execute on failure */
  fallbackStep?: string;
}

/**
 * Workflow step definition
 */
export interface WorkflowStep {
  /** Unique identifier for the step */
  id: string;
  /** Display name for the step */
  name: string;
  /** Type of step execution */
  type: 'prompt' | 'tool' | 'gate' | 'condition' | 'parallel';
  /** Step configuration */
  config: StepConfig;
  /** Dependencies (step IDs that must complete before this step) */
  dependencies: string[];
  /** Step timeout in milliseconds */
  timeout?: number;
  /** Number of retries for this step */
  retries?: number;
  /** Error handling configuration */
  onError?: ErrorHandling;
}

/**
 * Dependency graph for workflow execution order
 */
export interface DependencyGraph {
  /** All step IDs in the workflow */
  nodes: string[];
  /** Dependency edges as [from, to] tuples */
  edges: [string, string][];
  /** Pre-computed topological order (optional) */
  topologicalOrder?: string[];
}

/**
 * Retry policy for workflow execution
 */
export interface RetryPolicy {
  /** Maximum number of retries */
  maxRetries: number;
  /** Backoff strategy for retries */
  backoffStrategy: 'linear' | 'exponential';
  /** Types of errors that should trigger retries */
  retryableErrors: string[];
  /** Base delay between retries in milliseconds */
  baseDelay?: number;
  /** Maximum delay between retries in milliseconds */
  maxDelay?: number;
}

/**
 * Workflow metadata
 */
export interface WorkflowMetadata {
  /** Author of the workflow */
  author?: string;
  /** Creation timestamp */
  created: Date;
  /** Last modification timestamp */
  modified: Date;
  /** Tags for categorization */
  tags: string[];
  /** Target runtime environments */
  runtime: RuntimeTarget[];
  /** Version of the workflow */
  version: string;
}

/**
 * Gate configuration for workflow validation
 */
export interface WorkflowGate {
  /** Gate identifier */
  id: string;
  /** Gate name */
  name: string;
  /** Gate type */
  type: GateType;
  /** Step IDs this gate applies to */
  appliesTo: string[];
  /** Gate requirements */
  requirements: GateRequirement[];
  /** Action to take on gate failure */
  failureAction: 'stop' | 'retry' | 'skip' | 'rollback';
}

/**
 * Complete workflow definition
 */
export interface Workflow {
  /** Unique workflow identifier */
  id: string;
  /** Display name */
  name: string;
  /** Optional description */
  description?: string;
  /** Workflow version */
  version: string;
  /** Workflow steps */
  steps: WorkflowStep[];
  /** Dependency graph */
  dependencies: DependencyGraph;
  /** Retry policy */
  retryPolicy: RetryPolicy;
  /** Workflow metadata */
  metadata: WorkflowMetadata;
  /** Optional gates for validation */
  gates?: WorkflowGate[];
}

/**
 * Workflow execution context
 */
export interface WorkflowExecutionContext {
  /** Workflow being executed */
  workflow: Workflow;
  /** Input parameters */
  inputs: Record<string, any>;
  /** Current step results */
  stepResults: Record<string, any>;
  /** Execution start time */
  startTime: number;
  /** Current runtime target */
  runtime: RuntimeTarget;
  /** Execution options */
  options: WorkflowExecutionOptions;
}

/**
 * Workflow execution options
 */
export interface WorkflowExecutionOptions {
  /** Whether to require step confirmation */
  stepConfirmation?: boolean;
  /** Whether to validate gates */
  gateValidation?: boolean;
  /** Overall execution timeout */
  timeout?: number;
  /** Whether to run in parallel where possible */
  parallelExecution?: boolean;
}

/**
 * Workflow execution result
 */
export interface WorkflowExecutionResult {
  /** Workflow ID */
  workflowId: string;
  /** Execution ID */
  executionId: string;
  /** Final execution status */
  status: 'completed' | 'failed' | 'timeout' | 'cancelled';
  /** Start time */
  startTime: number;
  /** End time */
  endTime: number;
  /** Results from each step */
  stepResults: Record<string, StepResult>;
  /** Final workflow result */
  finalResult?: any;
  /** Error information if failed */
  error?: {
    message: string;
    step?: string;
    code?: string;
  };
}

/**
 * Workflow execution plan
 */
export interface WorkflowExecutionPlan {
  /** Workflow ID */
  workflowId: string;
  /** Execution order of steps */
  executionOrder: string[];
  /** Parallel execution groups */
  parallelGroups: string[][];
  /** Estimated execution time */
  estimatedDuration: number;
  /** Validation results */
  validationResults: ValidationResult;
}

/**
 * Workflow validation result
 */
export interface WorkflowValidationResult {
  /** Whether workflow is valid */
  valid: boolean;
  /** Validation errors */
  errors: string[];
  /** Validation warnings */
  warnings: string[];
  /** Dependency graph validation */
  dependencyValidation: {
    valid: boolean;
    cycles: string[][];
    unreachableNodes: string[];
  };
}
