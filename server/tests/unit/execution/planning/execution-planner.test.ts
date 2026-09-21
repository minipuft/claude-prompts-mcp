import { beforeEach, describe, expect, jest, test } from '@jest/globals';

import { ExecutionPlanner } from '../../../../src/engine/execution/planning/execution-planner.js';

import type { ParsedCommand } from '../../../../src/engine/execution/context/execution-context.js';
import type { Logger } from '../../../../src/infra/logging/index.js';
import type { ContentAnalyzer } from '../../../../src/modules/semantic/content-analyzer.js';
import type { ContentAnalysisResult } from '../../../../src/modules/semantic/types.js';
import type { ConvertedPrompt } from '../../../../src/shared/types/index.js';

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
    hasFrameworkKeywords: false,
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
): Pick<ContentAnalyzer, 'analyzePrompt'> => {
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
  return { analyzePrompt };
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

  describe('requiresSession', () => {
    test('requires session when gateOverrides.gates are provided (MCP gates parameter)', async () => {
      const analyzer = createAnalyzer();
      const planner = new ExecutionPlanner(analyzer, logger);

      const plan = await planner.createPlan({
        convertedPrompt: basePrompt,
        gateOverrides: {
          gates: ['intent-quality'],
        },
      });

      expect(plan.gates).toContain('intent-quality');
      expect(plan.requiresSession).toBe(true);
    });

    test('requires session when symbolic gate operator is present', async () => {
      const analyzer = createAnalyzer();
      const planner = new ExecutionPlanner(analyzer, logger);

      const parsedCommand: ParsedCommand = {
        promptId: 'demo',
        rawArgs: '',
        format: 'symbolic',
        confidence: 0.9,
        metadata: {
          originalCommand: ">>demo :: 'check'",
          parseStrategy: 'symbolic',
          detectedFormat: 'symbolic',
          warnings: [],
        },
        operators: {
          hasOperators: true,
          operatorTypes: ['gate'],
          parseComplexity: 'moderate',
          operators: [
            {
              type: 'gate',
              criteria: 'check accuracy',
              parsedCriteria: ['check accuracy'],
              scope: 'execution',
            } as any,
          ],
        },
      };

      const plan = await planner.createPlan({
        parsedCommand,
        convertedPrompt: basePrompt,
      });

      expect(plan.requiresSession).toBe(true);
    });

    test('does not require session for plain single prompt without gates', async () => {
      const analyzer = createAnalyzer();
      const planner = new ExecutionPlanner(analyzer, logger);

      const plan = await planner.createPlan({
        convertedPrompt: basePrompt,
      });

      expect(plan.requiresSession).toBe(false);
    });

    test('requires session when prompt has built-in chain steps', async () => {
      const analyzer = createAnalyzer();
      const planner = new ExecutionPlanner(analyzer, logger);

      const promptWithChain: ConvertedPrompt = {
        ...basePrompt,
        chainSteps: [
          { step: 1, prompt: 'first', args: {} },
          { step: 2, prompt: 'second', args: {} },
        ] as any,
      };

      const plan = await planner.createPlan({
        convertedPrompt: promptWithChain,
      });

      expect(plan.requiresSession).toBe(true);
    });
  });
});

/**
 * B13: the planner is where "the prompt declared an artifact block" becomes "this run touches
 * these kinds". It is the only place the two halves meet — `produces` is on the prompt,
 * `fromArgument`'s value is on the parsed command — so if it does not union them here, nothing
 * downstream can.
 */
describe('ExecutionPlanner — B13 declaredArtifacts', () => {
  let logger: Logger;

  beforeEach(() => {
    logger = createLogger();
  });

  /** Captures the selection context the resolver hands the registry. */
  const createCapturingGateManager = () => {
    const calls: Array<Record<string, unknown>> = [];
    const manager = {
      selectGates: jest.fn((context: Record<string, unknown>) => {
        calls.push(context);
        return {
          selectedIds: [],
          guides: [],
          skippedIds: [],
          metadata: { selectionMethod: 'category', selectionTime: 0 },
        };
      }),
    };
    return { manager, calls };
  };

  const parsedWithArgs = (promptArgs: Record<string, unknown>): ParsedCommand => ({
    promptId: 'demo',
    rawArgs: '',
    format: 'simple',
    confidence: 1,
    promptArgs,
    metadata: {
      originalCommand: '>>demo',
      parseStrategy: 'simple',
      detectedFormat: 'simple',
      warnings: [],
    },
  });

  test('fromArgument classifies the named argument value into kinds, in table order', async () => {
    const { manager, calls } = createCapturingGateManager();
    const planner = new ExecutionPlanner(createAnalyzer(), logger);
    planner.setGateManager(manager as never);

    await planner.createPlan({
      parsedCommand: parsedWithArgs({ files: 'server/tests/x.test.ts, README.md' }),
      convertedPrompt: {
        ...basePrompt,
        arguments: [{ name: 'files', required: true }],
        artifacts: { fromArgument: 'files' },
      } as ConvertedPrompt,
    });

    expect(calls).toHaveLength(1);
    expect(calls[0]?.['declaredArtifacts']).toEqual(['test', 'readme']);
  });

  test('produces unions with the classified paths, deduped', async () => {
    const { manager, calls } = createCapturingGateManager();
    const planner = new ExecutionPlanner(createAnalyzer(), logger);
    planner.setGateManager(manager as never);

    await planner.createPlan({
      parsedCommand: parsedWithArgs({ files: 'a.test.ts' }),
      convertedPrompt: {
        ...basePrompt,
        arguments: [{ name: 'files', required: true }],
        artifacts: { produces: ['plan', 'test'], fromArgument: 'files' },
      } as ConvertedPrompt,
    });

    expect(calls[0]?.['declaredArtifacts']).toEqual(['test', 'plan']);
  });

  test('a prompt with no artifacts block leaves the selection context clean', async () => {
    const { manager, calls } = createCapturingGateManager();
    const planner = new ExecutionPlanner(createAnalyzer(), logger);
    planner.setGateManager(manager as never);

    await planner.createPlan({
      parsedCommand: parsedWithArgs({ files: 'a.test.ts' }),
      convertedPrompt: basePrompt,
    });

    expect(calls[0]).not.toHaveProperty('declaredArtifacts');
  });
});
