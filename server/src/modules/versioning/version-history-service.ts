// @lifecycle canonical - Core service for managing resource version history

import { RESOURCE_SUBTREE_MATCH } from './history-key.js';

import type { LoadedTree } from '#cli-shared/object-store.js';
import type { VersioningConfig, Logger } from '#shared/types/index.js';
import type { DatabasePort, StateStoreOptions } from '#shared/types/persistence.js';
import type {
  ResourceFileLocatorPort,
  ResourceFileSet,
  ResourceLocationResult,
} from '#shared/utils/resource-file-set.js';
import type {
  VersionEntry,
  HistoryFile,
  SaveVersionResult,
  SaveVersionOptions,
  ResourceType,
} from './types.js';

import {
  readResourceTree,
  recordTree,
  sweepUnreferencedObjects,
} from '#cli-shared/object-store.js';
import { pruneVersionHistory } from '#cli-shared/version-history-rows.js';
import { hashCanonical } from '#shared/utils/hash.js';
import { resolveContinuityScopeId } from '#shared/utils/request-identity-scope.js';
import { resourceFileSet } from '#shared/utils/resource-file-set.js';

/**
 * The identity of a snapshot, as the table stores it.
 *
 * Hashed from the PERSISTED text rather than from the live object, on both sides of every
 * comparison. That is what makes the test symmetric: a live snapshot can hold an `undefined`
 * member or a key order a loader happened to produce, neither of which survives the column, so
 * comparing a live object against a stored row directly answers a different question than
 * "will this row equal the one already there". `hashCanonical` then removes key order from the
 * answer entirely — the property CHANGELOG 4.0.0 claimed for the whole system and which, until
 * now, held on the server path only.
 */
function snapshotIdentity(persistedJson: string): string {
  return hashCanonical(JSON.parse(persistedJson));
}

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

  /**
   * How this service turns a (type, id) into the files on disk that ARE that resource.
   *
   * INJECTED, never re-derived (owner ruling R65). Root precedence has exactly one owner
   * (`runtime/resource-roots.ts`), and a second derivation of it here would decide, independently,
   * which of a bundled and a workspace definition a checkpoint records — the two could only agree
   * by inspection, and the failure is silent: a rollback restores the wrong file.
   *
   * Optional because the unit suites construct this service directly and a missing locator
   * degrades a row to projection-only — today's behaviour — rather than to a wrong answer. Every
   * construction in `src/` supplies one, which
   * `tests/unit/versioning/version-history-locator-wiring.test.ts` enumerates and enforces.
   */
  private resourceFileLocator?: ResourceFileLocatorPort;

  constructor(deps: {
    logger: Logger;
    configManager: VersioningConfigProvider;
    dbManager?: DatabasePort;
    scope?: StateStoreOptions;
    resourceFileLocator?: ResourceFileLocatorPort;
  }) {
    this.logger = deps.logger;
    this.configProvider = deps.configManager;
    this.dbManager = deps.dbManager ?? null;
    this.scope = deps.scope;
    this.resourceFileLocator = deps.resourceFileLocator;
  }

  /**
   * Where this resource's entry file and contributing roots are, or why they could not be found.
   *
   * The single reason this service holds a locator at all. A caller that gets `located: false`
   * records the version WITHOUT a file tree and warns once — never a failed save, because the
   * projection in `snapshot` is what every reader already uses.
   */
  private async locateResourceFiles(
    resourceType: ResourceType,
    resourceId: string
  ): Promise<ResourceLocationResult> {
    if (this.resourceFileLocator === undefined) {
      return { located: false, reason: 'no resource file locator was injected into this service' };
    }
    return this.resourceFileLocator.locate(resourceType, resourceId);
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
    return this.appendVersion(resourceType, resourceId, snapshot, options, true);
  }

  /**
   * The body of {@link saveVersion}, plus whether this row may carry a file tree.
   *
   * `recordFiles` is the ONE structural difference between a produced row and a bridge row
   * (ruling R66). It is deliberately not exposed on `SaveVersionOptions`: a caller outside this
   * class has no way to know whether the files on disk describe the snapshot it is passing, and
   * the two callers that do know are both in this file.
   *
   * The equality rule is untouched by it — skip-if-equal still runs on the snapshot's canonical
   * hash, inside the transaction, exactly as before. A row that is not written records no tree
   * because there is no row to hang one on, not because of a second comparison.
   */
  private async appendVersion(
    resourceType: ResourceType,
    resourceId: string,
    snapshot: Record<string, unknown>,
    options: SaveVersionOptions | undefined,
    recordFiles: boolean
  ): Promise<SaveVersionResult> {
    const config = this.getConfig();

    if (!config.enabled) {
      return { success: true, version: 0, recorded: false };
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
      // Serialised ONCE, outside the lock: this text is both what the equality test measures and
      // what the INSERT binds, so the two cannot describe different states.
      const payload = JSON.stringify(snapshot);

      // The resource's bytes are read here, ABOVE the write lock. Nothing about them needs it:
      // objects are content-addressed, so a file that changes between this read and the commit
      // produces a different tree rather than a wrong one, and holding the lock across disk I/O
      // blocks the other writer of this one file for as long as the disk takes.
      const prepared = recordFiles
        ? await this.prepareFileTree(resourceType, resourceId)
        : undefined;
      let treeReason = prepared !== undefined && 'reason' in prepared ? prepared.reason : undefined;

      const outcome = await db.transaction(async () => {
        // The newest row's number AND its snapshot, read together. The equality decision lives
        // INSIDE this transaction deliberately: decided before `BEGIN IMMEDIATE`, two processes
        // could each compare against a maximum the other was about to replace and each conclude
        // "unchanged", so a genuine change would go unrecorded by both. `version_history` has two
        // accepted writers against one file, so that is a real configuration.
        const row = db.queryOne<{ version: number; snapshot: string }>(
          `SELECT version, snapshot FROM version_history
         WHERE tenant_id = ? AND resource_type = ? AND resource_id = ?
         ORDER BY version DESC LIMIT 1`,
          [tenantId, resourceType, resourceId]
        );

        if (row !== null && snapshotIdentity(row.snapshot) === snapshotIdentity(payload)) {
          return { version: row.version, recorded: false };
        }

        const version = (row?.version ?? 0) + 1;
        this.insertAndPrune({
          db,
          tenantId,
          resourceType,
          resourceId,
          version,
          payload,
          options,
        });
        // The STATEMENTS that store the files run last, inside the same lock the row was written
        // under. That placement is invariant WRITE-1: an object insert and the manifest row that
        // justifies it commit together or not at all, so a crash between them leaves neither. The
        // file READS are not in here — they happened above, before the lock was taken.
        if (prepared !== undefined && 'tree' in prepared) {
          treeReason = this.attachFileTree({
            db,
            tenantId,
            resourceType,
            resourceId,
            version,
            tree: prepared.tree,
          });
        }
        return { version, recorded: true };
      }, 'immediate');

      // Warned once, and only for a row that exists: an unchanged write records nothing, so a
      // degradation reported there would describe a version nobody wrote.
      if (outcome.recorded && treeReason !== undefined) {
        this.logger.warn(
          `Recorded ${resourceType}/${resourceId} version ${outcome.version} without a file ` +
            `tree: ${treeReason}. Rollback to this version restores from its projection.`
        );
      }
      this.logger.debug(
        outcome.recorded
          ? `Saved version ${outcome.version} for ${resourceType}/${resourceId}`
          : `No change to record for ${resourceType}/${resourceId}; still at version ${outcome.version}`
      );
      return { success: true, version: outcome.version, recorded: outcome.recorded };
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
    /** The snapshot as `saveVersion` serialised it — the same text its equality test measured. */
    payload: string;
    options?: SaveVersionOptions;
  }): void {
    const { db, tenantId, resourceType, resourceId, payload, options } = input;
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
        payload,
        options?.diff_summary ?? '',
        options?.description ?? `Version ${newVersion}`,
        new Date().toISOString(),
      ]
    );

    // Trim through the ONE implementation both writers share (`cli-shared/version-history-rows`).
    // It used to be restated here, with SQL and a bound that differed from the CLI's — which is
    // how a workspace configured to keep three versions kept fifty after a `cpm` write.
    const pruned = pruneVersionHistory(db, {
      tenantId,
      resourceType,
      resourceId,
      maxVersions: config.maxVersions,
    });
    if (pruned > 0) {
      this.logger.debug(
        `Pruned ${pruned} history row(s) for ${resourceId} to ${config.maxVersions} versions`
      );
    }
  }

  /**
   * Record the files behind the row just inserted, or leave the row projection-only.
   *
   * Never throws for a resource it cannot store. The version row is the durable thing nothing
   * regenerates; an over-limit file or a deleted directory must cost byte-exact rollback for that
   * version, not the version itself. One `warn` names the resource and the reason, so a
   * degradation is visible in the log rather than inferred from a NULL column much later.
   *
   * A SQLite failure is NOT caught here and propagates into the caller's transaction, which rolls
   * back. That is the correct asymmetry: "these bytes do not fit" is a property of the resource,
   * "this INSERT failed" is a property of the database, and only the second one means the row
   * itself is untrustworthy.
   */
  private async prepareFileTree(
    resourceType: ResourceType,
    resourceId: string
  ): Promise<{ tree: LoadedTree } | { reason: string }> {
    const location = await this.locateResourceFiles(resourceType, resourceId);
    if (!location.located) {
      return { reason: location.reason };
    }

    let files: ResourceFileSet;
    try {
      files = await resourceFileSet({
        resourceType,
        entryPath: location.entryPath,
        roots: location.roots,
      });
    } catch (error) {
      return { reason: error instanceof Error ? error.message : String(error) };
    }
    return readResourceTree(files);
  }

  /**
   * Point the row just inserted at bytes already read, or say why it stays projection-only.
   *
   * Runs INSIDE the caller's transaction and is synchronous: every I/O this used to do now
   * happens in `prepareFileTree`, above the lock. Returns a reason instead of warning, because
   * the caller warns once and only when a row was actually written — a degradation reported for
   * a write that skip-if-equal declined would describe a row that does not exist.
   */
  private attachFileTree(input: {
    db: DatabasePort;
    tenantId: string;
    resourceType: ResourceType;
    resourceId: string;
    version: number;
    tree: LoadedTree;
  }): string | undefined {
    const { db, tenantId, resourceType, resourceId, version, tree } = input;

    // The row id is read back rather than taken from a driver's last-insert value: `DatabasePort`
    // exposes none, and (tenant, type, id, version) is UNIQUE since schema v28, so this SELECT
    // inside the same transaction identifies exactly the row just written.
    const row = db.queryOne<{ id: number }>(
      `SELECT id FROM version_history
       WHERE tenant_id = ? AND resource_type = ? AND resource_id = ? AND version = ?`,
      [tenantId, resourceType, resourceId, version]
    );
    if (row === null) {
      return 'the row could not be read back inside its own transaction';
    }

    const outcome = recordTree(db, { tenantId, versionRowId: row.id, tree });
    return outcome.recorded ? undefined : outcome.reason;
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
   * Called at COMMIT time, with the produced files already on disk. Every caller passes this as
   * the `commit` callback of `ResourceMutationTransaction`, whose `run()` is
   * `captureSnapshots → mutate → validate → commit` — so the write and its verification have both
   * happened, and a throw here lands in the catch that restores every snapshot, leaving the files
   * byte-identical. This docblock said the opposite ("Called BEFORE the file write") from P4.2,
   * when SF-3 moved the record inside the transaction, until row O.4 measured it: the object store
   * DEPENDS on this order, because it reads the bytes the edit produced.
   *
   * Pinned by `tests/integration/versioning/record-edit-result-ordering.test.ts`.
   */
  async recordEditResult(
    resourceType: ResourceType,
    resourceId: string,
    priorLiveSnapshot: Record<string, unknown>,
    producedSnapshot: Record<string, unknown>,
    options?: SaveVersionOptions
  ): Promise<SaveVersionResult & { bridged: boolean }> {
    if (!this.isEnabled()) {
      return { success: true, version: 0, bridged: false, recorded: false };
    }

    // ONE equality rule, applied twice. The bridge used to have its own comparison
    // (`isDeepStrictEqual` against the newest row, decided outside the write lock) while the
    // record below had none at all, so the same question — "is this state already the newest
    // one?" — was answered by two different implementations on two paths, and the second answer
    // was always "no". Both calls now go through `saveVersion`, whose test runs inside its own
    // transaction: the bridge row appears exactly when the prior live state is unrecorded, and
    // `bridged` is simply whether that call wrote.
    const bridge = await this.appendVersion(
      resourceType,
      resourceId,
      priorLiveSnapshot,
      {
        description: 'Bridge: prior live state (era transition or out-of-band edit)',
        diff_summary: '',
      },
      // No file tree, and the reason is the ordering this method runs under. Both appends happen
      // in `commit`, AFTER the produced files are on disk, so an enumerator run inside either one
      // reads the PRODUCED bytes. A tree on the bridge row would therefore describe the produced
      // state under a row whose snapshot is the prior one, and a later byte-exact rollback would
      // restore the wrong bytes while reporting full fidelity.
      false
    );

    const result = await this.appendVersion(
      resourceType,
      resourceId,
      producedSnapshot,
      options,
      true
    );
    return { ...result, bridged: bridge.recorded };
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

      // One transaction, IMMEDIATE: the count this reports, the delete it reports on, and the
      // sweep of the objects that delete orphaned are one unit. The count is inside too — read
      // above the lock it can be a number another writer has already changed.
      const removed = await db.transaction(async () => {
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
        // The manifest rows went by cascade; the objects behind them are reachable from nothing
        // else, and nothing ever enumerates the table to find them later.
        sweepUnreferencedObjects(db, tenantId);
        return before?.cnt ?? 0;
      }, 'immediate');

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
