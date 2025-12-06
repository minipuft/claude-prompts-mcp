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
  AnalysisMode,
  LoggingConfig,
  FrameworksConfig,
  ChainSessionConfig,
  JudgeConfig,
  GatesConfig,
  TransportMode,
} from '../types/index.js';
import { DEFAULT_INJECTION_CONFIG, type InjectionConfig } from '../execution/pipeline/decisions/injection/index.js';
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
  systemPromptReinjectionFrequency: 2,
};

const DEFAULT_GATES_CONFIG: GatesConfig = {
  definitionsDirectory: 'src/gates/definitions',
  templatesDirectory: 'src/gates/templates',
  enabled: true,
};

const DEFAULT_CHAIN_SESSION_CONFIG: ChainSessionConfig = {
  sessionTimeoutMinutes: 24 * 60,
  reviewTimeoutMinutes: 30,
  cleanupIntervalMinutes: 5,
};

const DEFAULT_JUDGE_CONFIG: JudgeConfig = {
  enabled: true,
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
    file: 'prompts/promptsConfig.json',
  },
  analysis: DEFAULT_ANALYSIS_CONFIG,
  gates: DEFAULT_GATES_CONFIG,
  frameworks: DEFAULT_FRAMEWORKS_CONFIG,
  chainSessions: DEFAULT_CHAIN_SESSION_CONFIG,
  transport: DEFAULT_TRANSPORT_MODE,
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
   * Get global registerWithMcp default from prompts config
   * Returns undefined if not specified (allowing downstream defaults)
   */
  getPromptsRegisterWithMcp(): boolean | undefined {
    return this.config.prompts?.registerWithMcp;
  }

  /**
   * Get the transport mode from config
   * Priority: CLI args (handled by caller) > config.transport > legacy transports.default > default
   */
  getTransportMode(): TransportMode {
    // New simplified field takes priority
    if (this.config.transport) {
      return this.config.transport;
    }

    // Backward compatibility: check legacy transports.default
    if (this.config.transports?.default) {
      const legacyMode = this.config.transports.default;
      // Validate and map legacy value
      if (legacyMode === 'stdio' || legacyMode === 'sse' || legacyMode === 'both') {
        logger.warn(
          '[ConfigManager] DEPRECATION: transports.default is deprecated. ' +
            'Use "transport": "' + legacyMode + '" instead. ' +
            'See docs/operations-guide.md for migration details.'
        );
        return legacyMode;
      }
    }

    // Default to STDIO for Claude Desktop compatibility
    return DEFAULT_TRANSPORT_MODE;
  }

  /**
   * Get transports configuration
   * @deprecated Use getTransportMode() instead
   */
  getTransportsConfig() {
    // Provide backward-compatible response for legacy consumers
    const mode = this.getTransportMode();
    return {
      default: mode,
      sse: { enabled: mode === 'sse' || mode === 'both' },
      stdio: { enabled: mode === 'stdio' || mode === 'both' },
    };
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
      systemPromptReinjectionFrequency:
        this.config.frameworks?.systemPromptReinjectionFrequency ??
        DEFAULT_FRAMEWORKS_CONFIG.systemPromptReinjectionFrequency,
    };
  }

  /**
   * Get gates configuration
   */
  getGatesConfig(): GatesConfig {
    const gatesConfig: Partial<GatesConfig> = this.config.gates ?? {};
    return {
      definitionsDirectory:
        gatesConfig.definitionsDirectory ?? DEFAULT_GATES_CONFIG.definitionsDirectory,
      templatesDirectory:
        gatesConfig.templatesDirectory ?? DEFAULT_GATES_CONFIG.templatesDirectory,
      enabled: gatesConfig.enabled ?? DEFAULT_GATES_CONFIG.enabled,
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
   * Get judge selection system configuration
   */
  getJudgeConfig(): JudgeConfig {
    const judgeConfig: Partial<JudgeConfig> = this.config.judge ?? {};
    return {
      enabled: judgeConfig.enabled ?? DEFAULT_JUDGE_CONFIG.enabled,
    };
  }

  /**
   * Get injection control configuration.
   * Supports backward compatibility with frameworks.systemPromptReinjectionFrequency.
   */
  getInjectionConfig(): InjectionConfig {
    // If injection config exists, use it directly
    if (this.config.injection) {
      return {
        ...DEFAULT_INJECTION_CONFIG,
        ...this.config.injection,
      };
    }

    // Backward compatibility: map legacy frameworks.systemPromptReinjectionFrequency
    const legacyFrequency = this.config.frameworks?.systemPromptReinjectionFrequency;
    if (legacyFrequency !== undefined) {
      logger.warn(
        '[ConfigManager] DEPRECATION: frameworks.systemPromptReinjectionFrequency is deprecated. ' +
          'Use injection.system-prompt.frequency instead. ' +
          'See docs/architecture.md for migration guide.'
      );

      return {
        ...DEFAULT_INJECTION_CONFIG,
        'system-prompt': {
          enabled: true,
          frequency: {
            mode: legacyFrequency === 0 ? 'first-only' : 'every',
            interval: legacyFrequency === 0 ? undefined : legacyFrequency,
          },
        },
      };
    }

    return DEFAULT_INJECTION_CONFIG;
  }

  /**
   * Get the port number, with environment variable override
   */
  getPort(): number {
    return process.env['PORT'] ? parseInt(process.env['PORT'], 10) : this.config.server.port;
  }

  /**
   * Determine transport from command line arguments or configuration
   * Priority: CLI args > config.transport > default (stdio)
   *
   * @deprecated Use getTransportMode() for the raw config value.
   * This method is kept for backward compatibility with CLI arg parsing.
   */
  getTransport(args: string[]): TransportMode {
    // CLI argument takes highest priority
    const transportArg = args.find((arg: string) => arg.startsWith('--transport='));
    if (transportArg) {
      const value = transportArg.split('=')[1];
      // Validate CLI arg
      if (value === 'stdio' || value === 'sse' || value === 'both') {
        return value;
      }
      logger.warn(`Invalid --transport value: "${value}". Using config default.`);
    }

    // Fall back to config value (which handles backward compat internally)
    return this.getTransportMode();
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
      overridePath ?? process.env['MCP_PROMPTS_CONFIG_PATH'] ?? this.getPromptsFilePath();

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

    // Ensure transport mode is set
    // Prioritize new simplified 'transport' field, fall back to legacy 'transports.default'
    if (!this.config.transport) {
      if (this.config.transports?.default) {
        // Legacy config detected - migration handled in getTransportMode()
        // Don't set transport here to preserve deprecation warning
      } else {
        this.config.transport = DEFAULT_TRANSPORT_MODE;
      }
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

    // Ensure judge config exists
    if (!this.config.judge) {
      this.config.judge = { ...DEFAULT_JUDGE_CONFIG };
    } else {
      this.config.judge = {
        enabled: this.config.judge.enabled ?? DEFAULT_JUDGE_CONFIG.enabled,
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
      a.enableDynamicToolDescriptions !== b.enableDynamicToolDescriptions ||
      a.systemPromptReinjectionFrequency !== b.systemPromptReinjectionFrequency
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
