import { describe, expect, jest, test } from '@jest/globals';

import { PromptExecutionPipeline } from '../../../../src/engine/execution/pipeline/prompt-execution-pipeline.js';

import type { ExecutionContext } from '../../../../src/engine/execution/context/execution-context.js';
import type { PipelineStage } from '../../../../src/engine/execution/pipeline/stage.js';
import type { Logger } from '../../../../src/infra/logging/index.js';

// Stage order matches the array PipelineBuilder.build() hands the constructor.
// Optional stages (ScriptExecution, ScriptAutoExecute, ShellVerification,
// PhaseGuardVerification) are omitted — this suite asserts sequencing and
// short-circuit behaviour, neither of which depends on them.
const stageOrder = [
  'RequestNormalization',
  'ExecutionLifecycle',
  'IdentityResolution',
  'CommandParsing',
  'InlineGateExtraction',
  'OperatorValidation',
  'ExecutionPlanning',
  'JudgeSelection', // before framework/gate stages, for the two-phase judge flow
  'GateEnhancement', // after the judge decision
  'FrameworkResolution', // after the judge decision, so %judge returns an uninjected menu
  'SessionManagement', // populates currentStep
  'InjectionControl', // needs currentStep; writes state.injection
  'PromptGuidance', // reads state.injection
  'StepResponseCapture',
  'StepExecution',
  'GateReview',
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

  const pipeline = new PromptExecutionPipeline(stageInstances, {
    logger: createLogger(),
    metricsProvider: () => undefined,
  });

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
        context.frameworkContext = { framework: 'CAGEERF' } as any;
      }),
    };

    const responseFormattingStage = createStage('ResponseFormatting', (context) => {
      context.setResponse({
        content: [
          { type: 'text', text: `framework:${context.frameworkContext?.framework ?? 'none'}` },
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

describe('PromptExecutionPipeline stage-order enforcement', () => {
  const declared = (
    name: string,
    declarations: Pick<PipelineStage, 'provides' | 'requires'>
  ): PipelineStage => ({
    name,
    ...declarations,
    execute: async () => undefined,
  });

  const session = declared('SessionManagement', { provides: ['sessionContext.currentStep'] });
  const injection = declared('InjectionControl', { requires: ['sessionContext.currentStep'] });

  test('constructs when a declared requirement is met by an earlier stage', () => {
    expect(
      () => new PromptExecutionPipeline([session, injection], { logger: createLogger() })
    ).not.toThrow();
  });

  test('throws when a declared requirement is produced by a later stage', () => {
    expect(
      () => new PromptExecutionPipeline([injection, session], { logger: createLogger() })
    ).toThrow(/InjectionControl requires "sessionContext\.currentStep"/);
  });

  test('the throw names the count and the producing stage, so the fix is the message', () => {
    expect(
      () => new PromptExecutionPipeline([injection, session], { logger: createLogger() })
    ).toThrow(/1 declared ordering constraint\(s\)[\s\S]*SessionManagement at index 1/);
  });
});
