// @lifecycle canonical - Core service for managing resource version history

import { existsSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import type {
  VersioningConfig,
  VersionEntry,
  HistoryFile,
  SaveVersionResult,
  RollbackResult,
  SaveVersionOptions,
} from './types.js';
import type { ConfigManager } from '../config/index.js';
import type { Logger } from '../logging/index.js';

const HISTORY_FILENAME = '.history.json';

/**
 * Interface for config provider - allows ConfigManager or test doubles
 */
export interface VersioningConfigProvider {
  getVersioningConfig(): VersioningConfig;
}

/**
 * Service for managing version history of resources (prompts, gates, methodologies).
 *
 * Stores version snapshots in sidecar `.history.json` files alongside each resource.
 * Supports automatic versioning on updates, rollback, and version comparison.
 *
 * Config is read from ConfigManager on each operation to support hot-reload.
 */
export class VersionHistoryService {
  private logger: Logger;
  private configProvider: VersioningConfigProvider;

  constructor(deps: { logger: Logger; configManager: VersioningConfigProvider }) {
    this.logger = deps.logger;
    this.configProvider = deps.configManager;
  }

  /**
   * Get current versioning config from ConfigManager
   */
  private getConfig(): VersioningConfig {
    return this.configProvider.getVersioningConfig();
  }

  /**
   * Check if versioning is enabled
   */
  isEnabled(): boolean {
    return this.getConfig().enabled;
  }

  /**
   * Check if auto-versioning is enabled
   */
  isAutoVersionEnabled(): boolean {
    const config = this.getConfig();
    return config.enabled && config.auto_version;
  }

  /**
   * Save a version snapshot before an update.
   *
   * @param resourceDir - Directory containing the resource
   * @param resourceType - Type of resource (prompt, gate, methodology)
   * @param resourceId - ID of the resource
   * @param snapshot - Current state to save as a version
   * @param options - Optional description and diff summary
   */
  async saveVersion(
    resourceDir: string,
    resourceType: 'prompt' | 'gate' | 'methodology',
    resourceId: string,
    snapshot: Record<string, unknown>,
    options?: SaveVersionOptions
  ): Promise<SaveVersionResult> {
    const config = this.getConfig();

    if (!config.enabled) {
      return { success: true, version: 0 };
    }

    try {
      const historyPath = path.join(resourceDir, HISTORY_FILENAME);
      const history = await this.loadHistoryFile(historyPath, resourceType, resourceId);

      const newVersion = history.current_version + 1;
      const entry: VersionEntry = {
        version: newVersion,
        date: new Date().toISOString(),
        snapshot,
        diff_summary: options?.diff_summary ?? '',
        description: options?.description ?? `Version ${newVersion}`,
      };

      // Add new version at the beginning (newest first)
      history.versions.unshift(entry);
      history.current_version = newVersion;

      // Prune old versions if exceeding max
      if (history.versions.length > config.max_versions) {
        history.versions = history.versions.slice(0, config.max_versions);
        this.logger.debug(`Pruned history for ${resourceId} to ${config.max_versions} versions`);
      }

      await this.saveHistoryFile(historyPath, history);

      this.logger.debug(`Saved version ${newVersion} for ${resourceType}/${resourceId}`);
      return { success: true, version: newVersion };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to save version for ${resourceId}: ${message}`);
      return { success: false, error: message };
    }
  }

  /**
   * Load version history for a resource.
   *
   * @param resourceDir - Directory containing the resource
   */
  async loadHistory(resourceDir: string): Promise<HistoryFile | null> {
    const historyPath = path.join(resourceDir, HISTORY_FILENAME);

    if (!existsSync(historyPath)) {
      return null;
    }

    try {
      const content = await fs.readFile(historyPath, 'utf8');
      return JSON.parse(content) as HistoryFile;
    } catch (error) {
      this.logger.error(`Failed to load history from ${historyPath}: ${error}`);
      return null;
    }
  }

  /**
   * Get a specific version snapshot.
   *
   * @param resourceDir - Directory containing the resource
   * @param version - Version number to retrieve
   */
  async getVersion(resourceDir: string, version: number): Promise<VersionEntry | null> {
    const history = await this.loadHistory(resourceDir);

    if (history === null) {
      return null;
    }

    const entry = history.versions.find((v) => v.version === version);
    return entry ?? null;
  }

  /**
   * Get the latest version number for a resource.
   *
   * @param resourceDir - Directory containing the resource
   */
  async getLatestVersion(resourceDir: string): Promise<number> {
    const history = await this.loadHistory(resourceDir);
    return history?.current_version ?? 0;
  }

  /**
   * Rollback to a previous version.
   *
   * This saves the current state as a new version, then returns the snapshot
   * of the requested version for the caller to restore.
   *
   * @param resourceDir - Directory containing the resource
   * @param resourceType - Type of resource
   * @param resourceId - ID of the resource
   * @param targetVersion - Version to rollback to
   * @param currentSnapshot - Current state (to save before rollback)
   */
  async rollback(
    resourceDir: string,
    resourceType: 'prompt' | 'gate' | 'methodology',
    resourceId: string,
    targetVersion: number,
    currentSnapshot: Record<string, unknown>
  ): Promise<RollbackResult & { snapshot?: Record<string, unknown> }> {
    if (!this.isEnabled()) {
      return { success: false, error: 'Versioning is disabled' };
    }

    try {
      // Get the target version
      const targetEntry = await this.getVersion(resourceDir, targetVersion);
      if (targetEntry === null) {
        return { success: false, error: `Version ${targetVersion} not found` };
      }

      // Save current state as new version before rollback
      const saveResult = await this.saveVersion(
        resourceDir,
        resourceType,
        resourceId,
        currentSnapshot,
        {
          description: `Pre-rollback snapshot (before reverting to v${targetVersion})`,
          diff_summary: '',
        }
      );

      if (!saveResult.success) {
        return { success: false, error: `Failed to save current state: ${saveResult.error}` };
      }

      this.logger.info(
        `Rollback ${resourceType}/${resourceId}: saved v${saveResult.version}, restoring v${targetVersion}`
      );

      return {
        success: true,
        saved_version: saveResult.version,
        restored_version: targetVersion,
        snapshot: targetEntry.snapshot,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Rollback failed for ${resourceId}: ${message}`);
      return { success: false, error: message };
    }
  }

  /**
   * Compare two versions and return their snapshots for diffing.
   *
   * @param resourceDir - Directory containing the resource
   * @param fromVersion - First version to compare
   * @param toVersion - Second version to compare
   */
  async compareVersions(
    resourceDir: string,
    fromVersion: number,
    toVersion: number
  ): Promise<{
    success: boolean;
    from?: VersionEntry;
    to?: VersionEntry;
    error?: string;
  }> {
    const fromEntry = await this.getVersion(resourceDir, fromVersion);
    const toEntry = await this.getVersion(resourceDir, toVersion);

    if (fromEntry === null) {
      return { success: false, error: `Version ${fromVersion} not found` };
    }
    if (toEntry === null) {
      return { success: false, error: `Version ${toVersion} not found` };
    }

    return { success: true, from: fromEntry, to: toEntry };
  }

  /**
   * Delete version history for a resource.
   * Called when a resource is deleted.
   *
   * @param resourceDir - Directory containing the resource
   */
  async deleteHistory(resourceDir: string): Promise<boolean> {
    const historyPath = path.join(resourceDir, HISTORY_FILENAME);

    if (!existsSync(historyPath)) {
      return true;
    }

    try {
      await fs.unlink(historyPath);
      this.logger.debug(`Deleted history at ${historyPath}`);
      return true;
    } catch (error) {
      this.logger.error(`Failed to delete history at ${historyPath}: ${error}`);
      return false;
    }
  }

  /**
   * Format history for display in MCP response.
   *
   * @param history - History file to format
   * @param limit - Maximum entries to show (default: 10)
   */
  formatHistoryForDisplay(history: HistoryFile, limit: number = 10): string {
    const parts: string[] = [];

    parts.push(
      `📜 **Version History**: ${history.resource_id} (${history.versions.length} versions)`
    );
    parts.push('');
    parts.push('| Version | Date | Changes | Description |');
    parts.push('|---------|------|---------|-------------|');

    const entries = history.versions.slice(0, limit);
    for (const entry of entries) {
      const date = new Date(entry.date).toLocaleString('en-US', {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
      const current = entry.version === history.current_version ? ' (current)' : '';
      const changes = entry.diff_summary !== '' ? entry.diff_summary : '-';
      parts.push(`| ${entry.version}${current} | ${date} | ${changes} | ${entry.description} |`);
    }

    if (history.versions.length > limit) {
      parts.push('');
      parts.push(`*... and ${history.versions.length - limit} more versions*`);
    }

    return parts.join('\n');
  }

  // ==========================================================================
  // Private Helpers
  // ==========================================================================

  private async loadHistoryFile(
    historyPath: string,
    resourceType: 'prompt' | 'gate' | 'methodology',
    resourceId: string
  ): Promise<HistoryFile> {
    if (existsSync(historyPath)) {
      const content = await fs.readFile(historyPath, 'utf8');
      return JSON.parse(content) as HistoryFile;
    }

    // Create new history file
    return {
      resource_type: resourceType,
      resource_id: resourceId,
      current_version: 0,
      versions: [],
    };
  }

  private async saveHistoryFile(historyPath: string, history: HistoryFile): Promise<void> {
    const content = JSON.stringify(history, null, 2);
    await fs.writeFile(historyPath, content, 'utf8');
  }
}
