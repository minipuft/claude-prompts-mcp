import { describe, expect, jest, test } from '@jest/globals';

import { ExecutionContext } from '../../../../src/engine/execution/context/execution-context.js';
import { GateReviewStage } from '../../../../src/engine/execution/pipeline/stages/20-gate-review-stage.js';

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

    const chainSessionStore = {
      getPendingGateReview: jest.fn().mockReturnValue({
        combinedPrompt: 'Review prompt',
        gateIds: ['inline_gate_focus'],
        prompts: [],
        createdAt: Date.now(),
        attemptCount: 1,
        maxAttempts: 3,
      }),
      getChainContext: jest.fn().mockReturnValue({ step_results: {} }),
      // The review body is resolved against the RUN's node list now (P4 row 3.4), so the double
      // has to answer for the run. `undefined` is a real answer — a formatter-only harness with
      // no session — and exercises the projection's parse-time fallback.
      getSession: jest.fn().mockReturnValue(undefined),
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
        getPendingGateReview: jest.fn().mockReturnValue(undefined),
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
    getPendingGateReview: jest.fn().mockReturnValue(review),
    setPendingGateReview: jest.fn().mockResolvedValue(undefined as never),
    clearPendingGateReview: jest.fn().mockResolvedValue(undefined as never),
    getChainContext: jest.fn().mockReturnValue({ step_results: {} }),
    getSession: jest.fn().mockReturnValue(undefined),
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

    expect(store.clearPendingGateReview).toHaveBeenCalledWith('session-1');
    expect(store.setPendingGateReview).not.toHaveBeenCalled();
    expect(context.executionResults?.metadata?.gateReview).toEqual(
      expect.objectContaining({ autoCleared: true })
    );
  });
});
