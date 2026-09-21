/**
 * Standalone version-history functions for CLI consumption.
 *
 * SQLite-backed implementation (runtime-state/state.db), replacing legacy sidecar history files.
 * Reads and writes `state.db` through `node:sqlite`, whose `DatabaseSync` is synchronous,
 * so the exported API stays synchronous.
 *
 * This module is a READER and WRITER of `version_history` but never its schema owner —
 * `SqliteEngine.applySchema()` holds that exclusively. See `runSqlite` for why that
 * matters: a second `ensure_schema` here used to leave the server unable to boot.
 *
 * **Numbering semantics must match `VersionHistoryService` (P7 go-forward, P7-F10 fix).**
 * `version_history` is a durable table with two accepted writers — this CLI and the server's
 * `VersionHistoryService` — and they must agree on what a version number means or a resource
 * edited by both accumulates a history where "the newest version" means two different things
 * depending on who last wrote it. Go-forward: version N holds the state edit N PRODUCED, not
 * the state that preceded it. `recordEditResult` and the `rollback` action carry the bridge-row
 * logic (self-healing v1 for a never-before-recorded resource, or an out-of-band edit) — see
 * `recordEditResult` below for the mechanism, mirrored line-for-line from the server's.
 *
 * **Scope must also match, and cannot always be derived — so it is read back instead.**
 * `resolveTenantId` derives a scope guess independently of the server's own resolution (see its
 * doc comment for the precedence and why it can diverge). Rather than leave that guess as the
 * only answer, `resolveEffectiveTenantId` corrects it against the db's own `tenant_id` column
 * when the guess finds no rows and exactly one other tenant does — the server's resolution is
 * the source of truth, and an existing row already records what it was. See
 * `resolveEffectiveTenantId` for the exact rule and why it stays conservative under ambiguity.
 */

import { existsSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';

import { getConfigValue, readConfig } from './config-operations.js';
import { resolveStateDbPath } from './version-history-location.js';
import {
  SUBTREE_MATCH,
  appendVersion,
  loadRows,
  recordEditResultRow,
  renameSubtree,
  selectVersion,
  toEntry,
} from './version-history-rows.js';
import { resolveEffectiveTenantId, resolveTenantId } from './version-history-scope.js';
import { DEFAULT_MAX_VERSIONS } from './version-history-types.js';

import type {
  VersionEntry,
  HistoryFile,
  SaveVersionResult,
  RollbackResult,
  SaveVersionOptions,
} from '#modules/versioning/types.js';
import type { HistoryRequest, HistoryResponse, ResourceType } from './version-history-types.js';

import { STATE_DB_WRITER_PRAGMAS } from '#shared/utils/runtime-state-location.js';

/**
 * Which resource a history call is about: its type and the id it is served under — for a nested
 * prompt the composite `chain/step`, never its last segment.
 *
 * Every read, compare, delete and rename takes one, and none of them derives it from the path they
 * are given, which is only used to find `state.db`. A path cannot name a resource: a nested step's
 * last segment is another prompt's id, a single-file prompt's is `{id}.yaml`, and a workspace
 * sitting under a directory named `prompts` made a gate read as a prompt. The derivation that did
 * this was deleted once every caller could pass the ref instead.
 */
export interface HistoryResourceRef {
  resourceType: ResourceType;
  resourceId: string;
}

/**
 * Run one history operation against `state.db` directly.
 *
 * Replaces a `spawnSync('python3', ...)` round-trip carrying an embedded sqlite3 script,
 * from a Node process that already has `node:sqlite`. `DatabaseSync` is synchronous, so
 * the exported API stays synchronous without the subprocess.
 *
 * **This deliberately does NOT create the schema.** The old helper carried its own
 * `ensure_schema()` whose DDL predated the scope columns, so a CLI invocation on a fresh
 * machine created `version_history` without `organization_id`/`workspace_id` and wrote no
 * `schema_version` row. The engine then read version 0, took the "fresh" path, and
 * `CREATE TABLE IF NOT EXISTS` silently no-opped against that table — leaving the column
 * absent and the server unable to boot (`no such column: workspace_id`, thrown from
 * `applySchema` while creating the scope index). `SqliteEngine.applySchema()` is the
 * single owner of this DDL; the CLI reports a missing table instead of inventing one.
 */
function runSqlite(request: HistoryRequest): HistoryResponse {
  if (!existsSync(request.db_path)) {
    return { success: false, error: `state.db not found at ${request.db_path}` };
  }

  let db: DatabaseSync | undefined;
  try {
    db = new DatabaseSync(request.db_path);
    // The same list the server's connection applies — one owner, so the two writers of this file
    // cannot disagree about its lock patience or about whether its foreign keys hold.
    for (const pragma of STATE_DB_WRITER_PRAGMAS) {
      db.exec(pragma);
    }
    if (!versionHistoryExists(db)) {
      return {
        success: false,
        error: 'version_history table is absent — start the MCP server once to create the schema',
      };
    }
    return dispatch(db, request, resolveTenantId(request.db_path));
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    db?.close();
  }
}

function versionHistoryExists(db: DatabaseSync): boolean {
  const row = db
    .prepare(`SELECT count(*) AS present FROM sqlite_master WHERE type='table' AND name=?`)
    .get('version_history') as { present: number } | undefined;
  return (row?.present ?? 0) > 0;
}

/**
 * Route one request to its SQL. Mirrors the action set the Python helper dispatched.
 *
 * `tenantId` is `resolveTenantId`'s derivation, unverified against this db. The five actions
 * that only ever act on EXISTING rows resolve their own `effectiveTenantId` via
 * `resolveEffectiveTenantId` before using it; `save_version`/`record_edit_result` use `tenantId`
 * as given (a legitimate new write must not be redirected), and `rename_history` does too for a
 * narrower reason — see `resolveEffectiveTenantId`'s doc comment for both.
 */
function dispatch(db: DatabaseSync, request: HistoryRequest, tenantId: string): HistoryResponse {
  switch (request.action) {
    case 'load_history': {
      const resolved = resolveEffectiveTenantId(db, tenantId, request);
      // An ambiguous resolution must not collapse into the same shape a genuinely empty history
      // produces below (`success: true, history: null`) — that is the exact symptom this fix
      // exists to remove, just moved one level down. Refuse by name instead, through the
      // `success: false` channel every other real failure in this dispatch already uses.
      if (resolved.ambiguousCandidateCount !== undefined) {
        return {
          success: false,
          error:
            `${request.resource_type} '${request.resource_id}' has version history under ` +
            `${resolved.ambiguousCandidateCount} other scopes on this state.db; this process ` +
            `cannot tell which one you mean. Re-run from the workspace whose history you want.`,
          ambiguous: true,
        };
      }
      const history = loadRows(db, resolved.tenantId, request);
      return { success: true, history: history.versions.length > 0 ? history : null };
    }

    case 'get_version': {
      const effectiveTenantId = resolveEffectiveTenantId(db, tenantId, request).tenantId;
      const row = selectVersion(db, effectiveTenantId, request, Number(request.version));
      return { success: true, entry: row !== undefined ? toEntry(row) : null };
    }

    case 'save_version': {
      const outcome = appendVersion(
        db,
        tenantId,
        request,
        request.snapshot ?? {},
        request.description ?? '',
        request.diff_summary ?? ''
      );
      return { success: true, version: outcome.version, recorded: outcome.recorded };
    }

    case 'record_edit_result': {
      const result = recordEditResultRow(db, tenantId, request, {
        priorLiveSnapshot: request.prior_snapshot ?? {},
        producedSnapshot: request.snapshot ?? {},
        description: request.description ?? '',
        diffSummary: request.diff_summary ?? '',
      });
      return {
        success: true,
        version: result.version,
        recorded: result.recorded,
        bridged: result.bridged,
      };
    }

    case 'compare_versions': {
      const effectiveTenantId = resolveEffectiveTenantId(db, tenantId, request).tenantId;
      const fromVersion = Number(request.from_version);
      const toVersion = Number(request.to_version);
      const fromRow = selectVersion(db, effectiveTenantId, request, fromVersion);
      if (fromRow === undefined) {
        return { success: false, error: `Version ${fromVersion} not found` };
      }
      const toRow = selectVersion(db, effectiveTenantId, request, toVersion);
      if (toRow === undefined) {
        return { success: false, error: `Version ${toVersion} not found` };
      }
      return { success: true, from: toEntry(fromRow), to: toEntry(toRow) };
    }

    case 'rollback': {
      // Go-forward semantics (mirrors VersionHistoryService.rollback): the target is validated
      // BEFORE anything is written, so a refused rollback consumes no version number. The
      // restored state is then recorded as the newest version via `recordEditResult` — a
      // rollback is an edit, and version N holds what edit N produced. The live pre-rollback
      // state needs no dedicated "Pre-rollback snapshot" row: under these semantics it is
      // already the previous version, and when it is not (old-era rows, out-of-band edits) the
      // bridge records it.
      //
      // The tenant is corrected once, before the read, and the SAME value is reused for the
      // write below — a rollback that read the target from a corrected tenant must record the
      // restored state there too, or the operation splits across two tenants and the next read
      // sees a one-row history instead of a continuation.
      const effectiveTenantId = resolveEffectiveTenantId(db, tenantId, request).tenantId;
      const target = Number(request.target_version);
      const targetRow = selectVersion(db, effectiveTenantId, request, target);
      if (targetRow === undefined) {
        return { success: false, error: `Version ${target} not found` };
      }
      const restoredSnapshot = JSON.parse(targetRow.snapshot) as Record<string, unknown>;
      const result = recordEditResultRow(db, effectiveTenantId, request, {
        priorLiveSnapshot: request.current_snapshot ?? {},
        producedSnapshot: restoredSnapshot,
        description: `Rollback to v${target}`,
        diffSummary: '',
      });
      return {
        success: true,
        saved_version: result.version,
        // False when the target version was already the current state: nothing to restore and
        // nothing to record, so `saved_version` is the number that was already newest.
        recorded: result.recorded,
        restored_version: target,
        snapshot: restoredSnapshot,
      };
    }

    // Delete and rename act on the id AND every id below it (`id/…`). A chain directory holds its
    // steps, whose history is keyed `chain/step`; removing or renaming the directory removes or
    // renames them too, so their rows go with it rather than staying behind under ids nothing
    // serves. The prefix carries the `/`, so `chain_other` is not below `chain`.
    case 'delete_history': {
      // Corrected the same way rollback is: `cpm delete` is reached only from
      // `cli/src/commands/delete.ts` (via `deleteResourceDir`), never from the server, so a wrong
      // guess here would leave the server's rows behind as an orphan nothing can reach — the
      // resource directory is gone, but its history under the real tenant is not. The correction
      // itself keys on the resource's OWN exact id, not the subtree the DELETE below removes: for
      // a chain that has ever been edited as a whole, its own row exists and names the tenant
      // correctly; a chain versioned only step-by-step is outside what this check can see.
      const effectiveTenantId = resolveEffectiveTenantId(db, tenantId, request).tenantId;
      db.prepare(
        `DELETE FROM version_history
         WHERE tenant_id = ? AND resource_type = ? AND ${SUBTREE_MATCH}`
      ).run(effectiveTenantId, request.resource_type, request.resource_id, request.resource_id);
      return { success: true };
    }

    case 'rename_history': {
      const newResourceId = request.new_resource_id;
      if (newResourceId === undefined || newResourceId === '') {
        return { success: false, error: 'new_resource_id is required' };
      }
      return renameSubtree(db, tenantId, request, newResourceId);
    }
  }
}

function isNonEmptyString(value: string | undefined): value is string {
  return value !== undefined && value !== '';
}

/**
 * The request for one history operation. `resourceDir` only locates `state.db`; which rows the
 * operation touches is `ref`, always, because a path cannot say which resource it holds.
 */
function createRequest(
  resourceDir: string,
  action: HistoryRequest['action'],
  ref: HistoryResourceRef
): Partial<HistoryRequest> | null {
  const dbPath = resolveStateDbPath(resourceDir);
  if (dbPath === null || !isNonEmptyString(ref.resourceType) || !isNonEmptyString(ref.resourceId)) {
    return null;
  }
  return {
    resource_type: ref.resourceType,
    resource_id: ref.resourceId,
    db_path: dbPath,
    action,
  };
}

// ── Read operations ─────────────────────────────────────────────────────────

/**
 * Load a resource's version history.
 *
 * Throws only for the `ambiguous` case (`HistoryResponse.ambiguous`, set by `dispatch`'s
 * `load_history` case) — a resource with recorded history under more than one tenant, where this
 * process's scope guess matches none of them. `null` stays reserved for every OTHER outcome,
 * including a genuinely empty history and a missing `state.db`/`version_history` table (both
 * pre-existing `success: false` cases with no distinguishing field): a caller must be able to
 * tell "there is nothing to find" from "this process could not tell which of several tenants you
 * meant", and collapsing the second into the first reproduces the exact "no history" symptom this
 * correction exists to remove — just one layer further out.
 */
export function loadHistory(resourceDir: string, ref: HistoryResourceRef): HistoryFile | null {
  const request = createRequest(resourceDir, 'load_history', ref);
  if (request === null) {
    return null;
  }
  const result = runSqlite(request as HistoryRequest);
  if (!result.success) {
    if (result.ambiguous === true) {
      throw new Error(result.error ?? 'Ambiguous version history scope.');
    }
    return null;
  }
  return result.history ?? null;
}

export function getVersion(
  resourceDir: string,
  version: number,
  ref: HistoryResourceRef
): VersionEntry | null {
  const request = createRequest(resourceDir, 'get_version', ref);
  if (request === null) {
    return null;
  }
  const result = runSqlite({ ...(request as HistoryRequest), version });
  if (!result.success) {
    return null;
  }
  return result.entry ?? null;
}

export function compareVersions(
  resourceDir: string,
  fromVersion: number,
  toVersion: number,
  ref: HistoryResourceRef
): {
  success: boolean;
  from?: VersionEntry;
  to?: VersionEntry;
  error?: string;
} {
  const request = createRequest(resourceDir, 'compare_versions', ref);
  if (request === null) {
    return { success: false, error: 'Unable to resolve resource DB path' };
  }
  const result = runSqlite({
    ...(request as HistoryRequest),
    from_version: fromVersion,
    to_version: toVersion,
  });
  if (!result.success) {
    return { success: false, error: result.error ?? 'Comparison failed' };
  }
  return { success: true, from: result.from, to: result.to };
}

// ── Write operations ────────────────────────────────────────────────────────

/**
 * What a CLI history write needs beyond the snapshot itself.
 *
 * `maxVersions` rides here rather than as its own parameter because `recordEditResult` would
 * otherwise take seven, over the `max-params` ceiling — and because the bound belongs with the
 * other per-call facts the row records. Omitting it keeps {@link DEFAULT_MAX_VERSIONS}, which is
 * what a workspace that configured nothing gets; a `cpm` command supplies
 * {@link resolveConfiguredMaxVersions}.
 */
export interface HistoryWriteOptions extends SaveVersionOptions {
  maxVersions?: number;
}

/**
 * The row cap this workspace configured, or {@link DEFAULT_MAX_VERSIONS} when it configured none.
 *
 * **Why a `cpm` command must call this.** `versioning.maxVersions` is read by the SERVER through
 * `infra/config`, which `cli-shared` may not import (`validate:arch`, `cli-shared-no-runtime`), so
 * for years every CLI write bound the hardcoded default instead: an operator who set 3 kept 3
 * after an MCP edit and 50 after a `cpm rollback`, against one file. This reads the workspace
 * config DOCUMENT through the same reader `cpm config` uses, so the value is the one on disk and
 * the resolution is not a second derivation of where the config lives.
 *
 * Both spellings are honoured — `versioning.maxVersions` is the 5.0 file name and
 * `versioning.max_versions` the 4.x one the server still folds in
 * (`infra/config/config-file-translation.ts`). A value that is not a positive integer falls back
 * rather than throwing: a malformed setting must not make a rollback fail, and the server's own
 * loader treats it the same way.
 */
export function resolveConfiguredMaxVersions(workspace: string): number {
  const read = readConfig(workspace);
  if (!read.success || read.config === undefined) {
    return DEFAULT_MAX_VERSIONS;
  }
  for (const key of ['versioning.maxVersions', 'versioning.max_versions']) {
    const value = getConfigValue(read.config, key);
    if (typeof value === 'number' && Number.isInteger(value) && value > 0) {
      return value;
    }
  }
  return DEFAULT_MAX_VERSIONS;
}

export function saveVersion(
  resourceDir: string,
  resourceType: ResourceType,
  resourceId: string,
  snapshot: Record<string, unknown>,
  options?: HistoryWriteOptions
): SaveVersionResult {
  const request = createRequest(resourceDir, 'save_version', { resourceType, resourceId });
  if (request === null) {
    return { success: false, error: 'Unable to resolve resource DB path', recorded: false };
  }

  const result = runSqlite({
    ...(request as HistoryRequest),
    snapshot,
    diff_summary: options?.diff_summary ?? '',
    description: options?.description,
    created_at: new Date().toISOString(),
    max_versions: options?.maxVersions ?? DEFAULT_MAX_VERSIONS,
  });
  if (!result.success) {
    return { success: false, error: result.error ?? 'Failed to save version', recorded: false };
  }
  return { success: true, version: result.version ?? 0, recorded: result.recorded ?? false };
}

/**
 * Record the state PRODUCED by an edit, bridging any unrecorded prior state first.
 *
 * Public CLI counterpart to `VersionHistoryService.recordEditResult` — same go-forward
 * numbering (version N holds what edit N produced) and same bridge-row rule, so a resource
 * edited alternately by the server and by `cpm` accumulates one consistent version sequence
 * rather than two disagreeing ones.
 */
export function recordEditResult(
  resourceDir: string,
  resourceType: ResourceType,
  resourceId: string,
  priorLiveSnapshot: Record<string, unknown>,
  producedSnapshot: Record<string, unknown>,
  options?: HistoryWriteOptions
): SaveVersionResult & { bridged: boolean } {
  const request = createRequest(resourceDir, 'record_edit_result', { resourceType, resourceId });
  if (request === null) {
    return {
      success: false,
      error: 'Unable to resolve resource DB path',
      bridged: false,
      recorded: false,
    };
  }

  const result = runSqlite({
    ...(request as HistoryRequest),
    prior_snapshot: priorLiveSnapshot,
    snapshot: producedSnapshot,
    diff_summary: options?.diff_summary ?? '',
    description: options?.description ?? '',
    created_at: new Date().toISOString(),
    max_versions: options?.maxVersions ?? DEFAULT_MAX_VERSIONS,
  });
  if (!result.success) {
    return {
      success: false,
      error: result.error ?? 'Failed to record edit result',
      bridged: false,
      recorded: false,
    };
  }
  return {
    success: true,
    version: result.version ?? 0,
    recorded: result.recorded ?? false,
    bridged: result.bridged ?? false,
  };
}

export function rollbackVersion(
  resourceDir: string,
  resourceType: ResourceType,
  resourceId: string,
  targetVersion: number,
  currentSnapshot: Record<string, unknown>,
  options?: HistoryWriteOptions
): RollbackResult & { snapshot?: Record<string, unknown> } {
  const request = createRequest(resourceDir, 'rollback', { resourceType, resourceId });
  if (request === null) {
    return { success: false, error: 'Unable to resolve resource DB path' };
  }

  const result = runSqlite({
    ...(request as HistoryRequest),
    target_version: targetVersion,
    current_snapshot: currentSnapshot,
    created_at: new Date().toISOString(),
    max_versions: options?.maxVersions ?? DEFAULT_MAX_VERSIONS,
  });
  if (!result.success) {
    return { success: false, error: result.error ?? 'Rollback failed' };
  }
  return {
    success: true,
    saved_version: result.saved_version,
    recorded: result.recorded ?? false,
    restored_version: result.restored_version,
    snapshot: result.snapshot,
  };
}

/**
 * Delete every `version_history` row for `ref`, and for every id below it (`ref.resourceId/…`):
 * a chain's steps go with the chain. `resourceDir` only locates `state.db`.
 *
 * Named for what it does, not for the storage model it predates. It was `deleteHistoryFile` until
 * 2026-08-17 — a name from the retired JSON-sidecar era — which sent anyone grepping
 * for sidecar cleanup to a SQL function and anyone grepping for "what deletes version rows" past
 * it entirely. It is live and load-bearing: `deleteResourceDir` calls it, so removing a resource
 * directory purges its history.
 */
export function deleteVersionRows(resourceDir: string, ref: HistoryResourceRef): boolean {
  const request = createRequest(resourceDir, 'delete_history', ref);
  if (request === null) {
    return false;
  }
  const result = runSqlite(request as HistoryRequest);
  return result.success;
}

/**
 * Re-key `from`'s history to `newId`, and every id below it with it: renaming chain `a` to `b`
 * carries `a/step` to `b/step`. `resourceDir` only locates `state.db`.
 */
export function renameHistoryResource(
  resourceDir: string,
  from: HistoryResourceRef,
  newId: string
): boolean {
  const request = createRequest(resourceDir, 'rename_history', from);
  if (request === null) {
    return false;
  }
  const result = runSqlite({
    ...(request as HistoryRequest),
    new_resource_id: newId,
  });
  return result.success;
}

// ── Formatting ──────────────────────────────────────────────────────────────

export function formatHistoryTable(history: HistoryFile, limit: number = 10): string {
  const parts: string[] = [];

  parts.push(`Version History: ${history.resource_id} (${history.versions.length} versions)`);
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
    parts.push(`... and ${remaining} more ${remaining === 1 ? 'version' : 'versions'}`);
  }

  return parts.join('\n');
}
