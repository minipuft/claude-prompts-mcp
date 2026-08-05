// @lifecycle test - Tier 6.1: the CLI must never own state.db's DDL
/**
 * CLI Schema Ownership Regression Test
 *
 * `cli-shared/version-history.ts` used to carry its own `ensure_schema()`, embedded in a
 * Python helper it ran via `spawnSync`. That DDL predated the identity-scope columns, so
 * a CLI invocation on a machine where the server had never run created `version_history`
 * WITHOUT `organization_id`/`workspace_id`, and wrote no `schema_version` row.
 *
 * The engine then read version 0, took the "fresh database" path, and `CREATE TABLE IF
 * NOT EXISTS` silently no-opped against the already-present table — so the scope columns
 * stayed absent and `applySchema()` threw `no such column: workspace_id` while building
 * the scope index. Measured 2026-08-05: the MCP server could not boot at all.
 *
 * There are TWO independent guards, and an earlier version of this file only exercised
 * the first — the `existsSync(db_path)` short-circuit fired before the schema check, so
 * mutating the schema check changed nothing and the test proved nothing about it. They
 * are now separated:
 *   1. no `state.db` at all      → the CLI creates no file    (existsSync guard)
 *   2. `state.db` without the table → the CLI creates no table (versionHistoryExists guard)
 *      and the engine still boots with its scope columns — this is the actual regression
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import { jest, describe, it, expect, beforeEach, afterEach } from '@jest/globals';

import { loadHistory, saveVersion } from '../../../src/cli-shared/version-history.js';
import { SqliteEngine } from '../../../src/infra/database/index.js';

const mockLogger = {
  info: jest.fn() as jest.Mock,
  warn: jest.fn() as jest.Mock,
  error: jest.fn() as jest.Mock,
  debug: jest.fn() as jest.Mock,
};

const testDir = path.join(process.cwd(), 'tests/tmp/cli-schema-ownership');
const promptDir = path.join(testDir, 'resources', 'prompts', 'general', 'demo');

describe('CLI never owns state.db schema', () => {
  beforeEach(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
    await fs.mkdir(path.join(testDir, 'runtime-state'), { recursive: true });
    await fs.mkdir(promptDir, { recursive: true });
  });

  afterEach(async () => {
    await SqliteEngine.shutdownInstance();
    await fs.rm(testDir, { recursive: true, force: true });
  });

  const dbPath = (): string => path.join(testDir, 'runtime-state', 'state.db');

  function tableNames(): string[] {
    const db = new DatabaseSync(dbPath());
    const names = (
      db.prepare(`SELECT name FROM sqlite_master WHERE type='table'`).all() as Array<{
        name: string;
      }>
    ).map((row) => row.name);
    db.close();
    return names;
  }

  it('guard 1: does not even create state.db when the server has never run', async () => {
    // Both a write and a read, because only the write path called ensure_schema.
    expect(saveVersion(promptDir, 'prompt', 'demo', { id: 'demo' }).success).toBe(false);
    expect(loadHistory(promptDir)).toBeNull();

    await expect(fs.stat(dbPath())).rejects.toThrow();
  });

  it('guard 2: does not create version_history in an existing state.db', async () => {
    // An existing but table-less database. The `existsSync` short-circuit passes here, so
    // this is the case that actually exercises the schema-ownership check.
    new DatabaseSync(dbPath()).close();

    expect(saveVersion(promptDir, 'prompt', 'demo', { id: 'demo' }).success).toBe(false);
    expect(tableNames()).not.toContain('version_history');

    // The regression: with a CLI-authored version_history present, this threw
    // `no such column: workspace_id` from applySchema and the server could not start.
    const engine = await SqliteEngine.getInstance(testDir, mockLogger as any);
    await expect(engine.initialize()).resolves.toBeUndefined();

    const columns = engine
      .query<{ name: string }>('PRAGMA table_info(version_history)')
      .map((row) => row.name);
    expect(columns).toContain('workspace_id');
    expect(columns).toContain('organization_id');
  });

  it('round-trips history once the engine has created the schema', async () => {
    const engine = await SqliteEngine.getInstance(testDir, mockLogger as any);
    await engine.initialize();
    await engine.shutdown();

    const saved = saveVersion(promptDir, 'prompt', 'demo', { id: 'demo' }, { description: 'v1' });
    expect(saved.success).toBe(true);
    expect(loadHistory(promptDir)?.versions[0]?.description).toBe('v1');
  });
});
