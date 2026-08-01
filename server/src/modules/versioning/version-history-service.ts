// @lifecycle canonical - Core service for managing resource version history

import type { VersioningConfig, Logger } from '#shared/types/index.js';
import type { DatabasePort } from '#shared/types/persistence.js';
import type {
  VersionEntry,
  HistoryFile,
  SaveVersionResult,
  RollbackResult,
  SaveVersionOptions,
} from './types.js';

type ResourceType = 'prompt' | 'gate' | 'framework';

interface VersionRow {
  id: number;
  version: number;
  snapshot: string;
  diff_summary: string;
  description: string;
  created_at: string;
  resource_type: string;
  resource_id: string;
}

/**
 * Interface for config provider - allows ConfigManager or test doubles.
 * Requires both versioning config and serverRoot for SQLite access.
 */
export interface VersioningConfigProvider {
  getVersioningConfig(): VersioningConfig;
  getServerRoot(): string;
}

/**
 * Service for managing version history of resources (prompts, gates, frameworks).
 *
 * Persists version snapshots in the SQLite `version_history` table via SqliteEngine.
 * Supports automatic versioning on updates, rollback, and version comparison.
 *
 * Config is read from ConfigManager on each operation to support hot-reload.
 */
export class VersionHistoryService {
  private logger: Logger;
  private configProvider: VersioningConfigProvider;
  private dbManager: DatabasePort | null;

  constructor(deps: {
    logger: Logger;
    configManager: VersioningConfigProvider;
    dbManager?: DatabasePort;
  }) {
    this.logger = deps.logger;
    this.configProvider = deps.configManager;
    this.dbManager = deps.dbManager ?? null;
  }

  /** Late-bind DatabasePort (setter injection, matching codebase convention). */
  setDatabasePort(db: DatabasePort): void {
    this.dbManager = db;
  }

  /**
   * Get database instance.
   * Requires DatabasePort to be injected via constructor or setDatabasePort().
   */
  private getDb(): DatabasePort {
    if (!this.dbManager) {
      throw new Error(
        'VersionHistoryService: DatabasePort not provided. Pass dbManager in constructor or call setDatabasePort().'
      );
    }
    return this.dbManager;
  }

  private getConfig(): VersioningConfig {
    return this.configProvider.getVersioningConfig();
  }

  isEnabled(): boolean {
    return this.getConfig().enabled;
  }

  isAutoVersionEnabled(): boolean {
    const config = this.getConfig();
    return config.enabled && config.auto_version;
  }

  /**
   * Save a version snapshot before an update.
   */
  async saveVersion(
    resourceType: ResourceType,
    resourceId: string,
    snapshot: Record<string, unknown>,
    options?: SaveVersionOptions
  ): Promise<SaveVersionResult> {
    const config = this.getConfig();

    if (!config.enabled) {
      return { success: true, version: 0 };
    }

    try {
      const db = this.getDb();

      // Get current max version
      const row = db.queryOne<{ max_version: number | null }>(
        `SELECT MAX(version) as max_version FROM version_history
         WHERE tenant_id = 'default' AND resource_type = ? AND resource_id = ?`,
        [resourceType, resourceId]
      );
      const currentVersion = row?.max_version ?? 0;
      const newVersion = currentVersion + 1;

      // Insert new version
      db.run(
        `INSERT INTO version_history (tenant_id, resource_type, resource_id, version, snapshot, diff_summary, description, created_at)
         VALUES ('default', ?, ?, ?, ?, ?, ?, ?)`,
        [
          resourceType,
          resourceId,
          newVersion,
          JSON.stringify(snapshot),
          options?.diff_summary ?? '',
          options?.description ?? `Version ${newVersion}`,
          new Date().toISOString(),
        ]
      );

      // Prune old versions if exceeding max
      const count = db.queryOne<{ cnt: number }>(
        `SELECT COUNT(*) as cnt FROM version_history
         WHERE tenant_id = 'default' AND resource_type = ? AND resource_id = ?`,
        [resourceType, resourceId]
      );

      if (count && count.cnt > config.max_versions) {
        db.run(
          `DELETE FROM version_history WHERE id NOT IN (
            SELECT id FROM version_history
            WHERE tenant_id = 'default' AND resource_type = ? AND resource_id = ?
            ORDER BY version DESC LIMIT ?
          ) AND tenant_id = 'default' AND resource_type = ? AND resource_id = ?`,
          [resourceType, resourceId, config.max_versions, resourceType, resourceId]
        );
        this.logger.debug(`Pruned history for ${resourceId} to ${config.max_versions} versions`);
      }

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
   */
  async loadHistory(resourceType: ResourceType, resourceId: string): Promise<HistoryFile | null> {
    try {
      const db = this.getDb();

      const rows = db.query<VersionRow>(
        `SELECT version, snapshot, diff_summary, description, created_at
         FROM version_history
         WHERE tenant_id = 'default' AND resource_type = ? AND resource_id = ?
         ORDER BY version DESC`,
        [resourceType, resourceId]
      );

      if (rows.length === 0) {
        return null;
      }

      const versions: VersionEntry[] = rows.map((row) => ({
        version: row.version,
        date: row.created_at,
        snapshot: JSON.parse(row.snapshot) as Record<string, unknown>,
        diff_summary: row.diff_summary,
        description: row.description,
      }));

      const currentVersion = versions[0]?.version ?? 0;

      return {
        resource_type: resourceType,
        resource_id: resourceId,
        current_version: currentVersion,
        versions,
      };
    } catch (error) {
      this.logger.error(`Failed to load history for ${resourceType}/${resourceId}: ${error}`);
      return null;
    }
  }

  /**
   * Get a specific version snapshot.
   */
  async getVersion(
    resourceType: ResourceType,
    resourceId: string,
    version: number
  ): Promise<VersionEntry | null> {
    try {
      const db = this.getDb();

      const row = db.queryOne<VersionRow>(
        `SELECT version, snapshot, diff_summary, description, created_at
         FROM version_history
         WHERE tenant_id = 'default' AND resource_type = ? AND resource_id = ? AND version = ?`,
        [resourceType, resourceId, version]
      );

      if (!row) {
        return null;
      }

      return {
        version: row.version,
        date: row.created_at,
        snapshot: JSON.parse(row.snapshot) as Record<string, unknown>,
        diff_summary: row.diff_summary,
        description: row.description,
      };
    } catch (error) {
      this.logger.error(
        `Failed to get version ${version} for ${resourceType}/${resourceId}: ${error}`
      );
      return null;
    }
  }

  /**
   * Get the latest version number for a resource.
   */
  async getLatestVersion(resourceType: ResourceType, resourceId: string): Promise<number> {
    try {
      const db = this.getDb();

      const row = db.queryOne<{ max_version: number | null }>(
        `SELECT MAX(version) as max_version FROM version_history
         WHERE tenant_id = 'default' AND resource_type = ? AND resource_id = ?`,
        [resourceType, resourceId]
      );

      return row?.max_version ?? 0;
    } catch {
      return 0;
    }
  }

  /**
   * Rollback to a previous version.
   *
   * Saves the current state as a new version, then returns the snapshot
   * of the requested version for the caller to restore.
   */
  async rollback(
    resourceType: ResourceType,
    resourceId: string,
    targetVersion: number,
    currentSnapshot: Record<string, unknown>
  ): Promise<RollbackResult & { snapshot?: Record<string, unknown> }> {
    if (!this.isEnabled()) {
      return { success: false, error: 'Versioning is disabled' };
    }

    try {
      const targetEntry = await this.getVersion(resourceType, resourceId, targetVersion);
      if (targetEntry === null) {
        return { success: false, error: `Version ${targetVersion} not found` };
      }

      // Save current state as new version before rollback
      const saveResult = await this.saveVersion(resourceType, resourceId, currentSnapshot, {
        description: `Pre-rollback snapshot (before reverting to v${targetVersion})`,
        diff_summary: '',
      });

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
   */
  async compareVersions(
    resourceType: ResourceType,
    resourceId: string,
    fromVersion: number,
    toVersion: number
  ): Promise<{
    success: boolean;
    from?: VersionEntry;
    to?: VersionEntry;
    error?: string;
  }> {
    const fromEntry = await this.getVersion(resourceType, resourceId, fromVersion);
    const toEntry = await this.getVersion(resourceType, resourceId, toVersion);

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
   */
  async deleteHistory(resourceType: ResourceType, resourceId: string): Promise<boolean> {
    try {
      const db = this.getDb();

      db.run(
        `DELETE FROM version_history
         WHERE tenant_id = 'default' AND resource_type = ? AND resource_id = ?`,
        [resourceType, resourceId]
      );

      this.logger.debug(`Deleted history for ${resourceType}/${resourceId}`);
      return true;
    } catch (error) {
      this.logger.error(`Failed to delete history for ${resourceType}/${resourceId}: ${error}`);
      return false;
    }
  }

  /**
   * Format history for display in MCP response.
   */
  formatHistoryForDisplay(history: HistoryFile, limit: number = 10): string {
    const parts: string[] = [];

    parts.push(`**Version History**: ${history.resource_id} (${history.versions.length} versions)`);
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
      const current = entry.version === history.current_version ? ' (latest)' : '';
      const changes = entry.diff_summary !== '' ? entry.diff_summary : '-';
      parts.push(`| ${entry.version}${current} | ${date} | ${changes} | ${entry.description} |`);
    }

    if (history.versions.length > limit) {
      const remaining = history.versions.length - limit;
      parts.push('');
      parts.push(`*... and ${remaining} more ${remaining === 1 ? 'version' : 'versions'}*`);
    }

    return parts.join('\n');
  }
}
