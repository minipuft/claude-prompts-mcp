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

/**
 * Ruling B4: the engine's recorded check outranks the model's verdict.
 *
 * `GateReviewStage` runs a gate's `shell_verify` / `script_tool` criteria and writes the outcome
 * to `PendingGateReview.checkResults`. Before this, nothing downstream read that field — the
 * stage printed the failing command into the review, the model answered PASS, and the processor
 * cleared on the verdict alone. These tests hold the refusal in place at the point where a
 * recorded exit code would otherwise lose to an opinion.
 */
describe('GateVerdictProcessor.processPendingReviewVerdict (recorded check results)', () => {
  const createReview = (
    checkResults?: Array<{ gateId: string; passed: boolean; summary: string }>
  ) => ({
    combinedPrompt: 'review',
    gateIds: ['test-suite'],
    prompts: [],
    createdAt: Date.now(),
    attemptCount: 0,
    maxAttempts: 3,
    ...(checkResults !== undefined ? { checkResults } : {}),
  });

  const createVerdictStore = (review: ReturnType<typeof createReview>) =>
    ({
      recordGateReviewOutcome: jest.fn<() => Promise<string>>().mockResolvedValue('cleared'),
      advanceStep: jest
        .fn<() => Promise<{ ordinal: number; nodeId: string }>>()
        .mockResolvedValue({ ordinal: 2, nodeId: 'node-2' }),
      getPendingGateReview: jest.fn().mockReturnValue(review),
      clearPendingGateReview: jest.fn<() => Promise<void>>().mockResolvedValue(undefined),
      isRetryLimitExceeded: jest.fn().mockReturnValue(false),
    }) as unknown as ChainSessionService & Record<string, jest.Mock>;

  /** Context carrying only what the PASS path reads or writes, plus a response sink. */
  const createVerdictContext = (verdict: string) => {
    const responses: Array<{ isError?: boolean; content: Array<{ text: string }> }> = [];
    const context = {
      gateEnforcement: undefined,
      getGateVerdict: () => verdict,
      setResponse: (response: { isError?: boolean; content: Array<{ text: string }> }) => {
        responses.push(response);
      },
      state: { gates: {}, session: {} },
      gates: { hasBlockingGates: () => false, getBlockingGateIds: () => [] },
      diagnostics: { info: jest.fn(), warn: jest.fn(), error: jest.fn() },
      sessionContext: { sessionId: 'session-1', currentStep: 1 },
    };
    return { context: context as never, responses };
  };

  const session = (review: ReturnType<typeof createReview>) =>
    ({
      pendingGateReview: review,
      state: { nodes: [{ id: 'node-1' }, { id: 'node-2' }] },
    }) as never;

  test('refuses a PASS by name while a recorded check is failing, and does not advance', async () => {
    const review = createReview([
      { gateId: 'test-suite', passed: false, summary: 'npm test exit 1' },
    ]);
    const store = createVerdictStore(review);
    const processor = new GateVerdictProcessor(store, createLogger());
    const { context, responses } = createVerdictContext('GATE_REVIEW: PASS - looks fine to me');

    const result = await processor.processPendingReviewVerdict(
      context,
      session(review),
      'session-1',
      1,
      undefined,
      { sessionId: 'session-1' } as never
    );

    expect(result.passClearedThisCall).toBe(false);
    expect(result.earlyExit).toBe(true);
    // The review stays pending and the attempt is not spent: nothing was recorded, nothing
    // cleared, and the step did not move.
    expect(store.recordGateReviewOutcome).not.toHaveBeenCalled();
    expect(store.advanceStep).not.toHaveBeenCalled();
    expect(store.clearPendingGateReview).not.toHaveBeenCalled();

    expect(responses).toHaveLength(1);
    expect(responses[0]?.isError).toBe(true);
    const message = responses[0]?.content[0]?.text ?? '';
    expect(message).toContain('Gate verdict refused');
    expect(message).toContain('test-suite');
    expect(message).toContain('npm test exit 1');
  });

  test('a PASS over a recorded PASS advances as before', async () => {
    const review = createReview([
      { gateId: 'test-suite', passed: true, summary: 'npm test exit 0' },
    ]);
    const store = createVerdictStore(review);
    const processor = new GateVerdictProcessor(store, createLogger());
    const { context, responses } = createVerdictContext('GATE_REVIEW: PASS - suite is green');

    const result = await processor.processPendingReviewVerdict(
      context,
      session(review),
      'session-1',
      1,
      undefined,
      { sessionId: 'session-1' } as never
    );

    expect(responses).toHaveLength(0);
    expect(store.recordGateReviewOutcome).toHaveBeenCalled();
    expect(store.advanceStep).toHaveBeenCalled();
    expect(result.passClearedThisCall).toBe(true);
  });

  test('a FAIL is unaffected by a recorded failure — it agrees with the check', async () => {
    const review = createReview([
      { gateId: 'test-suite', passed: false, summary: 'npm test exit 1' },
    ]);
    const store = createVerdictStore(review);
    (store.recordGateReviewOutcome as jest.Mock).mockResolvedValue('retry' as never);
    const processor = new GateVerdictProcessor(store, createLogger());
    const { context, responses } = createVerdictContext('GATE_REVIEW: FAIL - the suite is red');

    await processor.processPendingReviewVerdict(
      context,
      session(review),
      'session-1',
      1,
      undefined,
      { sessionId: 'session-1' } as never
    );

    expect(responses).toHaveLength(0);
    expect(store.recordGateReviewOutcome).toHaveBeenCalled();
  });

  test('a review with no recorded results leaves the verdict to the model', async () => {
    const review = createReview();
    const store = createVerdictStore(review);
    const processor = new GateVerdictProcessor(store, createLogger());
    const { context, responses } = createVerdictContext('GATE_REVIEW: PASS - reminders attested');

    const result = await processor.processPendingReviewVerdict(
      context,
      session(review),
      'session-1',
      1,
      undefined,
      { sessionId: 'session-1' } as never
    );

    expect(responses).toHaveLength(0);
    expect(result.passClearedThisCall).toBe(true);
  });
});
