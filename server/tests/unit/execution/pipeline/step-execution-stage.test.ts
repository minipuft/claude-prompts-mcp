import { describe, expect, jest, test } from '@jest/globals';

import { ExecutionContext } from '../../../../src/engine/execution/context/execution-context.js';
import { StepExecutionStage } from '../../../../src/engine/execution/pipeline/stages/18-execution-stage.js';

import type { ChainSessionService } from '../../../../src/modules/chains/types.js';
import type {
  ChainOperatorExecutor,
  ChainStepRenderResult,
} from '../../../../src/engine/execution/operators/chain-operator-executor.js';
import type { Logger } from '../../../../src/infra/logging/index.js';
import type { ConvertedPrompt } from '../../../../src/shared/types/index.js';

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

/**
 * The two fields the stage reads to decide a run is over. Completion is latched on run
 * identity now (terminal runStatus, or standing past the last node), so a test cannot express
 * "finished" by pushing `currentStep` past `totalSteps` any more — that arithmetic is exactly
 * what stopped being the signal.
 */
const runState = (
  currentNodeId: string | null,
  runStatus: 'working' | 'completed' = 'working'
) => ({
  runStatus,
  state: { currentNodeId },
});

const createSessionManager = (session?: ReturnType<typeof runState>) => {
  const getChainContext = jest.fn().mockReturnValue({ memory: [] });
  const getSession = jest.fn().mockReturnValue(session);
  return {
    sessionManager: { getChainContext, getSession } as unknown as ChainSessionService,
    getChainContext,
    getSession,
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
      systemPrompt: 'Apply the C.A.G.E.E.R.F framework systematically.',
    } as any;

    await stage.execute(context);

    expect(context.executionResults?.content).toContain(
      'Apply the C.A.G.E.E.R.F framework systematically.'
    );
    expect(context.executionResults?.content).toContain('Process AI');
  });

  test('does not duplicate framework guidance when prompt system message already contains it', async () => {
    const { executor: chainExecutor } = createChainExecutor();
    const { sessionManager } = createSessionManager();
    const stage = new StepExecutionStage(chainExecutor, sessionManager, createLogger());

    const promptWithGuidance: ConvertedPrompt = {
      ...samplePrompt,
      systemMessage: 'Apply the C.A.G.E.E.R.F framework systematically before answering.',
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
    const { sessionManager } = createSessionManager(runState('n2'));
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

  test('returns completion when session-based single prompt has advanced past totalSteps', async () => {
    const { executor: chainExecutor, renderStepMock } = createChainExecutor();
    const { sessionManager } = createSessionManager(runState(null, 'completed'));
    const stage = new StepExecutionStage(chainExecutor, sessionManager, createLogger());

    // Simulates: single prompt with gateConfiguration, after gate_verdict PASS
    // advanceStep() moved currentStep from 1 → 2, totalSteps is 1
    const context = new ExecutionContext({ command: '>>demo topic="AI"' });
    context.executionPlan = {
      strategy: 'prompt',
      gates: ['workflow-preflight'],
      requiresFramework: false,
      requiresSession: true,
      llmValidationEnabled: false,
    } as any;
    context.sessionContext = {
      sessionId: 'review-demo-123',
      chainId: 'chain-demo#1',
      isChainExecution: true,
      currentStep: 2,
      totalSteps: 1,
    };
    context.parsedCommand = {
      commandType: 'single',
      convertedPrompt: samplePrompt,
      promptArgs: { topic: 'AI' },
    };

    await stage.execute(context);

    expect(renderStepMock).not.toHaveBeenCalled();
    expect(context.state.session.chainComplete).toBe(true);
    expect(context.executionResults?.content).toBe('Execution complete.');
  });

  test('does not short-circuit when session currentStep equals totalSteps (still executing)', async () => {
    const { executor: chainExecutor } = createChainExecutor();
    const { sessionManager } = createSessionManager(runState('n1'));
    const stage = new StepExecutionStage(chainExecutor, sessionManager, createLogger());

    // currentStep=1, totalSteps=1 → still needs to execute (not past total)
    const context = new ExecutionContext({ command: '>>demo topic="AI"' });
    context.executionPlan = {
      strategy: 'prompt',
      gates: ['workflow-preflight'],
      requiresFramework: false,
      requiresSession: true,
      llmValidationEnabled: false,
    } as any;
    context.sessionContext = {
      sessionId: 'review-demo-456',
      chainId: 'chain-demo#1',
      isChainExecution: true,
      currentStep: 1,
      totalSteps: 1,
    };
    context.parsedCommand = {
      commandType: 'single',
      convertedPrompt: samplePrompt,
      promptArgs: { topic: 'AI' },
    };

    await stage.execute(context);

    // Should execute the prompt, not short-circuit
    expect(context.state.session.chainComplete).not.toBe(true);
    expect(context.executionResults?.content).toContain('Process AI');
  });

  test('skips rendering and returns completion stub when chain is already complete', async () => {
    const { executor: chainExecutor, renderStepMock } = createChainExecutor();
    const { sessionManager } = createSessionManager(runState(null, 'completed'));
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

    // Session-level completion check catches this before reaching executeChainStep()
    expect(renderStepMock).not.toHaveBeenCalled();
    expect(context.state.session.chainComplete).toBe(true);
    expect(context.executionResults?.content).toBe('Execution complete.');
  });
});
