import { beforeEach, describe, expect, jest, test } from '@jest/globals';

import { ExecutionContext } from '../../../../src/engine/execution/context/execution-context.js';
import { FrameworkResolutionStage } from '../../../../src/engine/execution/pipeline/stages/12-framework-stage.js';

import type { FrameworkManager } from '../../../../src/engine/frameworks/framework-manager.js';
import type {
  FrameworkExecutionContext,
  FrameworkSelection,
} from '../../../../src/engine/frameworks/types/index.js';
import type { GateLoader } from '../../../../src/engine/gates/core/gate-loader.js';
import type { ConvertedPrompt } from '../../../../src/shared/types/index.js';

const createLogger = () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
});

/**
 * Creates a mock GateLoader that returns specified framework gate IDs.
 */
const createMockGateLoader = (frameworkGateIds: string[] = ['framework-compliance']): GateLoader =>
  ({
    loadGate: jest.fn(),
    loadGates: jest.fn(),
    getActiveGates: jest.fn(),
    listAvailableGates: jest.fn(),
    listAvailableGateDefinitions: jest.fn(),
    clearCache: jest.fn(),
    isGateActive: jest.fn(),
    getStatistics: jest.fn(),
    isFrameworkGate: jest
      .fn()
      .mockImplementation((gateId: string) => Promise.resolve(frameworkGateIds.includes(gateId))),
    isFrameworkGateCached: jest
      .fn()
      .mockImplementation((gateId: string) => frameworkGateIds.includes(gateId)),
    getFrameworkGateIds: jest.fn().mockResolvedValue(frameworkGateIds),
    setTemporaryGateRegistry: jest.fn(),
  }) as unknown as GateLoader;

const createConvertedPrompt = (overrides: Partial<ConvertedPrompt> = {}): ConvertedPrompt => ({
  id: 'demo',
  name: 'demo',
  description: 'Demo prompt',
  category: 'analysis',
  userMessageTemplate: 'Process {{input}}',
  arguments: [{ name: 'input', description: 'Input text', required: true }],
  ...overrides,
});

const createFrameworkContext = (framework: FrameworkSelection): FrameworkExecutionContext => ({
  category: 'analysis',
  systemPrompt: `Use ${framework}`,
  selectedFramework: { name: framework, framework },
});

describe('FrameworkResolutionStage', () => {
  let manager: jest.Mocked<FrameworkManager>;
  let frameworkEnabled: jest.Mock<() => boolean>;
  let mockGateLoader: GateLoader;
  let stage: FrameworkResolutionStage;

  beforeEach(() => {
    manager = {
      generateExecutionContext: jest.fn(),
    } as unknown as jest.Mocked<FrameworkManager>;
    frameworkEnabled = jest.fn().mockReturnValue(true);
    mockGateLoader = createMockGateLoader();
    stage = new FrameworkResolutionStage(manager, frameworkEnabled, createLogger(), mockGateLoader);
  });

  test('skips resolution when framework system is disabled', async () => {
    frameworkEnabled.mockReturnValue(false);

    const context = new ExecutionContext({ command: '>>demo' } as any);
    context.executionPlan = {
      strategy: 'prompt',
      gates: [],
      requiresFramework: true,
      requiresSession: false,
    };
    context.parsedCommand = {
      promptId: 'demo',
      rawArgs: '',
      format: 'symbolic',
      confidence: 0.9,
      commandType: 'single',
      metadata: {
        originalCommand: '>>demo',
        parseStrategy: 'symbolic',
        detectedFormat: 'symbolic',
        warnings: [],
      },
      convertedPrompt: createConvertedPrompt(),
    };

    await stage.execute(context);

    expect(manager.generateExecutionContext).not.toHaveBeenCalled();
    expect(context.frameworkContext).toBeUndefined();
  });

  test('resolves framework context for single prompts when required', async () => {
    const context = new ExecutionContext({ command: '>>demo' } as any);
    const convertedPrompt = createConvertedPrompt();
    context.executionPlan = {
      strategy: 'prompt',
      gates: [],
      requiresFramework: true,
      requiresSession: false,
    };
    context.parsedCommand = {
      promptId: 'demo',
      rawArgs: '',
      format: 'symbolic',
      confidence: 0.95,
      commandType: 'single',
      metadata: {
        originalCommand: '>>demo',
        parseStrategy: 'symbolic',
        detectedFormat: 'symbolic',
        warnings: [],
      },
      convertedPrompt,
    };

    const frameworkContext = createFrameworkContext('CAGEERF');
    manager.generateExecutionContext.mockReturnValue(frameworkContext);

    await stage.execute(context);

    expect(manager.generateExecutionContext).toHaveBeenCalledWith(convertedPrompt, {});
    expect(context.frameworkContext).toBe(frameworkContext);
  });

  test('applies frameworks to chain steps that require framework gates', async () => {
    const context = new ExecutionContext({ command: '>>chain' } as any);
    const stepOnePrompt = createConvertedPrompt({ id: 'first' });
    const stepTwoPrompt = createConvertedPrompt({ id: 'second' });

    context.executionPlan = {
      strategy: 'chain',
      gates: [],
      requiresFramework: false,
      requiresSession: true,
    };
    context.parsedCommand = {
      promptId: 'chain-wrapper',
      rawArgs: '',
      format: 'symbolic',
      confidence: 0.88,
      commandType: 'chain',
      metadata: {
        originalCommand: '>>chain',
        parseStrategy: 'symbolic',
        detectedFormat: 'symbolic',
        warnings: [],
      },
      steps: [
        {
          stepNumber: 1,
          promptId: 'first',
          args: {},
          convertedPrompt: stepOnePrompt,
          executionPlan: {
            strategy: 'prompt',
            gates: ['framework-compliance'],
            requiresFramework: false,
            requiresSession: false,
          },
        },
        {
          stepNumber: 2,
          promptId: 'second',
          args: {},
          convertedPrompt: stepTwoPrompt,
          executionPlan: {
            strategy: 'prompt',
            gates: [],
            requiresFramework: false,
            requiresSession: false,
          },
        },
      ],
    };

    const frameworkContext = createFrameworkContext('CAGEERF');
    manager.generateExecutionContext.mockReturnValue(frameworkContext);

    await stage.execute(context);

    expect(manager.generateExecutionContext).toHaveBeenCalledTimes(1);
    expect(manager.generateExecutionContext).toHaveBeenCalledWith(stepOnePrompt, {});
    expect(context.parsedCommand?.steps?.[0].frameworkContext).toBe(frameworkContext);
    expect(context.parsedCommand?.steps?.[1].frameworkContext).toBeUndefined();
    expect(context.frameworkContext).toBe(frameworkContext);
  });

  test('passes framework overrides through userPreference when provided', async () => {
    const context = new ExecutionContext({ command: '>>demo' } as any);
    const convertedPrompt = createConvertedPrompt();
    context.executionPlan = {
      strategy: 'prompt',
      gates: [],
      requiresFramework: true,
      requiresSession: false,
    };
    context.parsedCommand = {
      promptId: 'demo',
      rawArgs: '',
      format: 'symbolic',
      confidence: 0.9,
      commandType: 'single',
      metadata: {
        originalCommand: '>>demo',
        parseStrategy: 'symbolic',
        detectedFormat: 'symbolic',
        warnings: [],
      },
      executionPlan: {
        strategy: 'prompt',
        gates: [],
        requiresFramework: true,
        requiresSession: false,
        frameworkOverride: 'SCAMPER',
      },
      convertedPrompt,
    };

    const frameworkContext = createFrameworkContext('SCAMPER');
    manager.generateExecutionContext.mockReturnValue(frameworkContext);

    await stage.execute(context);

    // FrameworkDecisionAuthority normalizes framework IDs to lowercase
    expect(manager.generateExecutionContext).toHaveBeenCalledWith(convertedPrompt, {
      userPreference: 'scamper',
    });
    expect(context.frameworkContext).toBe(frameworkContext);
  });

  test('propagates errors from the framework manager', async () => {
    const context = new ExecutionContext({ command: '>>demo' } as any);
    context.executionPlan = {
      strategy: 'prompt',
      gates: [],
      requiresFramework: true,
      requiresSession: false,
    };
    context.parsedCommand = {
      promptId: 'demo',
      rawArgs: '',
      format: 'symbolic',
      confidence: 0.9,
      commandType: 'single',
      metadata: {
        originalCommand: '>>demo',
        parseStrategy: 'symbolic',
        detectedFormat: 'symbolic',
        warnings: [],
      },
      convertedPrompt: createConvertedPrompt(),
    };

    manager.generateExecutionContext.mockImplementation(() => {
      throw new Error('framework failure');
    });

    await expect(stage.execute(context)).rejects.toThrow('framework failure');
  });

  /**
   * Tier 12 removed a `requiresFramework` derivation that ran 11 lines above an identical
   * one. The removed block was reachable only when `decision.shouldApply` was false, which
   * makes the surviving block's extra `|| decision.shouldApply` term a no-op there — so both
   * computed the same value and took the same branch, and the first was pure duplication.
   *
   * These cases enumerate that block's whole reachable state space (authority `disabled`
   * with no modifier in the reason) plus the one state only the survivor covers. They are
   * written to pass unchanged against the pre-Tier-12 stage; that is the point of them.
   */
  describe('requiresFramework derivation (Tier 12 differential)', () => {
    const singleCommand = (overrides: Record<string, unknown> = {}): Record<string, unknown> => ({
      promptId: 'demo',
      rawArgs: '',
      format: 'symbolic',
      confidence: 0.9,
      commandType: 'single',
      metadata: {
        originalCommand: '>>demo',
        parseStrategy: 'symbolic',
        detectedFormat: 'symbolic',
        warnings: [],
      },
      convertedPrompt: createConvertedPrompt(),
      ...overrides,
    });

    test('no framework configured and nothing requires one — skips', async () => {
      const context = new ExecutionContext({ command: '>>demo' } as any);
      context.executionPlan = {
        strategy: 'prompt',
        gates: [],
        requiresFramework: false,
        requiresSession: false,
      };
      context.parsedCommand = singleCommand() as any;

      await stage.execute(context);

      expect(manager.generateExecutionContext).not.toHaveBeenCalled();
      expect(context.frameworkContext).toBeUndefined();
    });

    test('no framework configured but the plan requires one — resolves', async () => {
      const context = new ExecutionContext({ command: '>>demo' } as any);
      context.executionPlan = {
        strategy: 'prompt',
        gates: [],
        requiresFramework: true,
        requiresSession: false,
      };
      context.parsedCommand = singleCommand() as any;
      manager.generateExecutionContext.mockReturnValue(createFrameworkContext('CAGEERF'));

      await stage.execute(context);

      expect(manager.generateExecutionContext).toHaveBeenCalledTimes(1);
    });

    test('no framework configured but an inline framework gate requires one — resolves', async () => {
      const context = new ExecutionContext({ command: '>>demo' } as any);
      context.executionPlan = {
        strategy: 'prompt',
        gates: [],
        requiresFramework: false,
        requiresSession: false,
      };
      context.parsedCommand = singleCommand({
        inlineGateIds: ['framework-compliance'],
      }) as any;
      manager.generateExecutionContext.mockReturnValue(createFrameworkContext('CAGEERF'));

      await stage.execute(context);

      expect(manager.generateExecutionContext).toHaveBeenCalledTimes(1);
    });

    test('a non-framework inline gate does not require one — skips', async () => {
      const context = new ExecutionContext({ command: '>>demo' } as any);
      context.executionPlan = {
        strategy: 'prompt',
        gates: [],
        requiresFramework: false,
        requiresSession: false,
      };
      context.parsedCommand = singleCommand({ inlineGateIds: ['code-quality'] }) as any;

      await stage.execute(context);

      expect(manager.generateExecutionContext).not.toHaveBeenCalled();
    });

    test('chain whose steps require nothing — skips', async () => {
      const context = new ExecutionContext({ command: '>>chain' } as any);
      context.executionPlan = {
        strategy: 'chain',
        gates: [],
        requiresFramework: false,
        requiresSession: true,
      };
      context.parsedCommand = {
        promptId: 'chain-wrapper',
        rawArgs: '',
        format: 'symbolic',
        confidence: 0.88,
        commandType: 'chain',
        metadata: {
          originalCommand: '>>chain',
          parseStrategy: 'symbolic',
          detectedFormat: 'symbolic',
          warnings: [],
        },
        steps: [
          {
            stepNumber: 1,
            promptId: 'first',
            args: {},
            convertedPrompt: createConvertedPrompt({ id: 'first' }),
            executionPlan: {
              strategy: 'prompt',
              gates: ['code-quality'],
              requiresFramework: false,
              requiresSession: false,
            },
          },
        ],
      } as any;

      await stage.execute(context);

      expect(manager.generateExecutionContext).not.toHaveBeenCalled();
    });

    /**
     * The state the removed block could never reach: the authority applies a framework, so
     * `decision.shouldApply` alone carries the derivation even though nothing else requires one.
     */
    test('@ operator applies a framework even when nothing requires one — resolves', async () => {
      const context = new ExecutionContext({ command: '>>demo' } as any);
      context.executionPlan = {
        strategy: 'prompt',
        gates: [],
        requiresFramework: false,
        requiresSession: false,
      };
      context.parsedCommand = singleCommand({
        executionPlan: {
          strategy: 'prompt',
          gates: [],
          requiresFramework: false,
          requiresSession: false,
          frameworkOverride: 'ReACT',
        },
      }) as any;
      manager.generateExecutionContext.mockReturnValue(createFrameworkContext('ReACT'));

      await stage.execute(context);

      expect(manager.generateExecutionContext).toHaveBeenCalledWith(expect.anything(), {
        userPreference: 'react',
      });
    });

    /**
     * GateEnhancementService (stage 11) calls `decide()` before this stage on the normal
     * path, so the authority is already cached by the time the stage runs. Pinned because
     * the stage's comment about why requirement-derivation cannot fold into the authority
     * depends on it.
     */
    test('honours a decision already cached by an earlier stage', async () => {
      const context = new ExecutionContext({ command: '>>demo' } as any);
      context.executionPlan = {
        strategy: 'prompt',
        gates: [],
        requiresFramework: false,
        requiresSession: false,
      };
      context.parsedCommand = singleCommand() as any;

      // Stand in for stage 11, which supplies the global active framework this stage cannot.
      context.frameworkAuthority.decide({ globalActiveFramework: 'CAGEERF' });
      manager.generateExecutionContext.mockReturnValue(createFrameworkContext('CAGEERF'));

      await stage.execute(context);

      expect(manager.generateExecutionContext).toHaveBeenCalledWith(expect.anything(), {
        userPreference: 'cageerf',
      });
    });
  });

  describe('System prompt duplication prevention', () => {
    test('sets coordination flag after applying framework context for single prompts', async () => {
      const context = new ExecutionContext({ command: '>>demo' } as any);
      const convertedPrompt = createConvertedPrompt();
      context.executionPlan = {
        strategy: 'prompt',
        gates: [],
        requiresFramework: true,
        requiresSession: false,
      };
      context.parsedCommand = {
        promptId: 'demo',
        rawArgs: '',
        format: 'symbolic',
        confidence: 0.95,
        commandType: 'single',
        metadata: {
          originalCommand: '>>demo',
          parseStrategy: 'symbolic',
          detectedFormat: 'symbolic',
          warnings: [],
        },
        convertedPrompt,
      };

      const frameworkContext = createFrameworkContext('CAGEERF');
      manager.generateExecutionContext.mockReturnValue(frameworkContext);

      await stage.execute(context);

      expect(context.state.framework.systemPromptApplied).toBe(true);
      expect(context.frameworkContext).toBe(frameworkContext);
    });

    test('does not set systemPromptApplied for chain steps (delegated to FrameworkInjectionControlStage)', async () => {
      const context = new ExecutionContext({ command: '>>chain' } as any);
      const stepOnePrompt = createConvertedPrompt({ id: 'first' });

      context.executionPlan = {
        strategy: 'chain',
        gates: [],
        requiresFramework: false,
        requiresSession: true,
      };
      context.parsedCommand = {
        promptId: 'chain-wrapper',
        rawArgs: '',
        format: 'symbolic',
        confidence: 0.88,
        commandType: 'chain',
        metadata: {
          originalCommand: '>>chain',
          parseStrategy: 'symbolic',
          detectedFormat: 'symbolic',
          warnings: [],
        },
        steps: [
          {
            stepNumber: 1,
            promptId: 'first',
            args: {},
            convertedPrompt: stepOnePrompt,
            executionPlan: {
              strategy: 'prompt',
              gates: ['framework-compliance'],
              requiresFramework: false,
              requiresSession: false,
            },
          },
        ],
      };

      const frameworkContext = createFrameworkContext('CAGEERF');
      manager.generateExecutionContext.mockReturnValue(frameworkContext);

      await stage.execute(context);

      // Framework Stage generates context but does NOT control injection frequency
      // InjectionControlStage handles that after SessionManagementStage
      // systemPromptApplied defaults to false (from state initialization)
      expect(context.state.framework.systemPromptApplied).toBe(false);
      expect(context.frameworkContext).toBe(frameworkContext);
    });
  });

  describe('@operator precedence and framework system bypass', () => {
    test('applies framework override even when framework system is disabled', async () => {
      frameworkEnabled.mockReturnValue(false);

      const context = new ExecutionContext({ command: '@SCAMPER >>demo' } as any);
      const convertedPrompt = createConvertedPrompt();
      context.executionPlan = {
        strategy: 'prompt',
        gates: [],
        requiresFramework: true,
        requiresSession: false,
        frameworkOverride: 'SCAMPER',
      };
      context.parsedCommand = {
        promptId: 'demo',
        rawArgs: '',
        format: 'symbolic',
        confidence: 0.9,
        commandType: 'single',
        metadata: {
          originalCommand: '@SCAMPER >>demo',
          parseStrategy: 'symbolic',
          detectedFormat: 'symbolic',
          warnings: [],
        },
        executionPlan: {
          strategy: 'prompt',
          gates: [],
          requiresFramework: true,
          requiresSession: false,
          frameworkOverride: 'SCAMPER',
        },
        convertedPrompt,
      };

      const frameworkContext = createFrameworkContext('SCAMPER');
      manager.generateExecutionContext.mockReturnValue(frameworkContext);

      await stage.execute(context);

      // FrameworkDecisionAuthority normalizes framework IDs to lowercase
      expect(manager.generateExecutionContext).toHaveBeenCalledWith(convertedPrompt, {
        userPreference: 'scamper',
      });
      expect(context.frameworkContext).toBe(frameworkContext);
      expect(context.state.framework.systemPromptApplied).toBe(true);
    });

    // Counterpart to the test above: same disabled system, but no override anywhere.
    // The stage reads `parsedCommand.executionPlan.frameworkOverride` (06-framework-stage.ts:99),
    // so "no override" means leaving that unset — omitting `executionPlan` from parsedCommand.
    test('skips framework resolution when system disabled and no override provided', async () => {
      frameworkEnabled.mockReturnValue(false);

      const context = new ExecutionContext({ command: '>>demo' } as any);
      context.executionPlan = {
        strategy: 'prompt',
        gates: [],
        requiresFramework: true,
        requiresSession: false,
      };
      context.parsedCommand = {
        promptId: 'demo',
        rawArgs: '',
        format: 'symbolic',
        confidence: 0.9,
        commandType: 'single',
        metadata: {
          originalCommand: '>>demo',
          parseStrategy: 'symbolic',
          detectedFormat: 'symbolic',
          warnings: [],
        },
        convertedPrompt: createConvertedPrompt(),
      };

      await stage.execute(context);

      expect(manager.generateExecutionContext).not.toHaveBeenCalled();
      expect(context.frameworkContext).toBeUndefined();
      expect(context.state.framework.systemPromptApplied).toBe(false);
    });

    test('framework override with @operator sets coordination flag to prevent duplication', async () => {
      const context = new ExecutionContext({ command: '@ReACT >>demo' } as any);
      const convertedPrompt = createConvertedPrompt();
      context.executionPlan = {
        strategy: 'prompt',
        gates: [],
        requiresFramework: true,
        requiresSession: false,
        frameworkOverride: 'ReACT',
      };
      context.parsedCommand = {
        promptId: 'demo',
        rawArgs: '',
        format: 'symbolic',
        confidence: 0.9,
        commandType: 'single',
        metadata: {
          originalCommand: '@ReACT >>demo',
          parseStrategy: 'symbolic',
          detectedFormat: 'symbolic',
          warnings: [],
        },
        executionPlan: {
          strategy: 'prompt',
          gates: [],
          requiresFramework: true,
          requiresSession: false,
          frameworkOverride: 'ReACT',
        },
        convertedPrompt,
      };

      const frameworkContext = createFrameworkContext('ReACT');
      manager.generateExecutionContext.mockReturnValue(frameworkContext);

      await stage.execute(context);

      // Verify framework override is passed correctly
      // FrameworkDecisionAuthority normalizes framework IDs to lowercase
      expect(manager.generateExecutionContext).toHaveBeenCalledWith(convertedPrompt, {
        userPreference: 'react',
      });

      // Verify coordination flag is set to signal Prompt Guidance Stage
      expect(context.state.framework.systemPromptApplied).toBe(true);
      expect(context.frameworkContext).toBe(frameworkContext);
    });
  });
});
