import { describe, expect, jest, test } from '@jest/globals';

import { ExecutionContext } from '../../../../src/execution/context/execution-context.js';
import { CallToActionStage } from '../../../../src/execution/pipeline/stages/11-call-to-action-stage.js';

describe('CallToActionStage', () => {
  test('appends CTA footer with user_response hint for in-progress chains', async () => {
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
    expect(content).toContain('Rendered instructions');
    expect(content).toContain('### Next Action - reply via `user_response`');
    expect(content).toContain(ctaText);
  });

  test('annotates heading with gate_verdict when pending review exists', async () => {
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
    context.metadata['gateReviewCallToAction'] = gateCTA;

    await stage.execute(context);

    const content = context.executionResults?.content ?? '';
    expect(content).toContain('### Next Action - reply via `gate_verdict`');
    expect(content).toContain('respond via gate_verdict as `GATE_REVIEW: PASS`');
  });

  test('skips CTA footer for final response instructions', async () => {
    const stage = new CallToActionStage({
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    } as any);

    const context = new ExecutionContext({ command: 'noop' });
    context.executionResults = {
      content: 'Rendered instructions',
      metadata: { callToAction: 'Deliver the final response to the user.' },
      generatedAt: Date.now(),
    };

    await stage.execute(context);

    expect(context.executionResults?.content).toBe('Rendered instructions');
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
});
