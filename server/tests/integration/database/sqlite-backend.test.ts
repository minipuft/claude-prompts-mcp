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
      expect(version).toBe(16);
    });

    it('should execute queries', async () => {
      // Insert a test tenant
      dbManager.run(`INSERT OR IGNORE INTO tenants (id, name) VALUES (?, ?)`, [
        'test-tenant',
        'Test Tenant',
      ]);

      const result = dbManager.queryOne<{ id: string; name: string }>(
        `SELECT id, name FROM tenants WHERE id = ?`,
        ['test-tenant']
      );

      expect(result).toEqual({ id: 'test-tenant', name: 'Test Tenant' });
    });

    it('should support transactions', async () => {
      await dbManager.transaction(async () => {
        dbManager.run(`INSERT OR IGNORE INTO tenants (id, name) VALUES (?, ?)`, [
          'tx-tenant',
          'Transaction Tenant',
        ]);
      });

      const result = dbManager.queryOne<{ id: string }>(`SELECT id FROM tenants WHERE id = ?`, [
        'tx-tenant',
      ]);
      expect(result?.id).toBe('tx-tenant');
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
