// @lifecycle canonical - Central hub that re-exports domain-specific type modules.
/**
 * Consolidated Type Index for MCP Prompts Server
 *
 * This module serves as the central type export hub, importing from domain-specific
 * type files and re-exporting them for easy consumption. Types are now organized
 * by domain for better maintainability and reduced duplication.
 *
 * Architecture: Domain-specific types -> This index -> Consumer modules
 */

// ===== Import Domain-Specific Types =====

export type { McpToolRequest } from './execution.js';

// Core configuration and protocol types
export type {
  Config,
  ServerConfig,
  TransportConfig,
  TransportsConfig,
  LoggingConfig,
  ChainSessionConfig,
  AnalysisMode,
  LLMProvider,
  LLMIntegrationConfig,
  SemanticAnalysisConfig,
  AnalysisConfig,
  ToolDescriptionsOptions,
  FrameworksConfig,
  Message,
  MessageContent,
  MessageRole,
  TextMessageContent,
  BaseMessageContent
} from '../types.js';

// Prompt system types
export type {
  PromptArgument,
  Category,
  PromptData,
  PromptFile,
  PromptsConfig,
  PromptsConfigFile,
  PromptsFile,
  PromptFileContent,
  CategoryPromptsResult,
  CategoryValidationResult,
  CategoryStatistics,
  CategoryPromptRelationship
} from '../prompts/types.js';

// Execution system types
export type {
  ConvertedPrompt,
  ChainStep,
  ExecutionStrategyType,
  ExecutionType,
  BaseExecutionContext,
  UnifiedExecutionResult,
  ExecutionStrategy,
  ChainExecutionResult,
  ChainStepResult,
  ChainExecutionState,
  EnhancedChainExecutionOptions,
  TemplateContext,
  ValidationResult,
  ExecutionStats,
  PerformanceMetrics
} from '../execution/types.js';

// Import additional types needed for interfaces in this file
import type {
  ChainStep,
  EnhancedChainExecutionOptions,
  ChainStepResult
} from '../execution/types.js';
import type {
  GateStatus,
  StepResult
} from '../gates/types.js';

// Gate system types
export type {
  GateDefinition,
  GateRequirement,
  GateRequirementType,
  GateStatus,
  GateEvaluationResult,
  ValidationContext,
  GateActivationResult,
  LightweightGateDefinition,
  GatePassCriteria,
  ValidationCheck,
  GatesConfig,
  StepResult,
  GateType
} from '../gates/types.js';

// Framework system types (consolidated in Phase 2)
export type {
  FrameworkDefinition,
  FrameworkExecutionContext,
  FrameworkSelectionCriteria,
  FrameworkMethodology,
  IMethodologyGuide,
  FrameworkStateInfo,
  IntegratedAnalysisResult,
  FrameworkSwitchingConfig
} from '../frameworks/types/index.js';

// ===== Additional System Types =====

// Conversation History Types
export interface ConversationHistoryItem {
  role: "user" | "assistant";
  content: string;
  timestamp: number;
  isProcessedTemplate?: boolean; // Flag to indicate if this is a processed template rather than original user input
}

// Advanced Chain Execution Types
export interface EnhancedChainExecutionContext {
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

  // Dependency management
  executionPlan?: {
    executionOrder: string[];             // Topologically sorted step execution order
    parallelGroups: Map<string, string[]>; // Parallel execution groups
  };

  // Advanced execution state
  currentPhase: 'planning' | 'executing' | 'completed' | 'failed';
  activeParallelGroups: Map<string, string[]>; // Currently executing parallel groups
  retryCount: Record<string, number>;    // Retry attempts per step

  // Gate validation tracking
  gateValidationResults: Record<string, GateStatus[]>; // Gate results per step
}

// API Response Types
export interface ApiResponse {
  success: boolean;
  message: string;
  data?: unknown;
}

export interface ToolResponse {
  content: Array<{
    type: "text";
    text: string;
  }>;
  isError?: boolean;
  structuredContent?: Record<string, any>;
}

// Tool Description Types
export interface ToolParameter {
  description?: string;
  examples?: string[];
}

export interface ToolDescription {
  description: string;
  parameters?: Record<string, ToolParameter | string>;
  shortDescription?: string;
  category?: string;
  frameworkAware?: {
    enabled?: string;
    disabled?: string;
    parametersEnabled?: Record<string, ToolParameter | string>;
    parametersDisabled?: Record<string, ToolParameter | string>;
    methodologies?: Record<string, string>;
    methodologyParameters?: Record<string, Record<string, ToolParameter | string>>;
  };
}

export interface ToolDescriptionsConfig {
  version: string;
  lastUpdated?: string;
  tools: Record<string, ToolDescription>;
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

// Execution State Types
export interface ExecutionState {
  type: 'single' | 'chain';
  promptId: string;
  status: 'pending' | 'running' | 'waiting_gate' | 'completed' | 'failed' | 'retrying';
  currentStep?: number;
  totalSteps?: number;
  gates: GateStatus[];
  results: Record<string, string | ChainStepResult>;
  metadata: {
    startTime: number;
    endTime?: number;
    executionMode?: 'prompt' | 'template' | 'chain';
    stepConfirmation?: boolean;
    gateValidation?: boolean;
    sessionId?: string; // For chain session management
  };
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
  executionMode: 'auto' | 'chain';
  gateValidation: boolean;
  stepConfirmation: boolean;
}

// Chain execution progress tracking
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

// Auto-execution configuration for chains
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

// ===== End of Consolidated Type Definitions =====
// Types are now organized by domain for better maintainability:
// - Core types: ../types.js
// - Prompt types: ../prompts/types.js
// - Execution types: ../execution/types.js
// - Gate types: ../gates/types.js
// - Framework types: ../frameworks/types/index.js
