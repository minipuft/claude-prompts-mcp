import { describe, test, expect, beforeEach, jest } from '@jest/globals';

import { ExecutionContext } from '../../../../src/engine/execution/context/execution-context.js';
import { JudgeSelectionStage } from '../../../../src/engine/execution/pipeline/stages/10-judge-selection-stage.js';

import type { ConfigManager } from '../../../../src/infra/config/index.js';
import type { JudgeMenuFormatter } from '../../../../src/engine/gates/judge/judge-menu-formatter.js';
import type {
  JudgeResourceCollector,
  ResourceMenu,
} from '../../../../src/engine/gates/judge/judge-resource-collector.js';
import type { ExecutionPlan, ToolResponse } from '../../../../src/shared/types/index.js';

const createLogger = () => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
});

const createExecutionPlan = (overrides: Partial<ExecutionPlan> = {}): ExecutionPlan =>
  ({
    strategy: 'prompt',
    gates: [],
    requiresFramework: true,
    requiresSession: false,
    ...overrides,
  }) as ExecutionPlan;

const createEmptyResourceMenu = (): ResourceMenu => ({
  styles: [],
  frameworks: [],
  gates: [],
});

const createJudgeToolResponse = (text: string): ToolResponse => ({
  content: [{ type: 'text', text }],
  isError: false,
});

const createMockResourceCollector = (
  menu: ResourceMenu = createEmptyResourceMenu()
): jest.Mocked<JudgeResourceCollector> =>
  ({
    collectAllResources: jest.fn().mockResolvedValue(menu),
  }) as unknown as jest.Mocked<JudgeResourceCollector>;

const createMockMenuFormatter = (
  responseText: string = 'Resource Selection Required'
): jest.Mocked<JudgeMenuFormatter> =>
  ({
    buildJudgeResponse: jest.fn().mockReturnValue(createJudgeToolResponse(responseText)),
    getOperatorContext: jest.fn().mockReturnValue({
      hasFrameworkOperator: false,
      hasInlineGates: false,
      inlineGateIds: [],
      hasStyleSelector: false,
    }),
    formatResourceMenuForClaude: jest.fn().mockReturnValue(''),
  }) as unknown as jest.Mocked<JudgeMenuFormatter>;

const createConfigLoader = (judgeEnabled: boolean = true): jest.Mocked<ConfigManager> =>
  ({
    isJudgeEnabled: jest.fn().mockReturnValue(judgeEnabled),
  }) as unknown as jest.Mocked<ConfigManager>;

describe('JudgeSelectionStage', () => {
  let resourceCollector: jest.Mocked<JudgeResourceCollector>;
  let menuFormatter: jest.Mocked<JudgeMenuFormatter>;
  let configManager: jest.Mocked<ConfigManager>;
  let stage: JudgeSelectionStage;

  beforeEach(() => {
    resourceCollector = createMockResourceCollector();
    menuFormatter = createMockMenuFormatter();
    configManager = createConfigLoader(true);

    stage = new JudgeSelectionStage(
      resourceCollector,
      menuFormatter,
      configManager,
      createLogger()
    );
  });

  describe('Judge Phase Detection', () => {
    test('skips when judge modifier is not set', async () => {
      const context = new ExecutionContext({ command: '>>demo' });
      context.executionPlan = createExecutionPlan();

      await stage.execute(context);

      expect(context.state.framework.judgePhaseTriggered).toBe(false);
      expect(context.response).toBeUndefined();
      expect(resourceCollector.collectAllResources).not.toHaveBeenCalled();
    });

    test('triggers judge phase when %judge modifier is used', async () => {
      resourceCollector = createMockResourceCollector({
        styles: [{ id: 'analytical', name: 'Analytical' } as any],
        frameworks: [],
        gates: [],
      });
      stage = new JudgeSelectionStage(
        resourceCollector,
        menuFormatter,
        configManager,
        createLogger()
      );

      const context = new ExecutionContext({ command: '%judge >>demo' });
      context.executionPlan = createExecutionPlan({
        modifiers: { judge: true },
      });

      await stage.execute(context);

      expect(context.state.framework.judgePhaseTriggered).toBe(true);
      expect(context.response).toBeDefined();
      expect(resourceCollector.collectAllResources).toHaveBeenCalled();
      expect(menuFormatter.buildJudgeResponse).toHaveBeenCalled();
    });

    test('skips judge phase when judge system is disabled in config', async () => {
      configManager = createConfigLoader(false);
      stage = new JudgeSelectionStage(
        resourceCollector,
        menuFormatter,
        configManager,
        createLogger()
      );

      const context = new ExecutionContext({ command: '%judge >>demo' });
      context.executionPlan = createExecutionPlan({
        modifiers: { judge: true },
      });

      await stage.execute(context);

      expect(context.state.framework.judgePhaseTriggered).toBe(false);
      expect(context.response).toBeUndefined();
    });
  });

  describe('Resource Collection', () => {
    test('skips when no resources are available', async () => {
      const context = new ExecutionContext({ command: '%judge >>demo' });
      context.executionPlan = createExecutionPlan({
        modifiers: { judge: true },
      });

      await stage.execute(context);

      // Empty resource menu → no judge trigger
      expect(context.state.framework.judgePhaseTriggered).toBe(false);
      expect(context.response).toBeUndefined();
    });

    test('sets response when resources are available', async () => {
      resourceCollector = createMockResourceCollector({
        styles: [{ id: 'analytical', name: 'Analytical' } as any],
        frameworks: [],
        gates: [{ id: 'code-quality', name: 'Code Quality' } as any],
      });
      stage = new JudgeSelectionStage(
        resourceCollector,
        menuFormatter,
        configManager,
        createLogger()
      );

      const context = new ExecutionContext({ command: '%judge >>demo' });
      context.executionPlan = createExecutionPlan({
        modifiers: { judge: true },
      });

      await stage.execute(context);

      expect(context.state.framework.judgePhaseTriggered).toBe(true);
      expect(context.response).toBeDefined();
      expect(menuFormatter.buildJudgeResponse).toHaveBeenCalledWith(
        expect.objectContaining({ styles: expect.any(Array), gates: expect.any(Array) }),
        context
      );
    });
  });

  describe('Edge Cases', () => {
    test('handles null configManager gracefully', async () => {
      resourceCollector = createMockResourceCollector({
        styles: [{ id: 'analytical', name: 'Analytical' } as any],
        frameworks: [],
        gates: [],
      });
      const stageWithoutConfig = new JudgeSelectionStage(
        resourceCollector,
        menuFormatter,
        null,
        createLogger()
      );
      const context = new ExecutionContext({ command: '%judge >>demo' });
      context.executionPlan = createExecutionPlan({
        modifiers: { judge: true },
      });

      await stageWithoutConfig.execute(context);

      // Should still work without config manager (defaults to enabled)
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
      expect(resourceCollector.collectAllResources).not.toHaveBeenCalled();
    });
  });
});
