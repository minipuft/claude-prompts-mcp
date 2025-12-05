import { describe, expect, jest, test } from '@jest/globals';

import { ExecutionContext } from '../../../../src/execution/context/execution-context.js';
import { StepExecutionStage } from '../../../../src/execution/pipeline/stages/09-execution-stage.js';

import type { ChainSessionService } from '../../../../src/chain-session/types.js';
import type {
  ChainOperatorExecutor,
  ChainStepRenderResult,
} from '../../../../src/execution/operators/chain-operator-executor.js';
import type { Logger } from '../../../../src/logging/index.js';
import type { ConvertedPrompt } from '../../../../src/types/index.js';

const createLogger = (): Logger => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
});

const createChainExecutor = () => {
  const renderStepMock = jest.fn<Promise<ChainStepRenderResult>, any>().mockResolvedValue({
    stepNumber: 1,
    totalSteps: 1,
    promptId: 'step',
    promptName: 'Step',
    content: 'chain content',
    callToAction: 'next',
  });
  return {
    executor: { renderStep: renderStepMock } as unknown as ChainOperatorExecutor,
    renderStepMock,
  };
};

const createSessionManager = () => {
  const getChainContext = jest.fn().mockReturnValue({ memory: [] });
  return {
    sessionManager: { getChainContext } as unknown as ChainSessionService,
    getChainContext,
  };
};

const samplePrompt: ConvertedPrompt = {
  id: 'demo',
  name: 'Demo',
  description: '',
  category: 'analysis',
  userMessageTemplate: 'Process {{topic}}',
  systemMessage: '',
  arguments: [],
};

describe('StepExecutionStage', () => {
  test('renders single prompts with framework system prompt when not already present', async () => {
    const { executor: chainExecutor } = createChainExecutor();
    const { sessionManager } = createSessionManager();
    const stage = new StepExecutionStage(chainExecutor, sessionManager, createLogger());

    const context = new ExecutionContext({ command: '>>demo topic="AI"' });
    context.executionPlan = {
      strategy: 'prompt',
      gates: ['quality'],
      requiresFramework: true,
      requiresSession: false,
      llmValidationEnabled: false,
    } as any;
    context.parsedCommand = {
      commandType: 'single',
      convertedPrompt: samplePrompt,
      promptArgs: { topic: 'AI' },
    };
    context.frameworkContext = {
      systemPrompt: 'Apply the C.A.G.E.E.R.F methodology systematically.',
    } as any;

    await stage.execute(context);

    expect(context.executionResults?.content).toContain(
      'Apply the C.A.G.E.E.R.F methodology systematically.'
    );
    expect(context.executionResults?.content).toContain('Process AI');
  });

  test('does not duplicate framework guidance when prompt system message already contains it', async () => {
    const { executor: chainExecutor } = createChainExecutor();
    const { sessionManager } = createSessionManager();
    const stage = new StepExecutionStage(chainExecutor, sessionManager, createLogger());

    const promptWithGuidance: ConvertedPrompt = {
      ...samplePrompt,
      systemMessage: 'Apply the C.A.G.E.E.R.F methodology systematically before answering.',
    };

    const context = new ExecutionContext({ command: '>>demo topic="AI"' });
    context.executionPlan = {
      strategy: 'prompt',
      gates: [],
      requiresFramework: true,
      requiresSession: false,
      llmValidationEnabled: false,
    } as any;
    context.parsedCommand = {
      commandType: 'single',
      convertedPrompt: promptWithGuidance,
      promptArgs: { topic: 'AI' },
    };
    context.frameworkContext = {
      systemPrompt: 'Framework block should be skipped',
    } as any;

    await stage.execute(context);

    expect(context.executionResults?.content).toContain(promptWithGuidance.systemMessage);
    expect(context.executionResults?.content).not.toContain('Framework block should be skipped');
  });

  test('executes chain steps using session state and chain executor', async () => {
    const { executor: chainExecutor, renderStepMock } = createChainExecutor();
    const { sessionManager } = createSessionManager();
    const stage = new StepExecutionStage(chainExecutor, sessionManager, createLogger());

    const context = new ExecutionContext({ command: '>>chain' });
    context.executionPlan = {
      strategy: 'chain',
      gates: ['quality'],
      requiresFramework: true,
      requiresSession: true,
      llmValidationEnabled: false,
    } as any;
    context.sessionContext = {
      sessionId: 'sess-1',
      chainId: 'chain-1',
      isChainExecution: true,
      currentStep: 2,
      totalSteps: 3,
    };
    context.parsedCommand = {
      commandType: 'chain',
      steps: [
        {
          stepNumber: 1,
          promptId: 'step_one',
          args: { topic: 'first' },
          convertedPrompt: { ...samplePrompt, id: 'step_one' },
        },
        {
          stepNumber: 2,
          promptId: 'step_two',
          args: { topic: 'second' },
          convertedPrompt: { ...samplePrompt, id: 'step_two' },
        },
      ],
    };

    const renderResult: ChainStepRenderResult = {
      stepNumber: 2,
      totalSteps: 3,
      promptId: 'step_two',
      promptName: 'Step Two',
      content: 'rendered chain step',
      callToAction: 'Proceed to review',
    };
    renderStepMock.mockResolvedValueOnce(renderResult);

    await stage.execute(context);

    expect(renderStepMock).toHaveBeenCalledTimes(1);
    const renderArgs = renderStepMock.mock.calls[0][0];
    expect(renderArgs.executionType).toBe('normal');
    expect(renderArgs.currentStepIndex).toBe(1);
    expect(renderArgs.additionalGateIds).toEqual(['quality']);
    expect(context.executionResults?.content).toBe('rendered chain step');
  });

  test('skips rendering and returns completion stub when chain is already complete', async () => {
    const { executor: chainExecutor, renderStepMock } = createChainExecutor();
    const { sessionManager } = createSessionManager();
    const stage = new StepExecutionStage(chainExecutor, sessionManager, createLogger());

    const context = new ExecutionContext({ command: '>>chain' });
    context.executionPlan = {
      strategy: 'chain',
      gates: ['quality'],
      requiresFramework: true,
      requiresSession: true,
      llmValidationEnabled: false,
    } as any;
    context.sessionContext = {
      sessionId: 'sess-2',
      chainId: 'chain-2',
      isChainExecution: true,
      currentStep: 4,
      totalSteps: 3,
    };
    context.parsedCommand = {
      commandType: 'chain',
      steps: [
        {
          stepNumber: 1,
          promptId: 'step_one',
          args: { topic: 'first' },
          convertedPrompt: { ...samplePrompt, id: 'step_one' },
        },
        {
          stepNumber: 2,
          promptId: 'step_two',
          args: { topic: 'second' },
          convertedPrompt: { ...samplePrompt, id: 'step_two' },
        },
        {
          stepNumber: 3,
          promptId: 'step_three',
          args: { topic: 'third' },
          convertedPrompt: { ...samplePrompt, id: 'step_three' },
        },
      ],
    };

    await stage.execute(context);

    expect(renderStepMock).not.toHaveBeenCalled();
    expect(context.state.session.chainComplete).toBe(true);
    expect(typeof context.executionResults?.content).toBe('string');
    expect(context.executionResults?.metadata).toMatchObject({
      promptId: 'chain-complete',
      totalSteps: 3,
    });
  });
});
