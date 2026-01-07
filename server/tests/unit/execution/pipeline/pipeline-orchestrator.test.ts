import { describe, expect, jest, test } from '@jest/globals';

import { PromptExecutionPipeline } from '../../../../src/execution/pipeline/prompt-execution-pipeline.js';

import type { ExecutionContext } from '../../../../src/execution/context/execution-context.js';
import type { PipelineStage } from '../../../../src/execution/pipeline/stage.js';
import type { Logger } from '../../../../src/logging/index.js';

// Stage order matches registerStages() in prompt-execution-pipeline.ts
// JudgeSelection runs BEFORE GateEnhancement and FrameworkResolution for two-phase judge flow
// FrameworkInjectionControl runs AFTER SessionManagement to access currentStep
const stageOrder = [
  'RequestNormalization',
  'DependencyInjection',
  'ExecutionLifecycle',
  'CommandParsing',
  'InlineGateExtraction',
  'OperatorValidation',
  'ExecutionPlanning',
  'JudgeSelection', // Moved before framework/gate stages
  'GateEnhancement', // Now runs after judge decision
  'FrameworkResolution', // Now uses clientFrameworkOverride from judge flow
  'SessionManagement',
  'FrameworkInjectionControl', // Controls injection frequency after session provides currentStep
  'PromptGuidance',
  'StepResponseCapture',
  'StepExecution',
  'GateReview',
  'CallToAction',
  'ResponseFormatting',
  'PostFormattingCleanup',
] as const;
type StageName = (typeof stageOrder)[number];

const createLogger = (): Logger => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
});

const createStage = (
  name: StageName,
  onExecute?: (context: ExecutionContext) => void | Promise<void>
): PipelineStage => ({
  name,
  execute: async (context) => {
    if (onExecute) {
      await onExecute(context);
    }
  },
});

const createPipeline = (
  overrides: Partial<Record<StageName, PipelineStage>> = {}
): { pipeline: PromptExecutionPipeline; tracker: string[] } => {
  const tracker: string[] = [];

  const wrapStage = (stage: PipelineStage): PipelineStage => ({
    name: stage.name,
    execute: async (context) => {
      tracker.push(stage.name);
      await stage.execute(context);
    },
  });

  const defaultFormattingStage = createStage('ResponseFormatting', (context) => {
    context.setResponse({
      content: [{ type: 'text', text: 'ResponseFormatting response' }],
    });
  });

  const stageInstances = stageOrder.map((name) =>
    wrapStage(
      overrides[name] ??
        (name === 'ResponseFormatting' ? defaultFormattingStage : createStage(name))
    )
  );

  // Destructuring order must match stageOrder array
  const [
    requestStage,
    dependencyStage,
    lifecycleStage,
    parsingStage,
    inlineGateStage,
    operatorValidationStage,
    planningStage,
    judgeSelectionStage, // position 8 (before gate/framework)
    gateStage, // position 9
    frameworkStage, // position 10
    sessionStage, // position 11
    frameworkInjectionControlStage, // position 12
    promptGuidanceStage, // position 13
    responseCaptureStage, // position 14
    executionStage, // position 15
    gateReviewStage, // position 16
    callToActionStage, // position 17
    formattingStage, // position 18
    postFormattingStage, // position 19
  ] = stageInstances;

  const pipeline = new PromptExecutionPipeline(
    requestStage,
    dependencyStage,
    lifecycleStage,
    parsingStage,
    inlineGateStage,
    operatorValidationStage,
    planningStage,
    null, // scriptExecutionStage (optional - null to skip)
    null, // scriptAutoExecuteStage (optional - null to skip)
    frameworkStage,
    judgeSelectionStage,
    promptGuidanceStage,
    gateStage,
    sessionStage,
    frameworkInjectionControlStage,
    responseCaptureStage,
    null, // shellVerificationStage (optional - null to skip)
    executionStage,
    gateReviewStage,
    callToActionStage,
    formattingStage,
    postFormattingStage,
    createLogger(),
    () => undefined
  );

  return { pipeline, tracker };
};

const contentText = (response: Awaited<ReturnType<PromptExecutionPipeline['execute']>>): string =>
  response.content[0]?.text ?? '';

describe('PromptExecutionPipeline orchestration', () => {
  test('runs stages sequentially until response formatting produces output', async () => {
    const { pipeline, tracker } = createPipeline();

    const response = await pipeline.execute({ command: '>>demo' });

    const expectedStages = stageOrder.slice(0, stageOrder.indexOf('ResponseFormatting') + 1);
    expect(tracker).toEqual(expectedStages);
    expect(contentText(response)).toContain('ResponseFormatting response');
  });

  test('stops execution when an earlier stage provides a response', async () => {
    const sessionStage = createStage('SessionManagement', (context) => {
      context.setResponse({
        content: [{ type: 'text', text: 'session short-circuit' }],
      });
    });

    const { pipeline, tracker } = createPipeline({
      SessionManagement: sessionStage,
    });

    const response = await pipeline.execute({ command: '>>demo ::gate' });

    const expectedStages = stageOrder.slice(0, stageOrder.indexOf('SessionManagement') + 1);
    expect(tracker).toEqual(expectedStages);
    expect(contentText(response)).toBe('session short-circuit');
  });

  test('step execution short-circuits chain runs before formatting stage', async () => {
    const parsingStage = createStage('CommandParsing', (context) => {
      context.parsedCommand = {
        commandType: 'chain',
        promptId: 'chain_prompt',
        format: 'symbolic',
        confidence: 0.8,
        metadata: {
          originalCommand: '>>chain_prompt',
          parseStrategy: 'symbolic',
          detectedFormat: 'symbolic',
          warnings: [],
        },
      } as any;
    });

    const stepExecutionStage = createStage('StepExecution', (context) => {
      context.setResponse({ content: [{ type: 'text', text: 'chain output' }] });
    });

    const { pipeline, tracker } = createPipeline({
      CommandParsing: parsingStage,
      StepExecution: stepExecutionStage,
      ResponseFormatting: createStage('ResponseFormatting'),
    });

    const response = await pipeline.execute({ command: '>>chain_prompt' });

    const expectedStages = stageOrder.slice(0, stageOrder.indexOf('StepExecution') + 1);
    expect(tracker).toEqual(expectedStages);
    expect(contentText(response)).toBe('chain output');
  });

  test('gate enhancement executes before framework resolution (for two-phase judge flow) and response formatting sees framework context', async () => {
    const gateStage = {
      name: 'GateEnhancement',
      execute: jest.fn(),
    };

    const frameworkStage = {
      name: 'FrameworkResolution',
      execute: jest.fn(async (context: ExecutionContext) => {
        context.frameworkContext = { methodology: 'CAGEERF' } as any;
      }),
    };

    const responseFormattingStage = createStage('ResponseFormatting', (context) => {
      context.setResponse({
        content: [
          { type: 'text', text: `framework:${context.frameworkContext?.methodology ?? 'none'}` },
        ],
      });
    });

    const { pipeline } = createPipeline({
      GateEnhancement: gateStage,
      FrameworkResolution: frameworkStage,
      ResponseFormatting: responseFormattingStage,
    });

    const response = await pipeline.execute({ command: '>>demo' });

    expect(gateStage.execute).toHaveBeenCalledTimes(1);
    expect(frameworkStage.execute).toHaveBeenCalledTimes(1);
    // Gate enhancement now runs BEFORE framework resolution for two-phase judge flow
    expect(gateStage.execute.mock.invocationCallOrder[0]).toBeLessThan(
      frameworkStage.execute.mock.invocationCallOrder[0]
    );
    expect(contentText(response)).toBe('framework:CAGEERF');
  });
});
