// @lifecycle canonical - Loads, validates, and watches MCP server configuration data.
/**
 * Configuration Management Module
 * Handles loading and validation of server configuration from config.json
 */

import { EventEmitter } from 'events';
import { watch, FSWatcher } from 'fs';
import { readFile } from 'fs/promises';
import os from 'node:os';
import path from 'path';

import { createLogger, getDefaultLoggerConfig } from '../logging/index.js';

const logger = createLogger(
  getDefaultLoggerConfig({
    logFile: path.join(os.tmpdir(), 'config-manager.log'),
    transport: 'stdio',
    enableDebug: false,
  })
);

import {
  Config,
  AnalysisConfig,
  SemanticAnalysisConfig,
  LLMIntegrationConfig,
  LoggingConfig,
  ResolvedFrameworkConfig,
  ExecutionConfig,
  ChainSessionConfig,
  TransportMode,
  VersioningConfig,
  FrameworkSettings,
  ResourcesConfig,
  TelemetryConfig,
  DEFAULT_VERSIONING_CONFIG,
  DEFAULT_TELEMETRY_CONFIG,
  DEFAULT_INJECTION_CONFIG,
  type InjectionConfig,
  type ConfigManager,
  type GatesConfig,
} from '#shared/types/index.js';
import { DEFAULT_FRAMEWORK_ID } from '#shared/utils/constants.js';
// Removed: ToolDescriptionLoader import to break circular dependency
// Now injected via dependency injection pattern

/**
 * Config keys the CLI accepted and no reader ever consulted.
 *
 * `cpm enable gates` wrote `gates.mode: "on"` and reported success; every runtime reader
 * consulted `gates.enabled`. The write path (`config-operations.ts` `applyConfigChange`) assigns
 * dot-keys verbatim, so there was never a translation step and the two spellings never met — the
 * command silently changed nothing, for all ten subsystems it advertises. The camelCase versioning
 * pair is the same failure on a different axis: the CLI took `maxVersions`, the runtime reads
 * `max_versions`.
 *
 * The inert spelling is gone from the CLI surface, so nothing writes these any more. This fold
 * exists only for `config.json` files already on disk carrying one.
 *
 * RETIREMENT CONDITION: delete this table and its call when no supported upgrade path starts from
 * a config written before the CLI surface was corrected — i.e. one full major cycle. The three
 * modes a reader *does* consult (`telemetry.mode`, `phaseGuards.mode`, `identity.mode`) are
 * deliberately absent; folding those would destroy live settings.
 */
const INERT_SPELLINGS: ReadonlyArray<{
  path: readonly string[];
  from: string;
  to: string;
  /** `on`/`off` becomes a boolean; the camelCase pair carries its value across unchanged. */
  coerce: 'onOff' | 'passthrough';
}> = [
  { path: ['gates'], from: 'mode', to: 'enabled', coerce: 'onOff' },
  { path: ['frameworks'], from: 'mode', to: 'enabled', coerce: 'onOff' },
  // `resources` has no top-level `enabled` — `registerWithMcp` is that section's master switch.
  { path: ['resources'], from: 'mode', to: 'registerWithMcp', coerce: 'onOff' },
  { path: ['resources', 'prompts'], from: 'mode', to: 'enabled', coerce: 'onOff' },
  { path: ['resources', 'gates'], from: 'mode', to: 'enabled', coerce: 'onOff' },
  { path: ['resources', 'frameworks'], from: 'mode', to: 'enabled', coerce: 'onOff' },
  { path: ['resources', 'observability'], from: 'mode', to: 'enabled', coerce: 'onOff' },
  { path: ['resources', 'logs'], from: 'mode', to: 'enabled', coerce: 'onOff' },
  { path: ['verification', 'isolation'], from: 'mode', to: 'enabled', coerce: 'onOff' },
  // This entry outlives its target on purpose. `analysis.semanticAnalysis` is deprecated and no
  // longer settable from either tool surface, but it is still parsed for one cycle, so a config
  // written with the inert `mode` spelling must still normalize to the one key the deprecation
  // warning names — otherwise a user is told to remove a section whose spelling we refused to
  // recognize. It retires WITH the section, not on the schedule above.
  {
    path: ['analysis', 'semanticAnalysis', 'llmIntegration'],
    from: 'mode',
    to: 'enabled',
    coerce: 'onOff',
  },
  { path: ['versioning'], from: 'mode', to: 'enabled', coerce: 'onOff' },
  { path: ['versioning'], from: 'maxVersions', to: 'max_versions', coerce: 'passthrough' },
  { path: ['versioning'], from: 'autoVersion', to: 'auto_version', coerce: 'passthrough' },
];

/** Walks `path`, returning the containing object only if every segment is a live object. */
function resolveContainer(
  root: Record<string, unknown>,
  segments: readonly string[]
): Record<string, unknown> | undefined {
  let current: Record<string, unknown> = root;
  for (const segment of segments) {
    const next = current[segment];
    if (next === null || typeof next !== 'object' || Array.isArray(next)) return undefined;
    current = next as Record<string, unknown>;
  }
  return current;
}

/**
 * Adopts each inert spelling into its canonical key, then deletes the inert one so a config sees
 * exactly one spelling per concept. The canonical key wins when both are present — an explicit
 * canonical value is the newer intent, and the inert one never did anything anyway.
 *
 * Mutates in place: it runs against the loaded config before defaults, which is the only point
 * where the distinction between "absent" and "defaulted" still exists.
 */
function adoptInertSpellings(root: Record<string, unknown>): void {
  for (const { path: segments, from, to, coerce } of INERT_SPELLINGS) {
    const container = resolveContainer(root, segments);
    if (!container || !(from in container)) continue;

    if (!(to in container) || container[to] === undefined) {
      const raw = container[from];
      if (coerce === 'onOff') {
        // Anything that is not the literal 'on'/'off' the CLI validated is dropped rather than
        // guessed at: a wrong boolean here silently flips a subsystem.
        if (raw === 'on' || raw === 'off') container[to] = raw === 'on';
      } else {
        container[to] = raw;
      }
    }

    delete container[from];
  }
}

/**
 * Default configuration values
 */
const DEFAULT_ANALYSIS_CONFIG: AnalysisConfig = {
  semanticAnalysis: {
    llmIntegration: {
      enabled: false,
      apiKey: null,
      endpoint: null,
      model: 'gpt-4',
      maxTokens: 1000,
      temperature: 0.1,
    },
  },
};

const DEFAULT_FRAMEWORKS_CONFIG: ResolvedFrameworkConfig = {
  dynamicToolDescriptions: true,
  // FrameworkManager and FrameworkStateStore both receive this value rather than carrying
  // their own literal, so the two cannot drift from the configured framework.
  defaultFramework: DEFAULT_FRAMEWORK_ID,
  injection: {
    systemPrompt: { enabled: true, frequency: 2, target: 'steps' },
    gateGuidance: { frequency: 0, target: 'both' },
    styleGuidance: { enabled: true, frequency: 0, target: 'steps' },
  },
};

const DEFAULT_GATES_CONFIG: GatesConfig = {
  enabled: true,
  definitionsDirectory: 'gates',
  enableFrameworkGates: true,
};

const DEFAULT_CHAIN_SESSION_CONFIG: ChainSessionConfig = {
  sessionTimeoutMinutes: 24 * 60,
  reviewTimeoutMinutes: 30,
  cleanupIntervalMinutes: 5,
};

const DEFAULT_EXECUTION_CONFIG: ExecutionConfig = {
  judge: true,
};

const DEFAULT_RESOURCES_CONFIG: ResourcesConfig = {
  registerWithMcp: false, // Disabled by default - tools provide more efficient discovery
  prompts: { enabled: true },
  gates: { enabled: true },
  frameworks: { enabled: true },
  observability: {
    enabled: true,
    sessions: true,
    metrics: true,
  },
  logs: {
    enabled: true,
    maxEntries: 500,
    defaultLevel: 'info',
  },
};

/**
 * Default transport mode - STDIO for Claude Desktop/CLI compatibility
 */
const DEFAULT_TRANSPORT_MODE: TransportMode = 'stdio';

const DEFAULT_CONFIG: Config = {
  server: {
    name: 'Claude Custom Prompts',
    version: '1.0.0',
    port: 3456,
  },
  prompts: {
    directory: 'resources/prompts',
  },
  analysis: DEFAULT_ANALYSIS_CONFIG,
  gates: DEFAULT_GATES_CONFIG,
  frameworks: DEFAULT_FRAMEWORKS_CONFIG,
  chainSessions: DEFAULT_CHAIN_SESSION_CONFIG,
  transport: DEFAULT_TRANSPORT_MODE,
  versioning: DEFAULT_VERSIONING_CONFIG,
};

/**
 * Configuration manager class
 */
/**
 * The path-resolution surface `ConfigLoader` needs, expressed structurally.
 *
 * `PathResolver` lives in `runtime/` and `infra/` (Layer 1) may import only `shared/`, so this is
 * a port rather than an import — the shape the arch rules prescribe ("shared/types interfaces +
 * constructor injection"). `runtime/context.ts` satisfies it by passing the live PathResolver.
 *
 * One member per resource type this loader resolves a directory for. Reads already go through
 * `PathResolver` for prompts, gates, frameworks and styles alike; these members exist so writes
 * agree with them (D8 Arc 1).
 */
export interface ResourcePathSource {
  getPromptsPath(): string;
  getGatesPath(): string;
  getFrameworksPath(): string;
  /**
   * The bundled (package-shipped) directory for a resource type — the lowest-precedence root,
   * always read, never written.
   *
   * Writers need it to answer "where does this resource live TODAY", which is a different
   * question from "where would a write go" and has a different answer whenever a personal library
   * is configured. Without it a framework served from the bundle read as absent to its own
   * updater, which reported `Files may be corrupted` (P1.2).
   */
  getBundledResourceDir(resourceType: string): string;
  /**
   * Workspace overlay directories for a resource type, highest precedence, read in order.
   *
   * On the port for the same reason `getBundledResourceDir` is: the RELOAD path needs the same
   * root SET startup uses, and it lives in `modules/` where `runtime/PathResolver` cannot be
   * imported. Without it, reload could only ever see one directory.
   */
  getOverlayResourceDirs(resourceType: string, primaryDir?: string): string[];
}

export class ConfigLoader extends EventEmitter implements ConfigManager {
  private config: Config;
  private configPath: string;
  // Removed: private toolDescriptionLoader - now injected via dependency injection
  private fileWatcher: FSWatcher | undefined;
  private watching: boolean = false;
  private reloadDebounceTimer: NodeJS.Timeout | undefined;
  private frameworksConfigCache: ResolvedFrameworkConfig;
  /** Deprecation notices are per-process, not per-load — file watching re-enters `loadConfig`. */
  private warnedAnalysisDeprecated = false;

  constructor(
    configPath: string,
    private readonly resourcePaths?: ResourcePathSource
  ) {
    super();
    this.configPath = configPath;
    this.config = DEFAULT_CONFIG;
    this.frameworksConfigCache = { ...DEFAULT_FRAMEWORKS_CONFIG };
  }

  /**
   * Load configuration from file
   */
  async loadConfig(): Promise<Config> {
    const previousFrameworks = { ...this.frameworksConfigCache };
    try {
      const configContent = await readFile(this.configPath, 'utf8');
      this.config = JSON.parse(configContent) as Config;

      // Validate and set defaults for any missing properties
      this.validateAndSetDefaults();

      this.emitConfigChange(previousFrameworks);

      return this.config;
    } catch (error) {
      console.error(`Error loading configuration from ${this.configPath}:`, error);
      console.info('Using default configuration');
      this.config = DEFAULT_CONFIG;
      this.validateAndSetDefaults();
      this.emitConfigChange(previousFrameworks);
      return this.config;
    }
  }

  /**
   * Get current configuration
   */
  getConfig(): Config {
    return this.config;
  }

  /**
   * Get server configuration
   */
  getServerConfig() {
    return this.config.server;
  }

  /**
   * Get prompts configuration
   */
  getPromptsConfig() {
    return this.config.prompts;
  }

  /**
   * Get global registerWithMcp default from prompts config
   * Returns undefined if not specified (allowing downstream defaults)
   */
  getPromptsRegisterWithMcp(): boolean | undefined {
    return this.config.prompts?.registerWithMcp;
  }

  /**
   * Get the transport mode from config
   * Priority: CLI args (handled by caller) > config.transport > default
   */
  getTransportMode(): TransportMode {
    return this.config.transport ?? DEFAULT_TRANSPORT_MODE;
  }

  /**
   * Get logging configuration with environment variable override
   * Supports LOG_LEVEL env var to override configured log level
   */
  getLoggingConfig(): LoggingConfig {
    const defaultLogging: LoggingConfig = {
      directory: './logs',
      level: 'info',
    };

    const configLogging = this.config.logging || defaultLogging;

    // Override log level from LOG_LEVEL environment variable if present
    const envLogLevel = process.env['LOG_LEVEL'];
    if (envLogLevel) {
      const validLevels = ['DEBUG', 'INFO', 'WARN', 'ERROR'];
      const normalizedLevel = envLogLevel.toUpperCase();

      if (validLevels.includes(normalizedLevel)) {
        return {
          ...configLogging,
          level: normalizedLevel.toLowerCase(), // Normalize to lowercase for consistency
        };
      } else {
        // Invalid LOG_LEVEL - warn but continue with config value
        const validLevelsStr = validLevels.join(', ');
        console.warn(
          `Invalid LOG_LEVEL environment variable: "${envLogLevel}". ` +
            `Valid levels: ${validLevelsStr}. Using configured level: "${configLogging.level}"`
        );
      }
    }

    return configLogging;
  }

  /**
   * Get frameworks configuration (includes injection settings)
   * Reads from frameworks config section
   */
  getFrameworksConfig(): ResolvedFrameworkConfig {
    const m = this.config.frameworks;
    const def = DEFAULT_FRAMEWORKS_CONFIG.injection!;
    return {
      dynamicToolDescriptions:
        m?.dynamicToolDescriptions ?? DEFAULT_FRAMEWORKS_CONFIG.dynamicToolDescriptions,
      defaultFramework: m?.defaultFramework ?? DEFAULT_FRAMEWORKS_CONFIG.defaultFramework,
      injection: {
        systemPrompt: {
          enabled: m?.enabled ?? true,
          frequency: m?.systemPromptFrequency ?? def.systemPrompt!.frequency!,
          target: m?.systemPromptTarget ?? def.systemPrompt!.target,
        },
        gateGuidance: {
          frequency: m?.gateGuidanceFrequency ?? def.gateGuidance!.frequency!,
          target: m?.gateGuidanceTarget ?? def.gateGuidance!.target,
        },
        styleGuidance: {
          enabled: m?.styleGuidance ?? def.styleGuidance!.enabled!,
          frequency: m?.styleGuidanceFrequency ?? def.styleGuidance!.frequency!,
          target: m?.styleGuidanceTarget ?? def.styleGuidance!.target,
        },
      },
    };
  }

  /**
   * Get gates configuration (unified gate settings)
   * Reads from gates config section with new property names
   */
  getGatesConfig(): GatesConfig {
    const gatesConfig = this.config.gates ?? {};
    return {
      enabled: gatesConfig.enabled ?? DEFAULT_GATES_CONFIG.enabled,
      definitionsDirectory: gatesConfig.directory ?? DEFAULT_GATES_CONFIG.definitionsDirectory,
      enableFrameworkGates: gatesConfig.frameworkGates ?? DEFAULT_GATES_CONFIG.enableFrameworkGates,
    };
  }

  /**
   * Get chain session lifecycle configuration
   * Reads from advanced.sessions config section
   */
  getChainSessionConfig(): ChainSessionConfig {
    const sessions = this.config.advanced?.sessions;
    return {
      sessionTimeoutMinutes:
        sessions?.timeoutMinutes ?? DEFAULT_CHAIN_SESSION_CONFIG.sessionTimeoutMinutes,
      reviewTimeoutMinutes:
        sessions?.reviewTimeoutMinutes ?? DEFAULT_CHAIN_SESSION_CONFIG.reviewTimeoutMinutes,
      cleanupIntervalMinutes:
        sessions?.cleanupIntervalMinutes ?? DEFAULT_CHAIN_SESSION_CONFIG.cleanupIntervalMinutes,
    };
  }

  /**
   * Get execution strategy configuration
   */
  getExecutionConfig(): ExecutionConfig {
    const judgeValue = this.config.execution?.judge;
    if (judgeValue !== undefined) {
      return { judge: judgeValue };
    }
    return { judge: DEFAULT_EXECUTION_CONFIG.judge ?? true };
  }

  /**
   * Get judge enabled status (convenience method)
   */
  isJudgeEnabled(): boolean {
    return this.getExecutionConfig().judge ?? true;
  }

  /**
   * Get versioning configuration for resource history tracking
   */
  getVersioningConfig(): VersioningConfig {
    const versioningConfig: Partial<VersioningConfig> = this.config.versioning ?? {};
    return {
      enabled: versioningConfig.enabled ?? DEFAULT_VERSIONING_CONFIG.enabled,
      max_versions: versioningConfig.max_versions ?? DEFAULT_VERSIONING_CONFIG.max_versions,
      auto_version: versioningConfig.auto_version ?? DEFAULT_VERSIONING_CONFIG.auto_version,
    };
  }

  /**
   * Get MCP resources configuration
   */
  getResourcesConfig(): ResourcesConfig {
    const cfg = this.config.resources ?? {};
    const def = DEFAULT_RESOURCES_CONFIG;
    return {
      registerWithMcp: cfg.registerWithMcp ?? def.registerWithMcp,
      prompts: {
        enabled: cfg.prompts?.enabled ?? def.prompts?.enabled ?? true,
      },
      gates: {
        enabled: cfg.gates?.enabled ?? def.gates?.enabled ?? true,
      },
      frameworks: {
        enabled: cfg.frameworks?.enabled ?? def.frameworks?.enabled ?? true,
      },
      observability: {
        enabled: cfg.observability?.enabled ?? def.observability?.enabled ?? true,
        sessions: cfg.observability?.sessions ?? def.observability?.sessions ?? true,
        metrics: cfg.observability?.metrics ?? def.observability?.metrics ?? true,
      },
      logs: {
        enabled: cfg.logs?.enabled ?? def.logs?.enabled ?? true,
        maxEntries: cfg.logs?.maxEntries ?? def.logs?.maxEntries ?? 500,
        defaultLevel: cfg.logs?.defaultLevel ?? def.logs?.defaultLevel ?? 'info',
      },
    };
  }

  /**
   * Get OpenTelemetry configuration with safe defaults.
   */
  getTelemetryConfig(): TelemetryConfig {
    const cfg: Partial<TelemetryConfig> = this.config.telemetry ?? {};
    return {
      enabled: cfg.enabled ?? DEFAULT_TELEMETRY_CONFIG.enabled,
      mode: cfg.mode ?? DEFAULT_TELEMETRY_CONFIG.mode,
      exporterEndpoint: cfg.exporterEndpoint ?? DEFAULT_TELEMETRY_CONFIG.exporterEndpoint,
      samplingRate: cfg.samplingRate ?? DEFAULT_TELEMETRY_CONFIG.samplingRate,
      attributePolicy: {
        businessContext:
          cfg.attributePolicy?.businessContext ??
          DEFAULT_TELEMETRY_CONFIG.attributePolicy.businessContext,
        rawCommands:
          cfg.attributePolicy?.rawCommands ?? DEFAULT_TELEMETRY_CONFIG.attributePolicy.rawCommands,
        rawResponses:
          cfg.attributePolicy?.rawResponses ??
          DEFAULT_TELEMETRY_CONFIG.attributePolicy.rawResponses,
        allowlist: cfg.attributePolicy?.allowlist,
      },
    };
  }

  /**
   * Get injection config for the internal InjectionDecisionService.
   * Translates from the user-friendly frameworks.injection format to the internal format.
   */
  getInjectionConfig(): InjectionConfig {
    const frameworksConfig = this.getFrameworksConfig();
    const inj = frameworksConfig.injection;

    // Translate frequency number to InjectionFrequency:
    // 0 → first-only, N>0 → every N steps
    const toFrequency = (
      n: number | undefined,
      fallbackMode: 'first-only' | 'every',
      fallbackInterval?: number
    ): { mode: 'every' | 'first-only'; interval?: number } => {
      if (n === undefined)
        return fallbackInterval
          ? { mode: fallbackMode, interval: fallbackInterval }
          : { mode: fallbackMode };
      if (n === 0) return { mode: 'first-only' as const };
      return { mode: 'every' as const, interval: n };
    };

    const systemPromptEnabled = inj?.systemPrompt?.enabled ?? true;
    const styleEnabled = inj?.styleGuidance?.enabled ?? true;
    const gatesEnabled = this.getGatesConfig().enabled;

    return {
      defaults: {
        'system-prompt': systemPromptEnabled,
        'gate-guidance': gatesEnabled,
        'style-guidance': styleEnabled,
      },
      'system-prompt': {
        enabled: systemPromptEnabled,
        frequency: toFrequency(inj?.systemPrompt?.frequency, 'every', 2),
        target: inj?.systemPrompt?.target ?? 'steps',
      },
      'gate-guidance': {
        ...DEFAULT_INJECTION_CONFIG['gate-guidance'],
        enabled: gatesEnabled,
        frequency: toFrequency(inj?.gateGuidance?.frequency, 'first-only'),
        target: inj?.gateGuidance?.target ?? 'both',
      },
      'style-guidance': {
        ...DEFAULT_INJECTION_CONFIG['style-guidance'],
        enabled: styleEnabled,
        frequency: toFrequency(inj?.styleGuidance?.frequency, 'first-only'),
        target: inj?.styleGuidance?.target ?? 'steps',
      },
    };
  }

  /**
   * Get the port number, with environment variable override
   */
  getPort(): number {
    return process.env['PORT'] ? parseInt(process.env['PORT'], 10) : this.config.server.port;
  }

  /**
   * Get config file path
   */
  getConfigPath(): string {
    return this.configPath;
  }

  /**
   * Get prompts directory path (for YAML-based prompt discovery)
   */
  getPromptsDirectory(): string {
    const configDir = path.dirname(this.configPath);
    return path.join(configDir, this.config.prompts.directory);
  }

  /**
   * Resolve prompts directory path — the destination every prompt WRITE resolves through.
   *
   * Priority:
   *   1. overridePath parameter
   *   2. the injected `PromptsPathSource` (PathResolver), i.e. the same chain reads use
   *   3. config.prompts.directory, resolved against the config file's directory
   *
   * Step 2 is the whole point. This method used to stop at step 3, which meant reads resolved
   * through PathResolver (`MCP_RESOURCES_PATH` -> `MCP_WORKSPACE` -> package default) while writes
   * resolved against the config file alone. Setting `MCP_RESOURCES_PATH` therefore moved every
   * read and no write: prompts were served from the override and edits landed back in the
   * package's own `resources/prompts`. The two only ever agreed because the shipped
   * `config.prompts.directory` happens to name the same path the default resolution produces.
   *
   * Step 3 remains as the fallback for callers constructed without a resolver (tests, the CLI's
   * throwaway loader), so behaviour there is unchanged.
   */
  getResolvedPromptsDirectory(overridePath?: string): string {
    const baseDir = path.dirname(this.configPath);

    if (overridePath !== undefined) {
      return path.isAbsolute(overridePath) ? overridePath : path.resolve(baseDir, overridePath);
    }

    if (this.resourcePaths !== undefined) {
      return this.resourcePaths.getPromptsPath();
    }

    const configured = this.getPromptsDirectory();
    return path.isAbsolute(configured) ? configured : path.resolve(baseDir, configured);
  }

  /**
   * Get server root directory path
   */
  getServerRoot(): string {
    return path.dirname(this.configPath);
  }

  /**
   * Get frameworks directory path — the destination every framework WRITE and DELETE resolves
   * through (`framework-file-writer.ts:504`, via `getFrameworkDir`).
   *
   * Third instance of the same defect as prompts and gates: `getFrameworkDir` composed
   * `join(getServerRoot(), 'resources', 'frameworks', id)`, so it ignored `PathResolver` while
   * framework reads were overlay-merged through it (`module-initializer.ts:218`). The delete path
   * makes this sharper than the other two — `rm(frameworkDir, {recursive: true})` against a
   * mis-resolved root removes a directory in the package tree.
   */
  getFrameworksDirectory(): string {
    if (this.resourcePaths !== undefined) {
      return this.resourcePaths.getFrameworksPath();
    }

    const configDir = path.dirname(this.configPath);
    return path.join(configDir, 'resources', 'frameworks');
  }

  /**
   * The bundled directory for a resource type, or undefined when no path source is injected.
   *
   * Undefined rather than a guessed fallback: the only honest answer without a `PathResolver` is
   * "unknown", and a guess here would send a copy-on-write reading files from the wrong tree.
   * Every caller treats undefined as "no distinct bundled source", which degrades to the
   * pre-existing behaviour rather than to a wrong one.
   */
  getBundledResourceDirectory(resourceType: string): string | undefined {
    return this.resourcePaths?.getBundledResourceDir(resourceType);
  }

  /**
   * The workspace overlay directories for a resource type, or `[]` when no path source is injected.
   *
   * Empty rather than undefined: "no overlays" and "cannot resolve overlays" produce the same
   * correct behaviour here — load nothing extra — and a caller that had to distinguish them would
   * be deciding something this method does not know.
   */
  getOverlayResourceDirectories(resourceType: string, primaryDir?: string): string[] {
    return this.resourcePaths?.getOverlayResourceDirs(resourceType, primaryDir) ?? [];
  }

  /**
   * Get gates directory path (for gate definitions) — the destination every gate WRITE resolves
   * through (`gate-file-writer.ts:135`, `gate-lifecycle-processor.ts:202,280`).
   *
   * Same defect prompts had (see `getResolvedPromptsDirectory`), one degree worse: this did not
   * merely stop short of `PathResolver`, it hardcoded `resources/gates` and consulted neither the
   * config file nor the environment. Gate reads DO go through `PathResolver` and are overlay-merged
   * (`module-initializer.ts:199`), so `MCP_RESOURCES_PATH` moved every gate read and no gate write.
   */
  getGatesDirectory(): string {
    if (this.resourcePaths !== undefined) {
      return this.resourcePaths.getGatesPath();
    }

    const configDir = path.dirname(this.configPath);
    return path.join(configDir, 'resources', 'gates');
  }

  // Removed: ToolDescriptionLoader methods - now handled via dependency injection in runtime/application.ts

  /**
   * Validate configuration and set defaults for missing properties
   */
  private validateAndSetDefaults(): void {
    // Runs first, before any default is applied: an adopted value must be visible to the
    // defaulting below, or the default overwrites what the user actually asked for.
    adoptInertSpellings(this.config as unknown as Record<string, unknown>);

    // Ensure server config exists
    if (!this.config.server) {
      this.config.server = DEFAULT_CONFIG.server;
    } else {
      this.config.server = {
        ...DEFAULT_CONFIG.server,
        ...this.config.server,
      };
    }

    // Ensure prompts config exists
    if (!this.config.prompts) {
      this.config.prompts = DEFAULT_CONFIG.prompts;
    } else {
      this.config.prompts = {
        ...DEFAULT_CONFIG.prompts,
        ...this.config.prompts,
      };
    }

    // Ensure analysis config exists.
    //
    // DEPRECATED SECTION: `analysis` is parsed and defaulted, and nothing consults the result any
    // more. It stays for one cycle because `config.json` is declared public API surface
    // (CLAUDE.md §Public API Contract), so a config that sets it must keep loading rather than
    // fail. The warning below is the deprecation notice; removal is the breaking act and carries
    // the major bump.
    if (!this.config.analysis) {
      this.config.analysis = DEFAULT_ANALYSIS_CONFIG;
    } else {
      this.warnAnalysisSectionDeprecated(this.config.analysis);
      this.config.analysis = this.validateAnalysisConfig(this.config.analysis);
    }

    // Ensure transport mode is set
    if (!this.config.transport) {
      this.config.transport = DEFAULT_TRANSPORT_MODE;
    }

    if (!this.config.frameworks) {
      this.config.frameworks = {
        enabled: true,
        dynamicToolDescriptions: DEFAULT_FRAMEWORKS_CONFIG.dynamicToolDescriptions,
        defaultFramework: DEFAULT_FRAMEWORKS_CONFIG.defaultFramework,
        systemPromptFrequency: DEFAULT_FRAMEWORKS_CONFIG.injection?.systemPrompt?.frequency ?? 2,
        styleGuidance: DEFAULT_FRAMEWORKS_CONFIG.injection?.styleGuidance?.enabled ?? true,
      };
    }

    // Ensure advanced.sessions config exists (new-style)
    if (!this.config.advanced) {
      this.config.advanced = {
        sessions: {
          timeoutMinutes: DEFAULT_CHAIN_SESSION_CONFIG.sessionTimeoutMinutes,
          reviewTimeoutMinutes: DEFAULT_CHAIN_SESSION_CONFIG.reviewTimeoutMinutes,
          cleanupIntervalMinutes: DEFAULT_CHAIN_SESSION_CONFIG.cleanupIntervalMinutes,
        },
      };
    } else if (!this.config.advanced.sessions) {
      this.config.advanced.sessions = {
        timeoutMinutes: DEFAULT_CHAIN_SESSION_CONFIG.sessionTimeoutMinutes,
        reviewTimeoutMinutes: DEFAULT_CHAIN_SESSION_CONFIG.reviewTimeoutMinutes,
        cleanupIntervalMinutes: DEFAULT_CHAIN_SESSION_CONFIG.cleanupIntervalMinutes,
      };
    }

    // Ensure execution config exists
    if (!this.config.execution) {
      this.config.execution = { judge: DEFAULT_EXECUTION_CONFIG.judge ?? true };
    } else {
      const judgeValue = this.config.execution.judge;
      this.config.execution =
        judgeValue !== undefined
          ? { judge: judgeValue }
          : { judge: DEFAULT_EXECUTION_CONFIG.judge ?? true };
    }

    // Ensure versioning config exists with all required fields
    this.config.versioning = {
      ...DEFAULT_VERSIONING_CONFIG,
      ...this.config.versioning,
    };

    // Ensure telemetry config exists with safe defaults
    if (!this.config.telemetry) {
      this.config.telemetry = { ...DEFAULT_TELEMETRY_CONFIG };
    } else {
      this.config.telemetry = {
        ...DEFAULT_TELEMETRY_CONFIG,
        ...this.config.telemetry,
        attributePolicy: {
          ...DEFAULT_TELEMETRY_CONFIG.attributePolicy,
          ...this.config.telemetry.attributePolicy,
        },
      };
    }
  }

  /**
   * Emit the `analysis` deprecation notice at most once per process.
   *
   * Fires only when a config file actually carries the section — the defaulted case is silent,
   * because a user who never wrote the key has nothing to act on. Names the replacement rather
   * than only the removal: a warning that says "stop doing X" without saying what to do instead
   * reads as breakage.
   */
  private warnAnalysisSectionDeprecated(analysisConfig: Partial<AnalysisConfig>): void {
    if (this.warnedAnalysisDeprecated || !analysisConfig.semanticAnalysis) return;
    this.warnedAnalysisDeprecated = true;
    logger.warn(
      '[CONFIG] `analysis.semanticAnalysis` is deprecated and no longer read by any runtime path. ' +
        'It is still parsed so existing configs keep loading, and will be removed in the next major. ' +
        'For model-graded gate evaluation use the `%judge` modifier or `gates.evaluation.defaultMode`. ' +
        'Remove the `analysis` section from config.json to silence this notice.'
    );
  }

  /**
   * Validate and merge analysis configuration with defaults
   */
  private validateAnalysisConfig(analysisConfig: Partial<AnalysisConfig>): AnalysisConfig {
    const semanticAnalysis = analysisConfig.semanticAnalysis || ({} as any);

    // Build LLM integration config
    const llmIntegration: LLMIntegrationConfig = {
      enabled:
        semanticAnalysis.llmIntegration?.enabled ??
        DEFAULT_ANALYSIS_CONFIG.semanticAnalysis.llmIntegration.enabled,
      apiKey:
        semanticAnalysis.llmIntegration?.apiKey ??
        DEFAULT_ANALYSIS_CONFIG.semanticAnalysis.llmIntegration.apiKey,
      endpoint:
        semanticAnalysis.llmIntegration?.endpoint ??
        DEFAULT_ANALYSIS_CONFIG.semanticAnalysis.llmIntegration.endpoint,
      model:
        semanticAnalysis.llmIntegration?.model ??
        DEFAULT_ANALYSIS_CONFIG.semanticAnalysis.llmIntegration.model,
      maxTokens:
        semanticAnalysis.llmIntegration?.maxTokens ??
        DEFAULT_ANALYSIS_CONFIG.semanticAnalysis.llmIntegration.maxTokens,
      temperature:
        semanticAnalysis.llmIntegration?.temperature ??
        DEFAULT_ANALYSIS_CONFIG.semanticAnalysis.llmIntegration.temperature,
    };

    return {
      semanticAnalysis: {
        llmIntegration,
      },
    };
  }

  /**
   * Start watching the configuration file for changes
   */
  startWatching(debounceMs = 500): void {
    if (this.watching) {
      return;
    }

    try {
      this.fileWatcher = watch(this.configPath, () => {
        if (this.reloadDebounceTimer) {
          clearTimeout(this.reloadDebounceTimer);
        }
        this.reloadDebounceTimer = setTimeout(() => {
          this.handleExternalConfigChange().catch((err) => {
            logger.error('Config reload failed:', err);
          });
        }, debounceMs);
      });
      this.watching = true;
      this.fileWatcher.on('error', (err) => {
        logger.error('Config file watcher error:', err);
        this.stopWatching();
      });
    } catch (error) {
      logger.error(`Failed to start config watcher for ${this.configPath}:`, error);
    }
  }

  /**
   * Stop watching the configuration file
   */
  stopWatching(): void {
    if (!this.fileWatcher) {
      return;
    }

    try {
      this.fileWatcher.close();
    } catch (error) {
      logger.error('Error closing config watcher:', error);
    }

    this.fileWatcher = undefined;
    this.watching = false;
    if (this.reloadDebounceTimer) {
      clearTimeout(this.reloadDebounceTimer);
      this.reloadDebounceTimer = undefined;
    }
  }

  /**
   * Shutdown the config manager and cleanup resources
   * Prevents async handle leaks by stopping file watcher and removing listeners
   */
  shutdown(): void {
    // Stop file watching
    this.stopWatching();

    // Remove all event listeners
    this.removeAllListeners();
  }

  private async handleExternalConfigChange(): Promise<void> {
    await this.loadConfig();
    this.emit('configChanged', this.getConfig());
  }

  private emitConfigChange(previousFrameworks: ResolvedFrameworkConfig): void {
    const currentFrameworks = this.getFrameworksConfig();
    const frameworksChanged = this.haveFrameworkConfigsChanged(
      previousFrameworks,
      currentFrameworks
    );
    this.frameworksConfigCache = { ...currentFrameworks };
    if (frameworksChanged) {
      this.emit('frameworksConfigChanged', currentFrameworks, previousFrameworks);
    }
  }

  private haveFrameworkConfigsChanged(
    a: ResolvedFrameworkConfig,
    b: ResolvedFrameworkConfig
  ): boolean {
    return (
      a.dynamicToolDescriptions !== b.dynamicToolDescriptions ||
      a.injection?.systemPrompt?.enabled !== b.injection?.systemPrompt?.enabled ||
      a.injection?.systemPrompt?.frequency !== b.injection?.systemPrompt?.frequency ||
      a.injection?.systemPrompt?.target !== b.injection?.systemPrompt?.target ||
      a.injection?.gateGuidance?.frequency !== b.injection?.gateGuidance?.frequency ||
      a.injection?.gateGuidance?.target !== b.injection?.gateGuidance?.target ||
      a.injection?.styleGuidance?.enabled !== b.injection?.styleGuidance?.enabled ||
      a.injection?.styleGuidance?.frequency !== b.injection?.styleGuidance?.frequency ||
      a.injection?.styleGuidance?.target !== b.injection?.styleGuidance?.target
    );
  }
}

/**
 * Create and initialize a configuration manager
 */
export async function createConfigLoader(configPath: string): Promise<ConfigLoader> {
  const configManager = new ConfigLoader(configPath);
  await configManager.loadConfig();
  return configManager;
}
