import { beforeEach, describe, expect, jest, test } from '@jest/globals';

import { GateVerdictProcessor } from '../../../../src/engine/gates/services/gate-verdict-processor.js';

import type { Logger } from '../../../../src/infra/logging/index.js';
import type { ChainSession, ChainSessionService } from '../../../../src/shared/types/index.js';

/**
 * `handleGateAction` answers the step review's exhaustion. `retry` and `skip` are events on the
 * review, applied through the processor's one review path (`advanceReview`, row 3.3), with or
 * without an enforcement authority on the context; `abort` cancels the RUN. A skip accepts the
 * answer the step holds and returns the advance past it (R24), and is refused on a step that holds
 * none.
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
    setReview: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    clearReview: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
    cancelChain: jest.fn<(sessionId: string) => Promise<boolean>>().mockResolvedValue(true),
    isStepComplete: jest.fn<() => boolean>().mockReturnValue(true),
    getChainContext: jest.fn(() => ({ step_results: { 1: 'step 1 answer' } })),
  }) as unknown as ChainSessionService & {
    setReview: jest.Mock;
    clearReview: jest.Mock;
    isStepComplete: jest.Mock<() => boolean>;
    cancelChain: jest.Mock<(sessionId: string) => Promise<boolean>>;
  };

/** A run standing on `n1`, whose review of `n1` stands in `phase`. */
const sessionWith = (phase: 'exhausted' | 'awaiting-verdict') =>
  ({
    sessionId: 'session-1',
    state: { currentNodeId: 'n1', nodes: [{ id: 'n1' }, { id: 'n2' }] },
    reviews: {
      n1: {
        nodeId: 'n1',
        kind: 'gate',
        phase,
        combinedPrompt: '',
        gateIds: ['some-gate'],
        prompts: [],
        createdAt: 1,
        attemptCount: phase === 'exhausted' ? 2 : 1,
        maxAttempts: 2,
      },
    },
  }) as unknown as ChainSession;

/** Minimal context carrying only what `handleGateAction` reads or writes. */
const createContext = () =>
  ({
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
    setResponse: jest.fn(),
    getScopeOptions: () => ({}),
  }) as never;

describe('GateVerdictProcessor.handleGateAction', () => {
  let store: ReturnType<typeof createStore>;
  let processor: GateVerdictProcessor;

  beforeEach(() => {
    jest.clearAllMocks();
    store = createStore();
    processor = new GateVerdictProcessor(store, createLogger());
  });

  test('abort cancels the run, not just the in-memory flag', async () => {
    const context = createContext();

    const advance = await processor.handleGateAction(
      context,
      sessionWith('exhausted'),
      'abort',
      {} as never
    );

    expect(advance).toBeUndefined();
    expect(store.cancelChain).toHaveBeenCalledWith('session-1');
    expect(
      (context as never as { state: { session: { aborted?: boolean } } }).state.session.aborted
    ).toBe(true);
  });

  test('abort still takes the abort exit when the run is already terminal', async () => {
    // cancelChain refuses completed/failed runs. The run is over either way.
    store.cancelChain.mockResolvedValue(false);
    const context = createContext();

    expect(
      await processor.handleGateAction(context, sessionWith('exhausted'), 'abort', {} as never)
    ).toBeUndefined();
    expect(
      (context as never as { state: { session: { aborted?: boolean } } }).state.session.aborted
    ).toBe(true);
  });

  test('retry reopens the exhausted review with its counter reset and decides no advance', async () => {
    const advance = await processor.handleGateAction(
      createContext(),
      sessionWith('exhausted'),
      'retry',
      { sessionId: 'session-1' } as never
    );
    expect(store.setReview).toHaveBeenCalledWith(
      'session-1',
      expect.objectContaining({ nodeId: 'n1', attemptCount: 0, phase: 'awaiting-verdict' })
    );
    expect(advance).toBeUndefined();
  });

  test('skip clears the review and returns the advance past the answered step (R24)', async () => {
    const advance = await processor.handleGateAction(
      createContext(),
      sessionWith('exhausted'),
      'skip',
      { sessionId: 'session-1' } as never
    );
    expect(store.clearReview).toHaveBeenCalledWith('session-1', 'n1');
    expect(store.cancelChain).not.toHaveBeenCalled();
    expect(advance).toEqual({ sessionId: 'session-1', nodeId: 'n1', reason: 'gate-skip' });
  });

  test('TWIN: skip on a step that holds no answer is refused by name and records nothing', async () => {
    store.isStepComplete.mockReturnValue(false);
    const context = createContext();

    const advance = await processor.handleGateAction(context, sessionWith('exhausted'), 'skip', {
      sessionId: 'session-1',
    } as never);

    expect(advance).toBeUndefined();
    expect(store.clearReview).not.toHaveBeenCalled();
    expect(
      (context as never as { setResponse: jest.Mock }).setResponse.mock.calls[0]?.[0]
    ).toMatchObject({
      isError: true,
      content: [
        { text: expect.stringContaining('nothing to skip past on step 1; answer it first') },
      ],
    });
  });

  test('CONTROL: a review that is not exhausted refuses the action and records nothing', async () => {
    const context = createContext();

    await processor.handleGateAction(context, sessionWith('awaiting-verdict'), 'retry', {
      sessionId: 'session-1',
    } as never);

    expect(store.setReview).not.toHaveBeenCalled();
    expect(
      (context as never as { setResponse: jest.Mock }).setResponse.mock.calls[0]?.[0]
    ).toMatchObject({ isError: true });
  });
});
