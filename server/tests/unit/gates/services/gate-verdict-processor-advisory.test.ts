/**
 * Row B.54: `processPendingReviewVerdict` fired the advisory and informational FAIL handlers
 * without awaiting them.
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
    advanceStep: jest.fn(async () => later(advancedTo)),
    getPendingGateReview: jest.fn(() => undefined),
    isRetryLimitExceeded: jest.fn(() => false),
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
  pendingGateReview: { gateIds: ['some-gate'], attemptCount: 1, maxAttempts: 3 },
  state: { nodes: [{ id: 'node-1' }, { id: 'node-2' }] },
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

      await processor.processPendingReviewVerdict(
        context,
        session,
        'session-1',
        0,
        'a response',
        sessionContext as never
      );

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

      await expect(
        processor.processPendingReviewVerdict(context, session, 'session-1', 0, 'a response', {
          currentStep: 0,
          currentNodeId: 'node-1',
        } as never)
      ).rejects.toThrow('chain session store is unavailable');
    });
  }
);
