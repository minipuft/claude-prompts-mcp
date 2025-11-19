import { describe, expect, jest, test } from '@jest/globals';

import { ExecutionContext } from '../../../../src/execution/context/execution-context.js';
import { GateEnhancementStage } from '../../../../src/execution/pipeline/stages/05-gate-enhancement-stage.js';
import type { IGateService } from '../../../../src/gates/services/gate-service-interface.js';
import type { TemporaryGateRegistry } from '../../../../src/gates/core/temporary-gate-registry.js';
import type { Logger } from '../../../../src/logging/index.js';
import type { ConvertedPrompt } from '../../../../src/types/index.js';

const createLogger = (): Logger => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
});

const baseFrameworkConfig = {
  enableSystemPromptInjection: true,
  enableMethodologyGates: true,
  enableDynamicToolDescriptions: true,
};

const createGateService = () => {
  return {
    serviceType: 'compositional' as const,
    supportsValidation: jest.fn().mockReturnValue(false),
    updateConfig: jest.fn(),
    enhancePrompt: jest.fn(async (prompt: ConvertedPrompt, gateIds: string[]) => ({
      enhancedPrompt: {
        ...prompt,
        userMessageTemplate: `${prompt.userMessageTemplate}\n\nGuidance: ${gateIds.join(',')}`,
      },
      gateInstructionsInjected: true,
      injectedGateIds: gateIds,
      validationResults: [],
      instructionLength: gateIds.join(',').length,
    })),
  } satisfies IGateService;
};

const samplePrompt: ConvertedPrompt = {
  id: 'demo',
  name: 'Demo',
  description: '',
  category: 'analysis',
  userMessageTemplate: 'Hello World',
  arguments: [],
};

describe('GateEnhancementStage', () => {
  test('injects inline + temporary gates for single prompts and stores instructions', async () => {
    const gateService = createGateService();
    const temporaryRegistry = {
      createTemporaryGate: jest.fn().mockReturnValue('temp_gate_custom'),
    } as unknown as TemporaryGateRegistry;

    const stage = new GateEnhancementStage(
      gateService,
      temporaryRegistry,
      () => baseFrameworkConfig,
      createLogger()
    );

    const context = new ExecutionContext({
      command: '>>demo',
      temporary_gates: [
        {
          name: 'Custom check',
          type: 'quality',
          scope: 'execution',
          guidance: 'Ensure clarity',
          description: 'Custom guidance',
        } as any,
      ],
    });
    context.executionPlan = {
      strategy: 'prompt',
      gates: ['quality'],
      requiresFramework: false,
      requiresSession: false,
      apiValidationEnabled: false,
      category: 'analysis',
    } as any;
    context.parsedCommand = {
      commandType: 'single',
      convertedPrompt: samplePrompt,
      inlineGateIds: ['inline_gate'],
    };

    await stage.execute(context);

    expect(gateService.enhancePrompt).toHaveBeenCalledTimes(1);
    const gateIdsPassed = (gateService.enhancePrompt as jest.Mock).mock.calls[0][1];
    expect(gateIdsPassed).toEqual(expect.arrayContaining(['quality', 'inline_gate', 'temp_gate_custom']));
    expect(context.executionPlan?.gates).toEqual(expect.arrayContaining(['temp_gate_custom']));
    expect(context.metadata['temporaryGateIds']).toEqual(expect.arrayContaining(['temp_gate_custom']));
    expect(context.gateInstructions).toContain('Guidance:');
  });

  test('filters methodology gates when disabled in framework config', async () => {
    const gateService = createGateService();
    const stage = new GateEnhancementStage(
      gateService,
      undefined,
      () => ({
        ...baseFrameworkConfig,
        enableMethodologyGates: false,
      }),
      createLogger()
    );

    const context = new ExecutionContext({ command: '>>demo' });
    context.executionPlan = {
      strategy: 'prompt',
      gates: ['framework-compliance', 'quality'],
      requiresFramework: false,
      requiresSession: false,
      apiValidationEnabled: false,
      category: 'analysis',
    } as any;
    context.parsedCommand = {
      commandType: 'single',
      convertedPrompt: samplePrompt,
    };

    await stage.execute(context);

    const gateIdsPassed = (gateService.enhancePrompt as jest.Mock).mock.calls[0][1];
    expect(gateIdsPassed).toEqual(['quality']);
  });

  test('applies gates per chain step and stores step-level instructions', async () => {
    const gateService = createGateService();
    const stage = new GateEnhancementStage(
      gateService,
      undefined,
      () => baseFrameworkConfig,
      createLogger()
    );

    const firstStepPrompt: ConvertedPrompt = {
      ...samplePrompt,
      id: 'step_one',
      category: 'analysis',
      userMessageTemplate: 'Step one',
    };
    const secondStepPrompt: ConvertedPrompt = {
      ...samplePrompt,
      id: 'step_two',
      category: 'development',
      userMessageTemplate: 'Step two',
    };

    const context = new ExecutionContext({ command: '>>chain' });
    context.executionPlan = {
      strategy: 'chain',
      gates: [],
      requiresFramework: false,
      requiresSession: true,
      apiValidationEnabled: false,
      category: 'analysis',
    } as any;
    context.parsedCommand = {
      commandType: 'chain',
      steps: [
        {
          stepNumber: 1,
          promptId: 'step_one',
          args: {},
          inlineGateIds: ['step_gate_1'],
          convertedPrompt: firstStepPrompt,
        },
        {
          stepNumber: 2,
          promptId: 'step_two',
          args: {},
          inlineGateIds: [],
          convertedPrompt: secondStepPrompt,
          executionPlan: { gates: ['planner_gate'] },
        },
      ],
    };

    await stage.execute(context);

    expect(gateService.enhancePrompt).toHaveBeenCalledTimes(2);
    const [firstCall, secondCall] = (gateService.enhancePrompt as jest.Mock).mock.calls;
    expect(firstCall[1]).toEqual(expect.arrayContaining(['step_gate_1', 'research-quality', 'technical-accuracy']));
    expect(secondCall[1]).toEqual(
      expect.arrayContaining(['planner_gate', 'code-quality', 'technical-accuracy'])
    );
    expect(context.parsedCommand?.steps?.[0].metadata?.gateInstructions).toBeDefined();
    expect(context.parsedCommand?.steps?.[1].metadata?.gateInstructions).toBeDefined();
  });
});
