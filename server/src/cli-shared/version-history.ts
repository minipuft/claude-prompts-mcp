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
 * the state that preceded it. `recordResourceWrite` and `rollbackVersion` carry the bridge-row
 * logic (self-healing v1 for a never-before-recorded resource, or an out-of-band edit) — see
 * `checkpointed-write.ts` for the mechanism, mirrored from the server's.
 *
 * **`rollbackVersion` is the one write that is not a dispatched action, and it is async.** It has
 * to hold the connection open ACROSS the file write so the prior-state row lands while the disk
 * still holds the prior bytes and the produced row lands once the restored bytes are there
 * (`checkpointed-write.ts`). Everything else here stays synchronous.
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

import { recordCheckpointedWrite, treeFromFileSet } from './checkpointed-write.js';
import { getConfigValue, readConfig } from './config-operations.js';
import { hasObjectStore } from './object-store.js';
import { resolveStateDbPath } from './version-history-location.js';
import {
  appendVersion,
  asObjectStoreDatabase,
  deleteSubtree,
  loadRows,
  renameSubtree,
  selectVersion,
  toEntry,
} from './version-history-rows.js';
import { resolveEffectiveTenantId, resolveTenantId } from './version-history-scope.js';
import { DEFAULT_MAX_VERSIONS } from './version-history-types.js';

import type { ResourceMutationTarget } from '#modules/resources/services/resource-mutation-transaction.js';
import type { RestorePlan } from '#modules/versioning/restore-plan.js';
import type {
  VersionEntry,
  HistoryFile,
  SaveVersionResult,
  RollbackResult,
  SaveVersionOptions,
  ResourceType as VersioningResourceType,
} from '#modules/versioning/types.js';
import type {
  ResourceFileSet,
  ResourceLocationResult,
  ResourceRootOrigin,
} from '#shared/utils/resource-file-set.js';
import type { LoadedTree } from './object-store.js';
import type {
  HistoryRequest,
  HistoryResponse,
  HistoryRowRequest,
  ResourceType,
} from './version-history-types.js';

import {
  resolveByteRestore,
  restoreTargets,
  writeRestoredFiles,
} from '#modules/versioning/byte-restore.js';
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
  const opened = openStateDb(request.db_path);
  if ('error' in opened) {
    return { success: false, error: opened.error };
  }

  try {
    return dispatch(opened.db, request, resolveTenantId(request.db_path));
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    opened.db.close();
  }
}

/**
 * Open `state.db` for writing, or say why it cannot be used.
 *
 * Extracted from `runSqlite` when `rollbackVersion` stopped being a dispatched action: that path
 * holds the connection open ACROSS the file write (`recordCheckpointedWrite`), which a synchronous
 * dispatch cannot express, and it must reach the connection the same way — same pragmas, same
 * missing-table refusal — or the two writers of one file would disagree about lock patience and
 * foreign keys depending on which `cpm` command ran.
 *
 * Exported for `config-checkpoint.ts`, which holds the connection open across a config write for
 * the same reason. It is not a general-purpose opener: a caller that skipped it would reach
 * `state.db` without `STATE_DB_WRITER_PRAGMAS` and without the missing-table refusal, which is the
 * divergence this function exists to prevent.
 */
export function openStateDb(dbPath: string): { db: DatabaseSync } | { error: string } {
  if (!existsSync(dbPath)) {
    return { error: `state.db not found at ${dbPath}` };
  }
  let db: DatabaseSync;
  try {
    db = new DatabaseSync(dbPath);
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
  try {
    // The same list the server's connection applies — one owner, so the two writers of this file
    // cannot disagree about its lock patience or about whether its foreign keys hold.
    for (const pragma of STATE_DB_WRITER_PRAGMAS) {
      db.exec(pragma);
    }
    if (!versionHistoryExists(db)) {
      db.close();
      return {
        error: 'version_history table is absent — start the MCP server once to create the schema',
      };
    }
  } catch (error) {
    db.close();
    return { error: error instanceof Error ? error.message : String(error) };
  }
  return { db };
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
 * `resolveEffectiveTenantId` before using it; `save_version` uses `tenantId`
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
      const outcome = appendVersion(db, tenantId, request, request.snapshot ?? {}, {
        description: request.description ?? '',
        diffSummary: request.diff_summary ?? '',
        tree: request.produced_tree ?? null,
      });
      return { success: true, version: outcome.version, recorded: outcome.recorded };
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
      return deleteSubtree(db, effectiveTenantId, request);
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
 * `maxVersions` rides here rather than as its own parameter because the bound belongs with the
 * other per-call facts the row records, and because `saveVersion` would otherwise take six
 * positional parameters. Omitting it keeps {@link DEFAULT_MAX_VERSIONS}, which is
 * what a workspace that configured nothing gets; a `cpm` command supplies
 * {@link resolveConfiguredMaxVersions}.
 */
export interface HistoryWriteOptions extends SaveVersionOptions {
  maxVersions?: number;
  /**
   * The resource's bytes as they are on disk RIGHT NOW, already read by the caller.
   *
   * Supplied by `cpm rollback` alone today; every other CLI write leaves it absent and records a
   * projection-only row, which is the behaviour those paths have always had. Which ROW it lands
   * on is decided per operation — see `rollbackVersion`.
   */
  tree?: LoadedTree | null;
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
    // One row, and the caller says whether the disk holds the state it is passing.
    produced_tree: options?.tree ?? null,
  });
  if (!result.success) {
    return { success: false, error: result.error ?? 'Failed to save version', recorded: false };
  }
  return { success: true, version: result.version ?? 0, recorded: result.recorded ?? false };
}

/**
 * What one {@link recordResourceWrite} did — in three states, not two.
 *
 * `written: false` is the only failure, and it covers both halves of the atomicity guarantee: the
 * write threw, or the row could not be appended and the transaction put every target back. Either
 * way there is no resource and no row. `written: true, recorded: false` is not a failure — it is a
 * workspace with no version history to write into, reported by name so a caller can say so.
 */
export type ResourceWriteOutcome =
  | { written: true; recorded: true; version: number; bridged: boolean }
  | { written: true; recorded: false; reason: string }
  | { written: false; rolledBack: boolean; error: string };

/**
 * What one `cpm` write records: how to reach its files, how to perform it, and what it produced.
 *
 * Sibling of {@link RollbackRestore}, and deliberately not the same type: a rollback's write is
 * driven by a snapshot this module reads out of the table first, while an ordinary write already
 * knows what it is going to do. What they share is the ORDERING, which is
 * `recordCheckpointedWrite`'s and is stated once there.
 */
export interface ResourceWriteRecord {
  /** The resource's files, re-enumerated on each call — see `CheckpointedWriteInput.enumerate`. */
  enumerate: () => Promise<ResourceFileSet>;
  /** Every path `write` may touch; restored byte-identical if the version record fails. */
  targets: ResourceMutationTarget[];
  /**
   * The state on disk right now, projected through the resource's own contract.
   *
   * **Omitted for a create.** See `CheckpointedWriteInput.priorSnapshot`: a create has no prior
   * live state, so it records one row and that row is version 1.
   */
  priorSnapshot?: Record<string, unknown>;
  /** Perform the write and return the projection of the state it produced. Throwing aborts it. */
  write: () => Promise<Record<string, unknown>>;
  description: string;
  diffSummary?: string;
  /** The workspace's own bound — {@link resolveConfiguredMaxVersions}. */
  maxVersions?: number;
}

/**
 * Perform a `cpm` write and record the state it produced, in the server's order.
 *
 * The one entry point for every `cpm` command that writes a resource it did not read out of the
 * version table. `cpm create` and `cpm toggle` reach it; `cpm rollback` reaches the same ordering
 * through `rollbackVersion`, which additionally has to load its target first.
 *
 * **The tenant is the derived one, uncorrected** — the same rule `dispatch` applies to
 * `save_version`, and for the same reason: `resolveEffectiveTenantId`
 * redirects a write onto a tenant that already holds rows for this id, which is right for an
 * operation acting on EXISTING history (a rollback reads its target from there) and wrong for one
 * that may legitimately be starting a new one. A create under a fresh workspace has no rows by
 * construction, and redirecting it would file the new resource's history under someone else's
 * scope.
 */
export async function recordResourceWrite(
  resourceDir: string,
  ref: HistoryResourceRef,
  record: ResourceWriteRecord
): Promise<ResourceWriteOutcome> {
  const dbPath = resolveStateDbPath(resourceDir);
  if (dbPath === null || !isNonEmptyString(ref.resourceType) || !isNonEmptyString(ref.resourceId)) {
    return await writeUnrecorded(record, 'no state.db could be located for this workspace');
  }
  const opened = openStateDb(dbPath);
  if ('error' in opened) {
    return await writeUnrecorded(record, opened.error);
  }

  const { db } = opened;
  const request: HistoryRowRequest = {
    resource_type: ref.resourceType,
    resource_id: ref.resourceId,
    created_at: new Date().toISOString(),
    max_versions: record.maxVersions ?? DEFAULT_MAX_VERSIONS,
  };
  try {
    const result = await recordCheckpointedWrite(db, resolveTenantId(dbPath), request, {
      loadTree: treeFromFileSet(record.enumerate),
      targets: record.targets,
      priorSnapshot: record.priorSnapshot,
      write: record.write,
      description: record.description,
      diffSummary: record.diffSummary,
    });
    if (!result.success) {
      return { written: false, rolledBack: result.rolledBack, error: result.error };
    }
    // `recorded: false` from the append means the produced state was ALREADY the newest recorded
    // row — a real outcome, not an unavailable history, so it carries that reason rather than the
    // unavailability one.
    return result.outcome.recorded
      ? {
          written: true,
          recorded: true,
          version: result.outcome.version,
          bridged: result.outcome.bridged,
        }
      : {
          written: true,
          recorded: false,
          reason: `the produced state already matches version ${result.outcome.version}`,
        };
  } catch (error) {
    return {
      written: false,
      rolledBack: false,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    db.close();
  }
}

/**
 * Perform the write with no transaction and no row, because there is no history to write into.
 *
 * **This is not a degraded record; it is the absence of one, reported.** A workspace the server
 * has never run in has no `state.db` and no `version_history` table — the CLI never creates either
 * (`runSqlite`) — and refusing the write there would make `cpm create` unusable in exactly the
 * workspace `cpm init` just made. The server's equivalent is `isAutoVersionEnabled()` returning
 * false: the writer runs with no `commit` step at all.
 *
 * The reason is returned rather than swallowed, because a create that silently records nothing is
 * the defect shape this whole seam exists to remove.
 */
async function writeUnrecorded(
  record: ResourceWriteRecord,
  reason: string
): Promise<ResourceWriteOutcome> {
  try {
    await record.write();
  } catch (error) {
    return {
      written: false,
      rolledBack: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
  return { written: true, recorded: false, reason };
}

/**
 * How a rollback puts the target version back on disk, and which files that touches.
 *
 * `apply` exists so the RESTORE happens between the two rows rather than after both of them.
 * `cpm rollback` used to record everything first and write afterwards, which left the merged file
 * it produced described by no row at all: measured 2026-09-21, `Rollback to v1` carried
 * `tree_hash` NULL while the bytes on disk hashed to something nothing had recorded, so
 * `cpm history` listed a state it could not restore byte-exactly. Handing the write in as a
 * callback is the same inversion every server processor already uses (`commit` of
 * `ResourceMutationTransaction`), and it is what lets both rows carry the bytes they describe.
 */
export interface RollbackRestore {
  /** The resource's files, re-enumerated on each call — see `CheckpointedWriteInput.enumerate`. */
  enumerate: () => Promise<ResourceFileSet>;
  /** Every path `apply` may touch; restored byte-identical if the version record fails. */
  targets: ResourceMutationTarget[];
  /**
   * Write the target version's state to disk and return the state that write PRODUCED.
   *
   * Returning it rather than reusing the target row's snapshot is what makes the produced row
   * true: a CLI restore merges the snapshot over the entry file and touches nothing else, so a
   * gate's `guidance.md` and any key the snapshot does not carry stay as they were. Recording the
   * target snapshot verbatim would claim a state the files do not hold.
   *
   * Throwing aborts the rollback with nothing claimed.
   */
  apply: (snapshot: Record<string, unknown>) => Promise<Record<string, unknown>>;
  /** The workspace's own bound — {@link resolveConfiguredMaxVersions}. */
  maxVersions?: number;
  /**
   * Where the resource's files are, for the BYTE path.
   *
   * Optional, and its absence is a real answer: a caller that cannot say where the files live gets
   * today's projection restore, which is what every `cpm rollback` did before schema v29. The
   * value has the same shape the server's injected locator returns, so both surfaces hand
   * `resolveByteRestore` the same thing.
   */
  location?: ResourceLocationResult;
  /**
   * The projection of what is on disk AFTER a byte restore.
   *
   * Byte-restoring does not produce a snapshot — it produces files — and the produced row must
   * describe what the files hold, not what the target row claimed. Re-projecting is also what
   * keeps a left-in-place file (ruling R57) honestly reflected: the restored resource may differ
   * from the target version, and the row records the difference rather than the intention.
   */
  reproject?: () => Promise<Record<string, unknown>>;
  /**
   * Resolve the plan and return it WITHOUT writing a file or a row.
   *
   * The same value the apply runs, from the same call — not a second derivation. A preview built
   * from its own read of the tables can agree with the action today and drift from it silently.
   */
  preview?: boolean;
}

/**
 * The byte-restore availability for one `cpm` rollback target.
 *
 * `selectVersion` reads the ENTRY columns a history listing needs and deliberately not the row id
 * or its tree columns, so those are read here rather than widening a projection every other caller
 * would then carry. A row with no tree, or a caller that gave no location, is `projection-only` —
 * the answer every `cpm rollback` gave before schema v29.
 */
async function resolveCliByteRestore(
  db: DatabaseSync,
  tenantId: string,
  request: HistoryRowRequest,
  input: { targetVersion: number; location?: ResourceLocationResult }
): Promise<Awaited<ReturnType<typeof resolveByteRestore>>> {
  if (input.location === undefined) {
    return { status: 'projection-only', reason: 'no resource location was supplied' };
  }
  // Asked BEFORE the SELECT below, not after it. `cpm` opens whatever `state.db` it finds, and one
  // written by a server older than v29 has neither the object store nor `version_history`'s tree
  // columns — a SELECT naming `tree_hash` there THROWS, which would turn a perfectly ordinary
  // rollback against an older database into a failure. The tables and the columns arrived in the
  // same bump, so one lookup answers for both.
  if (!hasObjectStore(asObjectStoreDatabase(db))) {
    return {
      status: 'projection-only',
      reason: 'this state.db has no object store — its schema predates v29',
    };
  }
  const row = db
    .prepare(
      `SELECT id, tree_hash, tree_origin FROM version_history
       WHERE tenant_id = ? AND resource_type = ? AND resource_id = ? AND version = ?`
    )
    .get(tenantId, request.resource_type, request.resource_id, input.targetVersion) as
    { id: number; tree_hash: string | null; tree_origin: string | null } | undefined;
  if (row?.tree_hash == null) {
    return {
      status: 'projection-only',
      reason: `version ${input.targetVersion} recorded no file tree`,
    };
  }
  return resolveByteRestore({
    db: asObjectStoreDatabase(db),
    tenantId,
    resourceType: request.resource_type as VersioningResourceType,
    resourceId: request.resource_id,
    version: input.targetVersion,
    versionRowId: Number(row.id),
    recordedOrigin: (row.tree_origin ?? 'unknown') as ResourceRootOrigin,
    location: input.location,
  });
}

/**
 * Restore `targetVersion` and record the state that restore produced.
 *
 * Not a dispatched action, unlike every other write here: the connection has to stay open across
 * `restore.apply`, and `dispatch` is synchronous by construction (`DatabaseSync`). The target is
 * still validated before anything is written, so a refused rollback consumes no version number and
 * touches no file.
 */
export async function rollbackVersion(
  resourceDir: string,
  ref: HistoryResourceRef,
  targetVersion: number,
  currentSnapshot: Record<string, unknown>,
  restore: RollbackRestore
): Promise<
  RollbackResult & {
    snapshot?: Record<string, unknown>;
    /** Present when the target version carries a file tree — the plan a preview prints. */
    plan?: RestorePlan;
  }
> {
  const dbPath = resolveStateDbPath(resourceDir);
  if (dbPath === null || !isNonEmptyString(ref.resourceType) || !isNonEmptyString(ref.resourceId)) {
    return { success: false, error: 'Unable to resolve resource DB path' };
  }
  const opened = openStateDb(dbPath);
  if ('error' in opened) {
    return { success: false, error: opened.error };
  }

  const { db } = opened;
  const request: HistoryRowRequest = {
    resource_type: ref.resourceType,
    resource_id: ref.resourceId,
    created_at: new Date().toISOString(),
    max_versions: restore.maxVersions ?? DEFAULT_MAX_VERSIONS,
  };
  try {
    // The tenant is corrected ONCE and the same value carries both rows — a rollback that read
    // its target from a corrected tenant must record the restored state there too, or the
    // operation splits across two tenants and the next read sees a one-row history.
    const tenantId = resolveEffectiveTenantId(db, resolveTenantId(dbPath), request).tenantId;
    const targetRow = selectVersion(db, tenantId, request, targetVersion);
    if (targetRow === undefined) {
      return { success: false, error: `Version ${targetVersion} not found` };
    }
    const restoredSnapshot = JSON.parse(targetRow.snapshot) as Record<string, unknown>;

    // The SAME resolution the server performs, over the same tables, through the same function —
    // which is what makes a `cpm rollback` and a `resource_manager rollback` of one version put
    // back the same bytes rather than two implementations agreeing by inspection.
    const available = await resolveCliByteRestore(db, tenantId, request, {
      targetVersion,
      location: restore.location,
    });
    if (available.status === 'refused') {
      return { success: false, error: available.reason };
    }
    const plan = available.status === 'ready' ? available.plan : undefined;

    // A preview returns HERE: before the prior-state row, before the file write, before the
    // produced row. Nothing has been written at this point and the plan is already resolved.
    if (restore.preview === true) {
      return {
        success: true,
        restored_version: targetVersion,
        recorded: false,
        snapshot: restoredSnapshot,
        ...(plan !== undefined ? { plan } : {}),
      };
    }

    const result = await recordCheckpointedWrite(db, tenantId, request, {
      loadTree: treeFromFileSet(restore.enumerate),
      // The plan's own paths on the byte path: those are the files that change, and they are what
      // must go back byte-identical if the version record fails. The caller's `targets` (the entry
      // file alone) would leave a restored companion file behind after a rolled-back write.
      targets: available.status === 'ready' ? restoreTargets(available.plan) : restore.targets,
      priorSnapshot: currentSnapshot,
      write: async () => {
        if (available.status !== 'ready') {
          return await restore.apply(restoredSnapshot);
        }
        await writeRestoredFiles(available.plan, available.bytes);
        // Re-projected from disk, never the target row echoed back: a restore that left a file in
        // place (ruling R57) produced a state that differs from the target version, and the row
        // must record what the files hold.
        return restore.reproject !== undefined ? await restore.reproject() : restoredSnapshot;
      },
      description: `Rollback to v${targetVersion}`,
    });
    if (!result.success) {
      return { success: false, error: result.error };
    }
    return {
      success: true,
      saved_version: result.outcome.version,
      // False when the target version was already the current state: the restore ran and produced
      // the state that was already newest, so `saved_version` is the number that already existed.
      recorded: result.outcome.recorded,
      restored_version: targetVersion,
      snapshot: restoredSnapshot,
      ...(plan !== undefined ? { plan } : {}),
    };
  } catch (error) {
    return { success: false, error: error instanceof Error ? error.message : String(error) };
  } finally {
    db.close();
  }
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
