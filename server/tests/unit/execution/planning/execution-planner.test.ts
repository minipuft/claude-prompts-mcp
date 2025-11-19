import { beforeEach, describe, expect, jest, test } from '@jest/globals';

import { ExecutionPlanner } from '../../../../src/execution/planning/execution-planner.js';
import type { ParsedCommand } from '../../../../src/execution/context/execution-context.js';
import type { Logger } from '../../../../src/logging/index.js';
import type { ContentAnalysisResult } from '../../../../src/semantic/types.js';
import type { ContentAnalyzer } from '../../../../src/semantic/configurable-semantic-analyzer.js';
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
  executionType: 'prompt',
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
    mode: 'structural',
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
    expect(plan.apiValidationEnabled).toBe(false);
  });

  test('auto-assigns documentation gates and keeps methodology gates unless excluded', async () => {
    const analyzer = createAnalyzer({ executionType: 'template' });
    const planner = new ExecutionPlanner(analyzer, logger);

    const plan = await planner.createPlan({
      convertedPrompt: { ...basePrompt, category: 'documentation' },
      frameworkEnabled: false,
    });

    expect(plan.strategy).toBe('template');
    expect(new Set(plan.gates)).toEqual(
      new Set(['content-structure', 'educational-clarity', 'framework-compliance'])
    );
    expect(plan.apiValidationEnabled).toBe(false);
  });

  test('respects gate validation overrides and custom quality gates', async () => {
    const analyzer = createAnalyzer();
    const planner = new ExecutionPlanner(analyzer, logger);

    const plan = await planner.createPlan({
      convertedPrompt: basePrompt,
      gateOverrides: {
        apiValidation: false,
        qualityGates: ['technical-accuracy'],
      },
    });

    expect(plan.gates).toContain('technical-accuracy');
    expect(plan.apiValidationEnabled).toBe(false);
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
});
