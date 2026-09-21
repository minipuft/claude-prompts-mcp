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

import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import type {
  VersionEntry,
  HistoryFile,
  SaveVersionResult,
  RollbackResult,
  SaveVersionOptions,
} from '#modules/versioning/types.js';

import {
  configFileFormat,
  findWorkspaceConfigFiles,
  parseConfigText,
} from '#shared/utils/config-file-format.js';
import { resolveSettingPath } from '#shared/utils/path-setting.js';
import { deriveProjectScopeId } from '#shared/utils/project-scope.js';
import { resolveContinuityScopeId } from '#shared/utils/request-identity-scope.js';
import {
  RUNTIME_STATE_DIR_NAME,
  STATE_DB_FILE_NAME,
} from '#shared/utils/runtime-state-location.js';

const DEFAULT_MAX_VERSIONS = 50;

type ResourceType = 'prompt' | 'gate' | 'framework' | 'style';

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

interface HistoryRequest {
  action:
    | 'load_history'
    | 'get_version'
    | 'save_version'
    | 'record_edit_result'
    | 'compare_versions'
    | 'rollback'
    | 'delete_history'
    | 'rename_history';
  db_path: string;
  resource_type: ResourceType;
  resource_id: string;
  version?: number;
  from_version?: number;
  to_version?: number;
  max_versions?: number;
  created_at?: string;
  snapshot?: Record<string, unknown>;
  /** The on-disk state immediately BEFORE this edit — only read by `record_edit_result`/`rollback` for the bridge check. */
  prior_snapshot?: Record<string, unknown>;
  description?: string;
  diff_summary?: string;
  target_version?: number;
  current_snapshot?: Record<string, unknown>;
  new_resource_id?: string;
}

interface HistoryResponse {
  success: boolean;
  error?: string;
  history?: HistoryFile | null;
  entry?: VersionEntry | null;
  from?: VersionEntry;
  to?: VersionEntry;
  version?: number;
  /** Set by `record_edit_result` — true when a bridge row was inserted before the recorded result. */
  bridged?: boolean;
  saved_version?: number;
  restored_version?: number;
  snapshot?: Record<string, unknown>;
  /**
   * Set alongside `success: false` by `load_history` when `resolveEffectiveTenantId` found the
   * guessed tenant empty AND more than one other tenant holding rows for this resource — refused
   * rather than guessed between two real candidates. Distinguishes this from every other
   * `success: false` (missing `state.db`, missing table): those map to `loadHistory` returning
   * `null`, same as a genuinely empty history; this one must not, or a caller cannot tell
   * "nothing recorded" from "recorded somewhere this guess could not find".
   */
  ambiguous?: true;
}

/** First of `values` that is set and not all-whitespace, else `undefined`. */
function firstNonEmptyEnvValue(...values: (string | undefined)[]): string | undefined {
  for (const value of values) {
    if (value !== undefined && value.trim() !== '') {
      return value;
    }
  }
  return undefined;
}

/**
 * Resolve `state.db`'s location the way the server does, without importing the server.
 *
 * Restates `PathResolver.getRuntimeRoot()` / `getStateDatabasePath()` (`server/src/runtime/
 * paths.ts`) rather than importing it: `validate:arch`'s `cli-shared-no-runtime` rule forbids
 * `cli-shared/` from reaching `runtime/` even transitively, because the CLI bundles this barrel
 * on its own, for a lower Node floor than the server's — >=18.18.0 vs >=22.13.0, per this repo's
 * root CLAUDE.md §Node.js Support Boundaries. The precedence is env-only, which is what a
 * standalone CLI process can actually observe; the server's `--workspace` CLI flag and
 * package-root fallback have no CLI-side equivalent:
 *
 *   1. `MCP_RUNTIME_ROOT`, if set to a non-empty value — matches `getRuntimeRoot()`'s own first
 *      branch exactly.
 *   2. `MCP_WORKSPACE`, if set to a non-empty value — matches `getRuntimeRoot()` falling back to
 *      `getWorkspace()`, whose own first two branches (`--workspace` flag, then this variable)
 *      collapse to this one for a CLI process.
 *   3. Neither set: fall back to discovering an existing `runtime-state/` by walking up from the
 *      resource directory, as this function always did. There is no env-derived root to trust in
 *      that case, and this keeps a bare local checkout — no plugin, no env vars — working as it
 *      always has.
 *
 * Branches 1 and 2 resolve through `resolveSettingPath`, the exact function `PathResolver` itself
 * calls for both variables, so a relative value is resolved against the CLI's cwd the same way the
 * server resolves it against its own.
 */
function resolveStateDbPath(resourceDir: string): string | null {
  const envRoot = firstNonEmptyEnvValue(
    process.env['MCP_RUNTIME_ROOT'],
    process.env['MCP_WORKSPACE']
  );
  if (envRoot !== undefined) {
    return join(resolveSettingPath(envRoot), RUNTIME_STATE_DIR_NAME, STATE_DB_FILE_NAME);
  }

  let current = normalize(resourceDir);
  for (;;) {
    const runtimeStateDir = join(current, RUNTIME_STATE_DIR_NAME);
    if (existsSync(runtimeStateDir)) {
      return join(runtimeStateDir, STATE_DB_FILE_NAME);
    }
    const serverRuntimeStateDir = join(current, 'server', RUNTIME_STATE_DIR_NAME);
    if (existsSync(serverRuntimeStateDir)) {
      return join(serverRuntimeStateDir, STATE_DB_FILE_NAME);
    }

    const parent = dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

/**
 * Guess the tenant this process would write `version_history` under, absent other evidence.
 *
 * Mirrors the SHAPE of `VersionHistoryService.resolveTenantId()` on the server —
 * `resolveContinuityScopeId(scope)` — but cannot mirror its INPUT: the server's `scope` there
 * comes from `identity.launchDefaults`, resolved at ITS launch from `--workspace-id`, its
 * config file, or its own `CLAUDE_PROJECT_DIR`/cwd (`applyRuntimeIdentityOverrides`,
 * `runtime/context.ts`) — none of which this process can observe. What it CAN observe: the
 * same `identity.launchDefaults.workspaceId` if the workspace's config file sets it explicitly
 * (`readConfiguredWorkspaceId`, matching rung 2 of the server's precedence), and its own
 * `CLAUDE_PROJECT_DIR`/cwd, which matches the server's only when both processes share an
 * environment (e.g. launched from the same shell/session) or happen to share a cwd.
 *
 * **This is a guess, not the answer, and `runSqlite` does not trust it blindly.** A `--workspace-id`
 * flag, or a server that derived its scope from a launch cwd this process never shares (the
 * common shape for a background daemon: one fixed install path serving many per-project
 * workspaces), both produce a guess that disagrees with the server's actual resolution. Rather
 * than let a wrong guess silently report "no history" or diverge a rollback onto a new tenant,
 * `resolveEffectiveTenantId` (below `runSqlite`) corrects it against `tenant_id` values already
 * recorded in this db — the server's resolution is the source of truth, and an existing row
 * already names it. What remains unclosed: a resource with NO history yet, first written by the
 * CLI itself under a guess the server would not have made — there is no prior row to correct
 * against, and closing that needs the server to persist its resolved scope somewhere this
 * process can read before any write happens, which is out of scope here.
 */
function resolveTenantId(dbPath: string): string {
  const configured = readConfiguredWorkspaceId(dbPath);
  const derived = deriveProjectScopeId()?.value;
  return resolveContinuityScopeId({ workspaceId: configured ?? derived });
}

/**
 * Read `identity.launchDefaults.workspaceId` from the config file beside runtime-state.
 *
 * Either config name counts, in the same precedence the server reads them, and the text parses in
 * whichever dialect its extension declares — a workspace id commented around in a `config.jsonc`
 * would otherwise read as absent and silently scope this process's history to `'default'`.
 */
function readConfiguredWorkspaceId(dbPath: string): string | undefined {
  const configPath = findWorkspaceConfigFiles(dirname(dirname(dbPath)))[0];
  try {
    if (configPath === undefined) {
      return undefined;
    }
    const parsed: unknown = parseConfigText(
      readFileSync(configPath, 'utf8'),
      configFileFormat(configPath)
    );
    const workspaceId = (
      parsed as { identity?: { launchDefaults?: { workspaceId?: unknown } } } | null
    )?.identity?.launchDefaults?.workspaceId;
    return typeof workspaceId === 'string' && workspaceId.trim() !== ''
      ? workspaceId.trim()
      : undefined;
  } catch {
    // A malformed config is the server's problem to report, not the CLI's to crash on.
    return undefined;
  }
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
    db.exec('PRAGMA busy_timeout = 5000');
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

/**
 * Correct `resolveTenantId`'s guess against what this db actually holds for this resource.
 *
 * `resolveTenantId` derives a scope independently of the server — it cannot see the server's own
 * launch cwd, only `CLAUDE_PROJECT_DIR` (if the CLI process happens to share it) and a configured
 * `identity.launchDefaults.workspaceId`. Neither rung fires for a server that derived its scope
 * from its own launch cwd with nothing configured — a background-daemon deployment where
 * `MCP_WORKSPACE` names a per-project directory but the server binary itself always launches from
 * one fixed install path. In that shape the CLI's guess and the server's resolution are two
 * independent answers to the same question and agree only by accident (measured: `cpm rollback -w
 * <workspace>` from an unrelated cwd reports `Version 1 not found` against history that exists).
 *
 * The correction is not a second guess: `tenant_id` on an existing `version_history` row is not
 * derived, it is what the writer — the server — actually used, so reading it is consulting the
 * SSOT directly instead of re-predicting it. Applied only when unambiguous (the guessed tenant has
 * no rows for this exact resource, and exactly one OTHER tenant does): a shared `state.db` can
 * legitimately hold the same `resource_type`/`resource_id` under two unrelated projects. Two real
 * candidates is reported as `ambiguousCandidateCount`, not silently resolved — picking one would
 * serve the wrong project's history, and returning the guess unlabeled would read exactly like a
 * genuinely empty history, which is the same "nothing found" symptom this fix exists to remove.
 * Zero candidates (nobody, anywhere, has ever recorded this resource) is not ambiguous — there is
 * nothing to be ambiguous BETWEEN — so it returns the guess unlabeled too, and the caller reports
 * an ordinary empty result.
 *
 * `dispatch` calls this for every action whose SQL can only act on rows that already exist —
 * `load_history`, `get_version`, `compare_versions`, `rollback` (which reads its target before
 * writing the restored state, under the SAME resolved tenant so the two halves of one rollback
 * never split across tenants), and `delete_history` (a wrong guess must not leave the server's
 * rows behind as an undeletable orphan — `cpm delete` has the identical shape as `cpm rollback`:
 * both are reached only from `cli/src/commands/*.ts`, never from the server, which always writes
 * through `VersionHistoryService`'s own `this.scope`, not this guess). `save_version` and
 * `record_edit_result` deliberately do NOT go through this: they can legitimately be the
 * first-ever write for a genuinely different, correctly-resolved tenant that happens to share a
 * `resource_type`/`resource_id` with another tenant's resource — "correcting" that write would
 * silently merge two unrelated projects' histories. Measured while writing this fix's own test:
 * an unmodified `saveVersion` under a second real tenant was redirected into the first tenant's
 * existing history instead of starting its own. `rename_history` is left on the uncorrected guess
 * too, but for a different reason: its write path is being edited concurrently elsewhere in this
 * file (row renumbering); correcting it is the same shape and belongs with that change, not this
 * one — tracked as an open gap, not a decision that it should stay uncorrected.
 *
 * Only `load_history` currently inspects `ambiguousCandidateCount` and refuses loudly on it
 * (`dispatch`'s other four callers read `.tenantId` alone, unchanged from before this field
 * existed) — see that case for why an ambiguous result must not collapse into the same "nothing
 * found" shape a genuinely empty history produces.
 */
function resolveEffectiveTenantId(
  db: DatabaseSync,
  guessedTenantId: string,
  request: HistoryRequest
): { tenantId: string; ambiguousCandidateCount?: number } {
  const guessHasRows =
    db
      .prepare(
        `SELECT 1 FROM version_history WHERE tenant_id = ? AND resource_type = ? AND resource_id = ? LIMIT 1`
      )
      .get(guessedTenantId, request.resource_type, request.resource_id) !== undefined;
  if (guessHasRows) {
    return { tenantId: guessedTenantId };
  }

  const candidates = db
    .prepare(
      `SELECT DISTINCT tenant_id FROM version_history WHERE resource_type = ? AND resource_id = ?`
    )
    .all(request.resource_type, request.resource_id) as { tenant_id: string }[];
  const onlyCandidate = candidates.length === 1 ? candidates[0] : undefined;
  if (onlyCandidate !== undefined) {
    return { tenantId: onlyCandidate.tenant_id };
  }
  if (candidates.length >= 2) {
    return { tenantId: guessedTenantId, ambiguousCandidateCount: candidates.length };
  }
  return { tenantId: guessedTenantId };
}

function versionHistoryExists(db: DatabaseSync): boolean {
  const row = db
    .prepare(`SELECT count(*) AS present FROM sqlite_master WHERE type='table' AND name=?`)
    .get('version_history') as { present: number } | undefined;
  return (row?.present ?? 0) > 0;
}

/** One persisted `version_history` row, before decoding the JSON snapshot. */
interface HistoryRow {
  version: number;
  snapshot: string;
  diff_summary: string | null;
  description: string | null;
  created_at: string;
}

const ENTRY_COLUMNS = 'version, snapshot, diff_summary, description, created_at';

/**
 * Matches a resource id and every id below it; binds the id twice. Appending `/` to the column
 * makes the id itself and its descendants one prefix test: `chain` and `chain/step` both start
 * `chain/`, and `chain_other` does not.
 */
const SUBTREE_MATCH = `substr(resource_id || '/', 1, length(?) + 1) = ? || '/'`;

function toEntry(row: HistoryRow): VersionEntry {
  return {
    version: Number(row.version),
    date: row.created_at,
    snapshot: JSON.parse(row.snapshot) as Record<string, unknown>,
    diff_summary: row.diff_summary ?? '',
    description: row.description ?? '',
  };
}

function selectVersion(
  db: DatabaseSync,
  tenantId: string,
  request: HistoryRequest,
  version: number
): HistoryRow | undefined {
  return db
    .prepare(
      `SELECT ${ENTRY_COLUMNS} FROM version_history
       WHERE tenant_id = ? AND resource_type = ? AND resource_id = ? AND version = ?`
    )
    .get(tenantId, request.resource_type, request.resource_id, version) as HistoryRow | undefined;
}

function latestVersion(db: DatabaseSync, tenantId: string, request: HistoryRequest): number {
  const row = db
    .prepare(
      `SELECT MAX(version) AS latest FROM version_history
       WHERE tenant_id = ? AND resource_type = ? AND resource_id = ?`
    )
    .get(tenantId, request.resource_type, request.resource_id) as
    { latest: number | null } | undefined;
  return Number(row?.latest ?? 0);
}

/** Insert a snapshot at the next version and trim to `max_versions`. */
function appendVersion(
  db: DatabaseSync,
  tenantId: string,
  request: HistoryRequest,
  snapshot: Record<string, unknown>,
  description: string,
  diffSummary: string
): number {
  const version = latestVersion(db, tenantId, request) + 1;
  db.prepare(
    `INSERT INTO version_history
       (tenant_id, organization_id, workspace_id, resource_type, resource_id,
        version, snapshot, diff_summary, description, created_at)
     VALUES (?, NULL, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    tenantId,
    tenantId,
    request.resource_type,
    request.resource_id,
    version,
    JSON.stringify(snapshot),
    diffSummary,
    description,
    request.created_at ?? new Date().toISOString()
  );
  prune(db, tenantId, request, request.max_versions ?? DEFAULT_MAX_VERSIONS);
  return version;
}

/** True when the newest recorded snapshot structurally equals the given live state. */
function latestSnapshotMatches(
  db: DatabaseSync,
  tenantId: string,
  request: HistoryRequest,
  live: Record<string, unknown>
): boolean {
  const latest = latestVersion(db, tenantId, request);
  if (latest === 0) return false;
  const row = selectVersion(db, tenantId, request, latest);
  if (row === undefined) return false;
  return JSON.stringify(JSON.parse(row.snapshot)) === JSON.stringify(live);
}

/**
 * Record the state PRODUCED by an edit, bridging any unrecorded prior state first.
 *
 * Mirrors `VersionHistoryService.recordEditResult` exactly (P7 go-forward numbering): version N
 * always holds the state edit N produced. Whenever the latest recorded snapshot differs from the
 * live pre-edit state (first update of a never-before-recorded resource, or an out-of-band edit),
 * that live state is bridged in first so it stays rollback-reachable; steady state records exactly
 * one row per edit. Both writers of `version_history` must agree on this, or a resource's "newest
 * version" means something different depending on which process wrote it.
 */
function recordEditResultRow(
  db: DatabaseSync,
  tenantId: string,
  request: HistoryRequest,
  edit: {
    priorLiveSnapshot: Record<string, unknown>;
    producedSnapshot: Record<string, unknown>;
    description: string;
    diffSummary: string;
  }
): { version: number; bridged: boolean } {
  const { priorLiveSnapshot, producedSnapshot, description, diffSummary } = edit;
  const bridged = !latestSnapshotMatches(db, tenantId, request, priorLiveSnapshot);
  if (bridged) {
    appendVersion(
      db,
      tenantId,
      request,
      priorLiveSnapshot,
      'Bridge: prior live state (era transition or out-of-band edit)',
      ''
    );
  }
  const version = appendVersion(db, tenantId, request, producedSnapshot, description, diffSummary);
  return { version, bridged };
}

function prune(
  db: DatabaseSync,
  tenantId: string,
  request: HistoryRequest,
  maxVersions: number
): void {
  db.prepare(
    `DELETE FROM version_history
     WHERE tenant_id = ? AND resource_type = ? AND resource_id = ?
       AND id NOT IN (
         SELECT id FROM version_history
         WHERE tenant_id = ? AND resource_type = ? AND resource_id = ?
         ORDER BY version DESC LIMIT ?
       )`
  ).run(
    tenantId,
    request.resource_type,
    request.resource_id,
    tenantId,
    request.resource_type,
    request.resource_id,
    maxVersions
  );
}

function loadRows(db: DatabaseSync, tenantId: string, request: HistoryRequest): HistoryFile {
  const rows = db
    .prepare(
      `SELECT ${ENTRY_COLUMNS} FROM version_history
       WHERE tenant_id = ? AND resource_type = ? AND resource_id = ?
       ORDER BY version DESC`
    )
    .all(tenantId, request.resource_type, request.resource_id) as unknown as HistoryRow[];
  const versions = rows.map(toEntry);
  return {
    resource_type: request.resource_type as HistoryFile['resource_type'],
    resource_id: request.resource_id,
    current_version: versions[0]?.version ?? 0,
    versions,
  };
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
      const version = appendVersion(
        db,
        tenantId,
        request,
        request.snapshot ?? {},
        request.description ?? '',
        request.diff_summary ?? ''
      );
      return { success: true, version };
    }

    case 'record_edit_result': {
      const result = recordEditResultRow(db, tenantId, request, {
        priorLiveSnapshot: request.prior_snapshot ?? {},
        producedSnapshot: request.snapshot ?? {},
        description: request.description ?? '',
        diffSummary: request.diff_summary ?? '',
      });
      return { success: true, version: result.version, bridged: result.bridged };
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
      db.prepare(
        `UPDATE version_history SET resource_id = ? || substr(resource_id, length(?) + 1)
         WHERE tenant_id = ? AND resource_type = ? AND ${SUBTREE_MATCH}`
      ).run(
        newResourceId,
        request.resource_id,
        tenantId,
        request.resource_type,
        request.resource_id,
        request.resource_id
      );
      return { success: true };
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

export function saveVersion(
  resourceDir: string,
  resourceType: ResourceType,
  resourceId: string,
  snapshot: Record<string, unknown>,
  options?: SaveVersionOptions
): SaveVersionResult {
  const request = createRequest(resourceDir, 'save_version', { resourceType, resourceId });
  if (request === null) {
    return { success: false, error: 'Unable to resolve resource DB path' };
  }

  const result = runSqlite({
    ...(request as HistoryRequest),
    snapshot,
    diff_summary: options?.diff_summary ?? '',
    description: options?.description,
    created_at: new Date().toISOString(),
    max_versions: DEFAULT_MAX_VERSIONS,
  });
  if (!result.success) {
    return { success: false, error: result.error ?? 'Failed to save version' };
  }
  return { success: true, version: result.version ?? 0 };
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
  options?: SaveVersionOptions
): SaveVersionResult & { bridged: boolean } {
  const request = createRequest(resourceDir, 'record_edit_result', { resourceType, resourceId });
  if (request === null) {
    return { success: false, error: 'Unable to resolve resource DB path', bridged: false };
  }

  const result = runSqlite({
    ...(request as HistoryRequest),
    prior_snapshot: priorLiveSnapshot,
    snapshot: producedSnapshot,
    diff_summary: options?.diff_summary ?? '',
    description: options?.description ?? '',
    created_at: new Date().toISOString(),
    max_versions: DEFAULT_MAX_VERSIONS,
  });
  if (!result.success) {
    return {
      success: false,
      error: result.error ?? 'Failed to record edit result',
      bridged: false,
    };
  }
  return { success: true, version: result.version ?? 0, bridged: result.bridged ?? false };
}

export function rollbackVersion(
  resourceDir: string,
  resourceType: ResourceType,
  resourceId: string,
  targetVersion: number,
  currentSnapshot: Record<string, unknown>
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
    max_versions: DEFAULT_MAX_VERSIONS,
  });
  if (!result.success) {
    return { success: false, error: result.error ?? 'Rollback failed' };
  }
  return {
    success: true,
    saved_version: result.saved_version,
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
