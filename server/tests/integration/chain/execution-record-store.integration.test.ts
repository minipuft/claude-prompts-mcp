// @lifecycle test - Tier 5 verification: ExecutionRecordStore round-trip + scope + ordering
/**
 * Integration test for ExecutionRecordStore.
 *
 * Verifies the append-only execution log against a real :memory: SQLite database
 * (node:sqlite DatabaseSync). The test mirrors the table shape declared in
 * sqlite-engine.ts so a real schema/code drift would surface here.
 *
 * Plan reference: ~/.claude/plans/execution-ledger-evidence-contracts-2026-04-27.md
 * Tier 5 rows #11 (per-step records) + #12 (chain-terminal record).
 */

import { afterEach, beforeEach, describe, expect, test, jest } from '@jest/globals';

import { DatabaseSync } from 'node:sqlite';

import { ExecutionRecordStore } from '../../../src/modules/chains/execution-record-store.js';

import type { Logger } from '../../../src/infra/logging/index.js';
import type { DatabasePort } from '../../../src/shared/types/persistence.js';

const createLogger = (): Logger =>
  ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }) as unknown as Logger;

/**
 * Build a DatabasePort-conformant adapter over a real :memory: DatabaseSync.
 * Schema mirrors sqlite-engine.ts:405-423 so drift between this test and the
 * production CREATE TABLE will surface as a SQL error.
 */
const createInMemoryDb = (): { db: DatabaseSync; port: DatabasePort } => {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE execution_records (
      execution_id TEXT PRIMARY KEY,
      tenant_id TEXT NOT NULL DEFAULT 'default',
      organization_id TEXT,
      workspace_id TEXT,
      session_id TEXT NOT NULL,
      chain_id TEXT,
      step_number INTEGER,
      prompt_id TEXT,
      status TEXT NOT NULL,
      substate_json TEXT,
      input_required_json TEXT,
      evidence_json TEXT,
      gate_verdicts_json TEXT NOT NULL DEFAULT '[]',
      error_message TEXT,
      started_at INTEGER NOT NULL,
      completed_at INTEGER,
      created_at TEXT DEFAULT (datetime('now'))
    );
    CREATE INDEX idx_execution_records_session ON execution_records(session_id);
    CREATE INDEX idx_execution_records_chain ON execution_records(chain_id);
  `);

  const port: DatabasePort = {
    isInitialized: () => true,
    initialize: async () => undefined,
    query: <T = Record<string, unknown>>(sql: string, params?: unknown[]): T[] => {
      const stmt = db.prepare(sql);
      const rows = stmt.all(...((params ?? []) as never[]));
      return rows as T[];
    },
    queryOne: <T = Record<string, unknown>>(sql: string, params?: unknown[]): T | null => {
      const stmt = db.prepare(sql);
      const row = stmt.get(...((params ?? []) as never[]));
      return (row ?? null) as T | null;
    },
    run: (sql: string, params?: unknown[]): void => {
      const stmt = db.prepare(sql);
      stmt.run(...((params ?? []) as never[]));
    },
    transaction: async <T>(fn: () => T | Promise<T>): Promise<T> => {
      db.exec('BEGIN');
      try {
        const result = await fn();
        db.exec('COMMIT');
        return result;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
    beginTransaction: () => db.exec('BEGIN'),
    commit: () => db.exec('COMMIT'),
    rollback: () => db.exec('ROLLBACK'),
  };

  return { db, port };
};

describe('ExecutionRecordStore (integration)', () => {
  let db: DatabaseSync;
  let port: DatabasePort;
  let store: ExecutionRecordStore;

  beforeEach(() => {
    const fixture = createInMemoryDb();
    db = fixture.db;
    port = fixture.port;
    store = new ExecutionRecordStore(port, createLogger());
  });

  afterEach(() => {
    try {
      db.close();
    } catch {
      // ignore close errors on teardown
    }
  });

  test('AC1+AC2: append() persists a step-level record with full field round-trip', () => {
    const renderedAt = Date.now();
    const executionId = store.append({
      sessionId: 'sess-int-1',
      chainId: 'chain-research#1',
      stepNumber: 1,
      promptId: 'analysis_report',
      status: 'working',
      substate: { renderedAt },
      startedAt: renderedAt,
    });

    expect(executionId).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/);

    const records = store.queryBySession('sess-int-1');
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      executionId,
      sessionId: 'sess-int-1',
      chainId: 'chain-research#1',
      stepNumber: 1,
      promptId: 'analysis_report',
      status: 'working',
      substate: { renderedAt },
      startedAt: renderedAt,
      gateVerdicts: [],
    });
    expect(records[0].completedAt).toBeUndefined();
    expect(records[0].errorMessage).toBeUndefined();
  });

  test('AC1: stage 09-style per-step + stage 10-style chain-terminal records both persist', () => {
    const t1 = Date.now();
    const t2 = t1 + 10;
    const t3 = t2 + 10;

    // Two step-level records (stage 09 emission shape)
    store.append({
      sessionId: 'sess-multi',
      chainId: 'chain-multi#1',
      stepNumber: 1,
      promptId: 'step-one',
      status: 'working',
      substate: { renderedAt: t1 },
      startedAt: t1,
    });
    store.append({
      sessionId: 'sess-multi',
      chainId: 'chain-multi#1',
      stepNumber: 2,
      promptId: 'step-two',
      status: 'working',
      substate: { renderedAt: t2 },
      startedAt: t2,
    });
    // Chain-terminal record (stage 10 emission shape — no stepNumber/promptId)
    store.append({
      sessionId: 'sess-multi',
      chainId: 'chain-multi#1',
      status: 'completed',
      startedAt: t3,
      completedAt: t3,
    });

    const records = store.queryBySession('sess-multi');
    expect(records).toHaveLength(3);
    expect(records.map((r) => r.status)).toEqual(['working', 'working', 'completed']);
    expect(records.map((r) => r.stepNumber)).toEqual([1, 2, undefined]);

    // Chain-terminal has completedAt set, step-level records do not
    expect(records[2].completedAt).toBe(t3);
    expect(records[0].completedAt).toBeUndefined();
    expect(records[1].completedAt).toBeUndefined();
  });

  test('AC3: ULID ordering preserves insertion order via queryBySession', () => {
    const ids: string[] = [];
    for (let i = 1; i <= 5; i++) {
      ids.push(
        store.append({
          sessionId: 'sess-order',
          chainId: 'chain-order#1',
          stepNumber: i,
          status: 'working',
          startedAt: Date.now() + i,
        })
      );
    }

    const records = store.queryBySession('sess-order');
    expect(records.map((r) => r.executionId)).toEqual(ids);
    expect(records.map((r) => r.stepNumber)).toEqual([1, 2, 3, 4, 5]);
  });

  test('AC4: queryByChain returns same records as queryBySession via different key', () => {
    store.append({
      sessionId: 'sess-by-chain',
      chainId: 'chain-x#1',
      stepNumber: 1,
      status: 'working',
      startedAt: Date.now(),
    });
    store.append({
      sessionId: 'sess-by-chain',
      chainId: 'chain-x#1',
      status: 'completed',
      startedAt: Date.now() + 1,
      completedAt: Date.now() + 1,
    });

    const bySession = store.queryBySession('sess-by-chain');
    const byChain = store.queryByChain('chain-x#1');

    expect(byChain).toHaveLength(2);
    expect(byChain.map((r) => r.executionId)).toEqual(bySession.map((r) => r.executionId));
  });

  test('AC5: scope (organization_id/workspace_id) round-trips through append + query', () => {
    store.append({
      sessionId: 'sess-scoped',
      chainId: 'chain-scoped#1',
      stepNumber: 1,
      status: 'working',
      startedAt: Date.now(),
      scope: {
        continuityScopeId: 'tenant-acme',
        organizationId: 'org-acme',
        workspaceId: 'workspace-prod',
      },
    });

    const records = store.queryBySession('sess-scoped', {
      continuityScopeId: 'tenant-acme',
    });

    expect(records).toHaveLength(1);
    expect(records[0].organizationId).toBe('org-acme');
    expect(records[0].workspaceId).toBe('workspace-prod');
  });

  test('AC5: queries are tenant-isolated — other tenants do not see this scope’s records', () => {
    store.append({
      sessionId: 'sess-shared-id',
      chainId: 'chain-shared#1',
      stepNumber: 1,
      status: 'working',
      startedAt: Date.now(),
      scope: { continuityScopeId: 'tenant-a' },
    });
    store.append({
      sessionId: 'sess-shared-id',
      chainId: 'chain-shared#1',
      stepNumber: 1,
      status: 'working',
      startedAt: Date.now() + 1,
      scope: { continuityScopeId: 'tenant-b' },
    });

    const tenantA = store.queryBySession('sess-shared-id', { continuityScopeId: 'tenant-a' });
    const tenantB = store.queryBySession('sess-shared-id', { continuityScopeId: 'tenant-b' });

    expect(tenantA).toHaveLength(1);
    expect(tenantB).toHaveLength(1);
    expect(tenantA[0].executionId).not.toBe(tenantB[0].executionId);
  });

  test('append is best-effort — SQL failures log warn but do not throw', () => {
    db.close();
    const warnLogger = createLogger();
    const resilientStore = new ExecutionRecordStore(port, warnLogger);

    // After closing the underlying DB, run() will throw inside the port; the
    // store must absorb the error so emission cannot break pipeline execution.
    expect(() =>
      resilientStore.append({
        sessionId: 'sess-after-close',
        status: 'working',
        startedAt: Date.now(),
      })
    ).not.toThrow();

    expect(warnLogger.warn).toHaveBeenCalled();
  });
});
