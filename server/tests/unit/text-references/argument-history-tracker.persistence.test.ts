import { afterEach, describe, expect, test, jest } from '@jest/globals';

import { ArgumentHistoryTracker } from '../../../src/modules/text-refs/argument-history-tracker.js';

import type { Logger } from '../../../src/infra/logging/index.js';
import type { StateStore, StateStoreOptions } from '../../../src/shared/types/persistence.js';
import type { PersistedArgumentHistory } from '../../../src/modules/text-refs/types.js';

const createLogger = (): Logger =>
  ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }) as unknown as Logger;

/**
 * Creates an in-memory StateStore keyed by scope, standing in for SqliteStateStore.
 *
 * The tracker no longer owns SQL: `modules/` may not import `infra/`, so the composition root
 * builds the concrete store and injects this interface. Keying by scope is what lets these
 * tests observe per-workspace isolation, which the previous mock — a DatabasePort whose SQL
 * hardcoded `tenant_id = 'default'` — structurally could not.
 */
const createInMemoryStore = (): StateStore<PersistedArgumentHistory> & {
  _storage: Map<string, PersistedArgumentHistory>;
} => {
  const storage = new Map<string, PersistedArgumentHistory>();
  const keyFor = (options?: StateStoreOptions): string =>
    options?.workspaceId ?? options?.continuityScopeId ?? options?.organizationId ?? 'default';

  return {
    _storage: storage,
    ensureInitialized: async () => undefined,
    load: async (options?: StateStoreOptions) =>
      storage.get(keyFor(options)) ?? {
        version: '1.0.0',
        lastUpdated: 0,
        chains: {},
        sessionToChain: {},
      },
    save: async (state: PersistedArgumentHistory, options?: StateStoreOptions) => {
      storage.set(keyFor(options), JSON.parse(JSON.stringify(state)) as PersistedArgumentHistory);
    },
    exists: async (options?: StateStoreOptions) => storage.has(keyFor(options)),
    delete: async (options?: StateStoreOptions) => {
      storage.delete(keyFor(options));
    },
  };
};

describe('ArgumentHistoryTracker (persistence)', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test('writes to and restores from SQLite kv_state table (arg_history key)', async () => {
    const logger = createLogger();
    const store = createInMemoryStore();

    // First tracker: write one entry
    const trackerA = new ArgumentHistoryTracker(logger, 10, store);
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
    const trackerB = new ArgumentHistoryTracker(logger, 10, store);
    await trackerB.initialize();

    const history = trackerB.getSessionHistory('sess-1');
    expect(history).toHaveLength(1);
    expect(history[0].originalArgs).toEqual({ q: 'hello' });
    expect(history[0].stepNumber).toBe(1);
    expect(history[0].stepResult).toBe('R1');

    await trackerB.shutdown();
  });

  /**
   * Tier 4.2's stated verification: "Arg history becomes per-workspace".
   *
   * Before this, persistence was a raw `INSERT OR REPLACE INTO kv_state` with the literal
   * `'default'` tenant, so every project on a machine sharing one state.db read and overwrote
   * the same row. Two workspaces reading each other's chain arguments is the defect; these two
   * cases are the two behaviors the row names — the store swap and the scope pass.
   */
  test('keeps argument history separate per workspace scope', async () => {
    const logger = createLogger();
    const store = createInMemoryStore();

    const trackerA = new ArgumentHistoryTracker(logger, 10, store, { workspaceId: 'ws-a' });
    await trackerA.initialize();
    await trackerA.trackExecution({
      promptId: 'chain-x',
      sessionId: 'sess-shared',
      originalArgs: { q: 'from-a' },
    });
    await trackerA.shutdown();

    // Same store, same session id, different workspace: must not observe ws-a's entry.
    const trackerB = new ArgumentHistoryTracker(logger, 10, store, { workspaceId: 'ws-b' });
    await trackerB.initialize();
    expect(trackerB.getSessionHistory('sess-shared')).toHaveLength(0);

    await trackerB.trackExecution({
      promptId: 'chain-x',
      sessionId: 'sess-shared',
      originalArgs: { q: 'from-b' },
    });
    await trackerB.shutdown();

    // ws-a's row survived ws-b's write rather than being overwritten by it.
    const reopenedA = new ArgumentHistoryTracker(logger, 10, store, { workspaceId: 'ws-a' });
    await reopenedA.initialize();
    const historyA = reopenedA.getSessionHistory('sess-shared');
    expect(historyA).toHaveLength(1);
    expect(historyA[0].originalArgs).toEqual({ q: 'from-a' });
    await reopenedA.shutdown();
  });

  test('still persists when no workspace scope is configured', async () => {
    const logger = createLogger();
    const store = createInMemoryStore();

    // The scope is optional throughout the chain, so an unscoped tracker must keep working
    // rather than silently dropping writes — this is the path a test harness or a CLI takes.
    const tracker = new ArgumentHistoryTracker(logger, 10, store);
    await tracker.initialize();
    await tracker.trackExecution({
      promptId: 'chain-y',
      sessionId: 'sess-unscoped',
      originalArgs: { q: 'no-scope' },
    });
    await tracker.shutdown();

    const reopened = new ArgumentHistoryTracker(logger, 10, store);
    await reopened.initialize();
    expect(reopened.getSessionHistory('sess-unscoped')).toHaveLength(1);
    await reopened.shutdown();
  });
});
