// @lifecycle test - PromptExecutor owns no teardown; the argument-history flush it made is surplus
/**
 * `PromptExecutor.cleanup()` ran nine steps and nothing in `src` called it. Each step was put
 * through the three-fork test (who consumes what it does at exit?):
 *
 * - analytics, tool-description loader, prompt manager, framework state store: superseded, since
 *   `Application.shutdown()` and `McpToolsManager.shutdown()` already stop the same instances.
 * - config manager `shutdown()`: `Application.stopConfigWatching()` already stops the watcher, and
 *   the listeners it also removed have no reader at process exit.
 * - gate system `cleanup()`: `GateStateStore.cleanup()` only logs and the temporary-gate registry
 *   has no `cleanup` method, so the step reached nothing.
 * - prompt guidance service `shutdown()`: flips a flag and logs.
 * - argument-history tracker `shutdown()`: claims to flush. The second test shows what it writes
 *   is what every mutator had already written.
 * - chain session store `cleanup()`: live, and owned by `Application.shutdown()`.
 *
 * What remains to pin is that no second teardown path grows back on the executor.
 */

import { describe, expect, jest, test } from '@jest/globals';

import { ChainSessionStore } from '../../../src/modules/chains/manager.js';
import { ArgumentHistoryTracker } from '../../../src/modules/text-refs/argument-history-tracker.js';
import { PromptExecutor } from '../../../src/mcp/tools/prompt-engine/core/prompt-executor.js';

import type { Logger } from '../../../src/infra/logging/index.js';
import type { StateStore } from '../../../src/shared/types/persistence.js';
import type { PersistedArgumentHistory } from '../../../src/modules/text-refs/types.js';

const TEARDOWN = /^(shutdown|cleanup|dispose|close|destroy)$/;

function teardownMethodsOf(prototype: object): string[] {
  return Object.getOwnPropertyNames(prototype).filter(
    (name) =>
      TEARDOWN.test(name) &&
      typeof (Object.getOwnPropertyDescriptor(prototype, name) ?? {}).value === 'function'
  );
}

const createLogger = (): Logger =>
  ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }) as unknown as Logger;

describe('PromptExecutor teardown', () => {
  test('the enumeration sees a teardown method where one exists (positive control)', () => {
    expect(teardownMethodsOf(ChainSessionStore.prototype)).toContain('cleanup');
  });

  test('PromptExecutor exposes no teardown method', () => {
    expect(teardownMethodsOf(PromptExecutor.prototype)).toEqual([]);
  });
});

describe('ArgumentHistoryTracker.shutdown() flush', () => {
  test('writes the chains every mutator had already persisted', async () => {
    const saved: PersistedArgumentHistory[] = [];
    const store: StateStore<PersistedArgumentHistory> = {
      ensureInitialized: async () => undefined,
      load: async () => ({ version: '1.0.0', lastUpdated: 0, chains: {} }),
      save: async (state) => {
        saved.push(JSON.parse(JSON.stringify(state)) as PersistedArgumentHistory);
      },
      exists: async () => false,
      delete: async () => undefined,
    };
    const tracker = new ArgumentHistoryTracker(createLogger(), 10, store);
    await tracker.initialize();

    await tracker.trackExecution({ promptId: 'p', sessionId: 's1', originalArgs: { q: 'a' } });
    await tracker.trackExecution({ promptId: 'p', sessionId: 's2', originalArgs: { q: 'b' } });
    await tracker.clearSession('s2');

    // Positive control: the store observed the mutators writing, and the write holds the entry.
    expect(saved.length).toBeGreaterThanOrEqual(3);
    const beforeShutdown = saved[saved.length - 1]!.chains;
    expect(Object.keys(beforeShutdown)).toEqual(['s1']);

    const writesBefore = saved.length;
    await tracker.shutdown();

    expect(saved).toHaveLength(writesBefore + 1);
    expect(saved[saved.length - 1]!.chains).toEqual(beforeShutdown);
  });
});
