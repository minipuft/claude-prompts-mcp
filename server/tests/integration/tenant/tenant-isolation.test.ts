import { afterAll, beforeAll, beforeEach, describe, expect, test, jest } from '@jest/globals';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

import { SqliteEngine } from '../../../src/infra/database/index.js';
import { SqliteStateStore } from '../../../src/infra/database/stores/sqlite-store.js';
import { ExecutionContext } from '../../../src/engine/execution/context/execution-context.js';
import { ChainSessionStore } from '../../../src/modules/chains/manager.js';

import type { Logger } from '../../../src/infra/logging/index.js';

const createLogger = (): Logger =>
  ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }) as unknown as Logger;

describe('Tenant Isolation', () => {
  let tmpDir: string;
  let dbManager: SqliteEngine;
  let logger: Logger;

  beforeAll(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'tenant-isolation-'));
    logger = createLogger();
    dbManager = await SqliteEngine.getInstance(tmpDir, logger);
    await dbManager.initialize();
  });

  afterAll(async () => {
    await dbManager.shutdown();
    try {
      await fs.rm(tmpDir, { recursive: true, force: true });
    } catch {
      // Cleanup error - ignore
    }
  });

  describe('ExecutionContext continuity scope support', () => {
    test('defaults to "default" tenant', () => {
      const ctx = new ExecutionContext({ command: 'test' }, logger);

      expect(ctx.getContinuityScopeId()).toBe('default');
      expect(ctx.state.scope.source).toBe('default');
    });

    test('allows setting continuity scope ID', () => {
      const ctx = new ExecutionContext({ command: 'test' }, logger);

      ctx.setContinuityScopeId('tenant-123', 'header');

      expect(ctx.getContinuityScopeId()).toBe('tenant-123');
      expect(ctx.state.scope.source).toBe('header');
    });

    test('tenant state is initialized in pipeline state', () => {
      const ctx = new ExecutionContext({ command: 'test' }, logger);

      expect(ctx.state.scope).toBeDefined();
      expect(ctx.state.scope.continuityScopeId).toBe('default');
    });
  });

  describe('SqliteStateStore tenant isolation', () => {
    interface TestState {
      value: string;
      counter: number;
    }

    let store: SqliteStateStore<TestState>;

    beforeEach(() => {
      // Create test table if it doesn't exist
      try {
        dbManager.run(`
          CREATE TABLE IF NOT EXISTS test_tenant_state (
            tenant_id TEXT PRIMARY KEY DEFAULT 'default',
            value TEXT NOT NULL,
            updated_at TEXT
          )
        `);
      } catch {
        // Table may already exist
      }

      store = new SqliteStateStore<TestState>(
        dbManager,
        {
          tableName: 'test_tenant_state',
          stateColumn: 'value',
          defaultState: () => ({ value: 'initial', counter: 0 }),
        },
        logger
      );

      // Clean up test table
      try {
        dbManager.run('DELETE FROM test_tenant_state');
      } catch {
        // Table may not exist yet
      }
    });

    test('different scopes have isolated state', async () => {
      // Save state for tenant A
      await store.save({ value: 'tenant-a-value', counter: 10 }, { continuityScopeId: 'tenant-a' });

      // Save state for tenant B
      await store.save({ value: 'tenant-b-value', counter: 20 }, { continuityScopeId: 'tenant-b' });

      // Load and verify isolation
      const stateA = await store.load({ continuityScopeId: 'tenant-a' });
      const stateB = await store.load({ continuityScopeId: 'tenant-b' });

      expect(stateA.value).toBe('tenant-a-value');
      expect(stateA.counter).toBe(10);

      expect(stateB.value).toBe('tenant-b-value');
      expect(stateB.counter).toBe(20);
    });

    test('default scope is used when no continuityScopeId specified', async () => {
      await store.save({ value: 'default-value', counter: 5 });

      // Load without continuityScopeId (should use 'default')
      const state = await store.load();

      expect(state.value).toBe('default-value');
      expect(state.counter).toBe(5);
    });

    test('tenant deletion only affects that tenant', async () => {
      // Set up state for multiple scopes
      await store.save({ value: 'a', counter: 1 }, { continuityScopeId: 'tenant-a' });
      await store.save({ value: 'b', counter: 2 }, { continuityScopeId: 'tenant-b' });

      // Delete tenant A's state
      await store.delete({ continuityScopeId: 'tenant-a' });

      // Verify tenant A's state is gone (returns default)
      const stateA = await store.load({ continuityScopeId: 'tenant-a' });
      expect(stateA.value).toBe('initial'); // Default state

      // Verify tenant B's state is still there
      const stateB = await store.load({ continuityScopeId: 'tenant-b' });
      expect(stateB.value).toBe('b');
      expect(stateB.counter).toBe(2);
    });

    test('exists() is tenant-aware', async () => {
      await store.save({ value: 'exists', counter: 1 }, { continuityScopeId: 'tenant-exists' });

      expect(await store.exists({ continuityScopeId: 'tenant-exists' })).toBe(true);
      expect(await store.exists({ continuityScopeId: 'tenant-not-exists' })).toBe(false);
    });
  });

  describe('Database-level tenant table', () => {
    test('default scope exists after initialization', () => {
      const result = dbManager.queryOne<{ id: string }>(
        "SELECT id FROM tenants WHERE id = 'default'"
      );

      expect(result).not.toBeNull();
      expect(result?.id).toBe('default');
    });

    test('can create additional scopes', () => {
      dbManager.run("INSERT OR IGNORE INTO tenants (id, name) VALUES ('new-tenant', 'New Tenant')");

      const result = dbManager.queryOne<{ id: string; name: string }>(
        "SELECT id, name FROM tenants WHERE id = 'new-tenant'"
      );

      expect(result).not.toBeNull();
      expect(result?.name).toBe('New Tenant');
    });
  });

  describe('ChainSessionStore tenant isolation', () => {
    const textReferenceManagerStub = {
      storeChainStepResult: jest.fn(),
      buildChainVariables: jest.fn().mockReturnValue({}),
      getChainStepMetadata: jest.fn().mockReturnValue(null),
      clearChainStepResults: jest.fn(),
    };

    let chainSessionStore: ChainSessionStore;

    beforeEach(() => {
      textReferenceManagerStub.storeChainStepResult.mockClear();
      textReferenceManagerStub.buildChainVariables.mockClear();
      textReferenceManagerStub.getChainStepMetadata.mockClear();
      textReferenceManagerStub.clearChainStepResults.mockClear();

      chainSessionStore = new ChainSessionStore(
        logger,
        textReferenceManagerStub as any,
        {
          cleanupIntervalMs: 10_000,
        },
        dbManager
      );
    });

    afterEach(async () => {
      await chainSessionStore.cleanup();
    });

    test('same chain_id can run independently across scopes', async () => {
      await chainSessionStore.createSession(
        'tenant-a-session',
        'chain-shared#1',
        2,
        {},
        {
          continuityScopeId: 'tenant-a',
        }
      );
      await chainSessionStore.createSession(
        'tenant-b-session',
        'chain-shared#1',
        2,
        {},
        {
          continuityScopeId: 'tenant-b',
        }
      );

      const tenantASession = chainSessionStore.getSessionByChainIdentifier('chain-shared#1', {
        continuityScopeId: 'tenant-a',
      });
      const tenantBSession = chainSessionStore.getSessionByChainIdentifier('chain-shared#1', {
        continuityScopeId: 'tenant-b',
      });

      expect(tenantASession?.sessionId).toBe('tenant-a-session');
      expect(tenantBSession?.sessionId).toBe('tenant-b-session');

      const tenantAList = chainSessionStore.listActiveSessions(50, {
        continuityScopeId: 'tenant-a',
      });
      const tenantBList = chainSessionStore.listActiveSessions(50, {
        continuityScopeId: 'tenant-b',
      });

      expect(tenantAList).toHaveLength(1);
      expect(tenantBList).toHaveLength(1);
      expect(tenantAList[0]?.sessionId).toBe('tenant-a-session');
      expect(tenantBList[0]?.sessionId).toBe('tenant-b-session');
    });

    test('clearing one tenant sessions does not affect another tenant', async () => {
      await chainSessionStore.createSession(
        'tenant-a-session',
        'chain-shared#1',
        2,
        {},
        {
          continuityScopeId: 'tenant-a',
        }
      );
      await chainSessionStore.createSession(
        'tenant-b-session',
        'chain-shared#1',
        2,
        {},
        {
          continuityScopeId: 'tenant-b',
        }
      );

      await chainSessionStore.clearSessionsForChain('chain-shared#1', {
        continuityScopeId: 'tenant-a',
      });

      const tenantAAfterClear = chainSessionStore.getSession('tenant-a-session', {
        continuityScopeId: 'tenant-a',
      });
      const tenantBAfterClear = chainSessionStore.getSession('tenant-b-session', {
        continuityScopeId: 'tenant-b',
      });

      expect(tenantAAfterClear).toBeUndefined();
      expect(tenantBAfterClear?.sessionId).toBe('tenant-b-session');
    });
  });
});
