import { describe, expect, jest, test } from '@jest/globals';

import { ExecutionContext } from '../../../../src/execution/context/execution-context.js';
import { GateEnhancementStage } from '../../../../src/execution/pipeline/stages/05-gate-enhancement-stage.js';

import type { GateLoader } from '../../../../src/gates/core/gate-loader.js';
import type { TemporaryGateRegistry } from '../../../../src/gates/core/temporary-gate-registry.js';
import type { GateManager } from '../../../../src/gates/gate-manager.js';
import type { IGateService } from '../../../../src/gates/services/gate-service-interface.js';
import type { Logger } from '../../../../src/logging/index.js';
import type { ConvertedPrompt } from '../../../../src/types/index.js';

/**
 * Creates a mock GateLoader that returns specified methodology gate IDs.
 */
const createMockGateLoader = (
  methodologyGateIds: string[] = ['framework-compliance', 'research-quality', 'technical-accuracy']
): GateLoader =>
  ({
    loadGate: jest.fn(),
    loadGates: jest.fn(),
    getActiveGates: jest.fn(),
    listAvailableGates: jest.fn(),
    listAvailableGateDefinitions: jest.fn(),
    clearCache: jest.fn(),
    isGateActive: jest.fn(),
    getStatistics: jest.fn(),
    isMethodologyGate: jest
      .fn()
      .mockImplementation((gateId: string) => Promise.resolve(methodologyGateIds.includes(gateId))),
    isMethodologyGateCached: jest
      .fn()
      .mockImplementation((gateId: string) => methodologyGateIds.includes(gateId)),
    getMethodologyGateIds: jest.fn().mockResolvedValue(methodologyGateIds),
    setTemporaryGateRegistry: jest.fn(),
  }) as unknown as GateLoader;

/**
 * Creates a mock GateManager that returns gates based on category.
 * Mirrors the old hardcoded getCategoryGates() behavior for test compatibility.
 */
const createMockGateManager = (): GateManager => {
  const categoryGateMapping: Record<string, string[]> = {
    analysis: ['research-quality', 'technical-accuracy'],
    research: ['research-quality', 'technical-accuracy'],
    development: ['code-quality', 'technical-accuracy'],
    code: ['code-quality', 'technical-accuracy'],
    documentation: ['content-structure', 'educational-clarity'],
    architecture: ['technical-accuracy', 'security-awareness'],
  };

  return {
    selectGates: jest.fn().mockImplementation(({ promptCategory }: { promptCategory?: string }) => {
      const gates = promptCategory ? (categoryGateMapping[promptCategory] ?? []) : [];
      return {
        guides: [],
        selectedIds: gates,
        skippedIds: [],
        metadata: { selectionMethod: 'category', selectionTime: 0 },
      };
    }),
    getGate: jest.fn(),
    hasGate: jest.fn(),
    listGates: jest.fn().mockReturnValue([]),
    getGateEntries: jest.fn().mockReturnValue([]),
    getActiveGates: jest.fn().mockReturnValue([]),
    setGateEnabled: jest.fn(),
    reloadGate: jest.fn(),
    getGateRegistry: jest.fn(),
    getRegistryStats: jest.fn().mockReturnValue({ totalGates: 0 }),
    getStatus: jest.fn(),
    isGateSystemEnabled: jest.fn().mockReturnValue(true),
    setStateManager: jest.fn(),
    initialize: jest.fn(),
  } as unknown as GateManager;
};

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
const baseGatesConfig = {
  enabled: true,
  definitionsDirectory: 'gates',
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
      undefined, // gateReferenceResolver
      () => undefined, // frameworkManagerProvider
      createLogger(),
      undefined,
      () => baseGatesConfig
    );

    const context = new ExecutionContext({
      command: '>>demo',
      gates: [
        {
          name: 'Custom check',
          type: 'quality',
          scope: 'execution',
          guidance: 'Ensure clarity',
          description: 'Custom guidance',
        } as any,
      ],
    });

    // Add normalized gates to metadata (mimics normalization stage behavior)
    context.state.gates.requestedOverrides = {
      gates: [
        {
          name: 'Custom check',
          type: 'quality',
          scope: 'execution',
          guidance: 'Ensure clarity',
          description: 'Custom guidance',
        },
      ],
      temporaryGateCount: 1,
    };

    context.executionPlan = {
      strategy: 'prompt',
      gates: ['quality'],
      requiresFramework: false,
      requiresSession: false,
      llmValidationEnabled: false,
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
    expect(gateIdsPassed).toEqual(
      expect.arrayContaining(['quality', 'inline_gate', 'temp_gate_custom'])
    );
    expect(context.executionPlan?.gates).toEqual(expect.arrayContaining(['temp_gate_custom']));
    expect(context.state.gates.temporaryGateIds).toEqual(
      expect.arrayContaining(['temp_gate_custom'])
    );
    expect(context.gateInstructions).toContain('Guidance:');
  });

  test('filters methodology gates when disabled in framework config', async () => {
    const gateService = createGateService();
    const mockGateLoader = createMockGateLoader();
    const stage = new GateEnhancementStage(
      gateService,
      undefined,
      () => ({
        ...baseFrameworkConfig,
        enableMethodologyGates: false,
      }),
      undefined, // gateReferenceResolver
      () => undefined, // frameworkManagerProvider
      createLogger(),
      undefined,
      () => baseGatesConfig,
      mockGateLoader
    );

    const context = new ExecutionContext({ command: '>>demo' });
    context.executionPlan = {
      strategy: 'prompt',
      gates: ['framework-compliance', 'quality'],
      requiresFramework: false,
      requiresSession: false,
      llmValidationEnabled: false,
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

  test('skips gate enhancement entirely when gates config is disabled', async () => {
    const gateService = createGateService();
    const stage = new GateEnhancementStage(
      gateService,
      undefined,
      () => baseFrameworkConfig,
      undefined,
      undefined,
      createLogger(),
      undefined,
      () => ({ ...baseGatesConfig, enabled: false })
    );

    const context = new ExecutionContext({ command: '>>demo' });
    context.executionPlan = {
      strategy: 'prompt',
      gates: ['quality'],
      requiresFramework: false,
      requiresSession: false,
      llmValidationEnabled: false,
      category: 'analysis',
    } as any;
    context.parsedCommand = {
      commandType: 'single',
      convertedPrompt: samplePrompt,
    };

    await stage.execute(context);

    expect(gateService.enhancePrompt as jest.Mock).not.toHaveBeenCalled();
  });

  test('applies gates per chain step and stores step-level instructions', async () => {
    const gateService = createGateService();
    const mockGateManager = createMockGateManager();
    const stage = new GateEnhancementStage(
      gateService,
      undefined,
      () => baseFrameworkConfig,
      undefined, // gateReferenceResolver
      () => undefined, // frameworkManagerProvider
      createLogger(),
      undefined,
      () => baseGatesConfig,
      undefined, // gateLoader
      () => mockGateManager // gateManagerProvider - provides category-based gate selection
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
      llmValidationEnabled: false,
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
    expect(firstCall[1]).toEqual(
      expect.arrayContaining(['step_gate_1', 'research-quality', 'technical-accuracy'])
    );
    expect(secondCall[1]).toEqual(
      expect.arrayContaining(['planner_gate', 'code-quality', 'technical-accuracy'])
    );
    expect(context.parsedCommand?.steps?.[0].metadata?.gateInstructions).toBeDefined();
    expect(context.parsedCommand?.steps?.[1].metadata?.gateInstructions).toBeDefined();
  });

  test('processes string gates from unified gates parameter', async () => {
    const gateService = createGateService();
    const stage = new GateEnhancementStage(
      gateService,
      undefined,
      () => baseFrameworkConfig,
      undefined, // gateReferenceResolver
      () => undefined, // frameworkManagerProvider
      createLogger(),
      undefined,
      () => baseGatesConfig
    );

    const context = new ExecutionContext({
      command: '>>demo',
      gates: ['quality-check', 'code-quality'], // String gates in unified parameter
    });

    // Add gates to metadata (mimics normalization stage behavior)
    context.state.gates.requestedOverrides = {
      gates: ['quality-check', 'code-quality'],
    };

    context.executionPlan = {
      strategy: 'single',
      gates: ['quality-check', 'code-quality'], // Gates populated by planner
      requiresFramework: false,
      requiresSession: false,
      llmValidationEnabled: false,
      category: 'analysis',
    } as any;
    context.parsedCommand = {
      commandType: 'single',
      convertedPrompt: samplePrompt,
    };

    await stage.execute(context);

    const gateIdsPassed = (gateService.enhancePrompt as jest.Mock).mock.calls[0][1];
    expect(gateIdsPassed).toContain('quality-check');
    expect(gateIdsPassed).toContain('code-quality');
  });

  test('applies step-targeted gate only to specified step number', async () => {
    const gateService = createGateService();
    const tempGateRegistry = {
      createTemporaryGate: jest.fn().mockReturnValue('temp_step_2_gate'),
      getTemporaryGate: jest.fn((gateId: string) => {
        if (gateId === 'temp_step_2_gate') {
          return { id: 'temp_step_2_gate', target_step_number: 2 };
        }
        return undefined;
      }),
    } as any;

    const stage = new GateEnhancementStage(
      gateService,
      tempGateRegistry,
      () => baseFrameworkConfig,
      undefined, // gateReferenceResolver
      () => undefined, // frameworkManagerProvider
      createLogger(),
      undefined,
      () => baseGatesConfig
    );

    const context = new ExecutionContext({
      command: '>>step1 --> >>step2 --> >>step3',
      gates: [{ name: 'Step 2 Only', target_step_number: 2, criteria: ['Check step 2'] }],
    } as any);

    // Add normalized gates to metadata (mimics normalization stage behavior)
    context.state.gates.requestedOverrides = {
      gates: [{ name: 'Step 2 Only', target_step_number: 2, criteria: ['Check step 2'] }],
    };

    context.executionPlan = {
      strategy: 'chain',
      gates: [],
      requiresFramework: false,
      requiresSession: false,
      llmValidationEnabled: false,
    } as any;
    context.parsedCommand = {
      commandType: 'chain',
      steps: [
        {
          stepNumber: 1,
          convertedPrompt: { ...samplePrompt, id: 'step1' },
          executionPlan: { gates: [] },
        },
        {
          stepNumber: 2,
          convertedPrompt: { ...samplePrompt, id: 'step2' },
          executionPlan: { gates: [] },
        },
        {
          stepNumber: 3,
          convertedPrompt: { ...samplePrompt, id: 'step3' },
          executionPlan: { gates: [] },
        },
      ],
    } as any;
    context.state.gates.temporaryGateIds = ['temp_step_2_gate'];

    await stage.execute(context);

    // Step 1 should NOT have the gate
    const step1Gates =
      (gateService.enhancePrompt as jest.Mock).mock.calls.find(
        (call) => call[0].id === 'step1'
      )?.[1] ?? [];
    expect(step1Gates).not.toContain('temp_step_2_gate');

    // Step 2 SHOULD have the gate
    const step2Gates =
      (gateService.enhancePrompt as jest.Mock).mock.calls.find(
        (call) => call[0].id === 'step2'
      )?.[1] ?? [];
    expect(step2Gates).toContain('temp_step_2_gate');

    // Step 3 should NOT have the gate
    const step3Gates =
      (gateService.enhancePrompt as jest.Mock).mock.calls.find(
        (call) => call[0].id === 'step3'
      )?.[1] ?? [];
    expect(step3Gates).not.toContain('temp_step_2_gate');
  });

  test('applies multi-step-targeted gate to specified steps only', async () => {
    const gateService = createGateService();
    const tempGateRegistry = {
      createTemporaryGate: jest.fn().mockReturnValue('temp_multi_gate'),
      getTemporaryGate: jest.fn((gateId: string) => {
        if (gateId === 'temp_multi_gate') {
          return { id: 'temp_multi_gate', apply_to_steps: [1, 3] };
        }
        return undefined;
      }),
    } as any;

    const stage = new GateEnhancementStage(
      gateService,
      tempGateRegistry,
      () => baseFrameworkConfig,
      undefined, // gateReferenceResolver
      () => undefined, // frameworkManagerProvider
      createLogger(),
      undefined,
      () => baseGatesConfig
    );

    const context = new ExecutionContext({
      command: '>>step1 --> >>step2 --> >>step3',
      gates: [{ name: 'Steps 1 and 3', apply_to_steps: [1, 3], criteria: ['Check steps'] }],
    } as any);

    // Add normalized gates to metadata (mimics normalization stage behavior)
    context.state.gates.requestedOverrides = {
      gates: [{ name: 'Steps 1 and 3', apply_to_steps: [1, 3], criteria: ['Check steps'] }],
    };

    context.executionPlan = {
      strategy: 'chain',
      gates: [],
      requiresFramework: false,
      requiresSession: false,
      llmValidationEnabled: false,
    } as any;
    context.parsedCommand = {
      commandType: 'chain',
      steps: [
        {
          stepNumber: 1,
          convertedPrompt: { ...samplePrompt, id: 'step1' },
          executionPlan: { gates: [] },
        },
        {
          stepNumber: 2,
          convertedPrompt: { ...samplePrompt, id: 'step2' },
          executionPlan: { gates: [] },
        },
        {
          stepNumber: 3,
          convertedPrompt: { ...samplePrompt, id: 'step3' },
          executionPlan: { gates: [] },
        },
      ],
    } as any;
    context.state.gates.temporaryGateIds = ['temp_multi_gate'];

    await stage.execute(context);

    // Step 1 SHOULD have the gate
    const step1Gates =
      (gateService.enhancePrompt as jest.Mock).mock.calls.find(
        (call) => call[0].id === 'step1'
      )?.[1] ?? [];
    expect(step1Gates).toContain('temp_multi_gate');

    // Step 2 should NOT have the gate
    const step2Gates =
      (gateService.enhancePrompt as jest.Mock).mock.calls.find(
        (call) => call[0].id === 'step2'
      )?.[1] ?? [];
    expect(step2Gates).not.toContain('temp_multi_gate');

    // Step 3 SHOULD have the gate
    const step3Gates =
      (gateService.enhancePrompt as jest.Mock).mock.calls.find(
        (call) => call[0].id === 'step3'
      )?.[1] ?? [];
    expect(step3Gates).toContain('temp_multi_gate');
  });

  test('applies gate without step targeting to all steps', async () => {
    const gateService = createGateService();
    const tempGateRegistry = {
      createTemporaryGate: jest.fn().mockReturnValue('temp_all_steps'),
      getTemporaryGate: jest.fn((gateId: string) => {
        if (gateId === 'temp_all_steps') {
          return { id: 'temp_all_steps' }; // No target_step_number or apply_to_steps
        }
        return undefined;
      }),
    } as any;

    const stage = new GateEnhancementStage(
      gateService,
      tempGateRegistry,
      () => baseFrameworkConfig,
      undefined, // gateReferenceResolver
      () => undefined, // frameworkManagerProvider
      createLogger(),
      undefined,
      () => baseGatesConfig
    );

    const context = new ExecutionContext({
      command: '>>step1 --> >>step2',
      gates: [{ name: 'All Steps', criteria: ['Check all'] }],
    } as any);

    // Add normalized gates to metadata (mimics normalization stage behavior)
    context.state.gates.requestedOverrides = {
      gates: [{ name: 'All Steps', criteria: ['Check all'] }],
    };

    context.executionPlan = {
      strategy: 'chain',
      gates: [],
      requiresFramework: false,
      requiresSession: false,
      llmValidationEnabled: false,
    } as any;
    context.parsedCommand = {
      commandType: 'chain',
      steps: [
        {
          stepNumber: 1,
          convertedPrompt: { ...samplePrompt, id: 'step1' },
          executionPlan: { gates: [] },
        },
        {
          stepNumber: 2,
          convertedPrompt: { ...samplePrompt, id: 'step2' },
          executionPlan: { gates: [] },
        },
      ],
    } as any;
    context.state.gates.temporaryGateIds = ['temp_all_steps'];

    await stage.execute(context);

    // Both steps SHOULD have the gate
    const step1Gates =
      (gateService.enhancePrompt as jest.Mock).mock.calls.find(
        (call) => call[0].id === 'step1'
      )?.[1] ?? [];
    expect(step1Gates).toContain('temp_all_steps');

    const step2Gates =
      (gateService.enhancePrompt as jest.Mock).mock.calls.find(
        (call) => call[0].id === 'step2'
      )?.[1] ?? [];
    expect(step2Gates).toContain('temp_all_steps');
  });

  test('converts unified gates parameter with mixed types to temporary gates', async () => {
    const gateService = createGateService();
    const tempGateRegistry = {
      createTemporaryGate: jest
        .fn()
        .mockReturnValueOnce('inline_toxicity') // For string ID converted to inline criteria
        .mockReturnValueOnce('inline_red_team'), // For CustomCheck converted to inline criteria
      getTemporaryGate: jest.fn((gateId: string) => {
        // Full TemporaryGateInput objects with 'id' are already registered by inline-gate-extraction stage
        if (gateId === 'gdpr-check') {
          return { id: 'gdpr-check', pass_criteria: ['no PII'], severity: 'high' };
        }
        return undefined;
      }),
    } as any;

    const stage = new GateEnhancementStage(
      gateService,
      tempGateRegistry,
      () => baseFrameworkConfig,
      undefined, // gateReferenceResolver
      () => undefined, // frameworkManagerProvider
      createLogger()
    );

    const context = new ExecutionContext({ command: '>>demo' });
    context.state.gates.requestedOverrides = {
      gates: [
        'toxicity', // String ID → inline criteria
        { name: 'red-team', description: 'Confirm exfil path' }, // CustomCheck → inline criteria
        { id: 'gdpr-check', criteria: ['no PII'], severity: 'high' }, // TemporaryGateInput → already registered, skipped
      ],
    };
    context.executionPlan = {
      strategy: 'prompt',
      gates: [],
      requiresFramework: false,
      requiresSession: false,
      llmValidationEnabled: false,
      category: 'analysis',
    } as any;
    context.parsedCommand = {
      commandType: 'single',
      convertedPrompt: samplePrompt,
    };

    await stage.execute(context);

    // Only string IDs and CustomChecks are converted (full TemporaryGateInput objects are already registered)
    expect(tempGateRegistry.createTemporaryGate).toHaveBeenCalledTimes(2);

    // String ID is converted to inline validation criteria
    expect(tempGateRegistry.createTemporaryGate).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Inline Validation Criteria',
        pass_criteria: ['toxicity'],
      }),
      expect.any(String)
    );

    // CustomCheck is converted to inline gate with description as guidance
    expect(tempGateRegistry.createTemporaryGate).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'red-team',
        description: 'Confirm exfil path',
      }),
      expect.any(String)
    );

    // Full TemporaryGateInput was already registered by inline-gate-extraction stage
    expect(tempGateRegistry.getTemporaryGate).toHaveBeenCalledWith('gdpr-check');
  });

  test('uses GateAccumulator for priority-based deduplication', async () => {
    const gateService = createGateService();
    const stage = new GateEnhancementStage(
      gateService,
      undefined,
      () => baseFrameworkConfig,
      undefined, // gateReferenceResolver
      () => undefined, // frameworkManagerProvider
      createLogger(),
      undefined,
      () => baseGatesConfig
    );

    const context = new ExecutionContext({ command: '>>demo' });
    context.executionPlan = {
      strategy: 'single',
      gates: ['code-quality', 'research-quality'], // From prompt config
      requiresFramework: false,
      requiresSession: false,
      category: 'analysis',
    } as any;
    context.parsedCommand = {
      commandType: 'single',
      convertedPrompt: {
        ...samplePrompt,
        category: 'analysis', // Would auto-add research-quality from category
      },
      inlineGateIds: ['code-quality'], // Duplicate - should win due to higher priority
    };

    await stage.execute(context);

    // Verify accumulator was used and gates are deduplicated
    expect(context.gates.size).toBeGreaterThan(0);
    expect(context.gates.has('code-quality')).toBe(true);
    expect(context.gates.has('research-quality')).toBe(true);

    // Verify the inline-operator source has higher priority for code-quality
    const codeQualityEntry = context.gates.getEntries().find((e) => e.id === 'code-quality');
    expect(codeQualityEntry?.source).toBe('inline-operator');

    // Verify gateService was called with deduplicated list
    expect(gateService.enhancePrompt).toHaveBeenCalledTimes(1);
    const gateIdsPassed = (gateService.enhancePrompt as jest.Mock).mock.calls[0][1];

    // No duplicates - code-quality should appear only once
    const codeQualityCount = gateIdsPassed.filter((g: string) => g === 'code-quality').length;
    expect(codeQualityCount).toBe(1);
  });

  test('accumulator tracks provenance for all gate sources', async () => {
    const gateService = createGateService();
    const temporaryRegistry = {
      createTemporaryGate: jest.fn().mockReturnValue('temp_custom'),
    } as unknown as TemporaryGateRegistry;
    const mockGateManager = createMockGateManager();

    const stage = new GateEnhancementStage(
      gateService,
      temporaryRegistry,
      () => baseFrameworkConfig,
      undefined,
      () => undefined, // frameworkManagerProvider
      createLogger(),
      undefined,
      () => baseGatesConfig,
      undefined, // gateLoader
      () => mockGateManager // gateManagerProvider - provides category-based gate selection
    );

    const context = new ExecutionContext({ command: '>>demo' });

    // Set up client-selected gates from judge phase
    context.state.framework.clientSelectedGates = ['client-gate'];

    // Set up normalized gates in metadata
    context.state.gates.requestedOverrides = {
      gates: [{ name: 'Custom', criteria: ['test'] }],
    };

    context.executionPlan = {
      strategy: 'single',
      gates: ['planned-gate'], // prompt-config source
      requiresFramework: false,
      requiresSession: false,
      category: 'development', // Will add code-quality, technical-accuracy from registry-auto
    } as any;
    context.parsedCommand = {
      commandType: 'single',
      convertedPrompt: { ...samplePrompt, category: 'development' },
      inlineGateIds: ['inline-gate'], // inline-operator source
    };

    await stage.execute(context);

    // Verify all sources are tracked
    const sourceCounts = context.gates.getSourceCounts();
    expect(sourceCounts['inline-operator']).toBeGreaterThanOrEqual(1);
    expect(sourceCounts['client-selection']).toBeGreaterThanOrEqual(1);
    expect(sourceCounts['prompt-config']).toBeGreaterThanOrEqual(1);
    // registry-auto source: gates selected from GateManager.selectGates() activation rules
    expect(sourceCounts['registry-auto']).toBeGreaterThanOrEqual(1);
  });
});
