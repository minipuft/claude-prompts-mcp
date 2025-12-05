import { describe, expect, jest, test } from '@jest/globals';

import { ExecutionContext } from '../../../../src/execution/context/execution-context.js';
import { CallToActionStage } from '../../../../src/execution/pipeline/stages/11-call-to-action-stage.js';

describe('CallToActionStage', () => {
  test('suppresses CTA footer when resume info already exists', async () => {
    const stage = new CallToActionStage({
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    } as any);

    const context = new ExecutionContext({ command: 'noop' });
    context.sessionContext = {
      sessionId: 'sess-1',
      chainId: 'chain-1',
      isChainExecution: true,
      currentStep: 1,
      totalSteps: 3,
    };
    const ctaText =
      'Use the resume shortcut below to rerun prompt_engine and paste your latest answer into user_response so Step 2 can begin.';
    context.executionResults = {
      content: 'Rendered instructions',
      metadata: { callToAction: ctaText },
      generatedAt: Date.now(),
    };

    await stage.execute(context);

    const content = context.executionResults?.content ?? '';
    expect(content).toBe('Rendered instructions');
    expect(content).not.toContain('### Next Action');
  });

  test('suppresses gate_verdict CTA when pending review exists', async () => {
    const stage = new CallToActionStage({
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    } as any);

    const context = new ExecutionContext({ command: 'noop' });
    context.sessionContext = {
      sessionId: 'sess-2',
      chainId: 'chain-2',
      isChainExecution: true,
      pendingReview: {
        combinedPrompt: 'p',
        gateIds: [],
        prompts: [],
        createdAt: Date.now(),
        attemptCount: 0,
        maxAttempts: 1,
      } as any,
    };
    context.executionResults = {
      content: 'Gate review instructions',
      metadata: {},
      generatedAt: Date.now(),
    };
    const gateCTA =
      'Use the resume shortcut below and respond via gate_verdict as `GATE_REVIEW: PASS` or `GATE_REVIEW: FAIL - reason` to resume the workflow.';
    context.state.gates.reviewCallToAction = gateCTA;

    await stage.execute(context);

    const content = context.executionResults?.content ?? '';
    expect(content).toBe('Gate review instructions');
    expect(content).not.toContain('### Next Action');
    expect(context.state.gates.reviewCallToAction).toBeUndefined();
  });

  test('appends CTA footer when template emits final response instructions', async () => {
    const stage = new CallToActionStage({
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    } as any);

    const context = new ExecutionContext({ command: 'noop' });
    context.sessionContext = {
      sessionId: 'sess-3',
      chainId: 'chain-3',
      isChainExecution: true,
      currentStep: 3,
      totalSteps: 3,
    };
    context.executionResults = {
      content: 'Rendered instructions',
      metadata: { callToAction: 'Deliver the final response to the user.' },
      generatedAt: Date.now(),
    };

    await stage.execute(context);

    const content = context.executionResults?.content ?? '';
    expect(content).toContain('Chain execution complete. You may now respond to the user.');
  });

  test('skips when no CTA exists', async () => {
    const stage = new CallToActionStage({
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    } as any);

    const context = new ExecutionContext({ command: 'noop' });
    context.executionResults = {
      content: 'Rendered instructions',
      metadata: {},
      generatedAt: Date.now(),
    };

    await stage.execute(context);

    expect(context.executionResults?.content).toBe('Rendered instructions');
  });

  test('appends CTA when final chain step completes without template CTA', async () => {
    const stage = new CallToActionStage({
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    } as any);

    const context = new ExecutionContext({ command: 'noop' });
    context.sessionContext = {
      sessionId: 'sess-4',
      chainId: 'chain-4',
      isChainExecution: true,
      currentStep: 4,
      totalSteps: 4,
    };
    context.executionResults = {
      content: 'Rendered instructions',
      metadata: {},
      generatedAt: Date.now(),
    };

    await stage.execute(context);

    const content = context.executionResults?.content ?? '';
    expect(content).toContain('Chain execution complete. You may now respond to the user.');
  });
});
