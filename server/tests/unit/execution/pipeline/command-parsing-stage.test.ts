import { describe, expect, jest, test } from '@jest/globals';

import { ExecutionContext } from '../../../../src/execution/context/execution-context.js';
import { CommandParsingStage } from '../../../../src/execution/pipeline/stages/01-parsing-stage.js';

import type {
  ArgumentParser,
  ArgumentParsingResult,
} from '../../../../src/execution/parsers/argument-parser.js';
import type { UnifiedCommandParser } from '../../../../src/execution/parsers/command-parser.js';
import type { SymbolicCommandParseResult } from '../../../../src/execution/parsers/types/operator-types.js';
import type { Logger } from '../../../../src/logging/index.js';
import type { ConvertedPrompt } from '../../../../src/types/index.js';

const createLogger = (): Logger => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
});

const createArgumentResult = (processedArgs: Record<string, unknown>): ArgumentParsingResult => ({
  processedArgs,
  resolvedPlaceholders: {},
  validationResults: [],
  metadata: {
    parsingStrategy: 'test',
    appliedDefaults: [],
    typeCoercions: [],
    contextSources: {},
    warnings: [],
  },
});

describe('CommandParsingStage', () => {
  test('parses simple commands and stores prompt arguments', async () => {
    const parseResult = {
      promptId: 'demo_prompt',
      rawArgs: 'name="World"',
      format: 'simple' as const,
      commandType: 'single' as const,
      confidence: 0.91,
      metadata: {
        originalCommand: '>>demo_prompt name="World"',
        parseStrategy: 'simple',
        detectedFormat: 'simple',
        warnings: [],
      },
    };

    const mockCommandParser: Partial<UnifiedCommandParser> = {
      parseCommand: jest.fn().mockResolvedValue(parseResult),
    };
    const mockArgumentParser: Partial<ArgumentParser> = {
      parseArguments: jest.fn().mockResolvedValue(createArgumentResult({ name: 'World' })),
    };

    const convertedPrompt: ConvertedPrompt = {
      id: 'demo_prompt',
      name: 'Demo Prompt',
      description: '',
      category: 'analysis',
      userMessageTemplate: 'Hello {{name}}',
      arguments: [],
    };

    const stage = new CommandParsingStage(
      mockCommandParser as UnifiedCommandParser,
      mockArgumentParser as ArgumentParser,
      [convertedPrompt],
      createLogger()
    );

    const context = new ExecutionContext({ command: '>>demo_prompt name="World"' });
    await stage.execute(context);

    expect(context.parsedCommand?.promptId).toBe('demo_prompt');
    expect(context.getPromptArgs()).toEqual({ name: 'World' });
    expect(mockArgumentParser.parseArguments).toHaveBeenCalledWith(
      'name="World"',
      convertedPrompt,
      expect.any(Object)
    );
  });

  test('merges inline gate criteria for symbolic single prompts', async () => {
    const symbolicParseResult: SymbolicCommandParseResult = {
      promptId: 'demo_prompt',
      rawArgs: 'input="World"',
      format: 'symbolic',
      commandType: 'single',
      confidence: 0.82,
      metadata: {
        originalCommand: '>>demo_prompt input="World" :: "Use emojis"',
        parseStrategy: 'symbolic',
        detectedFormat: 'symbolic',
        warnings: [],
      },
      operators: {
        hasOperators: true,
        operatorTypes: ['gate'],
        parseComplexity: 'simple',
        operators: [
          {
            type: 'gate',
            criteria: 'Use emojis',
            parsedCriteria: ['Use emojis'],
            scope: 'execution',
            retryOnFailure: true,
            maxRetries: 1,
          },
        ],
      },
      executionPlan: {
        steps: [
          {
            stepNumber: 1,
            type: 'prompt',
            promptId: 'demo_prompt',
            args: 'input="World"',
            inlineGateCriteria: ['Use emojis'],
            dependencies: [],
            outputVariable: 'result',
          },
        ],
        argumentInputs: ['input="World"'],
        estimatedComplexity: 1,
        requiresSessionState: false,
      },
    };

    const mockCommandParser: Partial<UnifiedCommandParser> = {
      parseCommand: jest.fn().mockResolvedValue(symbolicParseResult),
    };
    const mockArgumentParser: Partial<ArgumentParser> = {
      parseArguments: jest.fn().mockResolvedValue(createArgumentResult({ input: 'World' })),
    };

    const convertedPrompt: ConvertedPrompt = {
      id: 'demo_prompt',
      name: 'Demo Prompt',
      description: '',
      category: 'general',
      userMessageTemplate: 'Hello {{input}}',
      arguments: [],
    };

    const stage = new CommandParsingStage(
      mockCommandParser as UnifiedCommandParser,
      mockArgumentParser as ArgumentParser,
      [convertedPrompt],
      createLogger()
    );

    const context = new ExecutionContext({
      command: '>>demo_prompt input="World" :: "Use emojis"',
    });
    await stage.execute(context);

    expect(context.parsedCommand?.inlineGateCriteria).toEqual(['Use emojis']);
    expect(context.getPromptArgs()).toEqual({ input: 'World' });
  });

  test('builds symbolic chains with per-step inline gates and args', async () => {
    const symbolicParseResult: SymbolicCommandParseResult = {
      promptId: 'step_one',
      rawArgs: '',
      format: 'symbolic',
      commandType: 'chain',
      confidence: 0.77,
      metadata: {
        originalCommand: '>>step_one name="Alpha" :: "Gate A" --> >>step_two topic="Z" :: "Gate B"',
        parseStrategy: 'symbolic',
        detectedFormat: 'symbolic',
        warnings: [],
      },
      operators: {
        hasOperators: true,
        operatorTypes: ['chain', 'gate'],
        parseComplexity: 'moderate',
        operators: [
          {
            type: 'chain',
            steps: [
              { promptId: 'step_one', args: 'name="Alpha"', position: 0, variableName: 'one' },
              { promptId: 'step_two', args: 'topic="Z"', position: 1, variableName: 'two' },
            ],
            contextPropagation: 'automatic',
          },
        ],
      },
      executionPlan: {
        steps: [
          {
            stepNumber: 1,
            type: 'prompt',
            promptId: 'step_one',
            args: 'name="Alpha"',
            inlineGateCriteria: ['Gate A'],
            dependencies: [],
            outputVariable: 'step1',
          },
          {
            stepNumber: 2,
            type: 'prompt',
            promptId: 'step_two',
            args: 'topic="Z"',
            inlineGateCriteria: ['Gate B'],
            dependencies: [],
            outputVariable: 'step2',
          },
        ],
        argumentInputs: ['name="Alpha"', 'topic="Z"'],
        estimatedComplexity: 2,
        requiresSessionState: true,
      },
    };

    const mockCommandParser: Partial<UnifiedCommandParser> = {
      parseCommand: jest.fn().mockResolvedValue(symbolicParseResult),
    };

    const mockArgumentParser: Partial<ArgumentParser> = {
      parseArguments: jest.fn().mockImplementation(async (args: string) => {
        if (args.includes('Alpha')) {
          return createArgumentResult({ name: 'Alpha' });
        }
        return createArgumentResult({ topic: 'Z' });
      }),
    };

    const convertedPrompts: ConvertedPrompt[] = [
      {
        id: 'step_one',
        name: 'First Step',
        description: '',
        category: 'analysis',
        userMessageTemplate: 'First',
        arguments: [],
      },
      {
        id: 'step_two',
        name: 'Second Step',
        description: '',
        category: 'development',
        userMessageTemplate: 'Second',
        arguments: [],
      },
    ];

    const stage = new CommandParsingStage(
      mockCommandParser as UnifiedCommandParser,
      mockArgumentParser as ArgumentParser,
      convertedPrompts,
      createLogger()
    );

    const context = new ExecutionContext({
      command: '>>step_one name="Alpha" :: "Gate A" --> >>step_two topic="Z" :: "Gate B"',
    });
    await stage.execute(context);

    expect(context.parsedCommand?.commandType).toBe('chain');
    expect(context.parsedCommand?.steps).toHaveLength(2);
    expect(context.parsedCommand?.steps?.[0].inlineGateCriteria).toEqual(['Gate A']);
    expect(context.parsedCommand?.steps?.[1].inlineGateCriteria).toEqual(['Gate B']);
    expect(context.parsedCommand?.steps?.[0].args).toEqual({ name: 'Alpha' });
    expect(context.parsedCommand?.steps?.[1].args).toEqual({ topic: 'Z' });
  });

  test('promotes prompts with chainSteps to chain command type', async () => {
    const parseResult = {
      promptId: 'workflow',
      rawArgs: 'feature="flow"',
      format: 'simple' as const,
      commandType: 'single' as const,
      confidence: 0.9,
      metadata: {
        originalCommand: '>>workflow feature="flow"',
        parseStrategy: 'simple',
        detectedFormat: 'simple',
        warnings: [],
      },
    };

    const mockCommandParser: Partial<UnifiedCommandParser> = {
      parseCommand: jest.fn().mockResolvedValue(parseResult),
    };
    const mockArgumentParser: Partial<ArgumentParser> = {
      parseArguments: jest.fn().mockResolvedValue(createArgumentResult({ feature: 'flow' })),
    };

    const convertedPrompt: ConvertedPrompt = {
      id: 'workflow',
      name: 'Workflow',
      description: '',
      category: 'analysis',
      userMessageTemplate: 'Workflow {{feature}}',
      arguments: [],
      chainSteps: [
        { promptId: 'step_prepare', stepName: 'prepare' },
        { promptId: 'step_review', stepName: 'review' },
      ],
    };

    const stage = new CommandParsingStage(
      mockCommandParser as UnifiedCommandParser,
      mockArgumentParser as ArgumentParser,
      [convertedPrompt],
      createLogger()
    );

    const context = new ExecutionContext({ command: '>>workflow feature="flow"' });
    await stage.execute(context);

    expect(context.parsedCommand?.commandType).toBe('chain');
    expect(context.parsedCommand?.steps).toHaveLength(2);
    expect(context.parsedCommand?.steps?.[0].promptId).toBe('step_prepare');
    expect(context.parsedCommand?.steps?.[1].promptId).toBe('step_review');
  });
});
