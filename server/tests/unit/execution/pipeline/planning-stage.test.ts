import { beforeEach, describe, expect, jest, test } from '@jest/globals';

import { ExecutionContext } from '../../../../src/execution/context/execution-context.js';
import { ExecutionPlanningStage } from '../../../../src/execution/pipeline/stages/04-planning-stage.js';

import type { ExecutionPlan } from '../../../../src/execution/context/execution-context.js';
import type { ExecutionPlanner } from '../../../../src/execution/planning/execution-planner.js';
import type { ConvertedPrompt } from '../../../../src/types/index.js';

const createLogger = () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
});

const basePrompt: ConvertedPrompt = {
  id: 'demo',
  name: 'Demo Prompt',
  description: 'desc',
  category: 'analysis',
  userMessageTemplate: 'Hello {{name}}',
  arguments: [],
};

const createParsedCommand = () => ({
  promptId: 'demo',
  rawArgs: '',
  format: 'symbolic',
  confidence: 0.9,
  metadata: {
    originalCommand: '>>demo',
    parseStrategy: 'symbolic',
    detectedFormat: 'symbolic',
    warnings: [],
  },
});

describe('ExecutionPlanningStage', () => {
  let planner: jest.Mocked<ExecutionPlanner>;
  let frameworkEnabled: jest.Mock<boolean, []>;
  let stage: ExecutionPlanningStage;

  beforeEach(() => {
    planner = {
      createPlan: jest.fn(),
      createChainPlan: jest.fn(),
    } as unknown as jest.Mocked<ExecutionPlanner>;
    frameworkEnabled = jest.fn().mockReturnValue(true);
    stage = new ExecutionPlanningStage(planner, frameworkEnabled, createLogger());
  });

  test('plans chain executions and aggregates step gates', async () => {
    const context = new ExecutionContext({ command: '>>chain' });
    context.parsedCommand = {
      ...createParsedCommand(),
      commandType: 'chain',
      steps: [
        {
          stepNumber: 1,
          promptId: 'step-one',
          args: {},
          convertedPrompt: { ...basePrompt, id: 'step-one' },
        },
        {
          stepNumber: 2,
          promptId: 'step-two',
          args: {},
          convertedPrompt: { ...basePrompt, id: 'step-two' },
        },
      ],
    } as any;

    const chainPlan: ExecutionPlan = {
      strategy: 'chain',
      gates: ['workflow-governance'],
      requiresFramework: false,
      requiresSession: true,
      category: 'analysis',
    };

    const stepPlanA: ExecutionPlan = {
      strategy: 'prompt',
      gates: ['code-quality'],
      requiresFramework: true,
      requiresSession: false,
      category: 'analysis',
    };
    const stepPlanB: ExecutionPlan = {
      strategy: 'prompt',
      gates: ['security-awareness'],
      requiresFramework: false,
      requiresSession: false,
      category: 'analysis',
    };

    planner.createChainPlan.mockResolvedValue({
      chainPlan,
      stepPlans: [stepPlanA, stepPlanB],
    });

    await stage.execute(context);

    expect(planner.createChainPlan).toHaveBeenCalledWith({
      parsedCommand: context.parsedCommand,
      steps: context.parsedCommand?.steps,
      frameworkEnabled: true,
      gateOverrides: {
        llmValidation: undefined,
        gates: undefined,
      },
    });
    expect(context.parsedCommand?.steps?.[0].executionPlan).toEqual(stepPlanA);
    expect(context.executionPlan?.gates).toEqual([
      'workflow-governance',
      'code-quality',
      'security-awareness',
    ]);
    expect(context.executionPlan?.requiresFramework).toBe(true);
  });

  test('plans single prompts and forwards gate overrides', async () => {
    const context = new ExecutionContext({
      command: '>>prompt',
      gates: [
        'technical-accuracy',
        { name: 'references', description: 'Ensure references included' },
      ],
    });

    context.parsedCommand = {
      ...createParsedCommand(),
      commandType: 'single',
      convertedPrompt: basePrompt,
    } as any;

    const plan: ExecutionPlan = {
      strategy: 'prompt',
      gates: ['technical-accuracy'],
      requiresFramework: true,
      requiresSession: false,
      category: 'analysis',
    };
    planner.createPlan.mockResolvedValue(plan);

    await stage.execute(context);

    expect(planner.createPlan).toHaveBeenCalledWith({
      parsedCommand: context.parsedCommand,
      convertedPrompt: basePrompt,
      frameworkEnabled: true,
      gateOverrides: {
        llmValidation: undefined,
        gates: [
          'technical-accuracy',
          { name: 'references', description: 'Ensure references included' },
        ],
      },
    });
    expect(context.executionPlan).toEqual(plan);
  });

  test('throws when parsed command lacks converted prompt and steps', async () => {
    const context = new ExecutionContext({ command: '>>oops' });
    await expect(stage.execute(context)).rejects.toThrow(
      'Parsed command requires either convertedPrompt or steps.'
    );
    expect(planner.createPlan).not.toHaveBeenCalled();
  });

  test('forwards unified gates parameter to planner', async () => {
    const context = new ExecutionContext({ command: '>>prompt' });
    context.state.gates.requestedOverrides = {
      gates: ['toxicity', 'code-quality'],
    };
    context.parsedCommand = {
      ...createParsedCommand(),
      commandType: 'single',
      convertedPrompt: basePrompt,
    } as any;

    const plan: ExecutionPlan = {
      strategy: 'prompt',
      gates: ['toxicity', 'code-quality'],
      requiresFramework: true,
      requiresSession: false,
      category: 'analysis',
    };
    planner.createPlan.mockResolvedValue(plan);

    await stage.execute(context);

    expect(planner.createPlan).toHaveBeenCalledWith({
      parsedCommand: context.parsedCommand,
      convertedPrompt: basePrompt,
      frameworkEnabled: true,
      gateOverrides: expect.objectContaining({
        gates: ['toxicity', 'code-quality'],
      }),
    });
    expect(context.executionPlan).toEqual(plan);
  });

  test('forwards unified gates parameter with mixed specification types', async () => {
    const context = new ExecutionContext({ command: '>>prompt' });
    context.state.gates.requestedOverrides = {
      gates: [
        'toxicity',
        { name: 'red-team', description: 'Confirm exfil path' },
        { id: 'gdpr-check', criteria: ['no PII'], severity: 'high' },
      ],
    };
    context.parsedCommand = {
      ...createParsedCommand(),
      commandType: 'single',
      convertedPrompt: basePrompt,
    } as any;

    const plan: ExecutionPlan = {
      strategy: 'prompt',
      gates: ['toxicity'],
      requiresFramework: true,
      requiresSession: false,
      category: 'analysis',
    };
    planner.createPlan.mockResolvedValue(plan);

    await stage.execute(context);

    expect(planner.createPlan).toHaveBeenCalledWith({
      parsedCommand: context.parsedCommand,
      convertedPrompt: basePrompt,
      frameworkEnabled: true,
      gateOverrides: expect.objectContaining({
        gates: [
          'toxicity',
          { name: 'red-team', description: 'Confirm exfil path' },
          { id: 'gdpr-check', criteria: ['no PII'], severity: 'high' },
        ],
      }),
    });
  });
});
