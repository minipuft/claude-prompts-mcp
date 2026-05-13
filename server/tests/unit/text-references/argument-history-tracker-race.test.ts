// @lifecycle test - Regression test for ArgumentHistoryTracker initialization race condition
/**
 * ArgumentHistoryTracker Race Condition Regression Test
 *
 * Verifies that calling trackExecution() WITHOUT calling initialize() first
 * auto-initializes the tracker and persists data, instead of silently dropping it.
 *
 * Bug: initialize() was fire-and-forget in PromptExecutor. If the first
 * prompt_engine call arrived before initialize() completed, saveToStore() returned
 * early because this.stateStore was undefined.
 *
 * Fix: trackExecution() now calls initialize() if not yet initialized (idempotent).
 */

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

describe('ArgumentHistoryTracker (race condition)', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('trackExecution auto-initializes when called before initialize()', async () => {
    const logger = createLogger();
    const mockDb = createPersistentMockDb();

    // Create tracker but do NOT call initialize()
    const tracker = new ArgumentHistoryTracker(logger, 10, mockDb);

    // Call trackExecution directly — before the fix, this silently dropped data
    const entryId = await tracker.trackExecution({
      promptId: 'test-prompt',
      sessionId: 'sess-race-1',
      originalArgs: { input: 'hello world' },
      stepNumber: 1,
    });

    // Should have returned a valid entry ID (not empty/undefined)
    expect(entryId).toBeDefined();
    expect(entryId).toMatch(/^entry_/);

    // Data should be in memory
    const history = tracker.getSessionHistory('sess-race-1');
    expect(history).toHaveLength(1);
    expect(history[0].originalArgs).toEqual({ input: 'hello world' });

    await tracker.shutdown();
  });

  test('trackExecution data persists to SQLite even without prior initialize()', async () => {
    const logger = createLogger();
    const mockDb = createPersistentMockDb();

    // Tracker A: write without prior initialize()
    const trackerA = new ArgumentHistoryTracker(logger, 10, mockDb);
    await trackerA.trackExecution({
      promptId: 'chain-race',
      sessionId: 'sess-race-2',
      originalArgs: { q: 'persist test' },
      stepNumber: 1,
      stepResult: 'result-1',
    });
    await trackerA.shutdown();

    // Tracker B: should restore data from the same mock db
    const trackerB = new ArgumentHistoryTracker(logger, 10, mockDb);
    await trackerB.initialize();

    const history = trackerB.getSessionHistory('sess-race-2');
    expect(history).toHaveLength(1);
    expect(history[0].originalArgs).toEqual({ q: 'persist test' });
    expect(history[0].stepResult).toBe('result-1');

    await trackerB.shutdown();
  });

  test('multiple trackExecution calls without initialize() are idempotent', async () => {
    const logger = createLogger();
    const mockDb = createPersistentMockDb();

    const tracker = new ArgumentHistoryTracker(logger, 10, mockDb);

    // Call trackExecution multiple times without initialize() — each should work
    await tracker.trackExecution({
      promptId: 'multi',
      sessionId: 'sess-race-3',
      originalArgs: { step: '1' },
      stepNumber: 1,
    });
    await tracker.trackExecution({
      promptId: 'multi',
      sessionId: 'sess-race-3',
      originalArgs: { step: '2' },
      stepNumber: 2,
    });

    const history = tracker.getSessionHistory('sess-race-3');
    expect(history).toHaveLength(2);

    await tracker.shutdown();
  });
});
