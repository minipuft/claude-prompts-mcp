import { describe, test, expect, beforeEach, jest } from '@jest/globals';

import { ExecutionContext } from '../../../../dist/execution/context/execution-context.js';
import { JudgeSelectionStage } from '../../../../dist/execution/pipeline/stages/06a-judge-selection-stage.js';

import type { ConfigManager } from '../../../../dist/config/index.js';
import type { GateLoader } from '../../../../dist/gates/core/gate-loader.js';
import type { LightweightGateDefinition } from '../../../../dist/gates/types.js';
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

const createGuidancePrompt = (id: string, description: string): ConvertedPrompt => ({
  id,
  name: id,
  description,
  category: 'guidance',
  userMessageTemplate: `Guidance: ${id}`,
  arguments: [],
});

const createFrameworkResource = (id: string, description: string): ConvertedPrompt => ({
  id,
  name: id,
  description,
  category: 'guidance',
  userMessageTemplate: '',
  arguments: [],
});

const createGateDefinition = (id: string, description: string): LightweightGateDefinition => ({
  id,
  name: id,
  description,
  type: 'validation',
  severity: 'medium',
});

const createExecutionPlan = (overrides: Partial<ExecutionPlan> = {}): ExecutionPlan => ({
  strategy: 'prompt',
  gates: [],
  requiresFramework: true,
  requiresSession: false,
  ...overrides,
});

const createConfigManager = (judgeEnabled: boolean = true): jest.Mocked<ConfigManager> =>
  ({
    isJudgeEnabled: jest.fn().mockReturnValue(judgeEnabled),
  }) as unknown as jest.Mocked<ConfigManager>;

describe('JudgeSelectionStage', () => {
  let gateLoader: jest.Mocked<GateLoader>;
  let configManager: jest.Mocked<ConfigManager>;
  let stage: JudgeSelectionStage;
  let promptsProvider: jest.Mock;
  let frameworksProvider: jest.Mock;

  beforeEach(() => {
    gateLoader = {
      listAvailableGateDefinitions: jest.fn().mockResolvedValue([]),
    } as unknown as jest.Mocked<GateLoader>;

    promptsProvider = jest.fn().mockReturnValue([]);
    configManager = createConfigManager(true);
    frameworksProvider = jest.fn().mockResolvedValue([]);

    stage = new JudgeSelectionStage(
      promptsProvider,
      gateLoader,
      configManager,
      createLogger(),
      frameworksProvider
    );
  });

  describe('Judge Phase Detection', () => {
    test('skips when judge modifier is not set', async () => {
      const context = new ExecutionContext({ command: '>>demo' });
      context.executionPlan = createExecutionPlan();

      await stage.execute(context);

      expect(context.state.framework.judgePhaseTriggered).toBe(false);
      expect(context.response).toBeUndefined();
      expect(promptsProvider).not.toHaveBeenCalled();
    });

    test('ignores deprecated guided parameter (no judge trigger)', async () => {
      const context = new ExecutionContext({ command: '>>demo', guided: true });
      context.executionPlan = createExecutionPlan();

      await stage.execute(context);

      expect(context.state.framework.judgePhaseTriggered).toBe(false);
      expect(context.response).toBeUndefined();
      expect(promptsProvider).not.toHaveBeenCalled();
    });

    test('triggers judge phase when %judge modifier is used', async () => {
      const context = new ExecutionContext({ command: '%judge >>demo' });
      context.executionPlan = createExecutionPlan({
        modifiers: { judge: true },
      });

      const stylePrompt = createGuidancePrompt('analytical', 'Analytical style');
      promptsProvider.mockReturnValue([stylePrompt]);
      gateLoader.listAvailableGateDefinitions.mockResolvedValue([]);

      await stage.execute(context);

      expect(context.state.framework.judgePhaseTriggered).toBe(true);
      expect(context.response).toBeDefined();
    });

    test('skips judge phase when judge system is disabled in config', async () => {
      configManager = createConfigManager(false);
      stage = new JudgeSelectionStage(promptsProvider, gateLoader, configManager, createLogger());

      const context = new ExecutionContext({ command: '%judge >>demo' });
      context.executionPlan = createExecutionPlan({
        modifiers: { judge: true },
      });

      await stage.execute(context);

      expect(context.state.framework.judgePhaseTriggered).toBe(false);
      expect(context.response).toBeUndefined();
    });
  });

  describe('Judge Response Format', () => {
    test('includes resource menu in judge response', async () => {
      const context = new ExecutionContext({ command: '%judge >>demo' });
      context.executionPlan = createExecutionPlan({
        modifiers: { judge: true },
      });

      const stylePrompt = createGuidancePrompt('analytical', 'Systematic analysis');
      const frameworkPrompt = createGuidancePrompt('cageerf-guide', 'CAGEERF methodology');
      const gate = createGateDefinition('code-quality', 'Code quality checks');

      promptsProvider.mockReturnValue([stylePrompt]);
      frameworksProvider.mockResolvedValue([createFrameworkResource('cageerf', 'CAGEERF')]);
      gateLoader.listAvailableGateDefinitions.mockResolvedValue([gate]);

      await stage.execute(context);

      const response = context.response;
      expect(response).toBeDefined();
      const responseText = (response?.content[0] as { text: string }).text;

      expect(responseText).toContain('Resource Selection Required');
      expect(responseText).toContain('>>demo');
      expect(responseText).toContain('prompt_engine');
    });

    test('includes selection instructions in judge response', async () => {
      const context = new ExecutionContext({ command: '%judge >>demo' });
      context.executionPlan = createExecutionPlan({
        modifiers: { judge: true },
      });

      const stylePrompt = createGuidancePrompt('analytical', 'Analysis style');
      promptsProvider.mockReturnValue([stylePrompt]);
      gateLoader.listAvailableGateDefinitions.mockResolvedValue([]);

      await stage.execute(context);

      const response = context.response;
      const responseText = (response?.content[0] as { text: string }).text;

      expect(responseText).toContain('@<framework>');
      expect(responseText).toContain('#<analytical|procedural|creative|reasoning>');
      expect(responseText).toContain(':: <gate_id');
    });
  });

  describe('Resource Collection', () => {
    test('separates styles from frameworks based on ID patterns', async () => {
      const context = new ExecutionContext({ command: '%judge >>demo' });
      context.executionPlan = createExecutionPlan({
        modifiers: { judge: true },
      });

      const analyticalStyle = createGuidancePrompt('analytical', 'Analytical style');
      const cageerfFramework = createGuidancePrompt('cageerf-guide', 'CAGEERF');
      const reactFramework = createGuidancePrompt('react-guide', 'ReACT');

      promptsProvider.mockReturnValue([analyticalStyle, cageerfFramework, reactFramework]);
      gateLoader.listAvailableGateDefinitions.mockResolvedValue([]);

      await stage.execute(context);

      const response = context.response;
      const responseText = (response?.content[0] as { text: string }).text;

      // Styles section should contain analytical
      expect(responseText).toContain('analytical');
    });

    test('only includes guidance category prompts', async () => {
      const context = new ExecutionContext({ command: '%judge >>demo' });
      context.executionPlan = createExecutionPlan({
        modifiers: { judge: true },
      });

      const guidancePrompt = createGuidancePrompt('analytical', 'Guidance');
      const generalPrompt = createConvertedPrompt({ id: 'general', category: 'general' });

      promptsProvider.mockReturnValue([guidancePrompt, generalPrompt]);
      gateLoader.listAvailableGateDefinitions.mockResolvedValue([]);

      await stage.execute(context);

      const response = context.response;
      const responseText = (response?.content[0] as { text: string }).text;

      expect(responseText).toContain('analytical');
      expect(responseText).not.toContain('general-prompt');
    });

    test('skips when no resources are available', async () => {
      const context = new ExecutionContext({ command: '%judge >>demo' });
      context.executionPlan = createExecutionPlan({
        modifiers: { judge: true },
      });

      promptsProvider.mockReturnValue([]);
      gateLoader.listAvailableGateDefinitions.mockResolvedValue([]);

      await stage.execute(context);

      // Should not trigger judge phase if no resources
      expect(context.state.framework.judgePhaseTriggered).toBe(false);
      expect(context.response).toBeUndefined();
    });
  });

  describe('Edge Cases', () => {
    test('handles null promptsProvider gracefully', async () => {
      const stageWithoutProvider = new JudgeSelectionStage(
        null,
        gateLoader,
        configManager,
        createLogger()
      );
      const context = new ExecutionContext({ command: '%judge >>demo' });
      context.executionPlan = createExecutionPlan({
        modifiers: { judge: true },
      });

      const gate = createGateDefinition('code-quality', 'Quality gate');
      gateLoader.listAvailableGateDefinitions.mockResolvedValue([gate]);

      await stageWithoutProvider.execute(context);

      expect(context.state.framework.judgePhaseTriggered).toBe(true);
      expect(context.response).toBeDefined();
    });

    test('handles null gateLoader gracefully', async () => {
      const stageWithoutGateLoader = new JudgeSelectionStage(
        promptsProvider,
        null,
        configManager,
        createLogger()
      );
      const context = new ExecutionContext({ command: '%judge >>demo' });
      context.executionPlan = createExecutionPlan({
        modifiers: { judge: true },
      });

      const stylePrompt = createGuidancePrompt('analytical', 'Style');
      promptsProvider.mockReturnValue([stylePrompt]);

      await stageWithoutGateLoader.execute(context);

      expect(context.state.framework.judgePhaseTriggered).toBe(true);
      expect(context.response).toBeDefined();
    });

    test('handles null configManager gracefully', async () => {
      const stageWithoutConfig = new JudgeSelectionStage(
        promptsProvider,
        gateLoader,
        null,
        createLogger()
      );
      const context = new ExecutionContext({ command: '%judge >>demo' });
      context.executionPlan = createExecutionPlan({
        modifiers: { judge: true },
      });

      const stylePrompt = createGuidancePrompt('analytical', 'Style');
      promptsProvider.mockReturnValue([stylePrompt]);
      gateLoader.listAvailableGateDefinitions.mockResolvedValue([]);

      await stageWithoutConfig.execute(context);

      // Should still work without config manager
      expect(context.state.framework.judgePhaseTriggered).toBe(true);
    });

    test('skips when session blueprint is restored', async () => {
      const context = new ExecutionContext({ command: '%judge >>demo' });
      context.executionPlan = createExecutionPlan({
        modifiers: { judge: true },
      });
      context.state.session.isBlueprintRestored = true;

      await stage.execute(context);

      expect(context.state.framework.judgePhaseTriggered).toBe(false);
      expect(promptsProvider).not.toHaveBeenCalled();
    });
  });
});
