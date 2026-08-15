import { beforeEach, describe, expect, jest, test } from '@jest/globals';

import { GateVerdictProcessor } from '../../../../src/engine/gates/services/gate-verdict-processor.js';

import type { Logger } from '../../../../src/infra/logging/index.js';
import type { ChainSessionService } from '../../../../src/shared/types/index.js';

/**
 * `handleGateAction` has two branches: it delegates to GateEnforcementAuthority when
 * `context.gateEnforcement` is present, and falls back to direct store calls when it is not.
 * The authority branch is covered in gate-enforcement-authority.test.ts; nothing covered the
 * fallback, so abort could regress there while the suite stayed green.
 */

const createLogger = (): Logger =>
  ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }) as unknown as Logger;

const createStore = () =>
  ({
    resetRetryCount: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    clearPendingGateReview: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    cancelChain: jest.fn<() => Promise<boolean>>().mockResolvedValue(true),
  }) as unknown as ChainSessionService & {
    resetRetryCount: jest.Mock;
    clearPendingGateReview: jest.Mock;
    cancelChain: jest.Mock;
  };

/** Minimal context carrying only what the fallback branch reads or writes. */
const createContext = () =>
  ({
    // Absent on purpose — this is what selects the fallback branch.
    gateEnforcement: undefined,
    state: {
      gates: {
        retryLimitExceeded: true,
        awaitingUserChoice: true,
        retryExhaustedGateIds: ['some-gate'],
      },
      session: {} as { aborted?: boolean },
    },
    diagnostics: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
  }) as never;

describe('GateVerdictProcessor.handleGateAction (no enforcement authority)', () => {
  let store: ReturnType<typeof createStore>;
  let processor: GateVerdictProcessor;

  beforeEach(() => {
    jest.clearAllMocks();
    store = createStore();
    processor = new GateVerdictProcessor(store, createLogger());
  });

  test('abort cancels the run, not just the in-memory flag', async () => {
    const context = createContext();

    const earlyExit = await processor.handleGateAction(context, 'session-1', 'abort', {} as never);

    expect(earlyExit).toBe(true);
    expect(store.cancelChain).toHaveBeenCalledWith('session-1');
    expect(
      (context as never as { state: { session: { aborted?: boolean } } }).state.session.aborted
    ).toBe(true);
  });

  test('retry and skip leave the run alive', async () => {
    await processor.handleGateAction(createContext(), 'session-1', 'retry', {} as never);
    await processor.handleGateAction(createContext(), 'session-1', 'skip', {} as never);

    expect(store.resetRetryCount).toHaveBeenCalledWith('session-1');
    expect(store.clearPendingGateReview).toHaveBeenCalledWith('session-1');
    expect(store.cancelChain).not.toHaveBeenCalled();
  });
});
