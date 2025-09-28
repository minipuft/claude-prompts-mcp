/**
 * Configuration Management Module
 * Handles loading and validation of server configuration from config.json
 */

import { readFile } from "fs/promises";
import path from "path";
import { Config, AnalysisConfig, SemanticAnalysisConfig, LLMIntegrationConfig, AnalysisMode, LoggingConfig } from "../types/index.js";
// Removed: ToolDescriptionManager import to break circular dependency
// Now injected via dependency injection pattern

/**
 * Infer the optimal analysis mode based on LLM integration configuration
 */
function inferAnalysisMode(llmConfig: LLMIntegrationConfig): AnalysisMode {
  // Use semantic mode if LLM integration is properly configured
  if (llmConfig.enabled && llmConfig.endpoint) {
    // For non-localhost endpoints, require API key
    if (llmConfig.endpoint.includes('localhost') || llmConfig.endpoint.includes('127.0.0.1') || llmConfig.apiKey) {
      return "semantic";
    }
  }
  
  // Default to structural mode
  return "structural";
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
      model: "gpt-4",
      maxTokens: 1000,
      temperature: 0.1,
    },
  },
};

// DEFAULT_FRAMEWORK_CONFIG removed - framework state managed at runtime
// Use system_control MCP tool to enable/disable and switch frameworks


const DEFAULT_CONFIG: Config = {
  server: {
    name: "Claude Custom Prompts",
    version: "1.0.0",
    port: 3456,
  },
  prompts: {
    file: "prompts/promptsConfig.json",
  },
  analysis: DEFAULT_ANALYSIS_CONFIG,
  transports: {
    default: "stdio",
    sse: { enabled: false },
    stdio: { enabled: true },
  },
};

/**
 * Configuration manager class
 */
export class ConfigManager {
  private config: Config;
  private configPath: string;
  // Removed: private toolDescriptionManager - now injected via dependency injection

  constructor(configPath: string) {
    this.configPath = configPath;
    this.config = DEFAULT_CONFIG;
  }

  /**
   * Load configuration from file
   */
  async loadConfig(): Promise<Config> {
    try {
      const configContent = await readFile(this.configPath, "utf8");
      this.config = JSON.parse(configContent) as Config;

      // Validate and set defaults for any missing properties
      this.validateAndSetDefaults();

      return this.config;
    } catch (error) {
      console.error(
        `Error loading configuration from ${this.configPath}:`,
        error
      );
      console.info("Using default configuration");
      this.config = DEFAULT_CONFIG;
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
   * Get logging configuration
   */
  getLoggingConfig(): LoggingConfig {
    return this.config.logging || {
      directory: "./logs",
      level: "info"
    };
  }

  /**
   * Get the port number, with environment variable override
   */
  getPort(): number {
    return process.env.PORT
      ? parseInt(process.env.PORT, 10)
      : this.config.server.port;
  }

  /**
   * Determine transport from command line arguments or configuration
   */
  getTransport(args: string[]): string {
    const transportArg = args.find((arg: string) =>
      arg.startsWith("--transport=")
    );
    return transportArg
      ? transportArg.split("=")[1]
      : this.config.transports.default;
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
  }

  /**
   * Validate and merge analysis configuration with defaults
   */
  private validateAnalysisConfig(analysisConfig: Partial<AnalysisConfig>): AnalysisConfig {
    const semanticAnalysis = analysisConfig.semanticAnalysis || {} as any;
    
    // Build LLM integration config first
    const llmIntegration = {
      enabled: semanticAnalysis.llmIntegration?.enabled ?? DEFAULT_ANALYSIS_CONFIG.semanticAnalysis.llmIntegration.enabled,
      apiKey: semanticAnalysis.llmIntegration?.apiKey ?? DEFAULT_ANALYSIS_CONFIG.semanticAnalysis.llmIntegration.apiKey,
      endpoint: semanticAnalysis.llmIntegration?.endpoint ?? DEFAULT_ANALYSIS_CONFIG.semanticAnalysis.llmIntegration.endpoint,
      model: semanticAnalysis.llmIntegration?.model ?? DEFAULT_ANALYSIS_CONFIG.semanticAnalysis.llmIntegration.model,
      maxTokens: semanticAnalysis.llmIntegration?.maxTokens ?? DEFAULT_ANALYSIS_CONFIG.semanticAnalysis.llmIntegration.maxTokens,
      temperature: semanticAnalysis.llmIntegration?.temperature ?? DEFAULT_ANALYSIS_CONFIG.semanticAnalysis.llmIntegration.temperature,
    };

    // Infer analysis mode based on LLM configuration if not explicitly set
    const validModes: AnalysisMode[] = ["structural", "semantic"];
    const mode = semanticAnalysis.mode && validModes.includes(semanticAnalysis.mode as AnalysisMode)
      ? semanticAnalysis.mode as AnalysisMode
      : inferAnalysisMode(llmIntegration);

    return {
      semanticAnalysis: {
        mode,
        llmIntegration,
      },
    };
  }
}

/**
 * Create and initialize a configuration manager
 */
export async function createConfigManager(
  configPath: string
): Promise<ConfigManager> {
  const configManager = new ConfigManager(configPath);
  await configManager.loadConfig();
  return configManager;
}

