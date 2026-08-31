// @lifecycle test - Integration test for SQLite state backend
/**
 * SQLite Backend Integration Test
 *
 * Verifies that the SQLite state backend:
 * 1. Initializes correctly
 * 2. Creates state.db file
 * 3. Can perform basic operations
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { jest, describe, it, expect, beforeAll, afterAll } from '@jest/globals';

import { SqliteEngine, SqliteStateStore } from '../../../src/infra/database/index.js';

// Mock logger
const mockLogger = {
  info: jest.fn() as jest.Mock,
  warn: jest.fn() as jest.Mock,
  error: jest.fn() as jest.Mock,
  debug: jest.fn() as jest.Mock,
};

describe('SQLite State Backend', () => {
  const testDir = path.join(process.cwd(), 'tests/tmp/sqlite-test');
  let dbManager: SqliteEngine;

  beforeAll(async () => {
    // Clean up and create test directory
    await fs.rm(testDir, { recursive: true, force: true });
    await fs.mkdir(testDir, { recursive: true });
  });

  afterAll(async () => {
    if (dbManager) {
      await dbManager.shutdown();
    }
    await fs.rm(testDir, { recursive: true, force: true });
  });

  describe('SqliteEngine', () => {
    it('should initialize and create state.db', async () => {
      dbManager = await SqliteEngine.getInstance(testDir, mockLogger as any);
      await dbManager.initialize();

      // Verify state.db was created (node:sqlite writes directly to disk)
      const dbPath = path.join(testDir, 'runtime-state', 'state.db');
      const stat = await fs.stat(dbPath);
      expect(stat.isFile()).toBe(true);
    });

    it('should have correct schema version', async () => {
      const version = dbManager.getSchemaVersion();
      expect(version).toBe(27);
    });

    // These exercise run/queryOne/transaction, not any particular table. They used `tenants`,
    // which Tier 6.3 deleted; `resource_index` is a live table with a real writer.
    it('should execute queries', async () => {
      dbManager.run(
        `INSERT OR IGNORE INTO resource_index (id, type, name, file_path, content_hash, indexed_at)
         VALUES (?, 'prompt', ?, ?, ?, ?)`,
        ['query-probe', 'Query Probe', '/tmp/query-probe.md', 'hash-q', 1]
      );

      const result = dbManager.queryOne<{ id: string; name: string }>(
        `SELECT id, name FROM resource_index WHERE id = ?`,
        ['query-probe']
      );

      expect(result).toEqual({ id: 'query-probe', name: 'Query Probe' });
    });

    it('should support transactions', async () => {
      await dbManager.transaction(async () => {
        dbManager.run(
          `INSERT OR IGNORE INTO resource_index (id, type, name, file_path, content_hash, indexed_at)
           VALUES (?, 'prompt', ?, ?, ?, ?)`,
          ['tx-probe', 'Transaction Probe', '/tmp/tx-probe.md', 'hash-tx', 1]
        );
      });

      const result = dbManager.queryOne<{ id: string }>(
        `SELECT id FROM resource_index WHERE id = ?`,
        ['tx-probe']
      );
      expect(result?.id).toBe('tx-probe');
    });
  });

  describe('SqliteStateStore', () => {
    interface TestState {
      version: number;
      data: string;
    }

    it('should save and load state', async () => {
      const store = new SqliteStateStore<TestState>(
        dbManager,
        {
          tableName: 'kv_state',
          key: 'framework',
          defaultState: () => ({ version: 1, data: 'default' }),
        },
        mockLogger as any
      );

      await store.ensureInitialized();

      // No row exists initially (schema creates table, not default row)
      const existsBefore = await store.exists();
      expect(existsBefore).toBe(false);

      // Load returns default state when no row exists
      const defaultState = await store.load();
      expect(defaultState).toEqual({ version: 1, data: 'default' });

      // Save state
      await store.save({ version: 2, data: 'updated' });

      // Verify exists after save
      const existsAfter = await store.exists();
      expect(existsAfter).toBe(true);

      // Load returns saved state
      const loaded = await store.load();
      expect(loaded).toEqual({ version: 2, data: 'updated' });
    });

    it('should dual-read legacy tenant rows when workspace identity is requested', async () => {
      const store = new SqliteStateStore<TestState>(
        dbManager,
        {
          tableName: 'kv_state',
          key: 'framework',
          defaultState: () => ({ version: 1, data: 'default' }),
        },
        mockLogger as any
      );

      dbManager.run(`DELETE FROM kv_state WHERE key = 'framework'`);
      dbManager.run(
        `INSERT INTO kv_state (tenant_id, key, state, updated_at)
         VALUES (?, ?, ?, datetime('now'))`,
        ['legacy-workspace', 'framework', JSON.stringify({ version: 9, data: 'legacy-only' })]
      );

      const loaded = await store.load({ workspaceId: 'legacy-workspace' });
      expect(loaded).toEqual({ version: 9, data: 'legacy-only' });
    });

    it('should write canonical identity columns during save', async () => {
      const store = new SqliteStateStore<TestState>(
        dbManager,
        {
          tableName: 'kv_state',
          key: 'framework',
          defaultState: () => ({ version: 1, data: 'default' }),
        },
        mockLogger as any
      );

      dbManager.run(`DELETE FROM kv_state WHERE key = 'framework'`);
      await store.save(
        { version: 5, data: 'canonical' },
        {
          workspaceId: 'workspace-canonical',
          organizationId: 'org-canonical',
        }
      );

      const row = dbManager.queryOne<{
        tenant_id: string;
        organization_id: string | null;
        workspace_id: string | null;
      }>(
        `SELECT tenant_id, organization_id, workspace_id FROM kv_state WHERE workspace_id = ? AND key = 'framework'`,
        ['workspace-canonical']
      );

      expect(row).toEqual({
        tenant_id: 'workspace-canonical',
        organization_id: 'org-canonical',
        workspace_id: 'workspace-canonical',
      });
    });
  });
});

describe('Schema version bump', () => {
  const testDir = path.join(process.cwd(), 'tests/tmp/sqlite-schema-bump');
  const dbPath = path.join(testDir, 'runtime-state', 'state.db');
  let engine: SqliteEngine;

  beforeAll(async () => {
    await fs.rm(testDir, { recursive: true, force: true });
    await fs.mkdir(testDir, { recursive: true });

    engine = await SqliteEngine.getInstance(testDir, mockLogger as any);
    await engine.initialize();

    // A durable row: a resource snapshot backing rollback. Exists nowhere else.
    engine.run(
      `INSERT INTO version_history
         (tenant_id, resource_type, resource_id, version, snapshot, diff_summary, description, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        'default',
        'prompt',
        'survives-bump',
        1,
        JSON.stringify({ content: 'original' }),
        'initial',
        'pre-bump snapshot',
        new Date().toISOString(),
      ]
    );

    // A durable row: the record of files exported to a client's filesystem.
    engine.run(
      `INSERT INTO skills_sync_manifests
         (client, scope, resource_key, resource_id, resource_type, source_hash, output_hash,
          output_files, exported_at, config_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        'claude',
        'project',
        'prompt:survives-bump',
        'survives-bump',
        'prompt',
        'src-hash',
        'out-hash',
        JSON.stringify(['skills/survives-bump/SKILL.md']),
        new Date().toISOString(),
        'cfg-hash',
      ]
    );

    // A derived row: rebuilt from YAML on startup, so it is expected NOT to survive.
    engine.run(`INSERT INTO resource_index (id, type, name) VALUES (?, ?, ?)`, [
      'discarded-on-bump',
      'prompt',
      'Discarded',
    ]);

    // Simulate a DB written by an older server build, then reopen so ensureSchema
    // takes the version-mismatch branch on the next initialize().
    engine.run(`DELETE FROM schema_version`);
    engine.run(`INSERT INTO schema_version (version) VALUES (?)`, [1]);
    await engine.shutdown();

    engine = await SqliteEngine.getInstance(testDir, mockLogger as any);
    await engine.initialize();
  });

  afterAll(async () => {
    if (engine) {
      await engine.shutdown();
    }
    await fs.rm(testDir, { recursive: true, force: true });
  });

  it('recreates the schema at the current version', () => {
    expect(engine.getSchemaVersion()).toBe(27);
  });

  it('preserves version_history rows across the recreate', () => {
    // Flipped back at v19, exactly as the v18 version of this test said it would be.
    // `DROPPED_ON_THIS_BUMP` held version_history for one bump — pre-Tier-4 rows carried the
    // literal `tenant_id = 'default'`, could not be attributed to a workspace, and were
    // unreachable to a scoped read. That exclusion was retired here, so the table is durable
    // again and its rows are carried by snapshot/restore.
    const row = engine.queryOne<{ resource_id: string }>(
      `SELECT resource_id FROM version_history WHERE resource_id = ?`,
      ['survives-bump']
    );

    expect(row?.resource_id).toBe('survives-bump');
  });

  it('carries no stale one-time exclusion into this bump', () => {
    // The gate that forces the retirement lives in validate:table-contracts and in
    // snapshotDurableTables(); this asserts the observable consequence rather than the constant.
    // A non-empty DROPPED_ON_THIS_BUMP declared for an older SCHEMA_VERSION throws on init, so
    // reaching this line at all means the two are consistent.
    expect(engine.isInitialized()).toBe(true);
  });

  it('preserves skills_sync_manifests rows across the recreate', () => {
    const row = engine.queryOne<{ resource_key: string; output_files: string }>(
      `SELECT resource_key, output_files FROM skills_sync_manifests WHERE client = ? AND scope = ?`,
      ['claude', 'project']
    );

    expect(row?.resource_key).toBe('prompt:survives-bump');
    expect(JSON.parse(row?.output_files ?? '[]')).toEqual(['skills/survives-bump/SKILL.md']);
  });

  it('discards derived tables so they rebuild from YAML', () => {
    const row = engine.queryOne<{ id: string }>(`SELECT id FROM resource_index WHERE id = ?`, [
      'discarded-on-bump',
    ]);

    expect(row).toBeNull();
  });

  it('leaves AUTOINCREMENT able to allocate past the restored ids', () => {
    // The restore carries explicit ids, so sqlite_sequence must be re-seeded from them
    // or the next insert collides on the primary key. Asserted against a table that IS
    // carried — version_history is excluded on this bump, so it would prove nothing here.
    engine.run(
      `INSERT INTO skills_sync_manifests
         (client, scope, resource_key, resource_id, resource_type, source_hash, output_hash,
          output_files, exported_at, config_hash)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        'claude',
        'project',
        'prompt:second-entry',
        'second-entry',
        'prompt',
        'h1',
        'h2',
        JSON.stringify(['skills/second-entry/SKILL.md']),
        new Date().toISOString(),
        'cfg-hash',
      ]
    );

    const count = engine.queryOne<{ n: number }>(
      `SELECT COUNT(*) as n FROM skills_sync_manifests WHERE client = ?`,
      ['claude']
    );
    expect(count?.n).toBe(2);
  });

  it('writes the db file to the expected path', async () => {
    const stat = await fs.stat(dbPath);
    expect(stat.isFile()).toBe(true);
  });

  /**
   * Tier 3.3 — v_execution_history reads execution_records directly.
   *
   * v_execution_status selects FROM chain_sessions, which is deleted per-PID at cleanup,
   * so it reports 0 rows for a run that finished. These assert the new view does not
   * inherit that blindness.
   */
  describe('v_execution_history', () => {
    const seed = (sessionId: string, status: string, startedAt: number, step: number | null) => {
      engine.run(
        `INSERT INTO execution_records
           (execution_id, tenant_id, session_id, chain_id, step_number, status, gate_verdicts_json, started_at, completed_at)
         VALUES (?, 'default', ?, 'chain-hist', ?, ?, '[]', ?, ?)`,
        [
          `${sessionId}-${String(startedAt).padStart(6, '0')}`,
          sessionId,
          step,
          status,
          startedAt,
          status === 'working' ? null : startedAt + 5,
        ]
      );
    };

    it('exists after the schema recreate', () => {
      const view = engine.queryOne<{ name: string }>(
        `SELECT name FROM sqlite_master WHERE type = 'view' AND name = 'v_execution_history'`
      );
      expect(view?.name).toBe('v_execution_history');
    });

    it('reports a completed run that v_execution_status cannot see', () => {
      seed('sess-done', 'working', 100, 1);
      seed('sess-done', 'completed', 200, null);

      // chain_sessions is empty here, exactly as it is after PID cleanup in production.
      const oldView = engine.queryOne<{ n: number }>(`SELECT COUNT(*) n FROM v_execution_status`);
      expect(oldView?.n).toBe(0);

      const row = engine.queryOne<{ current_status: string; record_count: number }>(
        `SELECT current_status, record_count FROM v_execution_history WHERE session_id = ?`,
        ['sess-done']
      );
      expect(row?.current_status).toBe('completed');
      expect(row?.record_count).toBe(2);
    });

    it('collapses a session to its newest record by ULID order, not by timestamp', () => {
      // Both rows share started_at; only execution_id disambiguates them.
      engine.run(
        `INSERT INTO execution_records
           (execution_id, tenant_id, session_id, step_number, status, gate_verdicts_json, started_at)
         VALUES ('tie-000001', 'default', 'sess-tie', 1, 'working', '[]', 500)`
      );
      engine.run(
        `INSERT INTO execution_records
           (execution_id, tenant_id, session_id, step_number, status, gate_verdicts_json, started_at, completed_at)
         VALUES ('tie-000002', 'default', 'sess-tie', 2, 'failed', '[]', 500, 505)`
      );

      const row = engine.queryOne<{ current_status: string; current_step: number }>(
        `SELECT current_status, current_step FROM v_execution_history WHERE session_id = ?`,
        ['sess-tie']
      );
      expect(row?.current_status).toBe('failed');
      expect(row?.current_step).toBe(2);
    });

    it('covers every record — the per-session counts sum to the table count', () => {
      const total = engine.queryOne<{ n: number }>(`SELECT COUNT(*) n FROM execution_records`);
      const covered = engine.queryOne<{ n: number }>(
        `SELECT SUM(record_count) n FROM v_execution_history`
      );
      expect(covered?.n).toBe(total?.n);
    });

    describe('identity scope migration removal (Tier 4.5)', () => {
      /**
       * `applyIdentityScopeMigration` did three jobs and was deleted once all three became dead:
       * ALTER TABLE ADD COLUMN (applySchema declares both columns), a NULL backfill (every writer
       * now emits scope), and CREATE INDEX (duplicated in applySchema).
       *
       * The backfill's death is proven by the per-writer tests in Tiers 4.1/4.3/4.6 and the
       * version_history scoping tests. What no other test observes is the *indexes* — they existed
       * in two places, and deleting one copy is only safe because the other covers it. These read
       * sqlite_master directly, so they fail if applySchema's copy is ever removed or renamed.
       */
      const SCOPE_INDEXES = [
        'idx_chain_sessions_workspace',
        'idx_chain_sessions_organization',
        'idx_kv_state_workspace',
        'idx_kv_state_organization',
        'idx_version_history_workspace',
        'idx_version_history_organization',
        'idx_resource_changes_workspace',
        'idx_resource_changes_organization',
      ];

      it('creates every scope index from applySchema alone, with no migration running', () => {
        const present = engine
          .query<{ name: string }>(`SELECT name FROM sqlite_master WHERE type = 'index'`)
          .map((row) => row.name);

        for (const indexName of SCOPE_INDEXES) {
          expect(present).toContain(indexName);
        }
      });

      it('declares both scope columns on every table the migration used to ALTER', () => {
        // The ALTER was the compatibility path for databases predating these columns. It is dead
        // only because applySchema declares them and any older database is recreated through it.
        for (const table of [
          'chain_sessions',
          'kv_state',
          'chain_runs',
          'version_history',
          'resource_changes',
        ]) {
          const columns = engine
            .query<{ name: string }>(`PRAGMA table_info(${table})`)
            .map((row) => row.name);

          expect(columns).toContain('organization_id');
          expect(columns).toContain('workspace_id');
        }
      });
    });
  });
});
