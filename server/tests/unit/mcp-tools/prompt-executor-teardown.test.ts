// @lifecycle test - PromptExecutor and the services only it tore down expose no teardown
/**
 * `PromptExecutor.cleanup()` ran nine steps and nothing in `src` called it. Each step was put
 * through the three-fork test (who consumes what it does at exit?):
 *
 * - analytics, tool-description loader, prompt manager, framework state store: superseded, since
 *   `Application.shutdown()` and `McpToolsManager.shutdown()` already stop the same instances.
 * - config manager `shutdown()`: `Application.stopConfigWatching()` already stops the watcher, and
 *   the listeners it also removed have no reader at process exit.
 * - gate system `cleanup()`: `GateStateStore.cleanup()` only logged and the temporary-gate registry
 *   has no `cleanup` method, so the step reached nothing. With the executor gone, nothing called
 *   `LightweightGateSystem.cleanup()` or the store hook either, and both were deleted.
 * - prompt guidance service `shutdown()`: flipped a flag and logged; deleted with its caller.
 * - argument-history tracker `shutdown()`: saved what every mutator had already saved, since
 *   `trackExecution` and `clearSession` each await the save; deleted with its caller.
 * - chain session store `cleanup()`: live, and owned by `Application.shutdown()`.
 *
 * What remains to pin is that no teardown path grows back on the executor or on the services
 * it alone used to stop. `GateStateStore` is pinned in `state-store-teardown-persist.test.ts`.
 */

import { describe, expect, test } from '@jest/globals';

import { LightweightGateSystem } from '../../../src/engine/gates/core/index.js';
import { PromptGuidanceService } from '../../../src/engine/frameworks/prompt-guidance/service.js';
import { ChainSessionStore } from '../../../src/modules/chains/manager.js';
import { ArgumentHistoryTracker } from '../../../src/modules/text-refs/argument-history-tracker.js';
import { PromptExecutor } from '../../../src/mcp/tools/prompt-engine/core/prompt-executor.js';

const TEARDOWN = /^(shutdown|cleanup|dispose|close|destroy)$/;

function teardownMethodsOf(prototype: object): string[] {
  return Object.getOwnPropertyNames(prototype).filter(
    (name) =>
      TEARDOWN.test(name) &&
      typeof (Object.getOwnPropertyDescriptor(prototype, name) ?? {}).value === 'function'
  );
}

describe('PromptExecutor teardown', () => {
  test('the enumeration sees a teardown method where one exists (positive control)', () => {
    expect(teardownMethodsOf(ChainSessionStore.prototype)).toContain('cleanup');
  });

  test('PromptExecutor exposes no teardown method', () => {
    expect(teardownMethodsOf(PromptExecutor.prototype)).toEqual([]);
  });

  test.each([
    ['LightweightGateSystem', LightweightGateSystem],
    ['PromptGuidanceService', PromptGuidanceService],
    ['ArgumentHistoryTracker', ArgumentHistoryTracker],
  ])('%s exposes no teardown method', (_name, ctor) => {
    expect(teardownMethodsOf(ctor.prototype)).toEqual([]);
  });
});
