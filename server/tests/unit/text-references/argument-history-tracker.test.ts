import { afterEach, beforeEach, describe, expect, test, jest } from '@jest/globals';

import { ArgumentHistoryTracker } from '../../../src/modules/text-refs/argument-history-tracker.js';

import type { Logger } from '../../../src/infra/logging/index.js';
import type { StateStore } from '../../../src/shared/types/persistence.js';
import type { PersistedArgumentHistory } from '../../../src/modules/text-refs/types.js';

const createLogger = (): Logger =>
  ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }) as unknown as Logger;

/** No-op StateStore stub: these cases exercise in-memory behavior, not persistence. */
const createNoopStore = (): StateStore<PersistedArgumentHistory> => ({
  ensureInitialized: async () => undefined,
  load: async () => ({ version: '1.0.0', lastUpdated: 0, chains: {}, sessionToChain: {} }),
  save: async () => undefined,
  exists: async () => false,
  delete: async () => undefined,
});

describe('ArgumentHistoryTracker', () => {
  let tracker: ArgumentHistoryTracker;

  beforeEach(() => {
    tracker = new ArgumentHistoryTracker(createLogger(), 10, createNoopStore());
  });

  afterEach(async () => {
    await tracker.clearAll();
  });

  test('tracks executions and retrieves chain history', async () => {
    const entryId = await tracker.trackExecution({
      promptId: 'demo',
      sessionId: 'session-1',
      originalArgs: { name: 'Ada' },
      stepNumber: 1,
      stepResult: 'Hello Ada',
    });

    expect(entryId).toMatch(/^entry_/);
    const history = tracker.getChainHistory('session-1');
    expect(history).toHaveLength(1);
    expect(history[0].originalArgs.name).toBe('Ada');
  });

  test('enforces max entries per chain with FIFO semantics', async () => {
    tracker = new ArgumentHistoryTracker(createLogger(), 2, createNoopStore());
    await tracker.trackExecution({
      promptId: 'demo',
      sessionId: 'chain-a',
      originalArgs: { index: 1 },
    });
    await tracker.trackExecution({
      promptId: 'demo',
      sessionId: 'chain-a',
      originalArgs: { index: 2 },
    });
    await tracker.trackExecution({
      promptId: 'demo',
      sessionId: 'chain-a',
      originalArgs: { index: 3 },
    });

    const history = tracker.getChainHistory('chain-a');
    expect(history).toHaveLength(2);
    expect(history[0].originalArgs.index).toBe(2);
    expect(history[1].originalArgs.index).toBe(3);
  });

  test('builds review context with step results', async () => {
    await tracker.trackExecution({
      promptId: 'chain',
      sessionId: 'chain-1',
      originalArgs: { doc: 'First pass' },
      stepNumber: 1,
      stepResult: 'Result step 1',
    });
    await tracker.trackExecution({
      promptId: 'chain',
      sessionId: 'chain-1',
      originalArgs: { doc: 'Second pass' },
      stepNumber: 2,
      stepResult: 'Result step 2',
    });

    const reviewContext = tracker.buildReviewContext('chain-1');
    expect(reviewContext.originalArgs.doc).toBe('Second pass');
    expect(reviewContext.previousResults[2]).toBe('Result step 2');
    expect(reviewContext.previousResults[1]).toBe('Result step 1');
  });
});
