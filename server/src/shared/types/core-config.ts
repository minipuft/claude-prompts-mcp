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

// The delegation evidence mode's ONE definition lives with the contract that reads it, so the
// config shape and the resolver cannot drift into two spellings of the same union. Type-only,
// like `execution.ts`'s `#modules/workflow-ir` import — no value crosses the layer.
import type { HandoffEvidenceMode } from './handoff-evidence.js';

// ===== Prompt Configuration =====
// Moved from modules/prompts/types.ts — consumed by Config interface.

/**
 * Configuration for the prompts subsystem
 */
export interface PromptsConfig {
  /** Path to the prompts directory */
  directory: string;
  /** Global default for MCP registration. Category/prompt overrides take precedence. */
  registerWithMcp: boolean;
}

/**
 * The prompts section every reader gets when config.json says nothing.
 *
 * Lives here, in Layer 0, rather than inside `ConfigManager`, for the same reason
 * {@link DEFAULT_GATES_CONFIG} does: two layers read it. `infra/config` resolves the section with
 * it at load time, and `modules/prompts/converter.ts` falls back to `registerWithMcp` when a
 * `PromptConverter` is constructed without a config manager at all (test harnesses). While the
 * converter carried its own `true` literal, the loader could not report `prompts.registerWithMcp`
 * as a resolved default — the effective value lived three layers below the config surface.
 */
export const DEFAULT_PROMPTS_CONFIG: PromptsConfig = {
  directory: 'resources/prompts',
  registerWithMcp: true,
};

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
  judge: boolean;
  /** Delegated-step (`==>`) handoff settings. */
  delegation?: {
    /**
     * What the server does when a delegated step's resume does not carry the brief's
     * `HANDOFF RESULT` trailer. `required` (the default when unset) refuses the resume naming
     * the node; `advisory` accepts it. Either way the reason is recorded on the step's
     * execution record. Resolved through `resolveHandoffEvidenceMode`, never read raw.
     */
    evidence?: HandoffEvidenceMode;
  };
}

/**
 * Complete application configuration
 */
export interface ChainSessionConfig {
  /** Minutes before idle chain sessions expire */
  timeoutMinutes: number;
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
  /** Enable framework-specific gates (auto-added based on active framework) */
  enableFrameworkGates?: boolean;
  /** Execute a prompt's `inline_gate_definitions` instead of only displaying them; default `false`. Retirement contract on the `GatesConfig` field below. */
  executeInlineGateDefinitions?: boolean;
  /** Reminder subjects this installation's harness already covers; a reminder gate whose `subject` is listed is not rendered (checks are never suppressed) */
  harnessCovers?: string[];
  /** Estimated tokens of reminder guidance rendered per dispatch; reminders over budget render as one line each, in priority order */
  reminderTokenBudget?: number;
}

/**
 * The gate settings every reader gets when config.json says nothing.
 *
 * Lives here, in Layer 0, rather than inside `ConfigManager`, because two layers read it:
 * `infra/config` folds it into `getGatesConfig()`, and `GateGuidanceRenderer` (engine) needs the
 * same values when it is constructed without a config provider — a test harness, or a render path
 * that predates wiring. While this was module-private to `ConfigManager`, the renderer carried its
 * own literals, and the only guarantee that they still matched these was a comment saying they
 * did. Same placement and same reason as `DEFAULT_VERSIONING_CONFIG` and
 * `DEFAULT_TELEMETRY_CONFIG` below.
 *
 * `satisfies` rather than an annotation: it checks the shape against the contract while keeping
 * `harnessCovers` and `reminderTokenBudget` known-present at each use site, so a consumer reading
 * them gets a value instead of `T | undefined`.
 *
 * These values are also declared in `server/config.schema.json`, which is what an operator's
 * editor reads; the schema file cannot import TypeScript, so that pair stays two spellings of one
 * default and the schema is the one an operator sees.
 */
export const DEFAULT_GATES_CONFIG = {
  enabled: true,
  enableFrameworkGates: true,
  executeInlineGateDefinitions: false,
  harnessCovers: [] as string[],
  reminderTokenBudget: 800,
} satisfies GateSystemSettings;

/**
 * The gates section of the RESOLVED runtime config.
 *
 * Every member the loader resolves is required: `normalizeConfigFile` fills each one from the
 * file or from {@link DEFAULT_GATES_CONFIG}, so a reader never sees `undefined` here and the
 * compiler is what catches a leaf the loader forgot. The two exceptions sit inside `evaluation`
 * and are marked there.
 */
export interface GatesConfig {
  /** Enable/disable the gate subsystem entirely */
  enabled: boolean;
  /**
   * Resolved internal spelling. `ConfigManager` folds the config.json key into this, so
   * consumers read only this field and never the wire key below.
   */
  enableFrameworkGates?: boolean;
  /** config.json key: enable framework-specific quality gates */
  frameworkGates: boolean;
  /**
   * Execute a prompt's `inline_gate_definitions` instead of only displaying them.
   *
   * **Default `false`, and that default is the migration.** ADR 0001 (d) sequences this over two
   * releases: this release logs a warning for every malformed definition it drops so an operator
   * can see which of their workspace prompts would newly arm a gate; the next release flips this
   * default to `true`. Arming enforcement an author may have written and forgotten is the risk
   * being ramped, and workspaces overlaid via `MCP_WORKSPACE` cannot be inventoried from here.
   *
   * Retirement, per `cleanup-standards.md` — a gate that cannot be retired is a bug:
   * - **Evidence that flips it**: one release in which the warn logs show no unexpected prompts
   *   arming gates.
   * - **Commit that deletes it**: the release N+1 change bakes `true` and removes this field
   *   together with the `executeInlineGateDefinitions === true` branches. A knob parked at its
   *   baked value is a parallel system with a nicer name.
   */
  executeInlineGateDefinitions: boolean;
  /** Judge evaluation defaults — gates with `evaluation.mode: 'judge'` use context-isolated review */
  evaluation: {
    defaultMode: 'self' | 'judge';
    /** No default in any layer — a judge model is named or it is not. */
    defaultModel?: string;
    /**
     * Deliberately unresolved at load time. The only code default is
     * `judge-prompt-builder.ts`'s `mode === 'judge'`, which is a FUNCTION of the resolved mode
     * rather than a constant, so folding a constant in here would change what a `mode: 'self'`
     * gate does. `config.schema.json` documents `true`; the two disagree, and picking one is an
     * owner call, not a loader change.
     */
    strict?: boolean;
  };
  /** Reminder subjects this installation's harness already covers; a reminder gate whose `subject` is listed is not rendered (checks are never suppressed) */
  harnessCovers: string[];
  /** Estimated tokens of reminder guidance rendered per dispatch; reminders over budget render as one line each, in priority order */
  reminderTokenBudget: number;
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
  enabled: boolean;
  /** Adapt MCP tool descriptions based on active framework */
  dynamicToolDescriptions: boolean;
  /** Framework a scope falls back to with no persisted state (default: 'CAGEERF') */
  defaultFramework: string;
  /** Injection control for framework content (system prompt, gate guidance, style guidance) */
  injection: FrameworkInjectionConfig;
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
  maxVersions: number;
  /** Auto-save version on updates (can be overridden per-call) */
  autoVersion: boolean;
}

/**
 * Default versioning configuration
 */
export const DEFAULT_VERSIONING_CONFIG: VersioningConfig = {
  enabled: true,
  maxVersions: 50,
  autoVersion: true,
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
  /** Default organization scope. */
  organizationId?: string;
  /** Default workspace scope. */
  workspaceId?: string;
  /** Authoritative launch-level client family for delegation routing. */
  clientFamily?: ClientFamily;
  /** Authoritative launch-level client identifier. */
  clientId?: string;
  /** Authoritative launch-level client version. */
  clientVersion?: string;
  /** Authoritative launch-level delegation profile. */
  delegationProfile?: DelegationProfile;
}

/**
 * Identity and workspace scoping, as the RESOLVED runtime config carries it.
 *
 * `launchDefaults` stays a possibly-empty object rather than an optional member: "no launch
 * defaults" and "an empty set of launch defaults" are the same state to every reader
 * (`normalizeLaunchDefaults` produces the same result from both), and one of the two spellings
 * would otherwise have to be defended at every call site.
 */
export interface IdentityConfig {
  /** Policy mode: 'permissive' (accept overrides) or 'locked' (enforce defaults) */
  mode: IdentityPolicyMode;
  /** Allow per-request identity overrides from tokens/headers */
  allowPerRequestOverride: boolean;
  /** Launch-time identity defaults for workspace/organization scoping; `{}` when none are set */
  launchDefaults: IdentityLaunchDefaults;
}

/**
 * The fully RESOLVED runtime configuration.
 *
 * Every section the config schema declares is required, because `normalizeConfigFile` resolves
 * every one of them at load time — from the file where it speaks, from this module's `DEFAULT_*`
 * constants where it does not. That is what lets `getConfigValueWithSource` answer any declared
 * key with the value the server actually uses, and what lets each `ConfigManager` getter be pure
 * name mapping instead of a second, invisible layer of defaulting.
 *
 * Do NOT confuse this with `ConfigFile` (./config-file.js), the on-disk shape, where every member
 * except `version` is optional.
 */
export interface Config {
  /** Server configuration */
  server: ServerConfig;
  /** Prompts subsystem configuration */
  prompts: PromptsConfig;
  /** Gates system configuration (quality validation) */
  gates: GatesConfig;
  /** Phase guard enforcement for framework structural validation */
  phaseGuards: PhaseGuardsConfig;
  /** Execution strategy configuration (judge mode, etc.) */
  execution: ExecutionConfig;
  /** Framework feature configuration (injection, tool descriptions) */
  frameworks: FrameworkSettings;
  /** Chain session lifecycle configuration */
  chainSessions: ChainSessionConfig;
  /** Logging configuration */
  logging: LoggingConfig;
  /** Tool descriptions configuration. Not a config-file key — set by tooling, never by the loader. */
  toolDescriptions?: ToolDescriptionsOptions;
  /** Version history configuration for resources */
  versioning: VersioningConfig;
  /** Verification (Ralph Loops) configuration */
  verification: VerificationConfig;
  /** MCP Resources configuration */
  resources: ResourcesConfig;

  /** OpenTelemetry observability configuration (tracing, metrics, attribute policy) */
  telemetry: TelemetryConfig;

  /** Identity and workspace scoping configuration */
  identity: IdentityConfig;
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
