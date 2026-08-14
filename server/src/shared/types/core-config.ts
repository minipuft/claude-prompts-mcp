// @lifecycle canonical - Core configuration and protocol types.
/**
 * Core Config Types
 *
 * Contains configuration types, message types, and API/tool types
 * that are consumed across all architectural layers.
 *
 * IMPORTANT: This file must NOT import from ./index.js to avoid barrel cycles. That constraint is
 * the whole reason this module exists separately from the barrel: these types were split out of a
 * top-level aggregate so the aggregate and the barrel stopped importing each other. The aggregate
 * itself was deleted 2026-08-06 once it had no consumers left; the cycle it created is what this
 * file's independence still prevents.
 */

// ===== Prompt Configuration =====
// Moved from modules/prompts/types.ts — consumed by Config interface.

/**
 * Configuration for the prompts subsystem
 */
export interface PromptsConfig {
  /** Path to the prompts directory */
  directory: string;
  /** Global default for MCP registration. Category/prompt overrides take precedence. */
  registerWithMcp?: boolean;
}

// ===== Configuration Types =====

/**
 * Configuration for the server
 */
export interface ServerConfig {
  /** Name of the server */
  name: string;
  /** Version string in semver format */
  version: string;
  /** Port number to listen on (1024-65535) */
  port: number;
}

/**
 * Transport mode options
 * - 'stdio': Standard I/O transport for Claude Desktop/CLI (default)
 * - 'streamable-http': Streamable HTTP transport (MCP standard since 2025-03-26)
 * - 'both': Run STDIO and Streamable HTTP simultaneously
 */
export type TransportMode = 'stdio' | 'streamable-http' | 'both';

/**
 * LLM provider for semantic analysis
 */
export type LLMProvider = 'openai' | 'anthropic' | 'custom';

/**
 * LLM integration configuration
 */
export interface LLMIntegrationConfig {
  /** Whether LLM integration is enabled */
  enabled: boolean;
  /** API key for the LLM provider */
  apiKey: string | null;
  /** Custom endpoint URL for the LLM provider (provider auto-detected from URL) */
  endpoint: string | null;
  /** Model name to use */
  model: string;
  /** Maximum tokens for analysis requests */
  maxTokens: number;
  /** Temperature for analysis requests */
  temperature: number;
}

/**
 * Semantic analysis configuration
 */
export interface SemanticAnalysisConfig {
  /** LLM integration configuration */
  llmIntegration: LLMIntegrationConfig;
}

/**
 * Analysis system configuration
 */
export interface AnalysisConfig {
  /** Semantic analysis configuration */
  semanticAnalysis: SemanticAnalysisConfig;
}

/**
 * Logging system configuration
 */
export interface LoggingConfig {
  /** Directory to write log files to */
  directory: string;
  /** Log level: debug, info, warn, error */
  level: string;
}

/**
 * Tool descriptions configuration options
 */
export interface ToolDescriptionsOptions {
  /** Whether to restart server when tool descriptions change */
  restartOnChange?: boolean;
}

/**
 * Injection target: where content is injected during chain execution.
 * - 'steps': Normal step execution only
 * - 'gates': Gate review steps only
 * - 'both': Both step execution and gate reviews
 */
export type InjectionTargetConfig = 'steps' | 'gates' | 'both';

/**
 * Injection configuration for framework-driven content
 */
export interface FrameworkInjectionConfig {
  /** System prompt injection settings */
  systemPrompt?: {
    enabled: boolean;
    /** Inject every N steps (default: 2) */
    frequency?: number;
    /** Where to inject: 'steps', 'gates', or 'both' (default: 'steps') */
    target?: InjectionTargetConfig;
  };
  /** Gate guidance injection settings */
  gateGuidance?: {
    /** Inject gate criteria every N steps. 0 = first-only (default: 0) */
    frequency?: number;
    /** Where to inject: 'steps', 'gates', or 'both' (default: 'both') */
    target?: InjectionTargetConfig;
  };
  /** Style guidance injection settings */
  styleGuidance?: {
    enabled?: boolean;
    /** Inject style guidance every N steps. 0 = first-only (default: 0) */
    frequency?: number;
    /** Where to inject: 'steps', 'gates', or 'both' (default: 'steps') */
    target?: InjectionTargetConfig;
  };
}

/**
 * Configuration toggles for framework-driven features
 */
export interface ResolvedFrameworkConfig {
  /** Enable dynamic tool descriptions per framework */
  dynamicToolDescriptions: boolean;
  /**
   * Framework a scope falls back to when it has no persisted state row.
   * Set per project to pin a repo to one framework. This is the floor: a runtime
   * `system_control framework:switch` overrides it for that scope and persists.
   */
  defaultFramework: string;
  /** Injection control for framework content */
  injection?: FrameworkInjectionConfig;
}

/**
 * Configuration for execution strategies
 */
export interface ExecutionConfig {
  /** Enable judge mode (LLM-driven step selection) */
  judge?: boolean;
}

/**
 * Complete application configuration
 */
export interface ChainSessionConfig {
  /** Minutes before idle chain sessions expire */
  sessionTimeoutMinutes: number;
  /** Minutes before pending gate reviews expire */
  reviewTimeoutMinutes: number;
  /** Minutes between background cleanup sweeps */
  cleanupIntervalMinutes: number;
}

/**
 * Unified gate system settings (shared-layer contract).
 * enabled is required (defaults applied by ConfigManager).
 */
export interface GateSystemSettings {
  /** Enable/disable the gate subsystem entirely */
  enabled: boolean;
  /** Directory containing gate definitions (e.g., 'gates' for server/gates/{id}/) */
  definitionsDirectory?: string;
  /** Enable framework-specific gates (auto-added based on active framework) */
  enableFrameworkGates?: boolean;
}

/**
 * Configuration for gates subsystem (top-level config.json shape)
 */
export interface GatesConfig {
  /** Directory containing gate definitions (e.g., 'gates' for server/gates/{id}/) */
  definitionsDirectory?: string;
  /** New-style: directory path */
  directory?: string;
  /** Enable/disable the gate subsystem entirely */
  enabled?: boolean;
  /**
   * Resolved internal spelling. `ConfigManager` folds the config.json key into this, so
   * consumers read only this field and never the wire key below.
   */
  enableFrameworkGates?: boolean;
  /** config.json key: enable framework-specific quality gates */
  frameworkGates?: boolean;
  /** Judge evaluation defaults — gates with `evaluation.mode: 'judge'` use context-isolated review */
  evaluation?: {
    defaultMode?: 'self' | 'judge';
    defaultModel?: string;
    strict?: boolean;
  };
}

/**
 * Configuration for phase guard enforcement.
 * Controls deterministic structural validation of LLM output against framework phase markers.
 */
export interface PhaseGuardsConfig {
  /** Enforcement mode: 'enforce' creates pending gate review, 'warn' logs warning, 'off' disables */
  mode: 'enforce' | 'warn' | 'off';
  /** Maximum retry attempts before falling back to warn (enforce mode only) */
  maxRetries: number;
}

/**
 * New-style frameworks configuration (replaces frameworks)
 */
export interface FrameworkSettings {
  /** Enable framework system */
  enabled?: boolean;
  /** Adapt MCP tool descriptions based on active framework */
  dynamicToolDescriptions?: boolean;
  /** Framework a scope falls back to with no persisted state (default: 'CAGEERF') */
  defaultFramework?: string;
  /** Inject framework guidance every N chain steps (default: 2) */
  systemPromptFrequency?: number;
  /** Where to inject system prompt: 'steps', 'gates', or 'both' (default: 'steps') */
  systemPromptTarget?: InjectionTargetConfig;
  /** Inject gate criteria every N steps. 0 = first-only (default: 0) */
  gateGuidanceFrequency?: number;
  /** Where to inject gate guidance: 'steps', 'gates', or 'both' (default: 'both') */
  gateGuidanceTarget?: InjectionTargetConfig;
  /** Include response formatting guidance (true/false, or object for granular control) */
  styleGuidance?: boolean;
  /** Inject style guidance every N steps. 0 = first-only (default: 0) */
  styleGuidanceFrequency?: number;
  /** Where to inject style guidance: 'steps', 'gates', or 'both' (default: 'steps') */
  styleGuidanceTarget?: InjectionTargetConfig;
}

/**
 * Verification (Ralph Loops) configuration
 */
export interface VerificationConfig {
  /** Fix attempts within current context before spawning isolation */
  inContextAttempts?: number;
  /** Context isolation settings */
  isolation?: {
    enabled?: boolean;
    maxBudget?: number;
    timeout?: number;
    permissionMode?: 'delegate' | 'ask' | 'deny';
  };
}

/**
 * Advanced settings (internal/rarely-changed)
 */
export interface AdvancedConfig {
  sessions?: {
    timeoutMinutes?: number;
    reviewTimeoutMinutes?: number;
    cleanupIntervalMinutes?: number;
  };
}

/**
 * MCP Resources configuration
 */
export interface ResourcesConfig {
  /** Master switch: register resources with MCP (default: false) */
  registerWithMcp?: boolean;
  prompts?: { enabled?: boolean };
  gates?: { enabled?: boolean };
  frameworks?: { enabled?: boolean };
  observability?: {
    enabled?: boolean;
    sessions?: boolean;
    metrics?: boolean;
  };
  logs?: {
    enabled?: boolean;
    maxEntries?: number;
    defaultLevel?: 'error' | 'warn' | 'info' | 'debug';
  };
}

/**
 * Configuration for versioning behavior
 */
export interface VersioningConfig {
  /** Enable/disable version tracking globally */
  enabled: boolean;
  /** Maximum versions to retain per resource (FIFO pruning) */
  max_versions: number;
  /** Auto-save version on updates (can be overridden per-call) */
  auto_version: boolean;
}

/**
 * Default versioning configuration
 */
export const DEFAULT_VERSIONING_CONFIG: VersioningConfig = {
  enabled: true,
  max_versions: 50,
  auto_version: true,
};

// ===== Telemetry Configuration Types =====

/**
 * Telemetry export mode.
 * - 'off': Telemetry disabled (no SDK initialized)
 * - 'traces': Span/event emission only
 * - 'full': Spans + OTel metrics export
 */
export type TelemetryMode = 'off' | 'traces' | 'full';

/**
 * Attribute policy for telemetry data safety.
 * Controls which attributes are included in trace spans and events.
 * Enforces acceptance criteria: no raw payload data in default telemetry.
 */
export interface TelemetryAttributePolicy {
  /** Include safe business-context attributes in traces (default: true) */
  businessContext?: boolean;
  /** Include raw command text in traces (default: false — redacted for safety) */
  rawCommands?: boolean;
  /** Include raw user responses in traces (default: false — redacted for safety) */
  rawResponses?: boolean;
  /** Custom attribute allowlist — trace attribute names to explicitly include */
  allowlist?: string[];
}

/**
 * Configuration for OpenTelemetry-based observability.
 * Separate from resources.observability (MCP resource toggles).
 */
export interface TelemetryConfig {
  /** Master switch for telemetry subsystem (default: false) */
  enabled: boolean;
  /** Export mode: 'off', 'traces', or 'full' (default: 'off') */
  mode: TelemetryMode;
  /** OTLP HTTP exporter endpoint (default: 'http://localhost:4318') */
  exporterEndpoint: string;
  /** Head sampling rate for traces, 0.0–1.0 (default: 1.0 = sample everything) */
  samplingRate: number;
  /** Attribute policy for data safety enforcement */
  attributePolicy: TelemetryAttributePolicy;
}

/**
 * Default telemetry configuration — disabled, safe defaults.
 */
export const DEFAULT_TELEMETRY_CONFIG: TelemetryConfig = {
  enabled: false,
  mode: 'off',
  exporterEndpoint: 'http://localhost:4318',
  samplingRate: 1.0,
  attributePolicy: {
    businessContext: true,
    rawCommands: false,
    rawResponses: false,
  },
};

// ===== Identity & Scope Types =====

/**
 * Identity policy mode for request scoping.
 * - 'permissive': Accept per-request identity overrides from tokens/headers
 * - 'locked': Enforce launch defaults, reject overrides
 */
export type IdentityPolicyMode = 'permissive' | 'locked';

/**
 * Client family classification used for delegation strategy routing.
 */
export type ClientFamily = 'claude-code' | 'codex' | 'gemini' | 'opencode' | 'cursor' | 'unknown';

/**
 * Delegation rendering profile resolved from client identity.
 */
export type DelegationProfile =
  | 'task_tool_v1'
  | 'spawn_agent_v1'
  | 'gemini_subagent_v1'
  | 'opencode_agent_v1'
  | 'cursor_agent_v1'
  | 'neutral_v1';

/**
 * Launch-time identity defaults for workspace/organization scoping.
 * Set via CLI flags or config; used as fallback when request lacks identity claims.
 */
export interface IdentityLaunchDefaults {
  organizationId?: string;
  workspaceId?: string;
  /** Optional launch-level client routing hint. */
  clientFamily?: ClientFamily;
  /** Optional launch-level client identifier override (e.g., 'claude-code'). */
  clientId?: string;
  /** Optional launch-level client version hint. */
  clientVersion?: string;
  /** Optional launch-level delegation profile override. */
  delegationProfile?: DelegationProfile;
}

export interface Config {
  /** Server configuration */
  server: ServerConfig;
  /** Prompts subsystem configuration */
  prompts: PromptsConfig;
  /** Analysis system configuration */
  analysis?: AnalysisConfig;
  /** Gates system configuration (quality validation) */
  gates?: GatesConfig;
  /** Phase guard enforcement for framework structural validation */
  phaseGuards?: PhaseGuardsConfig;
  /** Execution strategy configuration (judge mode, etc.) */
  execution?: ExecutionConfig;
  /** Framework feature configuration (injection, tool descriptions) - LEGACY */
  /** New-style: Framework configuration */
  frameworks?: FrameworkSettings;
  /** Chain session lifecycle configuration - LEGACY */
  chainSessions?: ChainSessionConfig;
  /**
   * Transport mode: 'stdio' (default), 'streamable-http', or 'both'
   * STDIO is used by Claude Desktop/CLI, Streamable HTTP for web clients
   */
  transport?: TransportMode;
  /** Logging configuration */
  logging?: LoggingConfig;
  /** Tool descriptions configuration */
  toolDescriptions?: ToolDescriptionsOptions;
  /** Version history configuration for resources */
  versioning?: VersioningConfig;
  /** New-style: Verification (Ralph Loops) configuration */
  verification?: VerificationConfig;
  /** New-style: Advanced internal settings */
  advanced?: AdvancedConfig;
  /** MCP Resources configuration */
  resources?: ResourcesConfig;

  /** OpenTelemetry observability configuration (tracing, metrics, attribute policy) */
  telemetry?: TelemetryConfig;

  /** Identity and workspace scoping configuration */
  identity?: {
    /** Policy mode: 'permissive' (accept overrides) or 'locked' (enforce defaults) */
    mode?: IdentityPolicyMode;
    /** Allow per-request identity overrides from tokens/headers (default: true) */
    allowPerRequestOverride?: boolean;
    /** Launch-time identity defaults for workspace/organization scoping */
    launchDefaults?: IdentityLaunchDefaults;
  };
}

// ===== Message Types =====

/**
 * Base interface for message content
 */
export interface BaseMessageContent {
  /** Type discriminator for the content */
  type: string;
}

/**
 * Text message content
 */
export interface TextMessageContent extends BaseMessageContent {
  /** Type discriminator set to "text" */
  type: 'text';
  /** The text content */
  text: string;
}

/**
 * Types of message content supported by the system
 */
export type MessageContent = TextMessageContent;

/**
 * Role types for messages
 */
export type MessageRole = 'user' | 'assistant' | 'system';

/**
 * A message in a conversation
 */
export interface Message {
  /** Role of the message sender */
  role: MessageRole;
  /** Content of the message */
  content: MessageContent;
}

// ===== Semantic Analysis Contract Type =====
// Moved from shared/types/index.ts to break barrel cycles.

/**
 * Semantic analysis result (cross-layer contract type).
 * The concrete ContentAnalyzer in modules/semantic/ produces this.
 */
export interface ContentAnalysisResult {
  executionType: 'single' | 'chain';
  requiresExecution: boolean;
  requiresFramework: boolean;
  confidence: number;
  reasoning: string[];
  capabilities: {
    canDetectStructure: boolean;
    canAnalyzeComplexity: boolean;
    canRecommendFramework: boolean;
    hasSemanticUnderstanding: boolean;
  };
  limitations: string[];
  warnings: string[];
  executionCharacteristics: {
    hasConditionals: boolean;
    hasLoops: boolean;
    hasChainSteps: boolean;
    argumentCount: number;
    templateComplexity: number;
    hasSystemMessage: boolean;
    hasUserTemplate: boolean;
    hasStructuredReasoning: boolean;
    hasFrameworkKeywords: boolean;
    hasComplexAnalysis: boolean;
    advancedChainFeatures?: {
      hasDependencies: boolean;
      hasParallelSteps: boolean;
      hasAdvancedStepTypes: boolean;
      hasAdvancedErrorHandling: boolean;
      hasStepConfigurations: boolean;
      hasCustomTimeouts: boolean;
      requiresAdvancedExecution: boolean;
      complexityScore: number;
    };
  };
  complexity: 'low' | 'medium' | 'high';
  suggestedGates: string[];
  frameworkRecommendation: {
    shouldUseFramework: boolean;
    reasoning: string[];
    confidence: number;
    requiresUserChoice?: boolean;
    availableFrameworks?: string[];
  };
  analysisMetadata: {
    version: string;
    /**
     * Analysis mode. `ContentAnalyzer` is the sole producer and emits only `'minimal'`, so the
     * union has one member. This is narrower than the consumer-facing `analysisMode` string in
     * `resource-manager/prompt/core/types.ts`, which additionally carries `'fallback'` and
     * `'disabled'` from paths that never set this field.
     */
    mode?: 'minimal';
    analysisTime: number;
    analyzer: 'content';
    cacheHit: boolean;
    fallbackUsed?: boolean;
    hooksUsed?: boolean;
  };
}

// ===== Execution Plan Contract Types =====
// Moved from shared/types/index.ts to break barrel cycles.

/**
 * Execution strategy type enumeration (cross-layer contract type).
 */
export type ExecutionStrategyType = 'single' | 'chain';

/**
 * Execution modifier identifiers (cross-layer contract type).
 */
export type ExecutionModifier = 'clean' | 'judge' | 'lean' | 'framework';

/**
 * Execution modifiers control pipeline behavior (cross-layer contract type).
 * - clean: Skip all injection (system-prompt, gate-guidance, style-guidance)
 * - judge: Trigger judge selection phase for resource menu (%judge in command)
 * - lean: Skip system-prompt and style-guidance, keep gate-guidance only
 * - framework: Force framework injection
 */
export interface ExecutionModifiers {
  clean?: boolean;
  /** Triggers judge selection phase. Use %judge in command. */
  judge?: boolean;
  lean?: boolean;
  framework?: boolean;
}

/**
 * Execution plan generated by the ExecutionPlanner (cross-layer contract type).
 * Contains strategy, gate configuration, and execution requirements.
 */
export interface ExecutionPlan {
  strategy: ExecutionStrategyType;
  gates: string[];
  requiresFramework: boolean;
  requiresSession: boolean;
  category?: string;
  modifiers?: ExecutionModifiers;
  /** Semantic analysis result from planning phase (for resource-driven guidance) */
  semanticAnalysis?: ContentAnalysisResult;
}
