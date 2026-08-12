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

import type { StateStoreOptions } from './persistence.js';

export type { StateStoreOptions, StateStore, DatabasePort, ToolIndexEntry } from './persistence.js';
export type { McpToolRequest } from './execution.js';

// ConfigManager interface (cross-cutting: consumed by modules/, mcp/, engine/)
export type { ConfigManager } from './config-manager.js';

// Metrics types and MetricsCollector interface (cross-cutting: engine + mcp + infra)
export * from './metrics.js';

// Injection control types and defaults (cross-cutting: infra/config + engine/injection)
export * from './injection.js';

// Chain session types (cross-cutting: engine + modules + mcp)
export {
  type ChainSession,
  type ChainSessionLifecycle,
  type ChainSessionLookupOptions,
  type ChainSessionService,
  type ChainSessionSummary,
  type GateReviewOutcomeUpdate,
  type ParsedCommandSnapshot,
  type SessionBlueprint,
} from './chain-session.js';

// Chain execution types (cross-cutting: engine + modules + mcp)
export {
  type StepMetadata,
  type GateReviewHistoryEntry,
  type GateReviewExecutionContext,
  type GateReviewPrompt,
  type PendingGateReview,
  type FormatterExecutionContext,
  type ChainNode,
  type ChainState,
} from './chain-execution.js';

// Core configuration and protocol types (canonical source: ./core-config.ts)
// Also import locally for use by interfaces defined in this file
import type {
  ConfirmationRequired,
  ToolTriggerFilterResult,
  LoadedScriptTool,
  ScriptExecutionRequest,
  ScriptExecutionResult,
  ToolDetectionMatch,
} from './automation.js';
import type { ContentAnalysisResult } from './core-config.js';

export type {
  AdvancedConfig,
  AnalysisConfig,
  BaseMessageContent,
  ChainSessionConfig,
  Config,
  ExecutionConfig,
  FrameworkInjectionConfig,
  ResolvedFrameworkConfig,
  LLMIntegrationConfig,
  LLMProvider,
  LoggingConfig,
  Message,
  MessageContent,
  MessageRole,
  FrameworkSettings,
  PromptsConfig,
  ResourcesConfig,
  SemanticAnalysisConfig,
  ServerConfig,
  TextMessageContent,
  ToolDescriptionsOptions,
  TransportMode,
  VerificationConfig,
  VersioningConfig,
  ContentAnalysisResult,
  ExecutionStrategyType,
  ExecutionModifier,
  ExecutionModifiers,
  ExecutionPlan,
  GateSystemSettings,
  ClientFamily,
  DelegationProfile,
  IdentityLaunchDefaults,
  IdentityPolicyMode,
  TelemetryMode,
  TelemetryAttributePolicy,
  TelemetryConfig,
} from './core-config.js';
export { DEFAULT_VERSIONING_CONFIG, DEFAULT_TELEMETRY_CONFIG } from './core-config.js';

// Request identity types (workspace/organization scoping)
export type {
  RequestClientProfile,
  RequestClientProfileSource,
  RequestIdentity,
  RequestIdentityContext,
  RequestIdentityLaunchProfile,
  RequestIdentityProvenance,
  RequestIdentitySource,
  RequestIdentityTransport,
} from './request-identity.js';

// ===== Prompt Argument Contract Type =====
// Moved from modules/prompts/types.ts — consumed by shared/utils/jsonUtils.ts and engine/.

/**
 * Prompt argument definition (cross-layer contract type).
 */
export interface PromptArgument {
  /** Name of the argument */
  name: string;
  /** Optional description of the argument */
  description?: string;
  /** Whether this argument is required */
  required: boolean;
  /** Type of the argument value */
  type?: 'string' | 'number' | 'boolean' | 'object' | 'array';
  /** Default value if not provided */
  defaultValue?: string | number | boolean | null | object | Array<any>;
  /** Validation rules for the argument */
  validation?: {
    /** Regex pattern for string validation */
    pattern?: string;
    /** Minimum length for strings */
    minLength?: number;
    /** Maximum length for strings */
    maxLength?: number;
    /**
     * @deprecated Enforcement was dropped in v3.0.0 — the LLM handles semantic variation
     * better than a strict enum. The field is still accepted and parsed; argument-schema.ts
     * deliberately never applies it.
     */
    allowedValues?: Array<string | number | boolean>;
  };
}

// GatesConfig (shared-layer) re-exported from core-config as GateSystemSettings.
// Aliased here for backward compatibility.
export { type GateSystemSettings as GatesConfig } from './core-config.js';

// ContentAnalysisResult is now exported from ./core-config.js above.

// VersioningConfig and DEFAULT_VERSIONING_CONFIG are now exported from ./core-config.js above.

// ===== Additional System Types =====

// Conversation History Types
export interface ConversationHistoryItem {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  isProcessedTemplate?: boolean; // Flag to indicate if this is a processed template rather than original user input
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
    frameworks?: Record<string, string>;
    frameworkParameters?: Record<string, Record<string, ToolParameter | string>>;
  };
}

export interface ToolDescriptionsConfig {
  version: string;
  lastUpdated?: string;
  tools: Record<string, ToolDescription>;
  // Runtime metadata used when the active file is regenerated from framework state.
  // These two are not duplicates: overlays are registered under both a framework's id and its
  // type, so lookup prefers the type and falls back to the id (`activeFrameworkType ?? activeFramework`).
  /** Active framework's id (e.g. 'cageerf'). */
  activeFramework?: string;
  /** Active framework's type (e.g. 'CAGEERF'). Preferred overlay lookup key. */
  activeFrameworkType?: string;
  generatedFrom?: 'fallback' | 'legacy' | 'defaults' | string;
  generatedAt?: string;
}

// ===== Logger Interface =====
// Defined here (Layer 0) so all layers can import without cross-layer violations.
// infra/logging/ implements this interface; modules/ and mcp/ consume it.

/**
 * Logger interface for dependency injection across all layers.
 */
export interface Logger {
  info: (message: string, ...args: any[]) => void;
  error: (message: string, ...args: any[]) => void;
  warn: (message: string, ...args: any[]) => void;
  debug: (message: string, ...args: any[]) => void;
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

// ===== HTTP API Contract Type =====
// Minimal interface for ApiRouter consumed by infra/http/. Concrete class lives in mcp/http/.

/**
 * Minimal API manager interface for HTTP server bootstrapping.
 * infra/http imports this interface; mcp/http provides the concrete class.
 */
export interface ApiRouterPort {
  /** Create an Express-compatible application for HTTP transport */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Express Application type not available in shared layer
  createApp(): any;
}

// ===== Resource Change Tracking Contract Types =====
// Moved from infra/observability/tracking/ — consumed by mcp/ and infra/.

/** Source of a resource change event */
export type ChangeSource = 'filesystem' | 'mcp-tool' | 'external';

/** Type of tracked resource */
export type TrackedResourceType = 'prompt' | 'gate';

// Automation/script-tool types (cross-layer: engine + modules)
export * from './automation.js';

// ===== Prompt Gate Definition Contract Type =====
// Moved from modules/prompts/types.ts — consumed by engine/execution/types.ts (ConvertedPrompt.gates).

/**
 * Gate definition for prompt-level gate configuration (cross-layer contract type).
 */
export interface GateDefinition {
  id: string;
  name: string;
  type: 'validation' | 'guidance';
  requirements: any[];
  failureAction: 'stop' | 'retry' | 'skip' | 'rollback';
  retryPolicy?: {
    maxRetries: number;
    retryDelay: number;
  };
}

// ===== Cross-Layer Service Interfaces =====
// Minimal interfaces for engine/ pipeline stages to depend on without importing
// concrete classes from modules/ or mcp/. Concrete implementations `implements` these.

/**
 * Semantic content analyzer interface (engine/ contract).
 * Concrete: modules/semantic/content-analyzer.ts ContentAnalyzer
 */
export interface ContentAnalyzerPort {
  analyzePrompt(prompt: unknown): Promise<ContentAnalysisResult>;
}

/**
 * Style manager interface (engine/ contract).
 * Concrete: modules/formatting/style-manager.ts StyleManager
 */
export interface StyleManagerPort {
  listStyles(): string[];
  getStyle(styleId: string): { name?: string; description?: string } | undefined;
  getStyleGuidance(styleId: string): string | null;
}

/**
 * Tool detection service interface (engine/ contract).
 * Concrete: modules/automation/detection/tool-detection-service.ts ToolDetectionService
 */
export interface ToolDetectionServicePort {
  detectTools(
    input: string,
    args: Record<string, unknown>,
    availableTools: LoadedScriptTool[]
  ): ToolDetectionMatch[];
}

/**
 * Execution mode service interface (engine/ contract).
 * Concrete: modules/automation/execution/tool-trigger-filter.ts ToolTriggerFilter
 */
/** Matches split by whether the tool opts into validation-gated auto-approval. */
export interface ToolAutoApprovePartition {
  /** Tools declaring `execution.autoApproveOnValid` — approved by their own validation output. */
  readonly autoApprove: ToolDetectionMatch[];
  /** Everything else, which goes through the trigger/confirm partition. */
  readonly normal: ToolDetectionMatch[];
}

export interface ToolTriggerFilterPort {
  partitionAutoApprove(
    matches: ToolDetectionMatch[],
    tools: LoadedScriptTool[]
  ): ToolAutoApprovePartition;
  filterByTrigger(
    matches: ToolDetectionMatch[],
    tools: LoadedScriptTool[],
    promptId: string
  ): ToolTriggerFilterResult;
  buildConfirmationResponse(
    filterResult: ToolTriggerFilterResult,
    promptId: string
  ): ConfirmationRequired;
  logManualOverride(toolId: string): void;
}

/**
 * Script executor interface (engine/ contract).
 * Concrete: modules/automation/execution/script-executor.ts ScriptExecutor
 */
export interface ScriptExecutorPort {
  execute(request: ScriptExecutionRequest, tool: LoadedScriptTool): Promise<ScriptExecutionResult>;
}

/**
 * Response formatter interface (engine/ contract).
 * Concrete: mcp/tools/prompt-engine/processors/response-formatter.ts ResponseFormatter
 */
export interface ResponseFormatterPort {
  formatPromptEngineResponse(
    response: unknown,
    executionContext?: unknown,
    options?: unknown,
    gateResults?: unknown
  ): ToolResponse;
}

/**
 * Chain management service interface (engine/ contract).
 * Concrete: mcp/tools/prompt-engine/core/chain-management.ts ChainSessionRouter
 */
export interface ChainSessionRouterPort {
  tryHandleCommand(command: string, scope?: StateStoreOptions): Promise<ToolResponse | null>;
}

/**
 * Lightweight hook execution context for pipeline emissions.
 * `infra/hooks` aliases this as `HookExecutionContext` — the hook-author-facing
 * name — rather than redeclaring the shape, so the two cannot drift.
 */
export interface PipelineHookContext {
  readonly executionId: string;
  readonly executionType: 'single' | 'chain';
  readonly chainId?: string;
  readonly currentStep?: number;
  readonly frameworkEnabled: boolean;
  readonly frameworkId?: string;
}

/**
 * Outcome passed to gate hook callbacks.
 *
 * Distinct from `engine/gates` `GateEvaluationResult` (requirement-level detail):
 * this is the whole-gate verdict a hook observer sees.
 */
export interface GateHookEvaluationResult {
  /** Whether the gate passed */
  readonly passed: boolean;
  /** Reason for pass/fail */
  readonly reason?: string;
  /** Whether this gate has blockResponseOnFail enabled */
  readonly blocksResponse: boolean;
}

/**
 * Hook registry interface (mcp/ contract).
 * mcp/ stores and forwards to engine/ pipeline stages.
 * Concrete: infra/hooks/hook-registry.ts HookRegistry
 *
 * The gate emissions belong here, not only on the concrete class: `engine/gates`
 * receives the registry as this port and calls them. Declaring only the stage
 * hooks meant the sole caller had to cast the port back to the concrete type,
 * which type-checks between object types with no overlap and would have degraded
 * to a caught TypeError for any implementation that is not `HookRegistry`.
 */
export interface HookRegistryPort {
  getCounts(): { pipeline: number; gate: number; chain: number };
  clearAll(): void;
  emitBeforeStage(stage: string, context: PipelineHookContext): Promise<void>;
  emitAfterStage(stage: string, context: PipelineHookContext): Promise<void>;
  emitStageError(stage: string, error: Error, context: PipelineHookContext): Promise<void>;
  emitGateEvaluated(
    gate: GateDefinition,
    result: GateHookEvaluationResult,
    context: PipelineHookContext
  ): Promise<void>;
  emitGateFailed(gate: GateDefinition, reason: string, context: PipelineHookContext): Promise<void>;
  emitRetryExhausted(
    gateIds: string[],
    chainId: string,
    context: PipelineHookContext
  ): Promise<void>;
  emitResponseBlocked(gateIds: string[], context: PipelineHookContext): Promise<void>;
}

/** Gate failure notification payload. */
export interface GateFailedNotification {
  /** Gate ID that failed */
  gateId: string;
  /** Reason for failure */
  reason: string;
  /** Chain ID if this occurred during chain execution */
  chainId?: string;
  /** Step index where failure occurred */
  stepIndex?: number;
}

/** Response blocked notification payload. */
export interface ResponseBlockedNotification {
  /** Gate IDs that triggered the block */
  gateIds: string[];
  /** Chain ID if this occurred during chain execution */
  chainId?: string;
}

/** Retry exhausted notification payload. */
export interface RetryExhaustedNotification {
  /** Gate IDs that exhausted retries */
  gateIds: string[];
  /** Chain ID where this occurred */
  chainId: string;
  /** Maximum attempts that were allowed */
  maxAttempts: number;
}

/**
 * MCP notification emitter interface (mcp/ contract).
 * mcp/ stores and forwards to engine/ pipeline stages.
 * Concrete: infra/observability/notifications/mcp-notification-emitter.ts McpNotificationEmitter
 *
 * Carries the gate notifications for the same reason `HookRegistryPort` carries
 * the gate hooks — `engine/gates` holds the value as this port and emits them.
 */
export interface McpNotificationEmitterPort {
  canSend(): boolean;
  setServer(server: {
    notification(params: { method: string; params?: Record<string, unknown> }): void;
  }): void;
  emitGateFailed(notification: GateFailedNotification): void;
  emitResponseBlocked(notification: ResponseBlockedNotification): void;
  emitRetryExhausted(notification: RetryExhaustedNotification): void;
}

// ===== Hot Reload Types =====

/**
 * Hot reload event types
 */
export type HotReloadEventType =
  | 'prompt_changed'
  | 'config_changed'
  | 'category_changed'
  | 'framework_changed'
  | 'gate_changed'
  | 'reload_required';

/**
 * File change operation types for hot reload events
 */
export type FileChangeOperation = 'added' | 'modified' | 'removed';

/**
 * Hot reload event data
 */
export interface HotReloadEvent {
  type: HotReloadEventType;
  reason: string;
  affectedFiles: string[];
  category?: string;
  /** Framework ID for framework_changed events */
  frameworkId?: string;
  /** Gate ID for gate_changed events */
  gateId?: string;
  /** The type of file change (added, modified, removed) */
  changeType?: FileChangeOperation;
  timestamp: number;
  requiresFullReload: boolean;
}

// Execution plan types (ExecutionStrategyType, ExecutionModifier, ExecutionModifiers, ExecutionPlan)
// are now exported from ./core-config.js above.

// ===== Prompt Data Contract Types =====
// Moved from modules/prompts/types.ts — consumed by engine/execution/parsers and engine/execution/types.

/**
 * Gate configuration for prompts (YAML format)
 */
export interface PromptGateConfiguration {
  /** Gate IDs to include */
  include?: string[];
  /** Gate IDs to exclude */
  exclude?: string[];
  /** Whether to include framework gates (default: true) */
  framework_gates?: boolean;
  /** Inline gate definitions */
  inline_gate_definitions?: Array<{
    id?: string;
    name: string;
    type: string;
    scope?: 'execution' | 'session' | 'chain' | 'step';
    description?: string;
    guidance?: string;
    pass_criteria?: any[];
    expires_at?: number;
    source?: 'manual' | 'automatic' | 'analysis';
    context?: Record<string, any>;
  }>;
}

/**
 * Chain step definition (cross-layer contract type).
 *
 * Defines a single step in a chain workflow with support for:
 * - inputMapping: Map previous step results to semantic variable names
 * - outputMapping: Name this step's output for downstream reference
 * - retries: Per-step retry count for resilient chains
 */
export interface ChainStep {
  /** ID of the prompt to execute in this step */
  promptId: string;
  /** Name/identifier of this step */
  stepName: string;
  /**
   * Stable node identity (kebab-case), mirroring `ChainStepSchema.id` (P3 Tier 1). Optional —
   * defaults to a slug of `stepName` at mint time when omitted. Additive only; not yet consumed.
   */
  id?: string;
  /** Map step results to semantic names (e.g., { "research": "step1_result" }) */
  inputMapping?: Record<string, string>;
  /** Name this step's output for downstream steps */
  outputMapping?: Record<string, string>;
  /** Number of retry attempts on failure (default: 0) */
  retries?: number;
  /** Client-agnostic capability hint for delegation model selection (per-step override) */
  subagentModel?: 'heavy' | 'standard' | 'fast';
  /** Host agent to spawn for this step, overriding the prompt-level default */
  agentType?: string;
  /**
   * Framework this step runs under, overriding the run-wide selection. Resolved by
   * `12-framework-stage.ts`; an id the registry does not know falls back to the run-wide choice.
   */
  framework?: string;
}

/**
 * Complete prompt metadata structure (cross-layer contract type).
 */
export interface PromptData {
  /** Unique identifier for the prompt */
  id: string;
  /** Display name for the prompt */
  name: string;
  /** Category this prompt belongs to */
  category: string;
  /** Description of the prompt */
  description: string;
  /** Path to the prompt file */
  file: string;
  /** Arguments accepted by this prompt */
  arguments: PromptArgument[];
  /** Optional gates for validation (legacy format) */
  gates?: GateDefinition[];
  /** Gate configuration (YAML format) */
  gateConfiguration?: PromptGateConfiguration;
  /**
   * Prompt-level injection control, resolved between step and chain config.
   *
   * Referenced inline rather than through a top-level import: `./injection.js` is already
   * re-exported wholesale below, and adding a type import here would reorder an import group
   * this type has no stake in.
   */
  injection?: import('./injection.js').PromptInjectionConfig;
  /** Chain steps for multi-step execution (YAML format) */
  chainSteps?: ChainStep[];
  /** Whether to register this prompt with MCP. Overrides category default. */
  registerWithMcp?: boolean;
  /**
   * Behavior of the native MCP prompt surface when invoked as a slash command:
   * 'expand' returns plain template text; 'launch' returns a directive routing
   * the invocation through the prompt_engine pipeline (framework/gates/chains/
   * telemetry). Default: 'expand'. Overrides category default.
   */
  mcpPromptMode?: 'expand' | 'launch';
  /** Script tool IDs declared by this prompt (references tools/{id}/ directories) */
  tools?: string[];
  /** Client-agnostic capability hint for delegation model selection */
  subagentModel?: 'heavy' | 'standard' | 'fast';
  /** Default host agent for this prompt's delegated steps (a step may override it) */
  agentType?: string;
}

// ===== End of Type Definitions =====
