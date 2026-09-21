// @lifecycle canonical - Core service for managing resource version history

import { isDeepStrictEqual } from 'node:util';

import { RESOURCE_SUBTREE_MATCH } from './history-key.js';

import type { VersioningConfig, Logger } from '#shared/types/index.js';
import type { DatabasePort, StateStoreOptions } from '#shared/types/persistence.js';
import type {
  VersionEntry,
  HistoryFile,
  SaveVersionResult,
  SaveVersionOptions,
  ResourceType,
} from './types.js';

import { resolveContinuityScopeId } from '#shared/utils/request-identity-scope.js';

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
    return config.enabled && config.autoVersion;
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

      // `MAX(version)` and the INSERT that consumes it are ONE unit, under the write lock.
      //
      // The number this reads is the number it writes back, so anything committing between the two
      // makes the INSERT land on a stale maximum. Two rows then share a version — and since schema
      // v28 that is a UNIQUE violation rather than a silent duplicate, which turns a rare wrong
      // rollback into a failed save, but only a transaction removes the window. `version_history`
      // has two accepted writers (this service and `cli-shared/version-history.ts`) against one
      // file, so the racing connection is a real configuration, not a hypothetical. IMMEDIATE, not
      // deferred: a deferred transaction takes no lock until the write, by which point both readers
      // already hold the same stale maximum.
      //
      // The prune is inside deliberately — it already ran adjacent to the insert, reads the count
      // this insert produced, and deletes by it.
      //
      // No retry loop, because one is not needed: a contending writer WAITS on the lock. Both
      // connections to this file set `busy_timeout` from `STATE_DB_BUSY_TIMEOUT_MS`, so the loser
      // of a race blocks for the few milliseconds the winner's transaction takes and then proceeds.
      // A retry here would be a second, worse implementation of that wait, in the wrong layer.
      const newVersion = await db.transaction(async () => {
        // Get current max version
        const row = db.queryOne<{ max_version: number | null }>(
          `SELECT MAX(version) as max_version FROM version_history
         WHERE tenant_id = ? AND resource_type = ? AND resource_id = ?`,
          [tenantId, resourceType, resourceId]
        );
        const currentVersion = row?.max_version ?? 0;
        const version = currentVersion + 1;
        this.insertAndPrune({
          db,
          tenantId,
          resourceType,
          resourceId,
          version,
          snapshot,
          options,
        });
        return version;
      }, 'immediate');

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

  /** The write half of `saveVersion`, run inside its transaction: the row, then the trim. */
  private insertAndPrune(input: {
    db: DatabasePort;
    tenantId: string;
    resourceType: ResourceType;
    resourceId: string;
    version: number;
    snapshot: Record<string, unknown>;
    options?: SaveVersionOptions;
  }): void {
    const { db, tenantId, resourceType, resourceId, snapshot, options } = input;
    const newVersion = input.version;
    const config = this.getConfig();

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

    if (count && count.cnt > config.maxVersions) {
      db.run(
        `DELETE FROM version_history WHERE id NOT IN (
            SELECT id FROM version_history
            WHERE tenant_id = ? AND resource_type = ? AND resource_id = ?
            ORDER BY version DESC LIMIT ?
          ) AND tenant_id = ? AND resource_type = ? AND resource_id = ?`,
        [tenantId, resourceType, resourceId, config.maxVersions, tenantId, resourceType, resourceId]
      );
      this.logger.debug(`Pruned history for ${resourceId} to ${config.maxVersions} versions`);
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
    // Snapshots cross a JSON persistence boundary, which drops `undefined` object members while
    // preserving array order. Compare against that persisted shape, but use structural equality so
    // loader-induced object key reordering does not create a phantom bridge row.
    const persistedLive = JSON.parse(JSON.stringify(live)) as Record<string, unknown>;
    return isDeepStrictEqual(entry.snapshot, persistedLive);
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
   * Purge the version history of a resource, and of every id beneath it.
   *
   * Called when a resource is deleted — by all four `resource_manager` delete handlers, and by
   * nothing else. It was called by nobody at all until this was wired: the rows of a deleted
   * resource survived it permanently, unreachable by any action (rollback resolves the resource
   * first) and never reclaimed, and re-creating the same id later inherited a stranger's history.
   * `cpm delete` purged them the whole time, so the two surfaces disagreed about what delete means.
   *
   * SUBTREE, not one id: a chain's steps keep their history under `chain/step`, and deleting the
   * chain deletes them too, so their rows go with it rather than staying behind under ids nothing
   * serves. The predicate is imported rather than written here — `cli-shared` uses the same one,
   * and two copies of it would be the same cross-surface disagreement one layer down.
   *
   * **Throws on failure**, like `saveVersion` on this table and for the same reason: returning
   * `false` let every caller log and proceed, reporting a delete that only half happened. The
   * caller decides what to tell the operator; it must not be told the purge succeeded.
   *
   * Returns how many rows were removed, which is what lets a reply state what it did.
   */
  async deleteHistory(resourceType: ResourceType, resourceId: string): Promise<number> {
    // Disabled versioning wrote no rows, so there are none to purge — the same early return
    // `saveVersion` makes, for the same reason. Without it a delete on a server with versioning
    // off would fail on a database this service never opened.
    if (!this.getConfig().enabled) {
      return 0;
    }

    try {
      const db = this.getDb();
      const tenantId = this.resolveTenantId();
      const params = [tenantId, resourceType, resourceId, resourceId];

      const before = db.queryOne<{ cnt: number }>(
        `SELECT COUNT(*) as cnt FROM version_history
         WHERE tenant_id = ? AND resource_type = ? AND ${RESOURCE_SUBTREE_MATCH}`,
        params
      );
      db.run(
        `DELETE FROM version_history
         WHERE tenant_id = ? AND resource_type = ? AND ${RESOURCE_SUBTREE_MATCH}`,
        params
      );

      const removed = before?.cnt ?? 0;
      this.logger.debug(`Deleted ${removed} history row(s) for ${resourceType}/${resourceId}`);
      return removed;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to delete history for ${resourceType}/${resourceId}: ${message}`);
      throw new Error(
        `Failed to purge version history for ${resourceType}/${resourceId}: ${message}`,
        { cause: error }
      );
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
