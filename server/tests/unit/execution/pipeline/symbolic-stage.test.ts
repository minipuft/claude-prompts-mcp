import { describe, expect, jest, test } from '@jest/globals';

import { ExecutionContext } from '../../../../dist/execution/context/execution-context.js';
import { InlineGateExtractionStage } from '../../../../dist/execution/pipeline/stages/02-inline-gate-stage.js';
import { OperatorValidationStage } from '../../../../dist/execution/pipeline/stages/03-operator-validation-stage.js';
import { SessionManagementStage } from '../../../../dist/execution/pipeline/stages/07-session-stage.js';
import { FrameworkValidator } from '../../../../dist/frameworks/framework-validator.js';

import type { ChainSessionManager } from '../../../../dist/chain-session/manager.js';
import type {
  ExecutionPlan,
  ParsedCommand,
} from '../../../../dist/execution/context/execution-context.js';
import type { ChainStepPrompt } from '../../../../dist/execution/operators/chain-operator-executor.js';
import type { FrameworkManager } from '../../../../dist/frameworks/framework-manager.js';
import type { FrameworkDefinition } from '../../../../dist/frameworks/types/index.js';
import type { Logger } from '../../../../dist/logging/index.js';

const createLogger = (): Logger => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
});

const buildFrameworkValidator = (): FrameworkValidator => {
  const logger = createLogger();
  const frameworks: Record<string, FrameworkDefinition> = {
    CAGEERF: {
      id: 'CAGEERF',
      name: 'CAGEERF',
      description: 'Default methodology',
      systemPromptTemplate: 'Default prompt',
      executionGuidelines: [],
      applicableTypes: [],
      priority: 1,
      enabled: true,
    },
    SCAMPER: {
      id: 'SCAMPER',
      name: 'SCAMPER',
      description: 'Creative framework',
      systemPromptTemplate: 'SCAMPER prompt',
      executionGuidelines: [],
      applicableTypes: [],
      priority: 2,
      enabled: true,
    },
  };

  // Create mock FrameworkManager with the methods FrameworkValidator uses
  const mockFrameworkManager = {
    getFramework: jest.fn((id: string) => frameworks[id.toUpperCase()]),
    isFrameworkEnabled: jest.fn((id: string) => {
      const fw = frameworks[id.toUpperCase()];
      return fw?.enabled ?? false;
    }),
    getFrameworkIds: jest.fn((enabledOnly: boolean) => {
      const ids = Object.keys(frameworks);
      return enabledOnly ? ids.filter((id) => frameworks[id].enabled) : ids;
    }),
    validateIdentifier: jest.fn((id: string) => {
      const normalizedId = id.trim().toUpperCase();
      const framework = frameworks[normalizedId];
      if (framework) {
        return { valid: true, normalizedId: framework.id };
      }
      return {
        valid: false,
        error: `Framework '${id}' not found`,
        suggestions: Object.keys(frameworks),
      };
    }),
  } as unknown as FrameworkManager;

  return new FrameworkValidator(mockFrameworkManager, logger);
};

const createResolver = () => ({
  resolve: jest.fn().mockImplementation(async (value: string) => ({
    referenceType: 'inline' as const,
    criteria: value.trim(),
  })),
});

const buildChainSteps = (): ChainStepPrompt[] => [
  {
    stepNumber: 1,
    promptId: 'stage_one',
    args: { topic: 'Deep Dive' },
    inlineGateCriteria: ['Use numbered lists'],
    convertedPrompt: {
      id: 'stage_one',
      name: 'Stage One',
      description: 'First step',
      category: 'analysis',
      requiresExecution: true,
      arguments: [],
      userMessageTemplate: 'Stage one {{topic}}',
      systemMessage: 'You are a careful analyst.',
    },
  },
  {
    stepNumber: 2,
    promptId: 'stage_two',
    args: { previous_step_output: '{{step1}}' },
    inlineGateCriteria: ['Summarize the research'],
    convertedPrompt: {
      id: 'stage_two',
      name: 'Stage Two',
      description: 'Second step',
      category: 'analysis',
      requiresExecution: true,
      arguments: [],
      userMessageTemplate: 'Stage two summary',
      systemMessage: 'You are a concise summarizer.',
    },
  },
];

const buildParsedCommand = (): ParsedCommand & {
  commandType: 'chain';
  steps: ChainStepPrompt[];
} => ({
  promptId: 'stage_one',
  chainId: 'chain-stage_one',
  rawArgs: 'topic="Deep Dive"',
  format: 'symbolic',
  commandType: 'chain',
  confidence: 0.92,
  metadata: {
    originalCommand:
      '@scamper >>stage_one topic="Deep Dive" :: "Use numbered lists" --> >>stage_two previous_step_output="{{step1}}" :: "Summarize the research"',
    parseStrategy: 'symbolic',
    detectedFormat: 'symbolic',
    warnings: [],
  },
  promptArgs: { topic: 'Deep Dive' },
  inlineGateCriteria: ['Maintain chain-wide clarity'],
  steps: buildChainSteps(),
  operators: {
    hasOperators: true,
    operatorTypes: ['framework'],
    operators: [
      {
        type: 'framework',
        frameworkId: 'scamper',
        normalizedId: 'scamper',
        temporary: false,
        scopeType: 'execution',
      },
    ],
    parseComplexity: 'simple',
  },
  executionPlan: {
    steps: [
      {
        stepNumber: 1,
        type: 'prompt',
        promptId: 'stage_one',
        args: 'topic="Deep Dive"',
        inlineGateCriteria: ['Use numbered lists'],
        dependencies: [],
        outputVariable: 'stage_one_result',
      },
      {
        stepNumber: 2,
        type: 'prompt',
        promptId: 'stage_two',
        args: 'previous_step_output="{{stage_one_result}}"',
        inlineGateCriteria: ['Summarize the research'],
        dependencies: [1],
        outputVariable: 'stage_two_result',
      },
    ],
    frameworkOverride: 'scamper',
    finalValidation: undefined,
    estimatedComplexity: 2,
    requiresSessionState: true,
    argumentInputs: ['topic="Deep Dive"'],
  },
});

const createTemporaryGateRegistry = () => ({
  createTemporaryGate: jest
    .fn()
    .mockReturnValueOnce('inline_command_gate')
    .mockReturnValueOnce('step_gate_1')
    .mockReturnValueOnce('step_gate_2'),
  getTemporaryGate: jest.fn().mockReturnValue(undefined),
});

const createSessionManager = (): jest.Mocked<ChainSessionManager> =>
  ({
    hasActiveSession: jest.fn().mockReturnValue(false),
    getSession: jest.fn(),
    getSessionByChainIdentifier: jest.fn(),
    getLatestSessionForBaseChain: jest.fn(),
    getRunHistory: jest.fn().mockReturnValue([]),
    createSession: jest.fn().mockResolvedValue(undefined),
    getPendingGateReview: jest.fn().mockReturnValue(undefined),
    clearSession: jest.fn(),
    cleanup: jest.fn(),
  }) as unknown as jest.Mocked<ChainSessionManager>;

describe('Symbolic pipeline coverage', () => {
  test('inline gate and operator validation stages normalize symbolic metadata', async () => {
    const logger = createLogger();
    const context = new ExecutionContext({ command: 'symbolic chain' });
    context.state.session.executionScopeId = 'exec-scope';
    context.parsedCommand = buildParsedCommand();

    const registry = createTemporaryGateRegistry();
    const inlineStage = new InlineGateExtractionStage(
      registry as any,
      createResolver() as any,
      logger
    );
    await inlineStage.execute(context);

    expect(registry.createTemporaryGate).toHaveBeenCalledTimes(3);
    expect(registry.createTemporaryGate).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        scope: 'execution',
        description: 'Inline criteria for symbolic command',
      }),
      'exec-scope:command'
    );
    expect(registry.createTemporaryGate).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        scope: 'step',
        description: 'Inline criteria for step 1',
      }),
      'exec-scope:step_1'
    );
    expect(registry.createTemporaryGate).toHaveBeenNthCalledWith(
      3,
      expect.objectContaining({
        scope: 'step',
        description: 'Inline criteria for step 2',
      }),
      'exec-scope:step_2'
    );

    expect(context.parsedCommand?.inlineGateIds).toEqual(['inline_command_gate']);
    expect(context.parsedCommand?.steps?.[0].inlineGateIds).toEqual(['step_gate_1']);
    expect(context.parsedCommand?.steps?.[1].inlineGateIds).toEqual(['step_gate_2']);
    expect(context.state.gates.temporaryGateIds).toEqual([
      'inline_command_gate',
      'step_gate_1',
      'step_gate_2',
    ]);

    const validator = buildFrameworkValidator();
    const operatorStage = new OperatorValidationStage(validator, logger);
    await operatorStage.execute(context);

    expect(context.parsedCommand?.executionPlan?.frameworkOverride).toBe('SCAMPER');
    expect(context.metadata.operatorValidation).toMatchObject({
      normalizedFrameworkOperators: 1,
    });
  });

  test('session stage stores symbolic blueprint with inline gates', async () => {
    const logger = createLogger();
    const manager = createSessionManager();
    const sessionStage = new SessionManagementStage(manager, logger);
    const dateSpy = jest.spyOn(Date, 'now').mockReturnValue(1700000000000);

    const context = new ExecutionContext({ command: 'symbolic chain' });
    context.parsedCommand = buildParsedCommand();
    context.parsedCommand.inlineGateIds = ['inline_command_gate'];
    const steps = context.parsedCommand.steps!;
    steps[0].inlineGateIds = ['step_gate_1'];
    steps[1].inlineGateIds = ['step_gate_2'];
    context.executionPlan = {
      strategy: 'chain',
      gates: ['code-quality', 'inline_command_gate'],
      requiresFramework: false,
      requiresSession: true,
      llmValidationEnabled: true,
    } as ExecutionPlan;
    context.gateInstructions = 'Apply inline gates before responding.';

    await sessionStage.execute(context);

    expect(manager.createSession).toHaveBeenCalledTimes(1);
    const [sessionId, chainId, totalSteps, promptArgs, options] =
      manager.createSession.mock.calls[0];
    expect(sessionId).toBe('review-stage_one-1700000000000');
    expect(chainId).toBe('chain-stage_one#1');
    expect(totalSteps).toBe(2);
    expect(promptArgs).toEqual({ topic: 'Deep Dive' });
    expect(options?.blueprint?.parsedCommand?.inlineGateIds).toEqual(['inline_command_gate']);
    expect(options?.blueprint?.parsedCommand?.steps?.[0].inlineGateIds).toEqual(['step_gate_1']);
    expect(options?.blueprint?.parsedCommand?.steps?.[1].inlineGateIds).toEqual(['step_gate_2']);
    expect(options?.blueprint?.executionPlan?.gates).toEqual([
      'code-quality',
      'inline_command_gate',
    ]);
    expect(options?.blueprint?.gateInstructions).toBe('Apply inline gates before responding.');

    expect(context.sessionContext).toEqual(
      expect.objectContaining({
        sessionId: 'review-stage_one-1700000000000',
        chainId: 'chain-stage_one#1',
        totalSteps: 2,
        currentStep: 1,
      })
    );
    expect(context.state.session.lifecycleDecision).toBe('create-new');

    dateSpy.mockRestore();
  });
});
