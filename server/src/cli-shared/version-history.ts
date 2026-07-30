/**
 * Standalone version-history functions for CLI consumption.
 *
 * SQLite-backed implementation (runtime-state/state.db), replacing legacy sidecar history files.
 * Uses a small embedded Python sqlite3 helper so APIs remain synchronous.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';

import type {
  VersionEntry,
  HistoryFile,
  SaveVersionResult,
  RollbackResult,
  SaveVersionOptions,
} from '../modules/versioning/types.js';

const DEFAULT_MAX_VERSIONS = 50;

type ResourceType = 'prompt' | 'gate' | 'methodology' | 'style';

interface ResourceRef {
  resourceType: ResourceType;
  resourceId: string;
}

interface PythonRequest {
  action:
    | 'load_history'
    | 'get_version'
    | 'save_version'
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
  description?: string;
  diff_summary?: string;
  target_version?: number;
  current_snapshot?: Record<string, unknown>;
  new_resource_id?: string;
}

interface PythonResponse {
  success: boolean;
  error?: string;
  history?: HistoryFile | null;
  entry?: VersionEntry | null;
  from?: VersionEntry;
  to?: VersionEntry;
  version?: number;
  saved_version?: number;
  restored_version?: number;
  snapshot?: Record<string, unknown>;
}

const PYTHON_DB_HELPER = `
import json
import sqlite3
import sys

def respond(payload):
    print(json.dumps(payload))
    sys.exit(0)

def load_rows(conn, resource_type, resource_id):
    cursor = conn.execute(
        """
        SELECT version, snapshot, diff_summary, description, created_at
        FROM version_history
        WHERE tenant_id = 'default' AND resource_type = ? AND resource_id = ?
        ORDER BY version DESC
        """,
        (resource_type, resource_id),
    )
    rows = cursor.fetchall()
    versions = []
    for row in rows:
        versions.append(
            {
                "version": int(row[0]),
                "date": row[4],
                "snapshot": json.loads(row[1]),
                "diff_summary": row[2] or "",
                "description": row[3] or "",
            }
        )
    current_version = versions[0]["version"] if len(versions) > 0 else 0
    return {
        "resource_type": resource_type,
        "resource_id": resource_id,
        "current_version": current_version,
        "versions": versions,
    }

def ensure_schema(conn):
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS version_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            tenant_id TEXT NOT NULL DEFAULT 'default',
            resource_type TEXT NOT NULL,
            resource_id TEXT NOT NULL,
            version INTEGER NOT NULL,
            snapshot TEXT NOT NULL,
            diff_summary TEXT DEFAULT '',
            description TEXT DEFAULT '',
            created_at TEXT NOT NULL
        )
        """
    )
    conn.commit()

def latest_version(conn, resource_type, resource_id):
    row = conn.execute(
        """
        SELECT MAX(version)
        FROM version_history
        WHERE tenant_id = 'default' AND resource_type = ? AND resource_id = ?
        """,
        (resource_type, resource_id),
    ).fetchone()
    return int(row[0] or 0)

def prune(conn, resource_type, resource_id, max_versions):
    conn.execute(
        """
        DELETE FROM version_history
        WHERE tenant_id = 'default' AND resource_type = ? AND resource_id = ?
          AND id NOT IN (
            SELECT id
            FROM version_history
            WHERE tenant_id = 'default' AND resource_type = ? AND resource_id = ?
            ORDER BY version DESC
            LIMIT ?
          )
        """,
        (resource_type, resource_id, resource_type, resource_id, max_versions),
    )

try:
    payload = json.loads(sys.argv[1])
    conn = sqlite3.connect(payload["db_path"])
    conn.execute("PRAGMA busy_timeout = 5000")
    conn.row_factory = sqlite3.Row
    ensure_schema(conn)

    action = payload["action"]
    resource_type = payload["resource_type"]
    resource_id = payload["resource_id"]

    if action == "load_history":
        history = load_rows(conn, resource_type, resource_id)
        if len(history["versions"]) == 0:
            respond({"success": True, "history": None})
        respond({"success": True, "history": history})

    if action == "get_version":
        version = int(payload["version"])
        row = conn.execute(
            """
            SELECT version, snapshot, diff_summary, description, created_at
            FROM version_history
            WHERE tenant_id = 'default' AND resource_type = ? AND resource_id = ? AND version = ?
            """,
            (resource_type, resource_id, version),
        ).fetchone()
        if row is None:
            respond({"success": True, "entry": None})
        entry = {
            "version": int(row["version"]),
            "date": row["created_at"],
            "snapshot": json.loads(row["snapshot"]),
            "diff_summary": row["diff_summary"] or "",
            "description": row["description"] or "",
        }
        respond({"success": True, "entry": entry})

    if action == "save_version":
        current = latest_version(conn, resource_type, resource_id)
        new_version = current + 1
        conn.execute(
            """
            INSERT INTO version_history (
                tenant_id, resource_type, resource_id, version, snapshot, diff_summary, description, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                "default",
                resource_type,
                resource_id,
                new_version,
                json.dumps(payload["snapshot"]),
                payload.get("diff_summary") or "",
                payload.get("description") or f"Version {new_version}",
                payload.get("created_at"),
            ),
        )
        prune(conn, resource_type, resource_id, int(payload.get("max_versions") or 50))
        conn.commit()
        respond({"success": True, "version": new_version})

    if action == "compare_versions":
        from_version = int(payload["from_version"])
        to_version = int(payload["to_version"])
        from_row = conn.execute(
            """
            SELECT version, snapshot, diff_summary, description, created_at
            FROM version_history
            WHERE tenant_id = 'default' AND resource_type = ? AND resource_id = ? AND version = ?
            """,
            (resource_type, resource_id, from_version),
        ).fetchone()
        to_row = conn.execute(
            """
            SELECT version, snapshot, diff_summary, description, created_at
            FROM version_history
            WHERE tenant_id = 'default' AND resource_type = ? AND resource_id = ? AND version = ?
            """,
            (resource_type, resource_id, to_version),
        ).fetchone()
        if from_row is None:
            respond({"success": False, "error": f"Version {from_version} not found"})
        if to_row is None:
            respond({"success": False, "error": f"Version {to_version} not found"})
        respond(
            {
                "success": True,
                "from": {
                    "version": int(from_row["version"]),
                    "date": from_row["created_at"],
                    "snapshot": json.loads(from_row["snapshot"]),
                    "diff_summary": from_row["diff_summary"] or "",
                    "description": from_row["description"] or "",
                },
                "to": {
                    "version": int(to_row["version"]),
                    "date": to_row["created_at"],
                    "snapshot": json.loads(to_row["snapshot"]),
                    "diff_summary": to_row["diff_summary"] or "",
                    "description": to_row["description"] or "",
                },
            }
        )

    if action == "rollback":
        target = int(payload["target_version"])
        target_row = conn.execute(
            """
            SELECT version, snapshot
            FROM version_history
            WHERE tenant_id = 'default' AND resource_type = ? AND resource_id = ? AND version = ?
            """,
            (resource_type, resource_id, target),
        ).fetchone()
        if target_row is None:
            respond({"success": False, "error": f"Version {target} not found"})

        current = latest_version(conn, resource_type, resource_id)
        saved = current + 1
        conn.execute(
            """
            INSERT INTO version_history (
                tenant_id, resource_type, resource_id, version, snapshot, diff_summary, description, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            """,
            (
                "default",
                resource_type,
                resource_id,
                saved,
                json.dumps(payload["current_snapshot"]),
                "",
                f"Pre-rollback snapshot (before reverting to v{target})",
                payload.get("created_at"),
            ),
        )
        prune(conn, resource_type, resource_id, int(payload.get("max_versions") or 50))
        conn.commit()
        respond(
            {
                "success": True,
                "saved_version": saved,
                "restored_version": target,
                "snapshot": json.loads(target_row["snapshot"]),
            }
        )

    if action == "delete_history":
        conn.execute(
            """
            DELETE FROM version_history
            WHERE tenant_id = 'default' AND resource_type = ? AND resource_id = ?
            """,
            (resource_type, resource_id),
        )
        conn.commit()
        respond({"success": True})

    if action == "rename_history":
        new_resource_id = payload.get("new_resource_id")
        if not new_resource_id:
            respond({"success": False, "error": "new_resource_id is required"})
        conn.execute(
            """
            UPDATE version_history
            SET resource_id = ?
            WHERE tenant_id = 'default' AND resource_type = ? AND resource_id = ?
            """,
            (new_resource_id, resource_type, resource_id),
        )
        conn.commit()
        respond({"success": True})

    respond({"success": False, "error": f"Unsupported action: {action}"})
except Exception as error:
    respond({"success": False, "error": str(error)})
`;

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
    return { resourceType: 'methodology', resourceId: id };
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

function runPython(request: PythonRequest): PythonResponse {
  const pythonCandidates = ['python3', 'python'];
  let lastError = 'No python runtime found';

  for (const python of pythonCandidates) {
    try {
      const proc = spawnSync(python, ['-c', PYTHON_DB_HELPER, JSON.stringify(request)], {
        encoding: 'utf8',
      });
      if (proc.error instanceof Error) {
        lastError = proc.error.message;
        continue;
      }
      if (proc.status !== 0) {
        const stderr = proc.stderr.trim();
        lastError = stderr !== '' ? stderr : `python exited with status ${proc.status}`;
        continue;
      }
      const stdout = proc.stdout.trim();
      if (stdout === '') {
        lastError = 'python helper returned empty response';
        continue;
      }
      return JSON.parse(stdout) as PythonResponse;
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
    }
  }

  return { success: false, error: lastError };
}

function isNonEmptyString(value: string | undefined): value is string {
  return value !== undefined && value !== '';
}

function createRequest(
  resourceDir: string,
  action: PythonRequest['action'],
  overrides?: Partial<Pick<PythonRequest, 'resource_type' | 'resource_id'>>
): Partial<PythonRequest> | null {
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
  const result = runPython(request as PythonRequest);
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
  const result = runPython({ ...(request as PythonRequest), version });
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
  const result = runPython({
    ...(request as PythonRequest),
    from_version: fromVersion,
    to_version: toVersion,
  });
  if (!result.success) {
    return { success: false, error: result.error ?? 'Comparison failed' };
  }
  return { success: true, from: result.from, to: result.to };
}

// ── Write operations ────────────────────────────────────────────────────────

// eslint-disable-next-line max-params
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

  const result = runPython({
    ...(request as PythonRequest),
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

// eslint-disable-next-line max-params
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

  const result = runPython({
    ...(request as PythonRequest),
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
  const result = runPython(request as PythonRequest);
  return result.success;
}

export function renameHistoryResource(resourceDir: string, oldId: string, newId: string): boolean {
  const request = createRequest(resourceDir, 'rename_history', {
    resource_id: oldId,
  });
  if (request === null) {
    return false;
  }
  const result = runPython({
    ...(request as PythonRequest),
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
