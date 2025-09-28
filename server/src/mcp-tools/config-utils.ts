/**
 * Configuration Utilities for Safe Config Management
 *
 * Provides atomic config operations with backup/rollback capabilities
 * for secure configuration management in system_control tool.
 */

import { writeFile, readFile, copyFile, access } from "fs/promises";
import path from "path";
import { Config } from "../types/index.js";
import { ConfigManager } from "../config/index.js";
import { Logger } from "../logging/index.js";

/**
 * Configuration write result
 */
export interface ConfigWriteResult {
  success: boolean;
  message: string;
  backupPath?: string;
  error?: string;
  restartRequired?: boolean;
}

/**
 * Configuration backup information
 */
export interface ConfigBackup {
  backupPath: string;
  timestamp: number;
  originalConfig: Config;
}

/**
 * Safe Configuration Writer
 * Provides atomic config operations with automatic backup and rollback
 */
export class SafeConfigWriter {
  private logger: Logger;
  private configManager: ConfigManager;
  private configPath: string;

  constructor(logger: Logger, configManager: ConfigManager, configPath: string) {
    this.logger = logger;
    this.configManager = configManager;
    this.configPath = configPath;
  }

  /**
   * Safely update a configuration value with atomic operations
   */
  async updateConfigValue(key: string, value: string): Promise<ConfigWriteResult> {
    try {
      // Step 1: Validate the operation
      const validation = this.validateConfigUpdate(key, value);
      if (!validation.valid) {
        return {
          success: false,
          message: `Validation failed: ${validation.error}`,
          error: validation.error
        };
      }

      // Step 2: Create backup
      const backup = await this.createConfigBackup();
      this.logger.info(`Config backup created: ${backup.backupPath}`);

      // Step 3: Load current config and apply changes
      const currentConfig = this.configManager.getConfig();
      const updatedConfig = this.applyConfigChange(currentConfig, key, validation.convertedValue);

      // Step 4: Validate the entire updated configuration
      const configValidation = this.validateFullConfig(updatedConfig);
      if (!configValidation.valid) {
        return {
          success: false,
          message: `Configuration validation failed: ${configValidation.error}`,
          error: configValidation.error,
          backupPath: backup.backupPath
        };
      }

      // Step 5: Write the new configuration atomically
      await this.writeConfigAtomic(updatedConfig);

      // Step 6: Reload ConfigManager to use new config
      await this.configManager.loadConfig();

      return {
        success: true,
        message: `Configuration updated successfully: ${key} = ${value}`,
        backupPath: backup.backupPath,
        restartRequired: this.requiresRestart(key)
      };

    } catch (error) {
      this.logger.error(`Failed to update config ${key}:`, error);
      return {
        success: false,
        message: `Failed to update configuration: ${error}`,
        error: String(error)
      };
    }
  }

  /**
   * Create a timestamped backup of the current configuration
   */
  private async createConfigBackup(): Promise<ConfigBackup> {
    const timestamp = Date.now();
    const backupPath = `${this.configPath}.backup.${timestamp}`;

    try {
      await copyFile(this.configPath, backupPath);
      const originalConfig = this.configManager.getConfig();

      this.logger.debug(`Config backup created: ${backupPath}`);
      return {
        backupPath,
        timestamp,
        originalConfig
      };
    } catch (error) {
      this.logger.error(`Failed to create config backup:`, error);
      throw new Error(`Backup creation failed: ${error}`);
    }
  }

  /**
   * Restore configuration from backup
   */
  async restoreFromBackup(backupPath: string): Promise<ConfigWriteResult> {
    try {
      // Verify backup exists
      await access(backupPath);

      // Restore the backup
      await copyFile(backupPath, this.configPath);

      // Reload configuration
      await this.configManager.loadConfig();

      this.logger.info(`Configuration restored from backup: ${backupPath}`);

      return {
        success: true,
        message: `Configuration successfully restored from backup`
      };

    } catch (error) {
      this.logger.error(`Failed to restore from backup ${backupPath}:`, error);
      return {
        success: false,
        message: `Failed to restore configuration: ${error}`,
        error: String(error)
      };
    }
  }

  /**
   * Write configuration file atomically (write to temp file, then rename)
   */
  private async writeConfigAtomic(config: Config): Promise<void> {
    const tempPath = `${this.configPath}.tmp`;

    try {
      // Write to temporary file first
      const configJson = JSON.stringify(config, null, 2);
      await writeFile(tempPath, configJson, 'utf8');

      // Validate the written file can be parsed
      const testContent = await readFile(tempPath, 'utf8');
      JSON.parse(testContent); // Will throw if invalid

      // Atomic rename (this is the atomic operation)
      const fs = await import('fs');
      fs.renameSync(tempPath, this.configPath);

      this.logger.debug('Configuration written atomically');

    } catch (error) {
      // Clean up temp file if it exists
      try {
        const fs = await import('fs');
        if (fs.existsSync(tempPath)) {
          fs.unlinkSync(tempPath);
        }
      } catch (cleanupError) {
        this.logger.warn(`Failed to clean up temp file ${tempPath}:`, cleanupError);
      }
      throw error;
    }
  }

  /**
   * Apply a configuration change to a config object
   */
  private applyConfigChange(config: Config, key: string, value: any): Config {
    // Deep clone the config to avoid mutations
    const newConfig = JSON.parse(JSON.stringify(config));

    // Apply the change using dot notation
    const parts = key.split('.');
    let current: any = newConfig;

    // Navigate to the parent object
    for (let i = 0; i < parts.length - 1; i++) {
      const part = parts[i];
      if (!current[part]) {
        current[part] = {};
      }
      current = current[part];
    }

    // Set the final value
    const finalKey = parts[parts.length - 1];
    current[finalKey] = value;

    return newConfig as Config;
  }

  /**
   * Validate a configuration update
   */
  private validateConfigUpdate(key: string, value: string): { valid: boolean; error?: string; convertedValue?: any } {
    // Use the same validation logic as system-control
    switch (key) {
      case 'server.port':
        const port = parseInt(value, 10);
        if (isNaN(port) || port < 1024 || port > 65535) {
          return { valid: false, error: "Port must be a number between 1024-65535" };
        }
        return { valid: true, convertedValue: port };

      case 'server.name':
      case 'server.version':
      case 'logging.directory':
        if (!value || value.trim().length === 0) {
          return { valid: false, error: "Value cannot be empty" };
        }
        return { valid: true, convertedValue: value.trim() };

      case 'transports.default':
        if (!['stdio', 'sse'].includes(value)) {
          return { valid: false, error: "Transport must be 'stdio' or 'sse'" };
        }
        return { valid: true, convertedValue: value };

      case 'transports.stdio.enabled':
      case 'transports.sse.enabled':
        const boolValue = value.toLowerCase();
        if (!['true', 'false'].includes(boolValue)) {
          return { valid: false, error: "Value must be 'true' or 'false'" };
        }
        return { valid: true, convertedValue: boolValue === 'true' };

      case 'logging.level':
        if (!['debug', 'info', 'warn', 'error'].includes(value)) {
          return { valid: false, error: "Log level must be: debug, info, warn, or error" };
        }
        return { valid: true, convertedValue: value };

      case 'analysis.semanticAnalysis.llmIntegration.enabled':
        const analysisEnabled = value.toLowerCase();
        if (!['true', 'false'].includes(analysisEnabled)) {
          return { valid: false, error: "Value must be 'true' or 'false'" };
        }
        return { valid: true, convertedValue: analysisEnabled === 'true' };

      case 'analysis.semanticAnalysis.llmIntegration.model':
        if (!value || value.trim().length === 0) {
          return { valid: false, error: "Model name cannot be empty" };
        }
        return { valid: true, convertedValue: value.trim() };

      case 'analysis.semanticAnalysis.llmIntegration.maxTokens':
        const tokens = parseInt(value, 10);
        if (isNaN(tokens) || tokens < 1 || tokens > 4000) {
          return { valid: false, error: "Max tokens must be a number between 1-4000" };
        }
        return { valid: true, convertedValue: tokens };

      case 'analysis.semanticAnalysis.llmIntegration.temperature':
        const temp = parseFloat(value);
        if (isNaN(temp) || temp < 0 || temp > 2) {
          return { valid: false, error: "Temperature must be a number between 0-2" };
        }
        return { valid: true, convertedValue: temp };

      default:
        return { valid: false, error: `Unknown configuration key: ${key}` };
    }
  }

  /**
   * Validate the entire configuration object
   */
  private validateFullConfig(config: Config): { valid: boolean; error?: string } {
    try {
      // Basic structure validation
      if (!config.server || !config.transports) {
        return { valid: false, error: "Missing required configuration sections" };
      }

      // Server validation
      if (!config.server.name || !config.server.version || !config.server.port) {
        return { valid: false, error: "Missing required server configuration" };
      }

      if (config.server.port < 1024 || config.server.port > 65535) {
        return { valid: false, error: "Invalid server port range" };
      }

      // Transports validation
      if (!['stdio', 'sse'].includes(config.transports.default)) {
        return { valid: false, error: "Invalid default transport" };
      }

      if (typeof config.transports.stdio?.enabled !== 'boolean' ||
          typeof config.transports.sse?.enabled !== 'boolean') {
        return { valid: false, error: "Transport enabled flags must be boolean" };
      }

      // Logging validation (if present)
      if (config.logging) {
        if (!config.logging.directory || !config.logging.level) {
          return { valid: false, error: "Missing required logging configuration" };
        }

        if (!['debug', 'info', 'warn', 'error'].includes(config.logging.level)) {
          return { valid: false, error: "Invalid logging level" };
        }
      }

      return { valid: true };

    } catch (error) {
      return { valid: false, error: `Configuration validation error: ${error}` };
    }
  }

  /**
   * Check if a configuration key requires server restart
   */
  private requiresRestart(key: string): boolean {
    const restartRequired = [
      'server.port',
      'transports.default',
      'transports.stdio.enabled',
      'transports.sse.enabled',
      'analysis.semanticAnalysis.llmIntegration.enabled'
    ];
    return restartRequired.includes(key);
  }

  /**
   * Get the configuration file path for debugging/info purposes
   */
  getConfigPath(): string {
    return this.configPath;
  }
}

/**
 * Create a SafeConfigWriter instance
 */
export function createSafeConfigWriter(
  logger: Logger,
  configManager: ConfigManager,
  configPath: string
): SafeConfigWriter {
  return new SafeConfigWriter(logger, configManager, configPath);
}