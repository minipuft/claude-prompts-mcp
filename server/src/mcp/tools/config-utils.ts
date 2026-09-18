// @lifecycle canonical - Utility helpers for reading MCP tool configuration.
/**
 * Configuration Utilities for Safe Config Management
 *
 * Provides atomic config operations with automatic backup for secure configuration
 * management in system_control tool. Restoring a backup has no caller (measured
 * 2026-09-17, P4.52/R36) and was removed with `getConfigPath()`, which had none either.
 *
 * NO KEY LIST, NO VALIDATOR, NO SECOND WRITER, NO RE-EXPORT (ruling R54)
 * This file used to define its own `CONFIG_VALID_KEYS` (24 keys against cli-shared's 60) and its
 * own `validateConfigInput` switch, so the same `key=value` could be valid on the CLI and unknown
 * over MCP. Both are gone: `#cli-shared/config-input-validator.js` owns validation, driven by the
 * table generated from `ConfigFile`. This file used to also re-export `CONFIG_VALID_KEYS` /
 * `CONFIG_RESTART_REQUIRED_KEYS` / `validateConfigInput` as a second import path onto the same
 * surface — a path nothing outside this module actually took (`config-action-handler.ts` already
 * imported straight from cli-shared). Two import paths to one implementation still let a reader
 * land on either name and believe they were reading two surfaces; the re-export block is gone, so
 * `#cli-shared/config-input-validator.js` is the only place this surface is imported from.
 *
 * It also used to WRITE `configManager.getConfig()` back to disk — the RESOLVED runtime object.
 * That persisted defaults nobody typed, and dropped every section the loader does not map onto
 * `Config` (`hooks`), so toggling one boolean rewrote the operator's whole file. The writer now
 * reads the DOCUMENT through `#cli-shared/config-operations.js`, sets one dotted key, and writes
 * it back; `getConfig()` is never consulted on the write path.
 */

import {
  CONFIG_RESTART_REQUIRED_KEYS,
  validateConfigInput,
  type ConfigKey,
} from '#cli-shared/config-input-validator.js';
import {
  applyConfigChange,
  backupConfig,
  readConfigFile,
  validateConfigDocument,
  writeConfigAtomic,
} from '#cli-shared/config-operations.js';
import { type ConfigManager, type Logger } from '#shared/types/index.js';

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
 * Configuration backup information.
 *
 * `originalConfig` is the DOCUMENT that was on disk before the write, not a resolved `Config` —
 * a backup of anything else would restore a file the operator never wrote.
 */
export interface ConfigBackup {
  backupPath: string;
  timestamp: number;
  originalConfig: Record<string, unknown>;
}

/**
 * Safe Configuration Writer
 * Provides atomic config operations with automatic backup
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
   * Safely update a configuration value with atomic operations.
   *
   * The order is the contract: validate the candidate, read the file, apply one key, validate the
   * whole resulting DOCUMENT, then write. Nothing reaches disk until both checks pass.
   */
  async updateConfigValue(
    key: string,
    value: string,
    options?: { createBackup?: boolean }
  ): Promise<ConfigWriteResult> {
    try {
      // Step 1: Validate the candidate against the generated key table
      const validation = validateConfigInput(key, value);
      if (!validation.valid) {
        const errorMessage = validation.error ?? 'Unknown validation error';
        return {
          success: false,
          message: `Validation failed: ${errorMessage}`,
          ...(validation.error ? { error: validation.error } : {}),
        };
      }

      // Step 2: Read the config DOCUMENT — never `getConfig()`, which is the resolved runtime shape
      const read = readConfigFile(this.configPath);
      if (!read.success || !read.config) {
        const errorMessage = read.error ?? `Could not read ${this.configPath}`;
        return {
          success: false,
          message: `Failed to read configuration: ${errorMessage}`,
          error: errorMessage,
        };
      }

      // Step 3: Create backup
      const shouldCreateBackup = options?.createBackup !== false;
      const backup = shouldCreateBackup ? this.createConfigBackup(read.config) : undefined;
      if (backup) {
        this.logger.info(`Config backup created: ${backup.backupPath}`);
      }

      // Step 4: Apply the single change, preserving every other key and their order
      const updatedConfig = applyConfigChange(read.config, key, validation.convertedValue);

      // Step 5: Validate the entire updated document
      const documentCheck = validateConfigDocument(updatedConfig);
      if (!documentCheck.valid) {
        const errorMessage = documentCheck.errors.join('; ');
        return {
          success: false,
          message: `Configuration validation failed: ${errorMessage}`,
          error: errorMessage,
          ...(backup?.backupPath ? { backupPath: backup.backupPath } : {}),
        };
      }

      // Step 6: Write the new configuration atomically
      writeConfigAtomic(this.configPath, updatedConfig);

      // Step 7: Reload ConfigManager to use new config
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
   * Create a timestamped backup of the current configuration file.
   */
  private createConfigBackup(originalConfig: Record<string, unknown>): ConfigBackup {
    try {
      const backupPath = backupConfig(this.configPath);
      this.logger.debug(`Config backup created: ${backupPath}`);
      return {
        backupPath,
        timestamp: Date.now(),
        originalConfig,
      };
    } catch (error) {
      this.logger.error(`Failed to create config backup:`, error);
      throw new Error(`Backup creation failed: ${error}`, { cause: error });
    }
  }

  /**
   * Check if a configuration key requires server restart
   */
  private requiresRestart(key: string): boolean {
    return CONFIG_RESTART_REQUIRED_KEYS.includes(key as ConfigKey);
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
