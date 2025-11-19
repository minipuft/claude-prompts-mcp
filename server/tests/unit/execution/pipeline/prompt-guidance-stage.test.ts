import { describe, test, expect, beforeEach, jest } from '@jest/globals';

import { ExecutionContext } from "../../../../dist/execution/context/execution-context.js";
import { PromptGuidanceStage } from "../../../../dist/execution/pipeline/stages/06b-prompt-guidance-stage.js";
import type { PromptGuidanceService } from "../../../../dist/frameworks/prompt-guidance/index.js";
import type { ConvertedPrompt, ExecutionPlan } from "../../../../dist/types/index.js";

const createLogger = () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
});

const createConvertedPrompt = (overrides: Partial<ConvertedPrompt> = {}): ConvertedPrompt => ({
  id: 'prompt-id',
  name: 'Prompt',
  description: 'desc',
  category: 'general',
  userMessageTemplate: 'Hello {{name}}',
  arguments: [],
  ...overrides,
});

const createExecutionPlan = (overrides: Partial<ExecutionPlan> = {}): ExecutionPlan => ({
  strategy: 'prompt',
  gates: [],
  requiresFramework: true,
  requiresSession: false,
  ...overrides,
});

const createGuidanceResult = (
  prompt: ConvertedPrompt,
  overrides: Partial<ConvertedPrompt> = {}
) => ({
  originalPrompt: prompt,
  enhancedPrompt: {
    ...prompt,
    ...overrides,
  },
  activeMethodology: 'CAGEERF',
  guidanceApplied: true,
  processingTimeMs: 5,
  metadata: {
    frameworkUsed: 'CAGEERF',
    enhancementsApplied: ['system_prompt_injection'],
    confidenceScore: 0.92,
  },
});

describe('PromptGuidanceStage', () => {
  let service: jest.Mocked<PromptGuidanceService>;
  let stage: PromptGuidanceStage;

  beforeEach(() => {
    service = {
      isInitialized: jest.fn().mockReturnValue(true),
      applyGuidance: jest.fn(),
    } as unknown as jest.Mocked<PromptGuidanceService>;

    stage = new PromptGuidanceStage(service, createLogger());
  });

  test('skips when execution plan does not require frameworks', async () => {
    const context = new ExecutionContext({ command: '>>demo' });
    context.executionPlan = createExecutionPlan({ requiresFramework: false });

    await stage.execute(context);

    expect(service.applyGuidance).not.toHaveBeenCalled();
  });

  test('applies guidance to single prompts and replaces converted prompt', async () => {
    const context = new ExecutionContext({ command: '>>demo' });
    const convertedPrompt = createConvertedPrompt();
    context.executionPlan = createExecutionPlan();
    context.parsedCommand = {
      commandType: 'single',
      convertedPrompt,
    } as any;

    service.applyGuidance.mockResolvedValue(
      createGuidanceResult(convertedPrompt, {
        systemMessage: 'Use CAGEERF',
        userMessageTemplate: 'Hello {{name}}, with structure',
      }) as any
    );

    await stage.execute(context);

    expect(service.applyGuidance).toHaveBeenCalledWith(convertedPrompt, {
      includeSystemPromptInjection: true,
      includeTemplateEnhancement: true,
      frameworkOverride: undefined,
    });

    expect(context.parsedCommand?.convertedPrompt?.systemMessage).toBe('Use CAGEERF');
    expect(
      (context.metadata['promptGuidanceResults'] as Record<string, unknown>)?.[convertedPrompt.id]
    ).toBeDefined();
  });

  test('applies guidance only to chain steps requiring frameworks', async () => {
    const context = new ExecutionContext({ command: '>>chain' });
    context.executionPlan = createExecutionPlan({
      strategy: 'chain',
      requiresSession: true,
    });

    const firstStepPrompt = createConvertedPrompt({ id: 'step-one' });
    const secondStepPrompt = createConvertedPrompt({ id: 'step-two' });

    const chainSteps = [
      {
        stepNumber: 1,
        promptId: 'step-one',
        args: {},
        convertedPrompt: firstStepPrompt,
        executionPlan: createExecutionPlan({ requiresFramework: true }),
      },
      {
        stepNumber: 2,
        promptId: 'step-two',
        args: {},
        convertedPrompt: secondStepPrompt,
        executionPlan: createExecutionPlan({ requiresFramework: false }),
      },
    ];

    context.parsedCommand = {
      commandType: 'chain',
      steps: chainSteps,
    } as any;

    service.applyGuidance.mockResolvedValue(
      createGuidanceResult(firstStepPrompt, {
        systemMessage: 'Chain guidance',
      }) as any
    );

    await stage.execute(context);

    expect(service.applyGuidance).toHaveBeenCalledTimes(1);
    expect(service.applyGuidance).toHaveBeenCalledWith(firstStepPrompt, expect.any(Object));
    expect(chainSteps[0].convertedPrompt?.systemMessage).toBe('Chain guidance');
    expect(chainSteps[1].convertedPrompt?.systemMessage).toBeUndefined();
  });
});
