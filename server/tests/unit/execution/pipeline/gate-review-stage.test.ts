import { describe, expect, jest, test } from '@jest/globals';

import { ExecutionContext } from '../../../../src/execution/context/execution-context.js';
import { GateReviewStage } from '../../../../src/execution/pipeline/stages/10-gate-review-stage.js';

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

    const chainSessionManager = {
      getPendingGateReview: jest.fn().mockReturnValue({
        combinedPrompt: 'Review prompt',
        gateIds: ['inline_gate_focus'],
        prompts: [],
        createdAt: Date.now(),
        attemptCount: 1,
        maxAttempts: 3,
      }),
      getChainContext: jest.fn().mockReturnValue({ step_results: {} }),
    } as any;

    const stage = new GateReviewStage(chainOperatorExecutor, chainSessionManager, {
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
    expect(context.state.gates.reviewCallToAction).toContain('GATE_REVIEW');
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
