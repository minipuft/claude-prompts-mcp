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
  FrameworksConfig,
  ExecutionConfig,
  ChainSessionConfig,
  GatesConfig,
  TransportMode,
  VersioningConfig,
  DEFAULT_VERSIONING_CONFIG,
} from '../types/index.js';
import {
  DEFAULT_INJECTION_CONFIG,
  type InjectionConfig,
} from '../execution/pipeline/decisions/injection/index.js';
// Removed: ToolDescriptionManager import to break circular dependency
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

const DEFAULT_FRAMEWORKS_CONFIG: FrameworksConfig = {
  dynamicToolDescriptions: true,
  injection: {
    systemPrompt: { enabled: true, frequency: 2 },
    styleGuidance: true,
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
export class ConfigManager extends EventEmitter {
  private config: Config;
  private configPath: string;
  // Removed: private toolDescriptionManager - now injected via dependency injection
  private fileWatcher: FSWatcher | undefined;
  private watching: boolean = false;
  private reloadDebounceTimer: NodeJS.Timeout | undefined;
  private frameworksConfigCache: FrameworksConfig;

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
   */
  getFrameworksConfig(): FrameworksConfig {
    const frameworksConfig = this.config.frameworks;
    return {
      dynamicToolDescriptions:
        frameworksConfig?.dynamicToolDescriptions ??
        DEFAULT_FRAMEWORKS_CONFIG.dynamicToolDescriptions,
      injection: {
        systemPrompt: {
          enabled:
            frameworksConfig?.injection?.systemPrompt?.enabled ??
            DEFAULT_FRAMEWORKS_CONFIG.injection?.systemPrompt?.enabled ??
            true,
          frequency:
            frameworksConfig?.injection?.systemPrompt?.frequency ??
            DEFAULT_FRAMEWORKS_CONFIG.injection?.systemPrompt?.frequency ??
            2,
        },
        styleGuidance:
          frameworksConfig?.injection?.styleGuidance ??
          DEFAULT_FRAMEWORKS_CONFIG.injection?.styleGuidance ??
          true,
      },
    };
  }

  /**
   * Get gates configuration (unified gate settings)
   */
  getGatesConfig(): GatesConfig {
    const gatesConfig: Partial<GatesConfig> = this.config.gates ?? {};
    return {
      enabled: gatesConfig.enabled ?? DEFAULT_GATES_CONFIG.enabled,
      definitionsDirectory:
        gatesConfig.definitionsDirectory ?? DEFAULT_GATES_CONFIG.definitionsDirectory,
      enableMethodologyGates:
        gatesConfig.enableMethodologyGates ?? DEFAULT_GATES_CONFIG.enableMethodologyGates,
    };
  }

  /**
   * Get chain session lifecycle configuration
   */
  getChainSessionConfig(): ChainSessionConfig {
    const chainConfig: Partial<ChainSessionConfig> = this.config.chainSessions ?? {};
    return {
      sessionTimeoutMinutes:
        chainConfig.sessionTimeoutMinutes ?? DEFAULT_CHAIN_SESSION_CONFIG.sessionTimeoutMinutes,
      reviewTimeoutMinutes:
        chainConfig.reviewTimeoutMinutes ?? DEFAULT_CHAIN_SESSION_CONFIG.reviewTimeoutMinutes,
      cleanupIntervalMinutes:
        chainConfig.cleanupIntervalMinutes ?? DEFAULT_CHAIN_SESSION_CONFIG.cleanupIntervalMinutes,
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
   * Get injection config for the internal InjectionDecisionService.
   * Translates from the user-friendly frameworks.injection format to the internal format.
   */
  getInjectionConfig(): InjectionConfig {
    const frameworksConfig = this.getFrameworksConfig();
    const injection = frameworksConfig.injection;

    // Build internal InjectionConfig from user-facing config
    return {
      defaults: {
        'system-prompt': injection?.systemPrompt?.enabled ?? true,
        'gate-guidance': this.getGatesConfig().enabled, // Follows gates.enabled
        'style-guidance': injection?.styleGuidance ?? true,
      },
      'system-prompt': {
        enabled: injection?.systemPrompt?.enabled ?? true,
        frequency: {
          mode: 'every' as const,
          interval: injection?.systemPrompt?.frequency ?? 2,
        },
        target: 'both' as const,
      },
      'gate-guidance': {
        ...DEFAULT_INJECTION_CONFIG['gate-guidance'],
        enabled: this.getGatesConfig().enabled,
      },
      'style-guidance': {
        ...DEFAULT_INJECTION_CONFIG['style-guidance'],
        enabled: injection?.styleGuidance ?? true,
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
   * Get prompts directory path relative to config directory
   * @deprecated Use getPromptsDirectory() for YAML-based prompt discovery
   */
  getPromptsFilePath(): string {
    const configDir = path.dirname(this.configPath);
    return path.join(configDir, this.config.prompts.directory);
  }

  /**
   * Get prompts directory path (for YAML-based prompt discovery)
   * Resolves the prompts directory from config
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
   *   2. MCP_PROMPTS_PATH environment variable
   *   3. config.prompts.directory setting
   *
   * Note: PathResolver is the preferred source of truth for path resolution.
   * This method exists for backward compatibility and simple use cases.
   */
  getResolvedPromptsFilePath(overridePath?: string): string {
    const baseDir = path.dirname(this.configPath);

    // Priority: overridePath > MCP_PROMPTS_PATH > config
    let resolvedPath = overridePath ?? process.env['MCP_PROMPTS_PATH'] ?? this.getPromptsFilePath();

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

  // Removed: ToolDescriptionManager methods - now handled via dependency injection in runtime/application.ts

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

    // Ensure frameworks config exists
    if (!this.config.frameworks) {
      this.config.frameworks = { ...DEFAULT_FRAMEWORKS_CONFIG };
    } else {
      this.config.frameworks = {
        ...DEFAULT_FRAMEWORKS_CONFIG,
        ...this.config.frameworks,
      };
    }

    if (!this.config.chainSessions) {
      this.config.chainSessions = { ...DEFAULT_CHAIN_SESSION_CONFIG };
    } else {
      this.config.chainSessions = {
        sessionTimeoutMinutes:
          this.config.chainSessions.sessionTimeoutMinutes ??
          DEFAULT_CHAIN_SESSION_CONFIG.sessionTimeoutMinutes,
        reviewTimeoutMinutes:
          this.config.chainSessions.reviewTimeoutMinutes ??
          DEFAULT_CHAIN_SESSION_CONFIG.reviewTimeoutMinutes,
        cleanupIntervalMinutes:
          this.config.chainSessions.cleanupIntervalMinutes ??
          DEFAULT_CHAIN_SESSION_CONFIG.cleanupIntervalMinutes,
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

  private emitConfigChange(previousFrameworks: FrameworksConfig): void {
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

  private haveFrameworkConfigsChanged(a: FrameworksConfig, b: FrameworksConfig): boolean {
    return (
      a.dynamicToolDescriptions !== b.dynamicToolDescriptions ||
      a.injection?.systemPrompt?.enabled !== b.injection?.systemPrompt?.enabled ||
      a.injection?.systemPrompt?.frequency !== b.injection?.systemPrompt?.frequency ||
      a.injection?.styleGuidance !== b.injection?.styleGuidance
    );
  }
}

/**
 * Create and initialize a configuration manager
 */
export async function createConfigManager(configPath: string): Promise<ConfigManager> {
  const configManager = new ConfigManager(configPath);
  await configManager.loadConfig();
  return configManager;
}
