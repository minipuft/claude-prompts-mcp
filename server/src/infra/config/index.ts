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
  VerificationConfig,
  AdvancedConfig,
  ResourcesConfig,
  TelemetryConfig,
  DEFAULT_VERSIONING_CONFIG,
  DEFAULT_TELEMETRY_CONFIG,
  DEFAULT_INJECTION_CONFIG,
  type InjectionConfig,
  type ConfigManager,
  type GatesConfig,
} from '../../shared/types/index.js';
// Removed: ToolDescriptionLoader import to break circular dependency
// Now injected via dependency injection pattern

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
  injection: {
    systemPrompt: { enabled: true, frequency: 2, target: 'steps' },
    gateGuidance: { frequency: 0, target: 'both' },
    styleGuidance: { enabled: true, frequency: 0, target: 'steps' },
  },
};

const DEFAULT_GATES_CONFIG: GatesConfig = {
  enabled: true,
  definitionsDirectory: 'gates',
  enableMethodologyGates: true,
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
export class ConfigLoader extends EventEmitter implements ConfigManager {
  private config: Config;
  private configPath: string;
  // Removed: private toolDescriptionLoader - now injected via dependency injection
  private fileWatcher: FSWatcher | undefined;
  private watching: boolean = false;
  private reloadDebounceTimer: NodeJS.Timeout | undefined;
  private frameworksConfigCache: ResolvedFrameworkConfig;

  constructor(configPath: string) {
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
   * Get analysis configuration
   */
  getAnalysisConfig(): AnalysisConfig {
    return this.config.analysis || DEFAULT_ANALYSIS_CONFIG;
  }

  /**
   * Get semantic analysis configuration
   */
  getSemanticAnalysisConfig(): SemanticAnalysisConfig {
    return this.getAnalysisConfig().semanticAnalysis;
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
   * Reads from methodologies config section
   */
  getFrameworksConfig(): ResolvedFrameworkConfig {
    const m = this.config.frameworks;
    const def = DEFAULT_FRAMEWORKS_CONFIG.injection!;
    return {
      dynamicToolDescriptions:
        m?.dynamicToolDescriptions ?? DEFAULT_FRAMEWORKS_CONFIG.dynamicToolDescriptions,
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
      enableMethodologyGates:
        gatesConfig.methodologyGates ?? DEFAULT_GATES_CONFIG.enableMethodologyGates,
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
        target: (inj?.systemPrompt?.target ?? 'steps') as 'steps' | 'gates' | 'both',
      },
      'gate-guidance': {
        ...DEFAULT_INJECTION_CONFIG['gate-guidance'],
        enabled: gatesEnabled,
        frequency: toFrequency(inj?.gateGuidance?.frequency, 'first-only'),
        target: (inj?.gateGuidance?.target ?? 'both') as 'steps' | 'gates' | 'both',
      },
      'style-guidance': {
        ...DEFAULT_INJECTION_CONFIG['style-guidance'],
        enabled: styleEnabled,
        frequency: toFrequency(inj?.styleGuidance?.frequency, 'first-only'),
        target: (inj?.styleGuidance?.target ?? 'steps') as 'steps' | 'gates' | 'both',
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
   * Resolve prompts directory path with environment overrides and absolute fallback.
   *
   * Priority:
   *   1. overridePath parameter
   *   2. config.prompts.directory setting
   *
   * Note: PathResolver is the preferred source of truth for path resolution.
   * This method exists for backward compatibility and simple use cases.
   */
  getResolvedPromptsDirectory(overridePath?: string): string {
    const baseDir = path.dirname(this.configPath);

    // Priority: overridePath > config
    let resolvedPath = overridePath ?? this.getPromptsDirectory();

    if (!path.isAbsolute(resolvedPath)) {
      resolvedPath = path.resolve(baseDir, resolvedPath);
    }

    return resolvedPath;
  }

  /**
   * Get server root directory path
   */
  getServerRoot(): string {
    return path.dirname(this.configPath);
  }

  /**
   * Get gates directory path (for gate definitions)
   * Resolves to resources/gates relative to config directory
   */
  getGatesDirectory(): string {
    const configDir = path.dirname(this.configPath);
    return path.join(configDir, 'resources', 'gates');
  }

  // Removed: ToolDescriptionLoader methods - now handled via dependency injection in runtime/application.ts

  /**
   * Validate configuration and set defaults for missing properties
   */
  private validateAndSetDefaults(): void {
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

    // Ensure analysis config exists
    if (!this.config.analysis) {
      this.config.analysis = DEFAULT_ANALYSIS_CONFIG;
    } else {
      this.config.analysis = this.validateAnalysisConfig(this.config.analysis);
    }

    // Ensure transport mode is set
    if (!this.config.transport) {
      this.config.transport = DEFAULT_TRANSPORT_MODE;
    }

    // Adopt the legacy `methodologies:` section if a pre-rename config.json still carries it,
    // then drop it so only one key remains. Values are identical — this was a rename, not a
    // schema change — so adoption is lossless and no user edit is required.
    const legacySection = (this.config as { methodologies?: FrameworkSettings }).methodologies;
    if (legacySection && !this.config.frameworks) {
      this.config.frameworks = legacySection;
    }
    delete (this.config as { methodologies?: unknown }).methodologies;

    // Same rename one level down: `resources.methodologies` -> `resources.frameworks`. Without
    // this the old key is read as undefined and silently falls back to the default, so a user who
    // had deliberately disabled framework resources would find them re-enabled with no error.
    const legacyResources = this.config.resources as
      | (ResourcesConfig & { methodologies?: { enabled?: boolean } })
      | undefined;
    if (legacyResources?.methodologies && !legacyResources.frameworks) {
      legacyResources.frameworks = legacyResources.methodologies;
    }
    if (legacyResources) {
      delete legacyResources.methodologies;
    }

    if (!this.config.frameworks) {
      this.config.frameworks = {
        enabled: true,
        dynamicToolDescriptions: DEFAULT_FRAMEWORKS_CONFIG.dynamicToolDescriptions,
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
