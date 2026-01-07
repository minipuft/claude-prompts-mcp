import { beforeEach, describe, expect, jest, test } from '@jest/globals';

import { ExecutionPlanner } from '../../../../src/execution/planning/execution-planner.js';

import type { ParsedCommand } from '../../../../src/execution/context/execution-context.js';
import type { Logger } from '../../../../src/logging/index.js';
import type { ContentAnalyzer } from '../../../../src/semantic/configurable-semantic-analyzer.js';
import type { ContentAnalysisResult } from '../../../../src/semantic/types.js';
import type { ConvertedPrompt } from '../../../../src/types/index.js';

const createLogger = (): Logger => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
});

const basePrompt: ConvertedPrompt = {
  id: 'demo',
  name: 'Demo Prompt',
  description: 'Description',
  category: 'development',
  userMessageTemplate: 'Explain {{topic}}',
  arguments: [],
};

const baseAnalysis: ContentAnalysisResult = {
  executionType: 'single',
  requiresExecution: true,
  requiresFramework: false,
  confidence: 0.85,
  reasoning: [],
  capabilities: {
    canDetectStructure: true,
    canAnalyzeComplexity: true,
    canRecommendFramework: true,
    hasSemanticUnderstanding: true,
  },
  limitations: [],
  warnings: [],
  executionCharacteristics: {
    hasConditionals: false,
    hasLoops: false,
    hasChainSteps: false,
    argumentCount: 1,
    templateComplexity: 1,
    hasSystemMessage: false,
    hasUserTemplate: true,
    hasStructuredReasoning: false,
    hasMethodologyKeywords: false,
    hasComplexAnalysis: false,
  },
  complexity: 'medium',
  suggestedGates: [],
  frameworkRecommendation: {
    shouldUseFramework: false,
    reasoning: [],
    confidence: 0.4,
  },
  analysisMetadata: {
    version: 'test',
    mode: 'minimal',
    analysisTime: 5,
    analyzer: 'content',
    cacheHit: false,
  },
};

const createAnalyzer = (
  overrides: Partial<ContentAnalysisResult> = {}
): Pick<ContentAnalyzer, 'analyzePrompt' | 'isLLMEnabled'> => {
  const merged: ContentAnalysisResult = {
    ...baseAnalysis,
    ...overrides,
    capabilities: { ...baseAnalysis.capabilities, ...overrides.capabilities },
    executionCharacteristics: {
      ...baseAnalysis.executionCharacteristics,
      ...overrides.executionCharacteristics,
    },
    frameworkRecommendation: {
      ...baseAnalysis.frameworkRecommendation,
      ...overrides.frameworkRecommendation,
    },
    analysisMetadata: {
      ...baseAnalysis.analysisMetadata,
      ...overrides.analysisMetadata,
    },
  };

  const analyzePrompt = jest.fn().mockResolvedValue(merged);
  const isLLMEnabled = jest.fn().mockReturnValue(true);
  return { analyzePrompt, isLLMEnabled };
};

describe('ExecutionPlanner', () => {
  let logger: Logger;

  beforeEach(() => {
    logger = createLogger();
  });

  test('detects chain strategy when parsed command contains chain operator', async () => {
    const analyzer = createAnalyzer();
    const planner = new ExecutionPlanner(analyzer, logger);

    const parsedCommand: ParsedCommand = {
      promptId: 'multi',
      rawArgs: '',
      format: 'symbolic',
      confidence: 0.9,
      metadata: {
        originalCommand: '>>multi --> >>step',
        parseStrategy: 'symbolic',
        detectedFormat: 'symbolic',
        warnings: [],
      },
      operators: {
        hasOperators: true,
        operatorTypes: ['chain'],
        parseComplexity: 'moderate',
        operators: [{ type: 'chain', steps: [], contextPropagation: 'automatic' }],
      },
    };

    const plan = await planner.createPlan({
      parsedCommand,
      convertedPrompt: basePrompt,
      frameworkEnabled: true,
    });

    expect(plan.strategy).toBe('chain');
    expect(plan.requiresSession).toBe(true);
    expect(plan.requiresFramework).toBe(true);
  });

  test('returns empty auto-assigned gates when GateManager is not set', async () => {
    // Without GateManager, autoAssignGates returns empty (gates come from explicit config only)
    const analyzer = createAnalyzer({ executionType: 'single' });
    const planner = new ExecutionPlanner(analyzer, logger);

    const plan = await planner.createPlan({
      convertedPrompt: { ...basePrompt, category: 'documentation' },
      frameworkEnabled: false,
    });

    expect(plan.strategy).toBe('single');
    // Without GateManager, no auto-assigned gates (gates come from YAML activation rules via GateManager)
    expect(plan.gates).toEqual([]);
  });

  test('includes gates from gateOverrides.gates parameter', async () => {
    const analyzer = createAnalyzer();
    const planner = new ExecutionPlanner(analyzer, logger);

    const plan = await planner.createPlan({
      convertedPrompt: basePrompt,
      gateOverrides: {
        gates: ['technical-accuracy'],
      },
    });

    expect(plan.gates).toContain('technical-accuracy');
  });

  test('requires framework when symbolic plan contains framework override even if disabled', async () => {
    const analyzer = createAnalyzer();
    const planner = new ExecutionPlanner(analyzer, logger);

    const parsedCommand: ParsedCommand = {
      promptId: 'demo',
      rawArgs: '',
      format: 'symbolic',
      confidence: 0.92,
      metadata: {
        originalCommand: '>>demo',
        parseStrategy: 'symbolic',
        detectedFormat: 'symbolic',
        warnings: [],
      },
      executionPlan: { frameworkOverride: 'CAGEERF' } as any,
    };

    const plan = await planner.createPlan({
      parsedCommand,
      convertedPrompt: basePrompt,
      frameworkEnabled: false,
    });

    expect(plan.requiresFramework).toBe(true);
  });

  test('createChainPlan returns per-step plans and inherits chain strategy', async () => {
    const analyzer = createAnalyzer();
    const planner = new ExecutionPlanner(analyzer, logger);

    const steps = [
      {
        stepNumber: 1,
        promptId: 'step_one',
        args: {},
        convertedPrompt: { ...basePrompt, id: 'step_one' },
      },
      {
        stepNumber: 2,
        promptId: 'step_two',
        args: {},
        convertedPrompt: { ...basePrompt, id: 'step_two' },
      },
    ];

    const parsedCommand: ParsedCommand = {
      promptId: 'chain_prompt',
      rawArgs: '',
      format: 'symbolic',
      confidence: 0.9,
      commandType: 'chain',
      metadata: {
        originalCommand: '>>chain_prompt',
        parseStrategy: 'symbolic',
        detectedFormat: 'symbolic',
        warnings: [],
      },
    };

    const { chainPlan, stepPlans } = await planner.createChainPlan({
      parsedCommand,
      steps,
    });

    expect(chainPlan.strategy).toBe('chain');
    expect(stepPlans).toHaveLength(2);
    expect(stepPlans[0].requiresSession).toBe(true);
  });

  describe('applyScriptToolDefaults', () => {
    test('applies clean modifier by default for prompts with script tools', async () => {
      const analyzer = createAnalyzer();
      const planner = new ExecutionPlanner(analyzer, logger);

      const promptWithScriptTools: ConvertedPrompt = {
        ...basePrompt,
        scriptTools: [
          {
            id: 'word_count',
            name: 'Word Counter',
            description: 'Counts words',
            scriptPath: 'script.py',
            runtime: 'python',
            inputSchema: { type: 'object', properties: {} },
            toolDir: '/tmp/tools/word_count',
            absoluteScriptPath: '/tmp/tools/word_count/script.py',
            promptId: 'demo',
            descriptionContent: 'Counts words in text',
          },
        ],
      };

      const plan = await planner.createPlan({
        convertedPrompt: promptWithScriptTools,
        frameworkEnabled: true,
      });

      expect(plan.modifiers?.clean).toBe(true);
      // Clean mode should disable framework requirement
      expect(plan.requiresFramework).toBe(false);
    });

    test('does not apply clean default when user provides explicit modifier', async () => {
      const analyzer = createAnalyzer();
      const planner = new ExecutionPlanner(analyzer, logger);

      const promptWithScriptTools: ConvertedPrompt = {
        ...basePrompt,
        scriptTools: [
          {
            id: 'word_count',
            name: 'Word Counter',
            description: 'Counts words',
            scriptPath: 'script.py',
            runtime: 'python',
            inputSchema: { type: 'object', properties: {} },
            toolDir: '/tmp/tools/word_count',
            absoluteScriptPath: '/tmp/tools/word_count/script.py',
            promptId: 'demo',
            descriptionContent: 'Counts words in text',
          },
        ],
      };

      const parsedCommand: ParsedCommand = {
        promptId: 'demo',
        rawArgs: '',
        format: 'symbolic',
        confidence: 0.9,
        modifiers: { framework: true }, // User explicitly requested framework mode
        metadata: {
          originalCommand: '%framework >>demo',
          parseStrategy: 'symbolic',
          detectedFormat: 'symbolic',
          warnings: [],
        },
      };

      const plan = await planner.createPlan({
        parsedCommand,
        convertedPrompt: promptWithScriptTools,
        frameworkEnabled: true,
      });

      expect(plan.modifiers?.framework).toBe(true);
      expect(plan.requiresFramework).toBe(true);
    });

    test('does not apply clean default when user provides custom gates', async () => {
      const analyzer = createAnalyzer();
      const planner = new ExecutionPlanner(analyzer, logger);

      const promptWithScriptTools: ConvertedPrompt = {
        ...basePrompt,
        scriptTools: [
          {
            id: 'word_count',
            name: 'Word Counter',
            description: 'Counts words',
            scriptPath: 'script.py',
            runtime: 'python',
            inputSchema: { type: 'object', properties: {} },
            toolDir: '/tmp/tools/word_count',
            absoluteScriptPath: '/tmp/tools/word_count/script.py',
            promptId: 'demo',
            descriptionContent: 'Counts words in text',
          },
        ],
      };

      const plan = await planner.createPlan({
        convertedPrompt: promptWithScriptTools,
        frameworkEnabled: true,
        gateOverrides: {
          gates: ['code-quality'], // User provided custom gates
        },
      });

      // Should NOT default to clean when user provides gates
      expect(plan.modifiers?.clean).toBeFalsy();
    });

    test('does not apply clean default for prompts without script tools', async () => {
      const analyzer = createAnalyzer();
      const planner = new ExecutionPlanner(analyzer, logger);

      const plan = await planner.createPlan({
        convertedPrompt: basePrompt, // No scriptTools
        frameworkEnabled: true,
      });

      // Should NOT default to clean for regular prompts
      expect(plan.modifiers?.clean).toBeFalsy();
    });
  });
});
