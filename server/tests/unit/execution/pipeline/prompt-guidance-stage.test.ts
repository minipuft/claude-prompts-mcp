import { describe, test, expect, beforeEach, jest } from '@jest/globals';

import { ExecutionContext } from '../../../../dist/execution/context/execution-context.js';
import { PromptGuidanceStage } from '../../../../dist/execution/pipeline/stages/06b-prompt-guidance-stage.js';

import type { PromptGuidanceService } from '../../../../dist/frameworks/prompt-guidance/index.js';
import type { ConvertedPrompt, ExecutionPlan } from '../../../../dist/types/index.js';

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

    // Pass null for StyleManager - tests use hardcoded fallback styles
    stage = new PromptGuidanceStage(service, null, createLogger());
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
      (context.state.framework.guidanceResults as Record<string, unknown>)?.[convertedPrompt.id]
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

  describe('System prompt duplication prevention', () => {
    test('skips system prompt injection when framework stage already applied it', async () => {
      const context = new ExecutionContext({ command: '@CAGEERF >>demo' });
      const convertedPrompt = createConvertedPrompt();
      context.executionPlan = createExecutionPlan();
      context.parsedCommand = {
        commandType: 'single',
        convertedPrompt,
      } as any;

      // Simulate Framework Stage having already applied system prompt
      context.state.framework.systemPromptApplied = true;

      service.applyGuidance.mockResolvedValue(
        createGuidanceResult(convertedPrompt, {
          userMessageTemplate: 'Enhanced template',
        }) as any
      );

      await stage.execute(context);

      // Verify system prompt injection is disabled
      expect(service.applyGuidance).toHaveBeenCalledWith(convertedPrompt, {
        includeSystemPromptInjection: false, // Should be false!
        includeTemplateEnhancement: true,
        frameworkOverride: undefined,
      });
    });

    test('includes system prompt injection when framework stage has not run', async () => {
      const context = new ExecutionContext({ command: '>>demo' });
      const convertedPrompt = createConvertedPrompt();
      context.executionPlan = createExecutionPlan();
      context.parsedCommand = {
        commandType: 'single',
        convertedPrompt,
      } as any;

      // No framework coordination flag set
      // context.state.framework.systemPromptApplied is false by default

      service.applyGuidance.mockResolvedValue(
        createGuidanceResult(convertedPrompt, {
          systemMessage: 'Framework guidance',
          userMessageTemplate: 'Enhanced template',
        }) as any
      );

      await stage.execute(context);

      // Verify system prompt injection is enabled
      expect(service.applyGuidance).toHaveBeenCalledWith(convertedPrompt, {
        includeSystemPromptInjection: true, // Should be true!
        includeTemplateEnhancement: true,
        frameworkOverride: undefined,
      });
    });

    test('prevents duplication for chain steps when framework already applied', async () => {
      const context = new ExecutionContext({ command: '@ReACT >>chain' });
      context.executionPlan = createExecutionPlan({
        strategy: 'chain',
        requiresSession: true,
      });

      const firstStepPrompt = createConvertedPrompt({ id: 'step-one' });

      const chainSteps = [
        {
          stepNumber: 1,
          promptId: 'step-one',
          args: {},
          convertedPrompt: firstStepPrompt,
          executionPlan: createExecutionPlan({ requiresFramework: true }),
        },
      ];

      context.parsedCommand = {
        commandType: 'chain',
        steps: chainSteps,
      } as any;

      // Simulate Framework Stage having already applied system prompt
      context.state.framework.systemPromptApplied = true;

      service.applyGuidance.mockResolvedValue(
        createGuidanceResult(firstStepPrompt, {
          userMessageTemplate: 'Enhanced for chain',
        }) as any
      );

      await stage.execute(context);

      // Verify system prompt injection is disabled for chain steps too
      expect(service.applyGuidance).toHaveBeenCalledWith(firstStepPrompt, {
        includeSystemPromptInjection: false, // Should be false for chains too!
        includeTemplateEnhancement: true,
        frameworkOverride: undefined,
      });
    });

    test('passes framework override from @operator to prompt guidance service', async () => {
      const context = new ExecutionContext({ command: '@SCAMPER >>demo' });
      const convertedPrompt = createConvertedPrompt();
      context.executionPlan = createExecutionPlan({
        frameworkOverride: 'SCAMPER',
      });
      context.parsedCommand = {
        commandType: 'single',
        convertedPrompt,
        executionPlan: {
          strategy: 'prompt',
          gates: [],
          requiresFramework: true,
          requiresSession: false,
          frameworkOverride: 'SCAMPER',
        },
      } as any;

      // Framework Stage has already processed this
      context.state.framework.systemPromptApplied = true;

      service.applyGuidance.mockResolvedValue(createGuidanceResult(convertedPrompt) as any);

      await stage.execute(context);

      // Verify framework override is passed through even though system prompt injection is disabled
      // FrameworkDecisionAuthority normalizes framework IDs to lowercase
      expect(service.applyGuidance).toHaveBeenCalledWith(
        convertedPrompt,
        expect.objectContaining({
          includeSystemPromptInjection: false,
          includeTemplateEnhancement: true,
          frameworkOverride: 'scamper',
        })
      );
    });
  });

  describe('Two-phase client-driven judge selection', () => {
    test('skips when judgePhaseTriggered (pipeline returning early)', async () => {
      const context = new ExecutionContext({ command: '>>demo', guided: true });
      const convertedPrompt = createConvertedPrompt();
      context.executionPlan = createExecutionPlan({ requiresFramework: true });
      context.parsedCommand = {
        commandType: 'single',
        convertedPrompt,
      } as any;

      // Judge phase was triggered - pipeline returned early with judge response
      context.state.framework.judgePhaseTriggered = true;

      await stage.execute(context);

      // Should not call guidance service
      expect(service.applyGuidance).not.toHaveBeenCalled();
    });

    test('detects client-selected framework from JudgeSelectionStage', async () => {
      const context = new ExecutionContext({ command: '>>demo' });
      const convertedPrompt = createConvertedPrompt();
      context.executionPlan = createExecutionPlan({ requiresFramework: true });
      context.parsedCommand = {
        commandType: 'single',
        convertedPrompt,
      } as any;

      // JudgeSelectionStage sets this key directly
      context.state.framework.clientOverride = 'CAGEERF';

      service.applyGuidance.mockResolvedValue(createGuidanceResult(convertedPrompt) as any);

      await stage.execute(context);

      // Framework override should still be present (set by JudgeSelectionStage)
      expect(context.state.framework.clientOverride).toBe('CAGEERF');
    });

    test('detects client-selected gates from JudgeSelectionStage', async () => {
      const context = new ExecutionContext({ command: '>>demo' });
      const convertedPrompt = createConvertedPrompt();
      context.executionPlan = createExecutionPlan({ requiresFramework: true });
      context.parsedCommand = {
        commandType: 'single',
        convertedPrompt,
      } as any;

      // JudgeSelectionStage sets this key directly
      context.state.framework.clientSelectedGates = ['code-quality', 'security-awareness'];

      service.applyGuidance.mockResolvedValue(createGuidanceResult(convertedPrompt) as any);

      await stage.execute(context);

      // Gate selections should still be present (set by JudgeSelectionStage)
      expect(context.state.framework.clientSelectedGates).toEqual([
        'code-quality',
        'security-awareness',
      ]);
    });

    test('applies style enhancement to single prompt system message', async () => {
      const context = new ExecutionContext({ command: '>>demo' });
      const convertedPrompt = createConvertedPrompt({
        systemMessage: 'You are a helpful assistant.',
      });
      context.executionPlan = createExecutionPlan({ requiresFramework: true });
      context.parsedCommand = {
        commandType: 'single',
        convertedPrompt,
      } as any;

      // Client style selection (set by JudgeSelectionStage)
      context.state.framework.clientSelectedStyle = 'analytical';

      // Mock to return the prompt AS IT WAS PASSED IN (with style already applied)
      service.applyGuidance.mockImplementation(async (prompt) => ({
        originalPrompt: prompt,
        enhancedPrompt: prompt, // Return prompt as-is to preserve style enhancement
        activeMethodology: 'CAGEERF',
        guidanceApplied: false, // No additional guidance
        processingTimeMs: 5,
        metadata: {},
      }));

      await stage.execute(context);

      // Should enhance system message with style guidance
      expect(context.state.framework.styleEnhancementApplied).toBe(true);
      expect(context.state.framework.selectedStyleGuidance).toContain('systematic analysis');
      // The style was applied before applyGuidance and preserved
      expect(service.applyGuidance).toHaveBeenCalledWith(
        expect.objectContaining({
          systemMessage: expect.stringContaining('**Response Style:**'),
        }),
        expect.any(Object)
      );
    });

    test('applies style enhancement to chain steps', async () => {
      const context = new ExecutionContext({ command: '>>chain' });
      context.executionPlan = createExecutionPlan({
        strategy: 'chain',
        requiresSession: true,
        requiresFramework: true,
      });

      const firstStepPrompt = createConvertedPrompt({
        id: 'step-one',
        systemMessage: 'Step 1 system message',
      });
      const secondStepPrompt = createConvertedPrompt({
        id: 'step-two',
        systemMessage: 'Step 2 system message',
      });

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
          executionPlan: createExecutionPlan({ requiresFramework: true }),
        },
      ];

      context.parsedCommand = {
        commandType: 'chain',
        steps: chainSteps,
      } as any;

      // Client style selection (set by JudgeSelectionStage)
      context.state.framework.clientSelectedStyle = 'procedural';

      // Mock to return prompts as passed (preserving style enhancement)
      service.applyGuidance.mockImplementation(async (prompt) => ({
        originalPrompt: prompt,
        enhancedPrompt: prompt,
        activeMethodology: 'CAGEERF',
        guidanceApplied: false,
        processingTimeMs: 5,
        metadata: {},
      }));

      await stage.execute(context);

      // Style metadata should be set
      expect(context.state.framework.styleEnhancementApplied).toBe(true);
      expect(context.state.framework.selectedStyleGuidance).toContain('step-by-step');

      // Both steps should have had style applied before guidance service was called
      // The guidance service was called with already-enhanced prompts
      expect(service.applyGuidance).toHaveBeenCalledTimes(2);
    });

    test('applies all client selections together', async () => {
      const context = new ExecutionContext({ command: '>>demo' });
      const convertedPrompt = createConvertedPrompt();
      context.executionPlan = createExecutionPlan({ requiresFramework: true });
      context.parsedCommand = {
        commandType: 'single',
        convertedPrompt,
      } as any;

      // All client selections from JudgeSelectionStage
      context.state.framework.clientOverride = 'ReACT';
      context.state.framework.clientSelectedGates = ['research-quality'];
      context.state.framework.clientSelectedStyle = 'reasoning';

      service.applyGuidance.mockResolvedValue(createGuidanceResult(convertedPrompt) as any);

      await stage.execute(context);

      // All selections should still be present and style enhancement applied
      expect(context.state.framework.clientOverride).toBe('ReACT');
      expect(context.state.framework.clientSelectedGates).toEqual(['research-quality']);
      expect(context.state.framework.styleEnhancementApplied).toBe(true);
    });

    test('handles unknown style gracefully', async () => {
      const context = new ExecutionContext({ command: '>>demo' });
      const convertedPrompt = createConvertedPrompt({
        systemMessage: 'Original system message',
      });
      context.executionPlan = createExecutionPlan({ requiresFramework: true });
      context.parsedCommand = {
        commandType: 'single',
        convertedPrompt,
      } as any;

      // Unknown style selection
      context.state.framework.clientSelectedStyle = 'unknown-style';

      service.applyGuidance.mockResolvedValue(createGuidanceResult(convertedPrompt) as any);

      await stage.execute(context);

      // Should NOT apply style enhancement for unknown styles
      expect(context.state.framework.styleEnhancementApplied).toBe(false);
      // Original system message should be preserved (not modified by unknown style)
      // Note: The service mock may have enhanced it differently
    });
  });
});
