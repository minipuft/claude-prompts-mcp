import { afterAll, beforeAll, describe, expect, test, jest } from '@jest/globals';

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import { ChainSessionStore } from '../../../src/modules/chains/manager.js';
import type { StateStore } from '../../../src/shared/types/persistence.js';
import type { PersistedArgumentHistory } from '../../../src/modules/text-refs/types.js';
import { ArgumentHistoryTracker } from '../../../src/modules/text-refs/argument-history-tracker.js';

import type { Logger } from '../../../src/infra/logging/index.js';
import type { DatabasePort } from '../../../src/shared/types/persistence.js';

class StubTextReferenceStore {
  private store: Record<string, Record<number, { result: string; metadata: any }>> = {};
  storeChainStepResult = jest.fn().mockImplementation((...args: unknown[]) => {
    const [chainId, step, result, metadata] = args as [string, number, string, any];
    this.store[chainId] ||= {} as any;
    this.store[chainId][step] = { result, metadata };
  });
  buildChainVariables = jest.fn().mockImplementation((...args: unknown[]) => {
    const chainId = args[0] as string;
    const steps = this.store[chainId] || {};
    const step_results: Record<string, string> = {};
    for (const [k, v] of Object.entries(steps)) {
      step_results[k] = v.result;
    }
    return { step_results };
  });
  clearChainStepResults = jest.fn();
  getChainStepMetadata = jest.fn().mockReturnValue({});
}

const createLogger = (): Logger =>
  ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }) as unknown as Logger;

/**
 * Creates a mock DatabasePort that stores data in-memory, simulating SQLite.
 * Supports the kv_state shared table (used by argument history via key='arg_history').
 *
 * Chain-run persistence is deliberately NOT simulated: since v22 the store writes
 * chain_runs/chain_run_nodes through `db.run` and reads them through `db.query`, which
 * returns [] here. This file asserts the argument-history round trip, so an empty run
 * table is the correct stand-in rather than a gap.
 */
const createMockDb = (): DatabasePort => {
  const tables = new Map<string, Map<string, string>>();
  const argHistoryKey = (tenantId: string): string => `${tenantId}::arg_history`;

  return {
    isInitialized: () => true,
    initialize: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    queryOne: jest.fn().mockImplementation((...args: unknown[]) => {
      const sql = args[0] as string;
      const params = args[1] as unknown[] | undefined;
      const tenantId = (params?.[0] as string) ?? 'default';
      if (sql.includes('kv_state')) {
        // arg history uses kv_state with key='arg_history'
        const state = tables.get('kv_state')?.get(argHistoryKey(tenantId));
        return state ? { state } : null;
      }
      return null;
    }),
    query: jest.fn().mockReturnValue([]),
    run: jest.fn().mockImplementation((...args: unknown[]) => {
      const sql = args[0] as string;
      const params = args[1] as unknown[] | undefined;
      if (sql.includes('INSERT OR REPLACE INTO kv_state')) {
        if (!tables.has('kv_state')) tables.set('kv_state', new Map());
        const tenantId = (params?.[0] as string) ?? 'default';
        // params: [tenant_id, key, state]
        const state = (params?.[2] as string) ?? '{}';
        tables.get('kv_state')!.set(argHistoryKey(tenantId), state);
      }
    }),
    transaction: jest
      .fn()
      .mockImplementation(async (...args: unknown[]) => (args[0] as () => any)()),
    beginTransaction: jest.fn(),
    commit: jest.fn(),
    rollback: jest.fn(),
  } as unknown as DatabasePort;
};

/**
 * In-memory StateStore standing in for SqliteStateStore.
 *
 * It genuinely round-trips: this file asserts that a second tracker restores what the first
 * one wrote, so a no-op stub would make the assertion vacuous rather than passing.
 */
const createInMemoryStore = (): StateStore<PersistedArgumentHistory> => {
  let saved: PersistedArgumentHistory = {
    version: '1.0.0',
    lastUpdated: 0,
    chains: {},
    sessionToChain: {},
  };
  return {
    ensureInitialized: async () => undefined,
    load: async () => JSON.parse(JSON.stringify(saved)) as PersistedArgumentHistory,
    save: async (state: PersistedArgumentHistory) => {
      saved = JSON.parse(JSON.stringify(state)) as PersistedArgumentHistory;
    },
    exists: async () => true,
    delete: async () => undefined,
  };
};

describe('ChainSessionStore + ArgumentHistoryTracker (integration)', () => {
  let tmpRoot: string;

  beforeAll(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'chain-arg-int-'));
    fs.mkdirSync(path.join(tmpRoot, 'runtime-state'), { recursive: true });
  });

  afterAll(() => {
    try {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    } catch {}
  });

  test('real step completion writes argument-history to SQLite and enriches chainContext', async () => {
    const logger = createLogger();
    const textReference = new StubTextReferenceStore();
    const mockDb = createMockDb();
    // One store across both trackers: the round-trip is the assertion.
    const sharedArgStore = createInMemoryStore();

    const tracker = new ArgumentHistoryTracker(logger, 10, sharedArgStore);
    await tracker.initialize();

    const manager = new ChainSessionStore(
      logger,
      textReference as any,
      { serverRoot: tmpRoot, cleanupIntervalMs: 1000 },
      tracker
    );
    manager.setDatabasePort(mockDb);

    await manager.createSession('sess-1', 'chain-ctx', 2, { input: 'alpha' });

    // Simulate placeholder then real response for step 1
    await manager.updateSessionState('sess-1', 'n1', 'placeholder', { isPlaceholder: true });
    await manager.updateStepResult('sess-1', 'n1', 'REAL-OUTPUT-1');
    await manager.completeStep('sess-1', 'n1', { preservePlaceholder: false });
    await manager.advanceStep('sess-1', 'n1');

    const context = manager.getChainContext('sess-1');
    // Original args should be present via ArgumentHistoryTracker (merged at root)
    expect(context.input).toBe('alpha');
    // previous_step_results should include step 1
    expect(context.previous_step_results).toBeDefined();
    expect(context.previous_step_results['1']).toBe('REAL-OUTPUT-1');

    // Verify persistence: new tracker instance should see the data
    const tracker2 = new ArgumentHistoryTracker(logger, 10, sharedArgStore);
    await tracker2.initialize();
    const history = tracker2.getSessionHistory('sess-1');
    expect(history.length).toBeGreaterThan(0);
    await tracker2.shutdown();

    await manager.cleanup();
  });
});
