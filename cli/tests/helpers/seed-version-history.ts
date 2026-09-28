/**
 * Version-history seeding shared by the CLI integration suites.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * The workspace id the CLI resolves for these fixtures. Pinned via
 * `identity.launchDefaults.workspaceId` in the workspace's config.json — the first source
 * `resolveTenantId()` consults — so the tenant is deterministic instead of derived from
 * whatever CLAUDE_PROJECT_DIR/cwd the test process happens to run under.
 */
const FIXTURE_SCOPE = 'cli-fixture-scope';

/**
 * Seed a workspace's runtime-state/state.db with version history entries.
 * Uses python3 sqlite3 — same backend as cli-shared/version-history.ts.
 *
 * The DDL mirrors `SqliteEngine.applySchema()` (the sole schema owner — the CLI itself
 * no longer creates tables and refuses to run against a database without them). Rows are
 * written under FIXTURE_SCOPE because the CLI both filters reads by tenant_id and writes
 * rollback rows with `workspace_id = tenant_id`; the old seeder's scope-column-less
 * shape made every read return empty and every rollback INSERT throw.
 */
export function seedVersionHistory(
  workspace: string,
  resourceType: string,
  resourceId: string,
  versions: Array<{ version: number; snapshot: Record<string, unknown>; description: string; diff_summary?: string }>,
): void {
  const runtimeDir = join(workspace, 'runtime-state');
  if (!existsSync(runtimeDir)) mkdirSync(runtimeDir, { recursive: true });
  const dbPath = join(runtimeDir, 'state.db');
  writeFileSync(
    join(workspace, 'config.json'),
    JSON.stringify({ identity: { launchDefaults: { workspaceId: FIXTURE_SCOPE } } }),
  );

  const script = `
import json, sqlite3, sys
db = sqlite3.connect(sys.argv[1])
db.execute("""
  CREATE TABLE IF NOT EXISTS version_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    tenant_id TEXT NOT NULL DEFAULT 'default',
    organization_id TEXT,
    workspace_id TEXT,
    resource_type TEXT NOT NULL,
    resource_id TEXT NOT NULL,
    version INTEGER NOT NULL,
    snapshot TEXT NOT NULL,
    diff_summary TEXT DEFAULT '',
    description TEXT DEFAULT '',
    created_at TEXT NOT NULL
  )
""")
for v in json.loads(sys.argv[2]):
    db.execute(
        "INSERT INTO version_history (tenant_id, organization_id, workspace_id, resource_type, resource_id, version, snapshot, diff_summary, description, created_at) VALUES (?,?,?,?,?,?,?,?,?,?)",
        (sys.argv[5], None, sys.argv[5], sys.argv[3], sys.argv[4], v['version'], json.dumps(v['snapshot']), v.get('diff_summary',''), v['description'], '2025-06-13T08:00:00.000Z')
    )
db.commit()
db.close()
`;

  const result = spawnSync('python3', [
    '-c', script,
    dbPath,
    JSON.stringify(versions),
    resourceType,
    resourceId,
    FIXTURE_SCOPE,
  ], { encoding: 'utf-8', timeout: 5000 });

  if (result.status !== 0) {
    throw new Error(`Failed to seed version history: ${result.stderr}`);
  }
}
