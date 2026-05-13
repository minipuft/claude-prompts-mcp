import { afterEach, describe, expect, test, jest } from '@jest/globals';

import { ArgumentHistoryTracker } from '../../../src/modules/text-refs/argument-history-tracker.js';

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
 * Creates a mock DatabasePort that captures data written via run() and
 * returns it from queryOne(), simulating SQLite round-trip persistence.
 */
const createPersistentMockDb = (): DatabasePort & { _storage: Map<string, string> } => {
  const storage = new Map<string, string>();

  return {
    _storage: storage,
    isInitialized: () => true,
    initialize: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    queryOne: jest.fn().mockImplementation((...args: unknown[]) => {
      const params = args[1] as unknown[] | undefined;
      const tenantId = (params?.[0] as string) ?? 'default';
      const state = storage.get(tenantId);
      return state ? { state } : null;
    }),
    query: jest.fn().mockReturnValue([]),
    run: jest.fn().mockImplementation((...args: unknown[]) => {
      const sql = args[0] as string;
      const params = args[1] as unknown[] | undefined;
      if (sql.includes('INSERT OR REPLACE INTO kv_state')) {
        const tenantId = (params?.[0] as string) ?? 'default';
        // params: [tenant_id, key, state]
        const state = (params?.[2] as string) ?? '{}';
        storage.set(tenantId, state);
      }
    }),
    transaction: jest.fn(),
    beginTransaction: jest.fn(),
    commit: jest.fn(),
    rollback: jest.fn(),
  } as unknown as DatabasePort & { _storage: Map<string, string> };
};

describe('ArgumentHistoryTracker (persistence)', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('writes to and restores from SQLite kv_state table (arg_history key)', async () => {
    const logger = createLogger();
    const mockDb = createPersistentMockDb();

    // First tracker: write one entry
    const trackerA = new ArgumentHistoryTracker(logger, 10, mockDb);
    await trackerA.initialize();

    await trackerA.trackExecution({
      promptId: 'chain-x',
      sessionId: 'sess-1',
      originalArgs: { q: 'hello' },
      stepNumber: 1,
      stepResult: 'R1',
    });

    await trackerA.shutdown();

    // Second tracker: should restore previous state from the same mock db
    const trackerB = new ArgumentHistoryTracker(logger, 10, mockDb);
    await trackerB.initialize();

    const history = trackerB.getSessionHistory('sess-1');
    expect(history).toHaveLength(1);
    expect(history[0].originalArgs).toEqual({ q: 'hello' });
    expect(history[0].stepNumber).toBe(1);
    expect(history[0].stepResult).toBe('R1');

    await trackerB.shutdown();
  });
});
