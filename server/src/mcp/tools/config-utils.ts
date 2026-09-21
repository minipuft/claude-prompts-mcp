// @lifecycle canonical - Utility helpers for reading MCP tool configuration.
/**
 * Configuration Utilities for Safe Config Management
 *
 * Provides atomic, checkpointed config writes for the `system_control` tool.
 *
 * NO BACKUP FILES (ruling R53, O.9)
 * This class used to carry `createConfigBackup`, which copied the config beside itself as
 * `config.json[c].backup.<epoch-ms>`. Nothing read one: `restoreFromBackup` lost its last caller
 * when PR #312 retired `system_control config restore` (2026-09-15) and was deleted at P4.81, and
 * both production callers of `updateConfigValue` passed `createBackup: false` — so the only thing
 * still reaching it was its own unit test. A config write is now a `version_history` row carrying
 * the file's bytes (`#cli-shared/config-checkpoint.js`), which `cpm config history` lists and
 * `cpm config rollback` puts back. A timestamped copy nothing can restore is not a backup.
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
 * reads the DOCUMENT through `#cli-shared/config-operations.js` and edits one key's characters in
 * the file itself; `getConfig()` is never consulted on the write path. The parsed document is
 * still built, but only to validate what the file will mean — a write that re-serialized it would
 * strip every comment out of an operator's `config.jsonc` the first time anyone toggled a gate.
 */

import { recordConfigWrite } from '#cli-shared/config-checkpoint.js';
import {
  CONFIG_RESTART_REQUIRED_KEYS,
  validateConfigInput,
  type ConfigKey,
} from '#cli-shared/config-input-validator.js';
import {
  applyConfigChange,
  readConfigFile,
  validateConfigDocument,
  writeConfigKeyAtomic,
} from '#cli-shared/config-operations.js';
import { type ConfigManager, type Logger } from '#shared/types/index.js';

/**
 * Configuration write result
 */
export interface ConfigWriteResult {
  success: boolean;
  message: string;
  error?: string;
  restartRequired?: boolean;
}

/**
 * Safe Configuration Writer
 * Validates a candidate, edits one key's characters in place, and records the result as a version.
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
  async updateConfigValue(key: string, value: string): Promise<ConfigWriteResult> {
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

      // Step 3: Build the candidate document — what the file will mean once the key is set
      const updatedConfig = applyConfigChange(read.config, key, validation.convertedValue);

      // Step 4: Validate the entire updated document
      const documentCheck = validateConfigDocument(updatedConfig);
      if (!documentCheck.valid) {
        const errorMessage = documentCheck.errors.join('; ');
        return {
          success: false,
          message: `Configuration validation failed: ${errorMessage}`,
          error: errorMessage,
        };
      }

      // Step 5: Edit that one key's characters in the file the operator owns — a toggle over MCP
      // must not cost them the comments and layout they wrote — and record it as a config version.
      //
      // The SAME checkpoint `cpm config set` takes, through the same function. `system_control`
      // gate and framework toggles write this file (`persistGateConfig`, `persistFrameworkConfig`)
      // and recorded nothing before O.9, so an operator who toggled gates over MCP and then ran
      // `cpm config history` saw a history missing the change they were looking at. A failure to
      // record puts the file back byte-identical and is reported, never swallowed.
      const record = await recordConfigWrite(this.configPath, `Set ${key}`, () => {
        writeConfigKeyAtomic(this.configPath, key, validation.convertedValue);
      });
      if (!record.written) {
        return {
          success: false,
          message: `Failed to update configuration: ${record.error}`,
          error: record.error,
        };
      }
      if (!record.recorded) {
        this.logger.debug(`Config change not recorded as a version: ${record.reason}`);
      }

      // Step 6: Reload ConfigManager to use new config
      await this.configManager.loadConfig();

      return {
        success: true,
        message: `Configuration updated successfully: ${key} = ${value}`,
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
