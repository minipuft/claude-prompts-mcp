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
  AdvancedConfig,
  AnalysisConfig,
  BaseMessageContent,
  ChainSessionConfig,
  Config,
  ExecutionConfig,
  FrameworkInjectionConfig,
  FrameworksConfig,
  LLMIntegrationConfig,
  LLMProvider,
  LoggingConfig,
  Message,
  MessageContent,
  MessageRole,
  MethodologiesConfig,
  ResourcesConfig,
  SemanticAnalysisConfig,
  ServerConfig,
  TextMessageContent,
  ToolDescriptionsOptions,
  TransportMode,
  VerificationConfig,
} from '../types.js';

// Prompt system types
export type {
  Category,
  CategoryPromptRelationship,
  CategoryPromptsResult,
  CategoryStatistics,
  CategoryValidationResult,
  PromptArgument,
  PromptData,
  PromptFile,
  PromptFileContent,
  PromptsConfig,
  PromptsConfigFile,
  PromptsFile,
} from '../prompts/types.js';

// Execution system types
export type {
  BaseExecutionContext,
  ChainExecutionResult,
  ChainExecutionState,
  ChainStep,
  ChainStepResult,
  ConvertedPrompt,
  ExecutionModifier,
  ExecutionModifiers,
  ExecutionStats,
  ExecutionStrategy,
  ExecutionStrategyType,
  ExecutionType,
  PerformanceMetrics,
  TemplateContext,
  UnifiedExecutionResult,
  ValidationResult,
} from '../execution/types.js';

// Import additional types needed for interfaces in this file
import type { ChainStep, ChainStepResult } from '../execution/types.js';
import type { GateStatus, StepResult } from '../gates/types.js';

// Gate system types
export type {
  GateActivationResult,
  GateDefinition,
  GateEvaluationResult,
  GatePassCriteria,
  GateRequirement,
  GateRequirementType,
  GatesConfig,
  GateStatus,
  GateType,
  LightweightGateDefinition,
  StepResult,
  ValidationCheck,
  ValidationContext,
} from '../gates/types.js';

// Framework system types (consolidated in )
export type {
  FrameworkDefinition,
  FrameworkExecutionContext,
  FrameworkMethodology,
  FrameworkSelectionCriteria,
  FrameworkStateInfo,
  FrameworkSwitchingConfig,
  IMethodologyGuide,
  IntegratedAnalysisResult,
} from '../frameworks/types/index.js';

// Versioning system types
export type {
  VersioningConfig,
  VersionEntry,
  HistoryFile,
  SaveVersionResult,
  RollbackResult,
  SaveVersionOptions,
} from '../versioning/types.js';
export { DEFAULT_VERSIONING_CONFIG } from '../versioning/types.js';

// ===== Additional System Types =====

// Conversation History Types
export interface ConversationHistoryItem {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  isProcessedTemplate?: boolean; // Flag to indicate if this is a processed template rather than original user input
}

// API Response Types
export interface ApiResponse {
  success: boolean;
  message: string;
  data?: unknown;
}

export interface ToolResponse {
  content: Array<{
    type: 'text';
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
  // Runtime metadata used when the active file is regenerated from framework state
  activeFramework?: string;
  activeMethodology?: string;
  generatedFrom?: 'fallback' | 'legacy' | 'defaults' | string;
  generatedAt?: string;
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
  DEBUG = 'DEBUG',
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR',
}

export enum TransportType {
  STDIO = 'stdio',
  SSE = 'sse',
}

export enum StepStatus {
  PENDING = 'pending',
  RUNNING = 'running',
  COMPLETED = 'completed',
  FAILED = 'failed',
  SKIPPED = 'skipped',
}

// ===== MCP Error Codes for Structured Response Contract =====

/**
 * Standardized error codes for MCP tool responses.
 * Enables programmatic error routing in client hooks.
 */
export enum McpErrorCode {
  /** Gate verdict is required to continue chain execution */
  GATE_VERDICT_REQUIRED = 'GATE_VERDICT_REQUIRED',
  /** Maximum gate retry attempts have been exceeded */
  GATE_RETRY_EXCEEDED = 'GATE_RETRY_EXCEEDED',
  /** Response content blocked due to gate failure with blockResponseOnFail */
  GATE_RESPONSE_BLOCKED = 'GATE_RESPONSE_BLOCKED',
  /** Chain session not found for the provided chain_id */
  CHAIN_SESSION_NOT_FOUND = 'CHAIN_SESSION_NOT_FOUND',
  /** Framework is disabled but framework-specific operation was requested */
  FRAMEWORK_DISABLED = 'FRAMEWORK_DISABLED',
  /** Prompt not found in registry */
  PROMPT_NOT_FOUND = 'PROMPT_NOT_FOUND',
  /** Invalid gate verdict format */
  INVALID_GATE_VERDICT = 'INVALID_GATE_VERDICT',
}

/**
 * Gate retry information for structured responses.
 * Provides clients with retry state for implementing retry logic.
 */
export interface GateRetryInfo {
  /** Maximum number of retry attempts allowed */
  maxAttempts: number;
  /** Current attempt number (1-indexed) */
  currentAttempt: number;
  /** Whether more retries are allowed */
  retryAllowed: boolean;
}

/**
 * Extended gate validation info for structured responses.
 * Provides explicit fields for client hook consumption.
 */
export interface GateValidationInfo {
  /** Whether gate validation is enabled */
  enabled: boolean;
  /** Whether all gates passed */
  passed: boolean;
  /** Total number of gates evaluated */
  totalGates: number;
  /** Gates that failed with reasons */
  failedGates: Array<{ id: string; reason: string }>;
  /** Gates that passed (optional, for debugging) */
  passedGates?: Array<{ id: string }>;
  /** Gate evaluation execution time in ms */
  executionTime: number;
  /** Legacy retry count field */
  retryCount?: number;

  // ===== New Fields for Structured Response Contract =====

  /** Gate IDs awaiting verdict from client */
  pendingGateIds: string[];
  /** Whether client must provide gate_verdict to proceed */
  requiresGateVerdict: boolean;
  /** Whether response content was suppressed due to gate failure */
  responseBlocked: boolean;
  /** Detailed retry information for client retry logic */
  gateRetryInfo: GateRetryInfo;
}

// ===== End of Consolidated Type Definitions =====
// Types are now organized by domain for better maintainability:
// - Core types: ../types.js
// - Prompt types: ../prompts/types.js
// - Execution types: ../execution/types.js
// - Gate types: ../gates/types.js
// - Framework types: ../frameworks/types/index.js
