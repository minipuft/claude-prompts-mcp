import { afterEach, beforeEach, describe, expect, jest, test } from '@jest/globals';

import { ExecutionContext } from '../../../../src/engine/execution/context/execution-context.js';
import { GateEnforcementAuthority } from '../../../../src/engine/execution/pipeline/decisions/gates/gate-enforcement-authority.js';
import { GateReviewStage } from '../../../../src/engine/execution/pipeline/stages/20-gate-review-stage.js';
import { ChainSessionStore } from '../../../../src/modules/chains/manager.js';

/** A run standing on `n1` whose one review is `review` — what stage 20 reads its target off. */
const runReviewing = (review: Record<string, unknown>) => ({
  reviews: { n1: { ...review, nodeId: 'n1' } },
  state: { currentNodeId: 'n1', nodes: [] },
});

const createExecutionResult = () => ({
  stepNumber: 2,
  totalSteps: 2,
  promptId: '__gate_review__',
  promptName: 'Quality Gate Validation',
  content: 'Gate review content',
  callToAction: 'Return with GATE_REVIEW: PASS or FAIL.',
});

describe('GateReviewStage', () => {
  test('renders gate review content when pending review exists', async () => {
    const chainOperatorExecutor = {
      renderStep: jest.fn().mockResolvedValue(createExecutionResult()),
    } as any;

    const review = {
      nodeId: 'n1',
      combinedPrompt: 'Review prompt',
      gateIds: ['inline_gate_focus'],
      prompts: [],
      createdAt: Date.now(),
      attemptCount: 1,
      maxAttempts: 3,
    };
    const chainSessionStore = {
      getReview: jest.fn().mockReturnValue(review),
      getChainContext: jest.fn().mockReturnValue({ step_results: {} }),
      // The review is the one the RUN's reviews name (row 3.12), and the body is resolved against
      // the run's node list (P4 row 3.4). An empty node list exercises the parse-time fallback.
      getSession: jest.fn().mockReturnValue(runReviewing(review)),
    } as any;

    const stage = new GateReviewStage(chainOperatorExecutor, chainSessionStore, null, {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    } as any);

    const context = new ExecutionContext({ command: '>>chain' });
    context.parsedCommand = {
      steps: [{ stepNumber: 1, promptId: 'analyze', args: {} }],
    } as any;
    context.sessionContext = {
      sessionId: 'session-1',
      chainId: 'chain-1',
      isChainExecution: true,
      currentStep: 2,
      totalSteps: 2,
      pendingReview: true,
    };

    await stage.execute(context);

    expect(chainOperatorExecutor.renderStep).toHaveBeenCalledWith(
      expect.objectContaining({ executionType: 'gate_review' })
    );
    expect(context.executionResults?.content).toContain('Gate review content');
    expect(context.executionResults?.metadata?.callToAction).toContain('GATE_REVIEW');
    expect(context.sessionContext?.pendingReview).toEqual(
      expect.objectContaining({
        gateIds: ['inline_gate_focus'],
      })
    );
  });

  test('skips when no pending review data exists', async () => {
    const stage = new GateReviewStage(
      {
        renderStep: jest.fn(),
      } as any,
      {
        getReview: jest.fn().mockReturnValue(undefined),
        getChainContext: jest.fn(),
      } as any,
      null,
      { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() } as any
    );

    const context = new ExecutionContext({ command: 'noop' });
    context.sessionContext = {
      sessionId: 'session-1',
      chainId: 'chain-1',
      isChainExecution: true,
      currentStep: 1,
      totalSteps: 1,
    };

    await stage.execute(context);

    expect(context.executionResults).toBeUndefined();
  });
});

/**
 * Ruling B4: a check's result has to outlive the call that ran it.
 *
 * The verdict arrives on a LATER request, where this call's context is gone, so a result left
 * only in `shellSection` prose is a result the verdict processor cannot read — which is how a
 * model PASS came to override a recorded shell failure. The write goes onto the pending review
 * itself, and only on the path where a verdict is still owed.
 */
describe('GateReviewStage — recording check evidence on the pending review', () => {
  const failingGate = {
    id: 'test-suite',
    name: 'Test Suite',
    description: 'Runs the suite',
    pass_criteria: [{ type: 'shell_verify', shell_command: ['npm', 'test'] }],
  };

  const reminderGate = {
    id: 'code-quality',
    name: 'Code Quality',
    description: 'Reminder only',
    pass_criteria: [{ type: 'inline_guidance' }],
  };

  const createStore = (review: Record<string, unknown>) => ({
    getReview: jest.fn().mockReturnValue({ ...review, nodeId: 'n1' }),
    setPendingGateReview: jest.fn().mockResolvedValue(undefined as never),
    clearReview: jest.fn().mockResolvedValue(undefined as never),
    getChainContext: jest.fn().mockReturnValue({ step_results: {} }),
    getSession: jest.fn().mockReturnValue(runReviewing(review)),
  });

  const createContext = (review: Record<string, unknown>) => {
    const context = new ExecutionContext({ command: '>>chain' });
    context.parsedCommand = {
      steps: [{ stepNumber: 1, promptId: 'analyze', args: {} }],
    } as any;
    context.sessionContext = {
      sessionId: 'session-1',
      chainId: 'chain-1',
      isChainExecution: true,
      currentStep: 1,
      totalSteps: 1,
      pendingReview: review as any,
    };
    return context;
  };

  const logger = () =>
    ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }) as any;

  test('records the failing result and every gate tier when coverage is not satisfied', async () => {
    const review = {
      combinedPrompt: 'Review prompt',
      gateIds: ['test-suite', 'code-quality'],
      prompts: [],
      createdAt: 1,
      attemptCount: 1,
      maxAttempts: 3,
    };
    const store = createStore(review);
    const stage = new GateReviewStage(
      { renderStep: jest.fn().mockResolvedValue(createExecutionResult() as never) } as any,
      store as any,
      { loadGates: jest.fn().mockResolvedValue([failingGate, reminderGate] as never) } as any,
      logger(),
      undefined,
      {
        shellVerifyExecutor: {
          execute: jest.fn().mockResolvedValue({
            passed: false,
            exitCode: 1,
            stdout: '',
            stderr: '3 failing',
            durationMs: 12,
            command: 'npm test',
          } as never),
        } as any,
      }
    );

    const context = createContext(review);
    await stage.execute(context);

    expect(store.setPendingGateReview).toHaveBeenCalledTimes(1);
    const [sessionId, written] = store.setPendingGateReview.mock.calls[0] as [string, any];
    expect(sessionId).toBe('session-1');
    expect(written.checkResults).toEqual([
      { gateId: 'test-suite', passed: false, summary: 'npm test exit 1' },
    ]);
    expect(written.gateTiers).toEqual({ 'test-suite': 'check', 'code-quality': 'reminder' });
    // Everything else survives the re-set — the store persists what it is handed.
    expect(written.attemptCount).toBe(1);
    expect(written.combinedPrompt).toBe('Review prompt');
    // The same call renders the CTA, so the context copy must carry the evidence too.
    expect(context.sessionContext?.pendingReview?.checkResults).toEqual(written.checkResults);
  });

  test('records nothing when coverage is satisfied — the auto-clear path is untouched', async () => {
    const review = {
      combinedPrompt: 'Review prompt',
      gateIds: ['test-suite'],
      prompts: [],
      createdAt: 1,
      attemptCount: 1,
      maxAttempts: 3,
    };
    const store = createStore(review);
    const stage = new GateReviewStage(
      { renderStep: jest.fn() } as any,
      store as any,
      { loadGates: jest.fn().mockResolvedValue([failingGate] as never) } as any,
      logger(),
      undefined,
      {
        shellVerifyExecutor: {
          execute: jest.fn().mockResolvedValue({
            passed: true,
            exitCode: 0,
            stdout: 'ok',
            stderr: '',
            durationMs: 9,
            command: 'npm test',
          } as never),
        } as any,
      }
    );

    const context = createContext(review);
    await stage.execute(context);

    expect(store.clearReview).toHaveBeenCalledWith('session-1', 'n1');
    expect(store.setPendingGateReview).not.toHaveBeenCalled();
    expect(context.executionResults?.metadata?.gateReview).toEqual(
      expect.objectContaining({ autoCleared: true })
    );
  });
});

/**
 * Row 3.12: stage 20 renders the review a bare verdict answers (`resolveReviewTarget`) and, when
 * ground truth covers it, clears THAT node's review — never "the" review of the run. The store is
 * real, so two reviews are open at once: step 1's, opened FIRST, and the review of step 2, the
 * node the run stands on.
 */
describe('GateReviewStage — renders and clears the review of the node it names (row 3.12)', () => {
  const coveredGate = {
    id: 'test-suite',
    name: 'Test Suite',
    description: 'Runs the suite',
    pass_criteria: [{ type: 'shell_verify', shell_command: ['npm', 'test'] }],
  };
  const logger = () =>
    ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }) as any;
  const spies: Array<{ mockRestore: () => void }> = [];
  let store: ChainSessionStore;

  beforeEach(async () => {
    spies.push(
      jest.spyOn(ChainSessionStore.prototype as any, 'saveSessions').mockResolvedValue(undefined),
      jest.spyOn(ChainSessionStore.prototype as any, 'loadSessions').mockResolvedValue(undefined),
      jest
        .spyOn(ChainSessionStore.prototype as any, 'startCleanupScheduler')
        .mockImplementation(() => {})
    );
    store = new ChainSessionStore(logger(), { buildChainVariables: () => ({}) } as any, {
      cleanupIntervalMs: 60_000,
    });
    await store.createSession('s1', 'chain-1', 2);
    (store as any).activeSessions.get('s1').state.currentNodeId = 'n2';
    const authority = new GateEnforcementAuthority(store, logger());
    await authority.createReview('s1', 'gate', 'n1', {
      gateIds: ['step-one-gate'],
      instructions: 'Check step 1.',
    });
    await authority.createReview('s1', 'gate', 'n2', {
      gateIds: ['test-suite'],
      instructions: 'Check step 2.',
    });
  });

  afterEach(async () => {
    await store.cleanup();
    spies.splice(0).forEach((spy) => spy.mockRestore());
  });

  const contextOnStep2 = () => {
    const context = new ExecutionContext({ command: '>>chain' });
    context.parsedCommand = {
      steps: [
        { stepNumber: 1, promptId: 'draft', args: {} },
        { stepNumber: 2, promptId: 'analyze', args: {} },
      ],
    } as any;
    context.sessionContext = {
      sessionId: 's1',
      chainId: 'chain-1',
      isChainExecution: true,
      currentStep: 2,
      currentNodeId: 'n2',
      totalSteps: 2,
      pendingReview: store.getReview('s1', 'n2')!,
    };
    return context;
  };

  test('two open reviews: it renders the review of the node the run stands on', async () => {
    const renderStep = jest.fn().mockResolvedValue(createExecutionResult() as never);
    const stage = new GateReviewStage({ renderStep } as any, store, null, logger());

    const context = contextOnStep2();
    await stage.execute(context);

    const rendered = (renderStep.mock.calls[0]?.[0] as any)?.review;
    expect([rendered?.nodeId, rendered?.gateIds]).toEqual(['n2', ['test-suite']]);
    expect(context.sessionContext?.pendingReview?.nodeId).toBe('n2');
  });

  test("ground truth covering the rendered review clears only that node's review", async () => {
    const stage = new GateReviewStage(
      { renderStep: jest.fn() } as any,
      store,
      { loadGates: jest.fn().mockResolvedValue([coveredGate] as never) } as any,
      logger(),
      undefined,
      {
        shellVerifyExecutor: {
          execute: jest.fn().mockResolvedValue({
            passed: true,
            exitCode: 0,
            stdout: 'ok',
            stderr: '',
            durationMs: 9,
            command: 'npm test',
          } as never),
        } as any,
      }
    );

    const context = contextOnStep2();
    await stage.execute(context);

    // Positive control: the auto-clear path ran.
    expect(context.executionResults?.metadata?.gateReview).toEqual(
      expect.objectContaining({ autoCleared: true, gateIds: ['test-suite'] })
    );
    expect(Object.keys(store.getSession('s1')?.reviews ?? {})).toEqual(['n1']);
  });
});
