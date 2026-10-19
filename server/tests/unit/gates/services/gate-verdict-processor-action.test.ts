import { beforeEach, describe, expect, jest, test } from '@jest/globals';

import { GateVerdictProcessor } from '../../../../src/engine/gates/services/gate-verdict-processor.js';
import { PromptRequestContext } from '../../../../src/engine/execution/context/prompt-request-context.js';

import type { Logger } from '../../../../src/infra/logging/index.js';
import type { ChainSession, ChainSessionService } from '../../../../src/shared/types/index.js';

/**
 * `handleGateAction` answers the step review's exhaustion. `retry` and `skip` are events on the
 * review, applied through the processor's one review path (`advanceReview`, row 3.3), with or
 * without an enforcement authority on the context. Run-level abort exits before this service.
 * A skip accepts the answer the step holds and returns the advance past it (R24), and is refused
 * on a step that holds
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
const sessionWith = (phase: 'exhausted' | 'awaiting-verdict', kind: 'gate' | 'detached' = 'gate') =>
  ({
    sessionId: 'session-1',
    state: { currentNodeId: 'n1', nodes: [{ id: 'n1' }, { id: 'n2' }] },
    reviews: {
      n1: {
        nodeId: 'n1',
        kind,
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

/** Real admission getters, with the exhausted review's existing action flags. */
const createContext = () => {
  const context = new PromptRequestContext({ chain_id: 'chain-review#1' }, createLogger());
  context.state.gates.retryLimitExceeded = true;
  context.state.gates.awaitingUserChoice = true;
  context.state.gates.retryExhaustedGateIds = ['some-gate'];
  jest.spyOn(context, 'setResponse');
  return context;
};

describe('GateVerdictProcessor.handleGateAction', () => {
  let store: ReturnType<typeof createStore>;
  let processor: GateVerdictProcessor;

  beforeEach(() => {
    jest.clearAllMocks();
    store = createStore();
    processor = new GateVerdictProcessor(store, createLogger());
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
    expect(store.cancelChain).not.toHaveBeenCalled();
  });

  test.each(['retry', 'skip'] as const)(
    'detached %s resolves only its addressed review',
    async (action) => {
      const result = await processor.processDetachedReviewAction(
        createContext(),
        sessionWith('exhausted', 'detached'),
        'n1',
        action
      );

      expect(result).toMatchObject({
        kind: 'recorded',
        result: action === 'retry' ? 'retry' : 'skipped',
      });
      if (action === 'retry') {
        expect(store.setReview).toHaveBeenCalledWith(
          'session-1',
          expect.objectContaining({ nodeId: 'n1', attemptCount: 0, phase: 'awaiting-replacement' })
        );
        expect(store.clearReview).not.toHaveBeenCalled();
      } else {
        expect(store.clearReview).toHaveBeenCalledWith('session-1', 'n1');
        expect(store.setReview).not.toHaveBeenCalled();
      }
      expect(store.cancelChain).not.toHaveBeenCalled();
    }
  );

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
