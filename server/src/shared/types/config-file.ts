// @lifecycle canonical - On-disk shape of a 5.0 config.json; the source config.schema.json is generated from.
/**
 * Config File Types
 *
 * `ConfigFile` is what a 5.0 `config.json` CONTAINS on disk. `Config` (./core-config.js) is a
 * different thing: the RESOLVED runtime shape a reader gets after the config loader has applied
 * defaults, folded legacy spellings into current ones, and renamed wire keys to internal ones
 * (`chainSessions.timeoutMinutes` becomes `chainSessions.sessionTimeoutMinutes`).
 *
 * Conflating the two is what this file exists to stop, so `ConfigFile` deliberately does not
 * extend `Config` and a parsed file is not a cast target for it. A loader MAPS, key by key, and
 * the compiler is what makes a missed rename visible.
 *
 * `server/config.schema.json` is generated from this type with ts-json-schema-generator, so:
 * - the sentence an operator's editor shows for a key is the JSDoc sentence on the member here;
 * - a constraint TypeScript cannot carry is a JSDoc tag the generator reads (`@default`,
 *   `@minimum`, `@maximum`, `@pattern`, `@asType`);
 * - enums are union literal types;
 * - no object type carries an index signature, so each object emits `additionalProperties: false`.
 *
 * `@default` records what `server/config.json` ships today; where the shipped file says nothing,
 * the value `DEFAULT_CONFIG` (src/infra/config/index.ts) applies; where neither speaks, the value
 * the hand-written schema declared. A member with no `@default` has no default in any of the
 * three — absent means absent.
 *
 * `@asType integer` marks a `number` member that must emit JSON Schema `"type": "integer"`.
 * `ts-json-schema-generator` 2.9.0 turns every TypeScript `number` into `{ type: "number" }`
 * unconditionally, but with `jsDoc: 'extended'` (already set in `scripts/generate-config-schema.ts`)
 * `ExtendedAnnotationsReader.getTypeAnnotation` recognizes `asType` natively and overwrites the
 * emitted `type` with the tag's text — no `extraTags` registration or post-generation rewrite
 * needed. That native handling has no idea what the member's declared type is, though: it
 * overwrites `type` for ANY member carrying the tag. `scripts/generate-config-schema.ts`'s
 * `assertIntegerTagsOnNumberMembers` is the check the library doesn't do — it walks this file's
 * own AST and fails generation loudly if `@asType` sits on a member whose declared type is not
 * `number`, rather than silently retyping the wrong field.
 */

import type {
  IdentityLaunchDefaults,
  IdentityPolicyMode,
  InjectionTargetConfig,
  TelemetryMode,
} from './core-config.js';

/**
 * Log severities a config file may name. Distinct from the `LogLevel` enum in `./index.js`, which
 * is the runtime's uppercase spelling; these are the lowercase values an operator types.
 */
type ConfigFileLogLevel = 'error' | 'warn' | 'info' | 'debug';

/**
 * A reminder subject an installation's harness already covers. Spellings are copied from the
 * Subject column of `resources/gates/_index.md`.
 *
 * @pattern ^[a-z0-9]+(?:-[a-z0-9]+)*$
 */
type ConfigFileReminderSubject = string;

/** Server identity and transport settings. */
interface ConfigFileServer {
  /**
   * Server name reported to MCP clients.
   *
   * @default "claude-prompts"
   */
  name?: string;
  /**
   * Port for the Streamable HTTP transport (ignored for stdio).
   *
   * @asType integer
   * @default 9090
   * @minimum 1024
   * @maximum 65535
   */
  port?: number;
}

/** Prompt loading and registration. */
interface ConfigFilePrompts {
  /**
   * Directory containing prompt definitions (relative to server root).
   *
   * @default "resources/prompts"
   */
  directory?: string;
  /**
   * Register prompts as MCP resources for client discovery.
   *
   * @default true
   */
  registerWithMcp?: boolean;
}

/** Identity and client-profile resolution for scope isolation and delegation routing. */
interface ConfigFileIdentity {
  /**
   * Identity precedence mode.
   *
   * @default "permissive"
   */
  mode?: IdentityPolicyMode;
  /**
   * Allow request claims to override launch defaults based on transport policy.
   *
   * @default true
   */
  allowPerRequestOverride?: boolean;
  /** Launch-time defaults used when request identity/profile metadata is missing. */
  launchDefaults?: IdentityLaunchDefaults;
}

/** Framework system-prompt injection: the phase guidance a framework contributes to a step. */
interface ConfigFileSystemPromptInjection {
  /**
   * Inject framework system-prompt guidance at all.
   *
   * @default true
   */
  enabled?: boolean;
  /**
   * Inject framework guidance every N chain steps. Higher values reduce token usage at the cost of
   * less frequent framework reinforcement.
   *
   * @asType integer
   * @default 3
   * @minimum 1
   * @maximum 100
   */
  frequency?: number;
  /**
   * Where to inject framework guidance: 'steps' (normal execution), 'gates' (gate reviews), or
   * 'both'.
   *
   * @default "steps"
   */
  target?: InjectionTargetConfig;
}

/** Gate-guidance injection: the quality criteria a step is asked to satisfy. */
interface ConfigFileGateGuidanceInjection {
  /**
   * Inject gate criteria every N chain steps. 0 = first step only. Gate review steps always
   * receive guidance regardless of this setting.
   *
   * @asType integer
   * @default 0
   * @minimum 0
   * @maximum 100
   */
  frequency?: number;
  /**
   * Where to inject gate criteria: 'steps' (normal execution), 'gates' (gate reviews), or 'both'.
   *
   * @default "both"
   */
  target?: InjectionTargetConfig;
}

/** Style-guidance injection: response formatting guidance. */
interface ConfigFileStyleGuidanceInjection {
  /**
   * Include response formatting guidance in prompts.
   *
   * @default true
   */
  enabled?: boolean;
  /**
   * Inject style guidance every N chain steps. 0 = first step only. Set to 1 for every step.
   *
   * @asType integer
   * @default 0
   * @minimum 0
   * @maximum 100
   */
  frequency?: number;
  /**
   * Where to inject style guidance: 'steps' (normal execution), 'gates' (gate reviews), or 'both'.
   *
   * @default "steps"
   */
  target?: InjectionTargetConfig;
}

/**
 * Injection control for framework-driven content, one block per injection type.
 *
 * Nested because the runtime reads it nested: the flat file keys this replaces
 * (`systemPromptFrequency`, `styleGuidanceTarget`, and their five siblings) forced the loader to
 * reassemble three objects from seven keys, and every new injection type widened the file's
 * top-level namespace by three more.
 */
interface ConfigFileFrameworkInjection {
  /** System prompt injection settings. */
  systemPrompt?: ConfigFileSystemPromptInjection;
  /** Gate guidance injection settings. */
  gateGuidance?: ConfigFileGateGuidanceInjection;
  /** Style guidance injection settings. */
  styleGuidance?: ConfigFileStyleGuidanceInjection;
}

/**
 * Frameworks (CAGEERF, ReACT, etc.) that guide LLM behavior. Controls three injection types:
 * system-prompt (framework phases), gate-guidance (quality criteria), and style-guidance (response
 * formatting).
 */
interface ConfigFileFrameworks {
  /**
   * Enable framework system.
   *
   * @default true
   */
  enabled?: boolean;
  /**
   * Adapt MCP tool descriptions based on active framework.
   *
   * @default true
   */
  dynamicToolDescriptions?: boolean;
  /**
   * Framework a scope falls back to when it has no persisted state row. Set per project to pin a
   * repo to one framework (e.g. 'RADIANT' for design work). A runtime framework switch overrides
   * this for that scope and persists.
   *
   * @default "CAGEERF"
   */
  defaultFramework?: string;
  /** Injection control for framework content. */
  injection?: ConfigFileFrameworkInjection;
}

/**
 * Judge evaluation defaults. Gates with evaluation.mode 'judge' use context-isolated review via
 * delegation.
 */
interface ConfigFileGateEvaluation {
  /**
   * Default evaluation mode for all gates: 'self' (same-context review) or 'judge'
   * (context-isolated delegation).
   *
   * @default "self"
   */
  defaultMode?: 'self' | 'judge';
  /** Default model hint for judge sub-agents (e.g., 'haiku' for cheap evaluation). */
  defaultModel?: string;
  /**
   * Default strict mode: use failure-first framing for judge evaluation.
   *
   * Absent, its effective default is not a constant: `resolveJudgeConfig`
   * (`judge-prompt-builder.ts`) falls back to `true` exactly when the evaluation mode is
   * `'judge'`, and to `false` otherwise.
   */
  strict?: boolean;
}

/** Quality gates for validating LLM outputs. */
interface ConfigFileGates {
  /**
   * Enable the gate validation system.
   *
   * @default true
   */
  enabled?: boolean;
  /**
   * Apply framework-specific quality gates.
   *
   * @default true
   */
  frameworkGates?: boolean;
  /**
   * Execute a prompt's gateConfiguration.inline_gate_definitions block instead of only displaying
   * it. Off by default this release so an operator can watch the 'Dropped inline gate definition'
   * warnings and see which workspace prompts would newly arm a gate; set true to opt in early. The
   * next release makes true the default.
   *
   * @default false
   */
  executeInlineGateDefinitions?: boolean;
  /** Judge evaluation defaults. */
  evaluation?: ConfigFileGateEvaluation;
  /**
   * Reminder subjects this installation's harness already covers (its own rules or hooks). A
   * reminder gate whose `subject` is listed is not rendered; checks are never suppressed.
   *
   * @default []
   */
  harnessCovers?: ConfigFileReminderSubject[];
  /**
   * Estimated tokens of reminder guidance rendered per dispatch. Reminders over the budget render
   * as one line each, in priority order; nothing is dropped. Checks are outside the budget.
   *
   * @asType integer
   * @default 800
   * @minimum 0
   */
  reminderTokenBudget?: number;
}

/** Context isolation spawns a fresh Claude CLI to fix issues. */
interface ConfigFileVerificationIsolation {
  /**
   * Enable spawning isolated Claude instances after in-context attempts fail.
   *
   * @default true
   */
  enabled?: boolean;
  /**
   * Maximum cost (USD) per isolation spawn.
   *
   * @default 1
   * @minimum 0.01
   * @maximum 10
   */
  maxBudget?: number;
  /**
   * Timeout in seconds for each isolation spawn.
   *
   * @asType integer
   * @default 300
   * @minimum 30
   * @maximum 3600
   */
  timeout?: number;
  /**
   * How spawned instance handles permission requests.
   *
   * @default "delegate"
   */
  permissionMode?: 'delegate' | 'ask' | 'deny';
}

/** Ralph Loops: autonomous verification via shell commands. */
interface ConfigFileVerification {
  /**
   * Fix attempts within current context before spawning isolation. Set to 0 for immediate
   * isolation.
   *
   * @asType integer
   * @default 3
   * @minimum 0
   * @maximum 10
   */
  inContextAttempts?: number;
  /** Context isolation settings. */
  isolation?: ConfigFileVerificationIsolation;
}

/** Prompt version control. */
export interface ConfigFileVersioning {
  /**
   * Track prompt versions.
   *
   * @default true
   */
  enabled?: boolean;
  /**
   * Auto-create versions on prompt changes.
   *
   * @default true
   */
  autoVersion?: boolean;
  /**
   * Maximum versions to retain per prompt.
   *
   * @asType integer
   * @default 50
   * @minimum 1
   * @maximum 500
   */
  maxVersions?: number;
}

/**
 * Phase guards: deterministic structural validation of LLM output against framework phase
 * definitions (zero LLM cost).
 */
interface ConfigFilePhaseGuards {
  /**
   * Enforcement mode: 'enforce' blocks advancement until structural requirements pass, 'warn' logs
   * advisory warnings, 'off' disables phase guards.
   *
   * @default "enforce"
   */
  mode?: 'enforce' | 'warn' | 'off';
  /**
   * Maximum retry attempts before phase guard review expires (enforce mode only).
   *
   * @asType integer
   * @default 2
   * @minimum 0
   * @maximum 10
   */
  maxRetries?: number;
}

/** Prompt execution behavior. */
interface ConfigFileExecution {
  /**
   * Enable %judge modifier for framework comparison.
   *
   * @default true
   */
  judge?: boolean;
}

/**
 * Claude Code hook behavior (affects prompt-suggest.py output).
 *
 * Read by the Python hooks directly off the file — `hooks/lib/config_loader.py` — not by any
 * TypeScript path, which is why no member here has a counterpart in `Config`.
 */
interface ConfigFileHooks {
  /**
   * Show detailed multi-line output instead of compact single-line. Useful for debugging or
   * verbose mode. An absent key resolves to `false` in `hooks/lib/config_loader.py`.
   *
   * @default true
   */
  expandedOutput?: boolean;
}

/** Controls which attributes are included in trace spans and events for data safety. */
interface ConfigFileTelemetryAttributePolicy {
  /**
   * Include safe business-context attributes (cpm.prompt.id, cpm.execution.mode, etc.).
   *
   * @default true
   */
  businessContext?: boolean;
  /**
   * Include raw command text in traces. WARNING: may contain sensitive data.
   *
   * @default false
   */
  rawCommands?: boolean;
  /**
   * Include raw user responses in traces. WARNING: may contain sensitive data.
   *
   * @default false
   */
  rawResponses?: boolean;
  /** Custom attribute names to explicitly include in traces. */
  allowlist?: string[];
}

/**
 * OpenTelemetry observability: tracing, metrics, and attribute policy. Separate from
 * resources.observability (MCP resource toggles).
 */
interface ConfigFileTelemetry {
  /**
   * Master switch for the telemetry subsystem. When false, no OTel SDK is initialized.
   *
   * @default false
   */
  enabled?: boolean;
  /**
   * Export mode: 'off' (disabled), 'traces' (spans/events only), 'full' (spans + OTel metrics).
   *
   * @default "off"
   */
  mode?: TelemetryMode;
  /**
   * OTLP HTTP exporter endpoint URL.
   *
   * @default "http://localhost:4318"
   */
  exporterEndpoint?: string;
  /**
   * Head sampling rate for traces (0.0-1.0). 1.0 = sample everything, 0.0 = sample nothing.
   *
   * @default 1
   * @minimum 0
   * @maximum 1
   */
  samplingRate?: number;
  /** Controls which attributes are included in trace spans and events for data safety. */
  attributePolicy?: ConfigFileTelemetryAttributePolicy;
}

/** Server logging configuration. */
interface ConfigFileLogging {
  /**
   * Minimum log level.
   *
   * @default "info"
   */
  level?: ConfigFileLogLevel;
  /**
   * Log file directory.
   *
   * @default "./logs"
   */
  directory?: string;
}

/** A resource family that is registered with MCP or not. */
interface ConfigFileResourceToggle {
  /**
   * Enable this resource family.
   *
   * @default true
   */
  enabled?: boolean;
}

/** Observability resources (sessions and metrics). */
interface ConfigFileObservabilityResources {
  /**
   * Enable observability resources.
   *
   * @default true
   */
  enabled?: boolean;
  /**
   * Enable session resources (resource://session/...).
   *
   * @default true
   */
  sessions?: boolean;
  /**
   * Enable metrics resources (resource://metrics/...).
   *
   * @default true
   */
  metrics?: boolean;
}

/** Logs resource for debugging and observability. */
interface ConfigFileLogsResource {
  /**
   * Enable logs resource (resource://logs/).
   *
   * @default true
   */
  enabled?: boolean;
  /**
   * Maximum log entries to retain in memory.
   *
   * @asType integer
   * @default 500
   * @minimum 50
   * @maximum 5000
   */
  maxEntries?: number;
  /**
   * Minimum level to buffer (entries below this level are not stored).
   *
   * @default "info"
   */
  defaultLevel?: ConfigFileLogLevel;
}

/**
 * MCP resources configuration. Master switch must be enabled for any resources to register.
 */
interface ConfigFileResources {
  /**
   * Master switch: register resources with MCP protocol (default: false for token efficiency).
   *
   * @default false
   */
  registerWithMcp?: boolean;
  /** Prompt resources (resource://prompt/...). */
  prompts?: ConfigFileResourceToggle;
  /** Gate resources (resource://gate/...). */
  gates?: ConfigFileResourceToggle;
  /** Framework resources (resource://framework/...). */
  frameworks?: ConfigFileResourceToggle;
  /** Observability resources (sessions and metrics). */
  observability?: ConfigFileObservabilityResources;
  /** Logs resource for debugging and observability. */
  logs?: ConfigFileLogsResource;
}

/**
 * Chain session lifecycle management.
 *
 * At the root, not under `advanced`: session lifetimes are an operator-facing dial an installation
 * routinely tunes, and `sessions` was the only member `advanced` ever held, so the wrapper named
 * nothing.
 */
interface ConfigFileChainSessions {
  /**
   * Idle session timeout in minutes (default: 24 hours).
   *
   * @asType integer
   * @default 1440
   * @minimum 1
   * @maximum 10080
   */
  timeoutMinutes?: number;
  /**
   * Gate review timeout in minutes.
   *
   * @asType integer
   * @default 30
   * @minimum 1
   * @maximum 10080
   */
  reviewTimeoutMinutes?: number;
  /**
   * Background cleanup frequency in minutes.
   *
   * @asType integer
   * @default 5
   * @minimum 1
   * @maximum 10080
   */
  cleanupIntervalMinutes?: number;
}

/**
 * The contents of a 5.0 `config.json`.
 *
 * Every section is optional; `version` is not, because the loader routes on it and a file that
 * does not say which shape it is written in cannot be read as either.
 */
export interface ConfigFile {
  /** JSON Schema reference for IDE validation. */
  $schema?: string;
  /**
   * Config file format version. `5` is the shape this file describes; an older file declares its
   * own version and is migrated before it reaches this type.
   */
  version: 5;
  /** Server identity and transport settings. */
  server?: ConfigFileServer;
  /** Prompt loading and registration. */
  prompts?: ConfigFilePrompts;
  /** Identity and client-profile resolution for scope isolation and delegation routing. */
  identity?: ConfigFileIdentity;
  /** Frameworks (CAGEERF, ReACT, etc.) that guide LLM behavior. */
  frameworks?: ConfigFileFrameworks;
  /** Quality gates for validating LLM outputs. */
  gates?: ConfigFileGates;
  /** Ralph Loops: autonomous verification via shell commands. */
  verification?: ConfigFileVerification;
  /** Prompt version control. */
  versioning?: ConfigFileVersioning;
  /** Deterministic structural validation of LLM output against framework phase definitions. */
  phaseGuards?: ConfigFilePhaseGuards;
  /** Prompt execution behavior. */
  execution?: ConfigFileExecution;
  /** Claude Code hook behavior (affects prompt-suggest.py output). */
  hooks?: ConfigFileHooks;
  /** OpenTelemetry observability: tracing, metrics, and attribute policy. */
  telemetry?: ConfigFileTelemetry;
  /** Server logging configuration. */
  logging?: ConfigFileLogging;
  /** MCP resources configuration. */
  resources?: ConfigFileResources;
  /** Chain session lifecycle management. */
  chainSessions?: ConfigFileChainSessions;
}
