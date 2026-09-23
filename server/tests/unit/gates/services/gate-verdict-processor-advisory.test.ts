/**
 * Row B.54: the pending-review verdict path fired the advisory and informational FAIL handlers
 * without awaiting them (the path is `processReviewVerdict` since row 3.3).
 *
 * The `cleared` branch three lines above awaits everything it does. The FAIL branch did not, so
 * `clearPendingGateReview` and `advanceStep` — both state mutations — and the `sessionContext`
 * writes that follow them ran after `context.sessionContext = { ...sessionContext }` had already
 * snapshotted the value the response is built from. The caller reported the run still sitting on
 * the step it had in fact moved off, and any failure in either mutation was dropped with nothing
 * logged.
 *
 * Classification: Unit (one processor, stubbed store and context).
 */

import { beforeEach, describe, expect, jest, test } from '@jest/globals';

import { GateVerdictProcessor } from '../../../../src/engine/gates/services/gate-verdict-processor.js';

import type { Logger } from '../../../../src/infra/logging/index.js';
import type { ChainSession, ChainSessionService } from '../../../../src/shared/types/index.js';

const createLogger = (): Logger =>
  ({
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  }) as unknown as Logger;

/**
 * Every mutation resolves on a later microtask turn. A handler that is awaited still observes
 * them in order; one that is fired and forgotten does not — which is the whole difference.
 */
const later = <T>(value: T): Promise<T> =>
  new Promise((resolve) => setTimeout(() => resolve(value), 0));

function createStore(advancedTo: { ordinal: number; nodeId: string }) {
  return {
    recordGateReviewOutcome: jest.fn(async () => later('recorded')),
    clearPendingGateReview: jest.fn(async () => later(undefined)),
    setReview: jest.fn(async () => later(undefined)),
    advanceStep: jest.fn(async () => later(advancedTo)),
  } as unknown as ChainSessionService & Record<string, jest.Mock>;
}

function createContext(enforcementMode: 'advisory' | 'informational') {
  return {
    getGateVerdict: () => 'GATE_REVIEW: FAIL - it did not hold',
    gateEnforcement: undefined,
    setResponse: jest.fn(),
    state: {
      gates: {
        enforcementMode,
        advisoryWarnings: [] as string[],
      },
      session: {},
    },
    diagnostics: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
    sessionContext: undefined as unknown,
  } as never;
}

const session = {
  sessionId: 'session-1',
  reviews: {
    'node-1': {
      nodeId: 'node-1',
      kind: 'gate',
      phase: 'awaiting-verdict',
      combinedPrompt: '',
      gateIds: ['some-gate'],
      prompts: [],
      createdAt: 1,
      attemptCount: 1,
      maxAttempts: 3,
    },
  },
  state: { currentNodeId: 'node-1', nodes: [{ id: 'node-1' }, { id: 'node-2' }] },
} as unknown as ChainSession;

describe.each(['advisory', 'informational'] as const)(
  'GateVerdictProcessor %s FAIL',
  (enforcementMode) => {
    let store: ReturnType<typeof createStore>;
    let processor: GateVerdictProcessor;

    beforeEach(() => {
      jest.clearAllMocks();
      store = createStore({ ordinal: 1, nodeId: 'node-2' });
      processor = new GateVerdictProcessor(store, createLogger());
    });

    test('the step advance reaches the context the response is built from', async () => {
      const context = createContext(enforcementMode);
      const sessionContext = {
        currentStep: 0,
        currentNodeId: 'node-1',
        pendingReview: { gateIds: ['some-gate'] },
      };

      const result = await processor.processReviewVerdict(
        context,
        session,
        sessionContext as never,
        'a response'
      );

      // P4.89 moved WHERE the advance happens, not whether its effect is observable: it is
      // decided here and applied by the stage once the step has been captured and announced.
      expect(store.advanceStep).not.toHaveBeenCalled();
      expect(result.deferredAdvance?.reason).toBe(`${enforcementMode}-fail`);

      await processor.applyDeferredAdvance(context, result.deferredAdvance!);

      // Positive control: the mutations this test measures were actually reached.
      expect(store.advanceStep).toHaveBeenCalled();
      expect(store.clearPendingGateReview).toHaveBeenCalled();

      const snapshot = (context as never as { sessionContext: Record<string, unknown> })
        .sessionContext;
      expect(snapshot.currentStep).toBe(1);
      expect(snapshot.currentNodeId).toBe('node-2');
      expect(snapshot.pendingReview).toBeUndefined();
    });

    test('a failure to advance the step propagates instead of vanishing', async () => {
      const context = createContext(enforcementMode);
      (store.advanceStep as jest.Mock).mockImplementation(async () => {
        throw new Error('chain session store is unavailable');
      });

      const result = await processor.processReviewVerdict(
        context,
        session,
        { currentStep: 0, currentNodeId: 'node-1' } as never,
        'a response'
      );

      await expect(
        processor.applyDeferredAdvance(context, result.deferredAdvance!)
      ).rejects.toThrow('chain session store is unavailable');
    });
  }
);
