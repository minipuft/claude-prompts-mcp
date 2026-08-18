// @lifecycle canonical - Core service for managing resource version history

import type { VersioningConfig, Logger } from '#shared/types/index.js';
import type { DatabasePort, StateStoreOptions } from '#shared/types/persistence.js';
import type {
  VersionEntry,
  HistoryFile,
  SaveVersionResult,
  RollbackResult,
  SaveVersionOptions,
  ResourceType,
} from './types.js';

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
import { resolveContinuityScopeId } from '#shared/utils/request-identity-scope.js';

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

  /**
   * Workspace scope for every read, write, and prune in this service.
   *
   * Until Tier 4, all nine query sites filtered a hardcoded `tenant_id = ?` literal, so
   * every project sharing one state.db read and pruned the same rollback history. Scoping the
   * writes alone would break version numbering, because `MAX(version)` would read a different
   * set than the INSERT writes into — so the scope is applied uniformly or not at all.
   */
  private scope?: StateStoreOptions;

  constructor(deps: {
    logger: Logger;
    configManager: VersioningConfigProvider;
    dbManager?: DatabasePort;
    scope?: StateStoreOptions;
  }) {
    this.logger = deps.logger;
    this.configProvider = deps.configManager;
    this.dbManager = deps.dbManager ?? null;
    this.scope = deps.scope;
  }

  /** Late-bind DatabasePort and its scope (setter injection, matching codebase convention). */
  setDatabasePort(db: DatabasePort, scope?: StateStoreOptions): void {
    this.dbManager = db;
    if (scope !== undefined) {
      this.scope = scope;
    }
  }

  /** Tenant key for this service's rows — the workspace, falling back to the shared default. */
  private resolveTenantId(): string {
    return resolveContinuityScopeId(this.scope);
  }

  /**
   * Tenant key for a READ that may deliberately target another workspace.
   *
   * `state.db` is one file shared by every project, isolated only by `tenant_id`, so another
   * workspace's rollback history is already physically present — it is simply filtered out. Reading
   * it is legitimate debugging ("what did this prompt look like in the other checkout?").
   *
   * Reads ONLY. There is deliberately no write-side equivalent: `saveVersion` computes the next
   * number from `MAX(version)` within a scope, so a cross-scope write would interleave two
   * workspaces' numbering, and a rollback would restore a snapshot describing files that may not
   * exist here. `rollback` rejects the override rather than ignoring it — silently scoping a
   * parameter back to local would be worse than refusing, because the caller would believe they had
   * restored the other workspace's version.
   */
  private resolveReadTenantId(readScopeOverride?: string): string {
    return readScopeOverride ?? this.resolveTenantId();
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
   *
   * **Throws on persistence failure.** `version_history` is a DURABLE table whose rows nothing
   * regenerates, so a snapshot that fails to persist is an unrecoverable gap — and the previous
   * posture returned `{success:false}`, which every caller logged and then proceeded past, telling
   * the operator the update had succeeded (architecture.md: persistence throws, the caller
   * decides). `SaveVersionResult.success` is still `true` on the disabled path and is retained
   * because `cli-shared/version-history.ts`, the accepted second writer of this table, shares the
   * type and keeps its own result-returning posture.
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
      const tenantId = this.resolveTenantId();

      // Get current max version
      const row = db.queryOne<{ max_version: number | null }>(
        `SELECT MAX(version) as max_version FROM version_history
         WHERE tenant_id = ? AND resource_type = ? AND resource_id = ?`,
        [tenantId, resourceType, resourceId]
      );
      const currentVersion = row?.max_version ?? 0;
      const newVersion = currentVersion + 1;

      // Insert new version
      db.run(
        `INSERT INTO version_history (tenant_id, organization_id, workspace_id, resource_type, resource_id, version, snapshot, diff_summary, description, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          tenantId,
          this.scope?.organizationId ?? null,
          this.scope?.workspaceId ?? null,
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
         WHERE tenant_id = ? AND resource_type = ? AND resource_id = ?`,
        [tenantId, resourceType, resourceId]
      );

      if (count && count.cnt > config.max_versions) {
        db.run(
          `DELETE FROM version_history WHERE id NOT IN (
            SELECT id FROM version_history
            WHERE tenant_id = ? AND resource_type = ? AND resource_id = ?
            ORDER BY version DESC LIMIT ?
          ) AND tenant_id = ? AND resource_type = ? AND resource_id = ?`,
          [
            tenantId,
            resourceType,
            resourceId,
            config.max_versions,
            tenantId,
            resourceType,
            resourceId,
          ]
        );
        this.logger.debug(`Pruned history for ${resourceId} to ${config.max_versions} versions`);
      }

      this.logger.debug(`Saved version ${newVersion} for ${resourceType}/${resourceId}`);
      return { success: true, version: newVersion };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to save version for ${resourceId}: ${message}`);
      throw new Error(
        `Failed to persist version snapshot for ${resourceType}/${resourceId}: ${message}`,
        { cause: error }
      );
    }
  }

  /**
   * Load version history for a resource.
   */
  async loadHistory(
    resourceType: ResourceType,
    resourceId: string,
    readScopeOverride?: string
  ): Promise<HistoryFile | null> {
    try {
      const db = this.getDb();
      const tenantId = this.resolveReadTenantId(readScopeOverride);

      const rows = db.query<VersionRow>(
        `SELECT version, snapshot, diff_summary, description, created_at
         FROM version_history
         WHERE tenant_id = ? AND resource_type = ? AND resource_id = ?
         ORDER BY version DESC`,
        [tenantId, resourceType, resourceId]
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
    version: number,
    readScopeOverride?: string
  ): Promise<VersionEntry | null> {
    try {
      const db = this.getDb();
      const tenantId = this.resolveReadTenantId(readScopeOverride);

      const row = db.queryOne<VersionRow>(
        `SELECT version, snapshot, diff_summary, description, created_at
         FROM version_history
         WHERE tenant_id = ? AND resource_type = ? AND resource_id = ? AND version = ?`,
        [tenantId, resourceType, resourceId, version]
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
      const tenantId = this.resolveTenantId();

      const row = db.queryOne<{ max_version: number | null }>(
        `SELECT MAX(version) as max_version FROM version_history
         WHERE tenant_id = ? AND resource_type = ? AND resource_id = ?`,
        [tenantId, resourceType, resourceId]
      );

      return row?.max_version ?? 0;
    } catch {
      return 0;
    }
  }

  /**
   * Record the state PRODUCED by an edit, bridging any unrecorded prior state first.
   *
   * Go-forward numbering (P7-D2 mechanism 1, OQ-P7-3): version N holds the state edit N
   * produced, so the newest version always equals what `inspect` shows. Rows written under the
   * old semantics (version N = state BEFORE edit N) are left untouched — the eras are told apart
   * by description convention: post-fix rows describe the action that produced them ("Update via
   * resource_manager", "Rollback to vN"), bridge rows say so explicitly, and old-era rows carry
   * the historical "Pre-rollback snapshot…" / pre-edit descriptions.
   *
   * The bridge is what makes the transition need no migration: whenever the latest recorded
   * snapshot differs from the live pre-edit state (first post-fix edit of any resource, or an
   * out-of-band file edit), that live state is recorded first so it stays rollback-reachable.
   * Steady state records exactly one row per edit.
   *
   * Called BEFORE the file write, with the state about to be produced — a persistence failure
   * therefore still aborts the edit with nothing written (OQ-P7-6 posture, row 2.3).
   */
  async recordEditResult(
    resourceType: ResourceType,
    resourceId: string,
    priorLiveSnapshot: Record<string, unknown>,
    producedSnapshot: Record<string, unknown>,
    options?: SaveVersionOptions
  ): Promise<SaveVersionResult & { bridged: boolean }> {
    if (!this.isEnabled()) {
      return { success: true, version: 0, bridged: false };
    }

    const bridged = !(await this.latestSnapshotMatches(
      resourceType,
      resourceId,
      priorLiveSnapshot
    ));
    if (bridged) {
      await this.saveVersion(resourceType, resourceId, priorLiveSnapshot, {
        description: 'Bridge: prior live state (era transition or out-of-band edit)',
        diff_summary: '',
      });
    }

    const result = await this.saveVersion(resourceType, resourceId, producedSnapshot, options);
    return { ...result, bridged };
  }

  /** True when the newest recorded snapshot structurally equals the given live state. */
  private async latestSnapshotMatches(
    resourceType: ResourceType,
    resourceId: string,
    live: Record<string, unknown>
  ): Promise<boolean> {
    const latest = await this.getLatestVersion(resourceType, resourceId);
    if (latest === 0) return false;
    const entry = await this.getVersion(resourceType, resourceId, latest);
    if (entry === null) return false;
    return JSON.stringify(entry.snapshot) === JSON.stringify(live);
  }

  /**
   * Resolve the snapshot a rollback would restore. PURE READ — writes nothing, ever.
   *
   * This is the first of the three phases a rollback runs (validate → record → write). It exists
   * as its own method so "nothing has been written yet" is visible at the call site: the caller
   * takes this snapshot, asks its own snapshot contract whether the record is restorable, and only
   * then calls `commitEdit`. Previously `rollback()` did the resolve and the record together and
   * handed the result back for validation, so a caller that rejected an incomplete snapshot had
   * already caused a bridge row and a restore row to be written — the prompt path said so in its
   * own error text.
   */
  async resolveRollbackTarget(
    resourceType: ResourceType,
    resourceId: string,
    targetVersion: number
  ): Promise<{ ok: true; entry: VersionEntry } | { ok: false; error: string }> {
    if (!this.isEnabled()) {
      return { ok: false, error: 'Versioning is disabled' };
    }

    const targetEntry = await this.getVersion(resourceType, resourceId, targetVersion);
    if (targetEntry === null) {
      return { ok: false, error: `Version ${targetVersion} not found` };
    }
    return { ok: true, entry: targetEntry };
  }

  /**
   * Record the state an edit produced, bridging the prior live state when it is unrecorded.
   *
   * Phase two of three. Named for what a caller does with it rather than for the mechanism:
   * `recordEditResult` remains the mechanism and this is the boundary the processors call, so the
   * ordering — record BEFORE the file write, so a persistence failure aborts with nothing on disk —
   * reads as a sequence at the call site instead of being buried in a service method.
   *
   * Throws on persistence failure, by the same contract as `saveVersion`.
   */
  async commitEdit(
    resourceType: ResourceType,
    resourceId: string,
    priorLiveSnapshot: Record<string, unknown>,
    producedSnapshot: Record<string, unknown>,
    options?: SaveVersionOptions
  ): Promise<SaveVersionResult & { bridged: boolean }> {
    return this.recordEditResult(
      resourceType,
      resourceId,
      priorLiveSnapshot,
      producedSnapshot,
      options
    );
  }

  /**
   * Rollback to a previous version.
   *
   * Go-forward semantics (OQ-P7-3): the target is validated BEFORE anything is written, so a
   * refused rollback consumes no version number (DEV-T2-6's defect). The restored state is then
   * recorded as the newest version — a rollback is an edit, and version N holds what edit N
   * produced. The live pre-rollback state needs no dedicated "Pre-rollback snapshot" row: under
   * these semantics it is already the previous version, and when it is not (old-era rows,
   * out-of-band edits) the bridge records it.
   *
   * RESTORABILITY is not checked here — only existence. A caller that can reject the snapshot
   * (because its snapshot contract finds a required field missing) must use
   * `resolveRollbackTarget` + `commitEdit` instead, so the rejection happens before any write.
   * This convenience wrapper remains for callers with no such rejection to make.
   */
  async rollback(
    resourceType: ResourceType,
    resourceId: string,
    targetVersion: number,
    currentSnapshot: Record<string, unknown>
  ): Promise<RollbackResult & { snapshot?: Record<string, unknown> }> {
    const resolved = await this.resolveRollbackTarget(resourceType, resourceId, targetVersion);
    if (!resolved.ok) {
      return { success: false, error: resolved.error };
    }
    const targetEntry = resolved.entry;

    try {
      // Record the RESTORED state as the newest version, bridging the live state first if it is
      // not already recorded. A persistence failure throws and is caught below — a rollback that
      // reports failure and restores nothing, with the target validated above so the refusal
      // path writes no rows at all.
      const saveResult = await this.commitEdit(
        resourceType,
        resourceId,
        currentSnapshot,
        targetEntry.snapshot,
        {
          description: `Rollback to v${targetVersion}`,
          diff_summary: '',
        }
      );

      this.logger.info(
        `Rollback ${resourceType}/${resourceId}: recorded v${saveResult.version} (restored from v${targetVersion}${saveResult.bridged ? ', live state bridged' : ''})`
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
    toVersion: number,
    readScopeOverride?: string
  ): Promise<{
    success: boolean;
    from?: VersionEntry;
    to?: VersionEntry;
    error?: string;
  }> {
    const fromEntry = await this.getVersion(
      resourceType,
      resourceId,
      fromVersion,
      readScopeOverride
    );
    const toEntry = await this.getVersion(resourceType, resourceId, toVersion, readScopeOverride);

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
      const tenantId = this.resolveTenantId();

      db.run(
        `DELETE FROM version_history
         WHERE tenant_id = ? AND resource_type = ? AND resource_id = ?`,
        [tenantId, resourceType, resourceId]
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
