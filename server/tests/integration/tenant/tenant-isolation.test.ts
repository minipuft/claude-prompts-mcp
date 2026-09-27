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
    dbManager = await SqliteEngine.getInstance(logger, {
      dbPath: path.join(tmpDir, 'runtime-state', 'state.db'),
    });
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
    // getContinuityScopeId()/setContinuityScopeId() were deleted at P4.52: zero production
    // callers, and their only test coverage was this describe block testing itself. The
    // duplicate `state.scope` field they wrote was deleted at P4.70 — `execution-telemetry.ts`
    // now reads `state.identity.context?.identitySource` for the `cpm.scope.source` attribute,
    // so `state.identity`'s default shape is what stays worth asserting.
    test('tenant state is initialized in pipeline state', () => {
      const ctx = new ExecutionContext({ command: 'test' }, logger);

      expect(ctx.state.identity).toBeDefined();
      expect(ctx.state.identity.continuityScopeId).toBe('default');
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
    // Tier 6.3 deleted `tenants`. The two tests here inserted into it and read the row back,
    // which proved the table existed and nothing more — it had no reader in src/, and no
    // `tenant_id` column anywhere declared it as a foreign key. Isolation is delivered by the
    // scope columns on each table, which the rest of this file covers.
    test('is gone, and no table claims a foreign key into it', () => {
      const present = dbManager.query<{ name: string }>(
        `SELECT name FROM sqlite_master WHERE type='table' AND name='tenants'`
      );
      expect(present).toHaveLength(0);

      const referencing = dbManager
        .query<{ sql: string | null }>(`SELECT sql FROM sqlite_master WHERE type='table'`)
        .filter((row) => /REFERENCES\s+tenants/i.test(row.sql ?? ''));
      expect(referencing).toHaveLength(0);
    });
  });

  describe('ChainSessionStore tenant isolation', () => {
    const textReferenceManagerStub = {
      storeChainStepResult: jest.fn(),
      buildChainVariables: jest.fn().mockReturnValue({}),
      clearChainStepResults: jest.fn(),
    };

    let chainSessionStore: ChainSessionStore;

    beforeEach(() => {
      textReferenceManagerStub.storeChainStepResult.mockClear();
      textReferenceManagerStub.buildChainVariables.mockClear();
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

    /**
     * Tier 4 writer conformance. `chain_sessions.run_owner_pid` is the server PID and
     * `chain_runs.run_owner_pid` is the run owner — neither is a workspace, so the scope
     * columns are the only thing that says which project a row belongs to. Both were written
     * NULL until a startup backfill repaired them on the next boot; these assert the writers
     * now emit scope themselves, which is what lets that backfill be deleted.
     */
    test('stamps workspace scope on both the hook projection and the run rows', async () => {
      const scopedStore = new ChainSessionStore(
        logger,
        textReferenceManagerStub as any,
        { cleanupIntervalMs: 10_000, defaultScope: { workspaceId: 'ws-alpha' } },
        dbManager
      );

      try {
        await scopedStore.createSession('scoped-session', 'chain-scoped#1', 2, {}, {});

        const sessionRows = dbManager.query<{
          run_owner_pid: string;
          workspace_id: string | null;
          organization_id: string | null;
        }>(`SELECT run_owner_pid, workspace_id, organization_id FROM chain_sessions`);

        expect(sessionRows.length).toBeGreaterThan(0);
        expect(sessionRows.every((row) => row.workspace_id === 'ws-alpha')).toBe(true);
        // run_owner_pid stays the PID: the workspace fills the scope columns without displacing
        // run ownership, which the Python hooks query by. Renamed from tenant_id at v20 so the
        // two meanings no longer share a name.
        expect(sessionRows.every((row) => row.run_owner_pid === String(process.pid))).toBe(true);

        const runRows = dbManager.query<{
          run_owner_pid: string;
          workspace_id: string | null;
        }>(`SELECT run_owner_pid, workspace_id FROM chain_runs`);

        expect(runRows.length).toBeGreaterThan(0);
        expect(runRows.every((row) => row.workspace_id === 'ws-alpha')).toBe(true);
        expect(runRows.every((row) => row.run_owner_pid === String(process.pid))).toBe(true);
      } finally {
        await scopedStore.cleanup();
      }
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

    /** The hook projection's rows for `chainId`: the run each row carries and its scope. */
    const projectedRuns = (chainId: string): Array<{ sessionId: string; scope: string }> =>
      dbManager
        .query<{ state: string; continuity_scope_id: string }>(
          `SELECT state, continuity_scope_id FROM chain_sessions WHERE chain_id = ? ORDER BY id`,
          [chainId]
        )
        .map((row) => ({
          sessionId: (JSON.parse(row.state) as { sessionId: string }).sessionId,
          scope: row.continuity_scope_id,
        }));

    test('P6.147 (a) one process projects both scopes runs of one chain id', async () => {
      await chainSessionStore.createSession(
        'p147-a',
        'chain-p147#1',
        2,
        {},
        {
          continuityScopeId: 'tenant-a',
        }
      );
      await chainSessionStore.createSession(
        'p147-b',
        'chain-p147#1',
        2,
        {},
        {
          continuityScopeId: 'tenant-b',
        }
      );

      // Positive control: both runs reached `chain_runs`, the rows the projection derives from.
      const runs = dbManager.query<{ session_id: string }>(
        `SELECT session_id FROM chain_runs WHERE chain_id = ? ORDER BY session_id`,
        ['chain-p147#1']
      );
      expect(runs.map((row) => row.session_id)).toEqual(['p147-a', 'p147-b']);
      expect(projectedRuns('chain-p147#1')).toEqual([
        { sessionId: 'p147-a', scope: 'tenant-a' },
        { sessionId: 'p147-b', scope: 'tenant-b' },
      ]);
    });

    test('P6.147 (b) control: one scope projects its one run', async () => {
      await chainSessionStore.createSession(
        'p147-c',
        'chain-p147c#1',
        2,
        {},
        {
          continuityScopeId: 'tenant-c',
        }
      );

      expect(projectedRuns('chain-p147c#1')).toEqual([{ sessionId: 'p147-c', scope: 'tenant-c' }]);
    });

    /**
     * P6.166 (R74). A planted UNIQUE index turns the P6.147 pair back into a projection collision:
     * the second save must THROW at the caller, not log and report the run created. The partial
     * index names one chain id, so other tests' rows cannot trip it.
     */
    test('P6.166 a constraint violation in the projection throws the save to its caller', async () => {
      const plant = `CREATE UNIQUE INDEX p166_plant ON chain_sessions(chain_id)
        WHERE chain_id = 'chain-p166#1'`;
      dbManager.run(plant);
      try {
        await chainSessionStore.createSession(
          'p166-a',
          'chain-p166#1',
          2,
          {},
          {
            continuityScopeId: 'tenant-a',
          }
        );
        await expect(
          chainSessionStore.createSession(
            'p166-b',
            'chain-p166#1',
            2,
            {},
            {
              continuityScopeId: 'tenant-b',
            }
          )
        ).rejects.toThrow(/UNIQUE constraint failed: chain_sessions\.chain_id/);
        // Positive control on the table the defect lives in: the failed save rolled back, so
        // `chain_runs` holds only the first run.
        const runs = dbManager.query<{ session_id: string }>(
          `SELECT session_id FROM chain_runs WHERE chain_id = ? ORDER BY session_id`,
          ['chain-p166#1']
        );
        expect(runs.map((row) => row.session_id)).toEqual(['p166-a']);
      } finally {
        dbManager.run('DROP INDEX p166_plant');
      }
    });

    test('P6.166 control: the same pair saves cleanly without the planted index', async () => {
      await chainSessionStore.createSession(
        'p166-c',
        'chain-p166c#1',
        2,
        {},
        {
          continuityScopeId: 'tenant-a',
        }
      );
      await chainSessionStore.createSession(
        'p166-d',
        'chain-p166c#1',
        2,
        {},
        {
          continuityScopeId: 'tenant-b',
        }
      );

      expect(projectedRuns('chain-p166c#1')).toEqual([
        { sessionId: 'p166-c', scope: 'tenant-a' },
        { sessionId: 'p166-d', scope: 'tenant-b' },
      ]);
    });

    test('P6.166 two persists in flight at once both commit, one after the other', async () => {
      // A fire-and-forget persist (a lifecycle promotion) overlapping an awaited one used to meet
      // `cannot start a transaction within a transaction`, which the old swallow hid.
      await chainSessionStore.createSession(
        'p166-f',
        'chain-p166f#1',
        2,
        {},
        {
          continuityScopeId: 'tenant-a',
        }
      );
      const persist = () =>
        (
          chainSessionStore as unknown as { persistSessions: () => Promise<void> }
        ).persistSessions();

      await expect(Promise.all([persist(), persist()])).resolves.toEqual([undefined, undefined]);
      expect(projectedRuns('chain-p166f#1')).toEqual([{ sessionId: 'p166-f', scope: 'tenant-a' }]);
    });

    test('P6.166 a lock held past the busy timeout is logged and the save continues', async () => {
      // The one class `persistSessions` still swallows: SQLITE_BUSY (errcode 5), transient
      // because the next persist rewrites every live run.
      const errorLog = logger.error as jest.Mock;
      errorLog.mockClear();
      const busy = Object.assign(new Error('database is locked'), {
        code: 'ERR_SQLITE_ERROR',
        errcode: 5,
      });
      const spy = jest
        .spyOn(chainSessionStore as any, 'persistSessionsOrThrow')
        .mockRejectedValueOnce(busy);
      try {
        const session = await chainSessionStore.createSession('p166-e', 'chain-p166e#1', 2);
        expect(session.sessionId).toBe('p166-e');
        expect(String(errorLog.mock.calls.at(-1)?.[0])).toMatch(/lock held.*database is locked/);
      } finally {
        spy.mockRestore();
      }
    });

    /**
     * P6.175 (R74). One caller per save class, each with a planted rejection: an AWAITED mutator
     * whose result the client is told (`cancelChain`) rejects on anything but a held lock; an
     * awaited write whose reply renders what it wrote (`applyUnknownObservations`) rejects even on
     * a held lock; a BACKGROUND persist (a lifecycle promotion) logs, naming its context.
     */
    describe('P6.175: every save class fails loudly', () => {
      const constraint = () =>
        Object.assign(new Error('P175 planted: UNIQUE constraint failed'), {
          code: 'ERR_SQLITE_ERROR',
          errcode: 2067,
        });
      const heldLock = () =>
        Object.assign(new Error('P175 planted: database is locked'), {
          code: 'ERR_SQLITE_ERROR',
          errcode: 5,
        });
      const plant = (error: Error) =>
        jest.spyOn(chainSessionStore as any, 'persistSessionsOrThrow').mockRejectedValueOnce(error);

      test('awaited: a cancel whose save fails rejects instead of reporting the run cancelled', async () => {
        await chainSessionStore.createSession('p175-a', 'chain-p175a#1', 2);
        const spy = plant(constraint());
        try {
          await expect(chainSessionStore.cancelChain('p175-a')).rejects.toThrow(/P175 planted/);
        } finally {
          spy.mockRestore();
        }
        // Control: the same cancel with nothing planted resolves
        await expect(chainSessionStore.cancelChain('p175-a')).resolves.toBe(true);
      });

      test('awaited, nothing swallowed: a held lock fails an observation batch', async () => {
        await chainSessionStore.createSession('p175-b', 'chain-p175b#1', 2);
        const nodeId = chainSessionStore.getSession('p175-b')!.state.nodes[0]!.id;
        const observation = {
          type: 'unknown_discovered' as const,
          id: 'u-175',
          statement: 'undecided',
          blocking: false,
        };
        const spy = plant(heldLock());
        try {
          await expect(
            chainSessionStore.applyUnknownObservations('p175-b', nodeId, [observation])
          ).rejects.toThrow(/database is locked/);
        } finally {
          spy.mockRestore();
        }
      });

      test('background: a lifecycle promotion whose save fails is logged with its context', async () => {
        await chainSessionStore.createSession('p175-c', 'chain-p175c#1', 2);
        const session = chainSessionStore.getSession('p175-c')!;
        session.lifecycle = 'dormant';
        const warn = logger.warn as jest.Mock;
        warn.mockClear();
        const spy = plant(constraint());
        try {
          expect(chainSessionStore.getSession('p175-c')?.lifecycle).toBe('canonical');
          await new Promise((resolve) => setImmediate(resolve));
          expect(warn.mock.calls.map((call) => String(call[0]))).toContainEqual(
            expect.stringMatching(
              /Failed to persist sessions \(lifecycle-promotion\): P175 planted/
            )
          );
        } finally {
          spy.mockRestore();
        }
      });
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
