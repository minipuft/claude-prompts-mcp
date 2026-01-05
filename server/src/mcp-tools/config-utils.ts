// @lifecycle canonical - Utility helpers for reading MCP tool configuration.
/**
 * Configuration Utilities for Safe Config Management
 *
 * Provides atomic config operations with backup/rollback capabilities
 * for secure configuration management in system_control tool.
 */

import { access, copyFile, readFile, writeFile } from 'node:fs/promises';

import { ConfigManager } from '../config/index.js';
import { Logger } from '../logging/index.js';
import { Config } from '../types/index.js';

export const CONFIG_VALID_KEYS = [
  'server.name',
  'server.version',
  'server.port',
  'transport',
  'logging.level',
  'logging.directory',
  'gates.enabled',
  'gates.enableMethodologyGates',
  'execution.judge',
  'frameworks.dynamicToolDescriptions',
  'frameworks.injection.systemPrompt.enabled',
  'frameworks.injection.systemPrompt.frequency',
  'frameworks.injection.styleGuidance',
  'analysis.semanticAnalysis.llmIntegration.enabled',
  'analysis.semanticAnalysis.llmIntegration.model',
  'analysis.semanticAnalysis.llmIntegration.maxTokens',
  'analysis.semanticAnalysis.llmIntegration.temperature',
] as const;

export type ConfigKey = (typeof CONFIG_VALID_KEYS)[number];

export const CONFIG_RESTART_REQUIRED_KEYS: ConfigKey[] = [
  'server.port',
  'transport',
  'analysis.semanticAnalysis.llmIntegration.enabled',
];

export interface ConfigInputValidationResult {
  valid: boolean;
  error?: string;
  convertedValue?: any;
  valueType?: 'string' | 'number' | 'boolean';
}

export function validateConfigInput(key: string, value: string): ConfigInputValidationResult {
  switch (key) {
    case 'server.port': {
      const port = parseInt(value, 10);
      if (isNaN(port) || port < 1024 || port > 65535) {
        return {
          valid: false,
          error: 'Port must be a number between 1024-65535',
        };
      }
      return { valid: true, convertedValue: port, valueType: 'number' };
    }

    case 'server.name':
    case 'server.version':
    case 'logging.directory': {
      const trimmed = value?.trim();
      if (!trimmed) {
        return {
          valid: false,
          error: 'Value cannot be empty',
        };
      }
      return { valid: true, convertedValue: trimmed, valueType: 'string' };
    }

    case 'transport': {
      const normalized = value.trim().toLowerCase();
      if (!['stdio', 'sse', 'both'].includes(normalized)) {
        return {
          valid: false,
          error: "Transport mode must be 'stdio', 'sse', or 'both'",
        };
      }
      return { valid: true, convertedValue: normalized, valueType: 'string' };
    }

    case 'gates.enabled':
    case 'gates.enableMethodologyGates':
    case 'execution.judge':
    case 'frameworks.dynamicToolDescriptions':
    case 'frameworks.injection.systemPrompt.enabled':
    case 'frameworks.injection.styleGuidance': {
      const boolValue = value.trim().toLowerCase();
      if (!['true', 'false'].includes(boolValue)) {
        return {
          valid: false,
          error: "Value must be 'true' or 'false'",
        };
      }
      return {
        valid: true,
        convertedValue: boolValue === 'true',
        valueType: 'boolean',
      };
    }

    case 'frameworks.injection.systemPrompt.frequency': {
      const freq = parseInt(value, 10);
      if (isNaN(freq) || freq < 1 || freq > 100) {
        return {
          valid: false,
          error: 'Frequency must be a number between 1-100',
        };
      }
      return { valid: true, convertedValue: freq, valueType: 'number' };
    }

    case 'logging.level': {
      const normalized = value.trim();
      if (!['debug', 'info', 'warn', 'error'].includes(normalized)) {
        return {
          valid: false,
          error: 'Log level must be: debug, info, warn, or error',
        };
      }
      return { valid: true, convertedValue: normalized, valueType: 'string' };
    }

    case 'analysis.semanticAnalysis.llmIntegration.enabled': {
      const boolValue = value.trim().toLowerCase();
      if (!['true', 'false'].includes(boolValue)) {
        return {
          valid: false,
          error: "Value must be 'true' or 'false'",
        };
      }
      return {
        valid: true,
        convertedValue: boolValue === 'true',
        valueType: 'boolean',
      };
    }

    case 'analysis.semanticAnalysis.llmIntegration.model': {
      const trimmed = value?.trim();
      if (!trimmed) {
        return {
          valid: false,
          error: 'Model name cannot be empty',
        };
      }
      return { valid: true, convertedValue: trimmed, valueType: 'string' };
    }

    case 'analysis.semanticAnalysis.llmIntegration.maxTokens': {
      const tokens = parseInt(value, 10);
      if (isNaN(tokens) || tokens < 1 || tokens > 4000) {
        return {
          valid: false,
          error: 'Max tokens must be a number between 1-4000',
        };
      }
      return { valid: true, convertedValue: tokens, valueType: 'number' };
    }

    case 'analysis.semanticAnalysis.llmIntegration.temperature': {
      const temp = parseFloat(value);
      if (isNaN(temp) || temp < 0 || temp > 2) {
        return {
          valid: false,
          error: 'Temperature must be a number between 0-2',
        };
      }
      return { valid: true, convertedValue: temp, valueType: 'number' };
    }

    default:
      return {
        valid: false,
        error: `Unknown configuration key: ${key}`,
      };
  }
}

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
  async updateConfigValue(
    key: string,
    value: string,
    options?: { createBackup?: boolean }
  ): Promise<ConfigWriteResult> {
    try {
      // Step 1: Validate the operation
      const validation = validateConfigInput(key, value);
      if (!validation.valid) {
        const errorMessage = validation.error ?? 'Unknown validation error';
        return {
          success: false,
          message: `Validation failed: ${errorMessage}`,
          ...(validation.error ? { error: validation.error } : {}),
        };
      }

      // Step 2: Create backup
      const shouldCreateBackup = options?.createBackup !== false;
      const backup = shouldCreateBackup ? await this.createConfigBackup() : undefined;
      if (backup) {
        this.logger.info(`Config backup created: ${backup.backupPath}`);
      }

      // Step 3: Load current config and apply changes
      const currentConfig = this.configManager.getConfig();
      const updatedConfig = this.applyConfigChange(currentConfig, key, validation.convertedValue);

      // Step 4: Validate the entire updated configuration
      const configValidation = this.validateFullConfig(updatedConfig);
      if (!configValidation.valid) {
        return {
          success: false,
          message: `Configuration validation failed: ${configValidation.error}`,
          ...(configValidation.error ? { error: configValidation.error } : {}),
          ...(backup?.backupPath ? { backupPath: backup.backupPath } : {}),
        };
      }

      // Step 5: Write the new configuration atomically
      await this.writeConfigAtomic(updatedConfig);

      // Step 6: Reload ConfigManager to use new config
      await this.configManager.loadConfig();

      return {
        success: true,
        message: `Configuration updated successfully: ${key} = ${value}`,
        ...(backup?.backupPath ? { backupPath: backup.backupPath } : {}),
        restartRequired: this.requiresRestart(key),
      };
    } catch (error) {
      this.logger.error(`Failed to update config ${key}:`, error);
      return {
        success: false,
        message: `Failed to update configuration: ${error}`,
        error: String(error),
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
        originalConfig,
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
        message: `Configuration successfully restored from backup`,
      };
    } catch (error) {
      this.logger.error(`Failed to restore from backup ${backupPath}:`, error);
      return {
        success: false,
        message: `Failed to restore configuration: ${error}`,
        error: String(error),
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
      if (!part) {
        continue;
      }
      if (!current[part]) {
        current[part] = {};
      }
      current = current[part];
    }

    // Set the final value
    const finalKey = parts[parts.length - 1];
    if (finalKey) {
      current[finalKey] = value;
    }

    return newConfig as Config;
  }

  /**
   * Validate the entire configuration object
   */
  private validateFullConfig(config: Config): {
    valid: boolean;
    error?: string;
  } {
    try {
      // Basic structure validation
      if (!config.server) {
        return {
          valid: false,
          error: 'Missing required server configuration section',
        };
      }

      // Server validation
      if (!config.server.name || !config.server.version || !config.server.port) {
        return { valid: false, error: 'Missing required server configuration' };
      }

      if (config.server.port < 1024 || config.server.port > 65535) {
        return { valid: false, error: 'Invalid server port range' };
      }

      // Transport validation
      if (config.transport && !['stdio', 'sse', 'both'].includes(config.transport)) {
        return {
          valid: false,
          error: "Invalid transport mode (must be 'stdio', 'sse', or 'both')",
        };
      }

      // Logging validation (if present)
      if (config.logging) {
        if (!config.logging.directory || !config.logging.level) {
          return {
            valid: false,
            error: 'Missing required logging configuration',
          };
        }

        if (!['debug', 'info', 'warn', 'error'].includes(config.logging.level)) {
          return { valid: false, error: 'Invalid logging level' };
        }
      }

      return { valid: true };
    } catch (error) {
      return {
        valid: false,
        error: `Configuration validation error: ${error}`,
      };
    }
  }

  /**
   * Check if a configuration key requires server restart
   */
  private requiresRestart(key: string): boolean {
    return CONFIG_RESTART_REQUIRED_KEYS.includes(key as ConfigKey);
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
