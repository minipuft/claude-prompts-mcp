// @lifecycle canonical - Loads, validates, and watches MCP server configuration data.
/**
 * Configuration Management Module
 * Handles loading and validation of server configuration from config.json
 */

import { EventEmitter } from 'events';
import { watch, FSWatcher } from 'fs';
import { readFile } from 'fs/promises';
import path from 'path';
import { createLogger, getDefaultLoggerConfig } from '../logging/index.js';

const logger = createLogger(
  getDefaultLoggerConfig({
    logFile: '/tmp/config-manager.log',
    transport: 'stdio',
    enableDebug: false,
  })
);

import {
  Config,
  AnalysisConfig,
  SemanticAnalysisConfig,
  LLMIntegrationConfig,
  AnalysisMode,
  LoggingConfig,
  FrameworksConfig,
  ChainSessionConfig,
} from '../types/index.js';
// Removed: ToolDescriptionManager import to break circular dependency
// Now injected via dependency injection pattern

/**
 * Infer the optimal analysis mode based on LLM integration configuration
 */
function inferAnalysisMode(llmConfig: LLMIntegrationConfig): AnalysisMode {
  // Use semantic mode if LLM integration is properly configured
  if (llmConfig.enabled && llmConfig.endpoint) {
    // For non-localhost endpoints, require API key
    if (
      llmConfig.endpoint.includes('localhost') ||
      llmConfig.endpoint.includes('127.0.0.1') ||
      llmConfig.apiKey
    ) {
      return 'semantic';
    }
  }

  // Default to structural mode
  return 'structural';
}

/**
 * Default configuration values
 */
const DEFAULT_ANALYSIS_CONFIG: AnalysisConfig = {
  semanticAnalysis: {
    // mode will be inferred automatically based on LLM integration
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
  enableSystemPromptInjection: true,
  enableMethodologyGates: true,
  enableDynamicToolDescriptions: true,
};

const DEFAULT_CHAIN_SESSION_CONFIG: ChainSessionConfig = {
  sessionTimeoutMinutes: 24 * 60,
  reviewTimeoutMinutes: 30,
  cleanupIntervalMinutes: 5,
};

const DEFAULT_CONFIG: Config = {
  server: {
    name: 'Claude Custom Prompts',
    version: '1.0.0',
    port: 3456,
  },
  prompts: {
    file: 'prompts/promptsConfig.json',
  },
  analysis: DEFAULT_ANALYSIS_CONFIG,
  frameworks: DEFAULT_FRAMEWORKS_CONFIG,
  chainSessions: DEFAULT_CHAIN_SESSION_CONFIG,
  transports: {
    default: 'stdio',
    sse: { enabled: false },
    stdio: { enabled: true },
  },
};

/**
 * Configuration manager class
 */
export class ConfigManager extends EventEmitter {
  private config: Config;
  private configPath: string;
  // Removed: private toolDescriptionManager - now injected via dependency injection
  private fileWatcher?: FSWatcher;
  private watching: boolean = false;
  private reloadDebounceTimer?: NodeJS.Timeout;
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
   * Get transports configuration
   */
  getTransportsConfig() {
    return this.config.transports;
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
   * Get frameworks configuration
   */
  getFrameworksConfig(): FrameworksConfig {
    return {
      enableSystemPromptInjection:
        this.config.frameworks?.enableSystemPromptInjection ??
        DEFAULT_FRAMEWORKS_CONFIG.enableSystemPromptInjection,
      enableMethodologyGates:
        this.config.frameworks?.enableMethodologyGates ??
        DEFAULT_FRAMEWORKS_CONFIG.enableMethodologyGates,
      enableDynamicToolDescriptions:
        this.config.frameworks?.enableDynamicToolDescriptions ??
        DEFAULT_FRAMEWORKS_CONFIG.enableDynamicToolDescriptions,
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
   * Get the port number, with environment variable override
   */
  getPort(): number {
    return process.env['PORT'] ? parseInt(process.env['PORT'], 10) : this.config.server.port;
  }

  /**
   * Determine transport from command line arguments or configuration
   */
  getTransport(args: string[]): string {
    const transportArg = args.find((arg: string) => arg.startsWith('--transport='));
    return transportArg ? transportArg.split('=')[1] : this.config.transports.default;
  }

  /**
   * Get config file path
   */
  getConfigPath(): string {
    return this.configPath;
  }

  /**
   * Get prompts file path relative to config directory
   */
  getPromptsFilePath(): string {
    const configDir = path.dirname(this.configPath);
    return path.join(configDir, this.config.prompts.file);
  }

  /**
   * Resolve prompts file path with environment overrides and absolute fallback.
   * Honors MCP_SERVER_ROOT (for relative overrides) and MCP_PROMPTS_CONFIG_PATH.
   */
  getResolvedPromptsFilePath(overridePath?: string): string {
    const serverRootOverride = process.env['MCP_SERVER_ROOT'];
    const defaultBaseDir = serverRootOverride
      ? path.resolve(serverRootOverride)
      : path.dirname(this.configPath);

    let resolvedPath =
      overridePath ??
      process.env['MCP_PROMPTS_CONFIG_PATH'] ??
      this.getPromptsFilePath();

    if (!path.isAbsolute(resolvedPath)) {
      const baseDir =
        overridePath || process.env['MCP_PROMPTS_CONFIG_PATH']
          ? defaultBaseDir
          : path.dirname(this.configPath);
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

    // Ensure transports config exists
    if (!this.config.transports) {
      this.config.transports = DEFAULT_CONFIG.transports;
    } else {
      this.config.transports = {
        ...DEFAULT_CONFIG.transports,
        ...this.config.transports,
      };
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
  }

  /**
   * Validate and merge analysis configuration with defaults
   */
  private validateAnalysisConfig(analysisConfig: Partial<AnalysisConfig>): AnalysisConfig {
    const semanticAnalysis = analysisConfig.semanticAnalysis || ({} as any);

    // Build LLM integration config first
    const llmIntegration = {
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

    // Infer analysis mode based on LLM configuration if not explicitly set
    const validModes: AnalysisMode[] = ['structural', 'semantic'];
    const mode =
      semanticAnalysis.mode && validModes.includes(semanticAnalysis.mode as AnalysisMode)
        ? (semanticAnalysis.mode as AnalysisMode)
        : inferAnalysisMode(llmIntegration);

    return {
      semanticAnalysis: {
        mode,
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
      a.enableSystemPromptInjection !== b.enableSystemPromptInjection ||
      a.enableMethodologyGates !== b.enableMethodologyGates ||
      a.enableDynamicToolDescriptions !== b.enableDynamicToolDescriptions
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
