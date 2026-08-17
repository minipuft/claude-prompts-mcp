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

import { deriveProjectScopeId } from '#shared/utils/project-scope.js';
import { resolveContinuityScopeId } from '#shared/utils/request-identity-scope.js';

const DEFAULT_MAX_VERSIONS = 50;

type ResourceType = 'prompt' | 'gate' | 'framework' | 'style';

interface ResourceRef {
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
}

function resolveResourceRef(resourceDir: string): ResourceRef | null {
  const normalized = normalize(resourceDir).replace(/\\/g, '/');
  const segments = normalized.split('/').filter((segment) => segment !== '');
  const id = segments.length > 0 ? segments[segments.length - 1] : undefined;
  if (id === undefined || id === '') {
    return null;
  }

  if (segments.includes('prompts')) {
    return { resourceType: 'prompt', resourceId: id };
  }
  if (segments.includes('gates')) {
    return { resourceType: 'gate', resourceId: id };
  }
  if (segments.includes('frameworks')) {
    return { resourceType: 'framework', resourceId: id };
  }
  if (segments.includes('styles')) {
    return { resourceType: 'style', resourceId: id };
  }
  return null;
}

function resolveStateDbPath(resourceDir: string): string | null {
  let current = normalize(resourceDir);
  for (;;) {
    const runtimeStateDir = join(current, 'runtime-state');
    if (existsSync(runtimeStateDir)) {
      return join(runtimeStateDir, 'state.db');
    }
    const serverRuntimeStateDir = join(current, 'server', 'runtime-state');
    if (existsSync(serverRuntimeStateDir)) {
      return join(serverRuntimeStateDir, 'state.db');
    }

    const parent = dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

/**
 * Resolve the tenant this process writes `version_history` under.
 *
 * Must agree with `VersionHistoryService.resolveTenantId()` on the server, which is
 * `resolveContinuityScopeId(scope)` over the launch workspace. Same precedence applied
 * here: an explicit `identity.launchDefaults.workspaceId` in config.json outranks the
 * environment-derived id, which falls back to `'default'`.
 *
 * **Known limitation, stated rather than hidden**: a server launched with an explicit
 * `--workspace-id` flag records that id, and nothing on disk tells the CLI what flag the
 * server was started with. In that configuration the two still diverge. Closing it needs
 * the server to persist its resolved scope where the CLI can read it — out of scope here,
 * and narrower than the `'default'`-vs-workspace split this replaces.
 */
function resolveTenantId(dbPath: string): string {
  const configured = readConfiguredWorkspaceId(dbPath);
  const derived = deriveProjectScopeId()?.value;
  return resolveContinuityScopeId({ workspaceId: configured ?? derived });
}

/** Read `identity.launchDefaults.workspaceId` from the config.json beside runtime-state. */
function readConfiguredWorkspaceId(dbPath: string): string | undefined {
  const configPath = join(dirname(dirname(dbPath)), 'config.json');
  try {
    if (!existsSync(configPath)) {
      return undefined;
    }
    const parsed: unknown = JSON.parse(readFileSync(configPath, 'utf8'));
    const workspaceId = (parsed as { identity?: { launchDefaults?: { workspaceId?: unknown } } })
      ?.identity?.launchDefaults?.workspaceId;
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

/** Route one request to its SQL. Mirrors the action set the Python helper dispatched. */
function dispatch(db: DatabaseSync, request: HistoryRequest, tenantId: string): HistoryResponse {
  switch (request.action) {
    case 'load_history': {
      const history = loadRows(db, tenantId, request);
      return { success: true, history: history.versions.length > 0 ? history : null };
    }

    case 'get_version': {
      const row = selectVersion(db, tenantId, request, Number(request.version));
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
      const fromVersion = Number(request.from_version);
      const toVersion = Number(request.to_version);
      const fromRow = selectVersion(db, tenantId, request, fromVersion);
      if (fromRow === undefined) {
        return { success: false, error: `Version ${fromVersion} not found` };
      }
      const toRow = selectVersion(db, tenantId, request, toVersion);
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
      const target = Number(request.target_version);
      const targetRow = selectVersion(db, tenantId, request, target);
      if (targetRow === undefined) {
        return { success: false, error: `Version ${target} not found` };
      }
      const restoredSnapshot = JSON.parse(targetRow.snapshot) as Record<string, unknown>;
      const result = recordEditResultRow(db, tenantId, request, {
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

    case 'delete_history': {
      db.prepare(
        `DELETE FROM version_history
         WHERE tenant_id = ? AND resource_type = ? AND resource_id = ?`
      ).run(tenantId, request.resource_type, request.resource_id);
      return { success: true };
    }

    case 'rename_history': {
      const newResourceId = request.new_resource_id;
      if (newResourceId === undefined || newResourceId === '') {
        return { success: false, error: 'new_resource_id is required' };
      }
      db.prepare(
        `UPDATE version_history SET resource_id = ?
         WHERE tenant_id = ? AND resource_type = ? AND resource_id = ?`
      ).run(newResourceId, tenantId, request.resource_type, request.resource_id);
      return { success: true };
    }
  }
}

function isNonEmptyString(value: string | undefined): value is string {
  return value !== undefined && value !== '';
}

function createRequest(
  resourceDir: string,
  action: HistoryRequest['action'],
  overrides?: Partial<Pick<HistoryRequest, 'resource_type' | 'resource_id'>>
): Partial<HistoryRequest> | null {
  const ref = resolveResourceRef(resourceDir);
  const dbPath = resolveStateDbPath(resourceDir);
  const resourceType = overrides?.resource_type ?? ref?.resourceType;
  const resourceId = overrides?.resource_id ?? ref?.resourceId;
  if (dbPath === null || !isNonEmptyString(resourceType) || !isNonEmptyString(resourceId)) {
    return null;
  }
  return {
    resource_type: resourceType,
    resource_id: resourceId,
    db_path: dbPath,
    action,
  };
}

// ── Read operations ─────────────────────────────────────────────────────────

export function loadHistory(resourceDir: string): HistoryFile | null {
  const request = createRequest(resourceDir, 'load_history');
  if (request === null) {
    return null;
  }
  const result = runSqlite(request as HistoryRequest);
  if (!result.success) {
    return null;
  }
  return result.history ?? null;
}

export function getVersion(resourceDir: string, version: number): VersionEntry | null {
  const request = createRequest(resourceDir, 'get_version');
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
  toVersion: number
): {
  success: boolean;
  from?: VersionEntry;
  to?: VersionEntry;
  error?: string;
} {
  const request = createRequest(resourceDir, 'compare_versions');
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
  const request = createRequest(resourceDir, 'save_version', {
    resource_type: resourceType,
    resource_id: resourceId,
  });
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
  const request = createRequest(resourceDir, 'record_edit_result', {
    resource_type: resourceType,
    resource_id: resourceId,
  });
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
  const request = createRequest(resourceDir, 'rollback', {
    resource_type: resourceType,
    resource_id: resourceId,
  });
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

export function deleteHistoryFile(resourceDir: string): boolean {
  const request = createRequest(resourceDir, 'delete_history');
  if (request === null) {
    return false;
  }
  const result = runSqlite(request as HistoryRequest);
  return result.success;
}

export function renameHistoryResource(resourceDir: string, oldId: string, newId: string): boolean {
  const request = createRequest(resourceDir, 'rename_history', {
    resource_id: oldId,
  });
  if (request === null) {
    return false;
  }
  const result = runSqlite({
    ...(request as HistoryRequest),
    resource_id: oldId,
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
