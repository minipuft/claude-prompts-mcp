import { describe, expect, jest, test } from '@jest/globals';

import { PromptRequestContext } from '../../../../src/engine/execution/context/prompt-request-context.js';
import { ResponseAssembler } from '../../../../src/engine/execution/formatting/response-assembler.js';
import { createSymbolicCommandParser } from '../../../../src/engine/execution/parsers/symbolic-operator-parser.js';
import { OperatorValidationStage } from '../../../../src/engine/execution/pipeline/stages/06-operator-validation-stage.js';

import type { FrameworkValidator } from '../../../../src/engine/frameworks/framework-validator.js';
import type { Logger } from '../../../../src/infra/logging/index.js';

const createLogger = (): Logger => ({
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
  debug: jest.fn(),
});

describe('OperatorValidationStage', () => {
  test('skips when no operators detected', async () => {
    const validator = { validateAndNormalize: jest.fn() } as unknown as FrameworkValidator;
    const logger = createLogger();
    const stage = new OperatorValidationStage(validator, logger);
    const context = new PromptRequestContext({ command: '>>demo' }, logger);
    context.parsedCommand = {
      promptId: 'demo',
      rawArgs: '',
      format: 'symbolic',
      confidence: 0.9,
      metadata: {
        originalCommand: '>>demo',
        parseStrategy: 'symbolic',
        detectedFormat: 'symbolic',
        warnings: [],
      },
      operators: {
        hasOperators: false,
        operatorTypes: [],
        operators: [],
        parseComplexity: 'simple',
      },
    };

    await stage.execute(context);

    expect(validator.validateAndNormalize).not.toHaveBeenCalled();
    // Nothing in production reads diagnostics back (P4.52); the stage's only diagnostic
    // call is the "Normalized framework operators" debug entry, which fires on the
    // logger via DiagnosticAccumulator.add() — confirm it never fires on the skip path.
    expect(logger.debug).not.toHaveBeenCalledWith(
      expect.stringContaining('Normalized framework operators'),
      expect.anything()
    );
  });

  describe('subagentModel → delegated normalization', () => {
    const buildChainContext = (
      stepOverrides: Array<{
        subagentModel?: 'heavy' | 'standard' | 'fast';
        delegated?: boolean;
        await?: 'node' | 'run';
      }>,
      promptDelegation = false
    ) => {
      const stage = new OperatorValidationStage(null, createLogger());
      const context = new PromptRequestContext({ command: '>>a --> >>b --> >>c' });
      context.parsedCommand = {
        promptId: 'a',
        rawArgs: '',
        format: 'symbolic',
        confidence: 0.9,
        metadata: {
          originalCommand: '>>a --> >>b --> >>c',
          parseStrategy: 'symbolic',
          detectedFormat: 'symbolic',
          warnings: [],
        },
        commandType: 'chain',
        convertedPrompt: { delegation: promptDelegation } as any,
        steps: stepOverrides.map((s, i) => ({
          stepNumber: i + 1,
          promptId: `step${i}`,
          args: {},
          ...s,
        })),
        operators: {
          hasOperators: true,
          operatorTypes: ['chain'],
          parseComplexity: 'simple',
          operators: [
            {
              type: 'chain' as const,
              contextPropagation: 'automatic' as const,
              steps: stepOverrides.map((s, i) => ({
                promptId: `step${i}`,
                args: '',
                position: i,
                variableName: `step${i}_result`,
                ...(s.delegated ? { delegated: true } : {}),
              })),
            },
          ],
        },
      } as any;
      return { stage, context };
    };

    test('subagentModel: fast sets delegated on step prompt', async () => {
      const { stage, context } = buildChainContext([{}, { subagentModel: 'fast' }, {}]);

      await stage.execute(context);

      expect(context.parsedCommand!.steps![0].delegated).not.toBe(true);
      expect(context.parsedCommand!.steps![1].delegated).toBe(true);
      expect(context.parsedCommand!.steps![2].delegated).not.toBe(true);
    });

    test('await: run (a detached step) is delegated; await: node is not', async () => {
      // Tier 4: a step the run does not wait on only makes sense when a worker runs it, so the
      // single producer of the runtime flag reads `await: run` as a third source.
      const { stage, context } = buildChainContext([{ await: 'node' }, { await: 'run' }, {}]);
      await stage.execute(context);
      expect(context.parsedCommand!.steps![0].delegated).not.toBe(true);
      expect(context.parsedCommand!.steps![1].delegated).toBe(true);
      expect(context.parsedCommand!.steps![2].delegated).not.toBe(true);
    });

    test('all subagentModel variants trigger delegation', async () => {
      for (const model of ['heavy', 'standard', 'fast'] as const) {
        const { stage, context } = buildChainContext([{ subagentModel: model }, {}]);

        await stage.execute(context);

        expect(context.parsedCommand!.steps![0].delegated).toBe(true);
        expect(context.parsedCommand!.steps![1].delegated).not.toBe(true);
      }
    });

    test('step with both ==> delegated and subagentModel is idempotent', async () => {
      const { stage, context } = buildChainContext([
        {},
        { delegated: true, subagentModel: 'fast' },
      ]);

      await stage.execute(context);

      // Already delegated from parser — normalization keeps it true
      expect(context.parsedCommand!.steps![1].delegated).toBe(true);
    });

    test('steps without subagentModel are not affected by adjacent subagentModel steps', async () => {
      const { stage, context } = buildChainContext([{}, { subagentModel: 'fast' }, {}]);

      await stage.execute(context);

      expect(context.parsedCommand!.steps![0].delegated).not.toBe(true);
      expect(context.parsedCommand!.steps![2].delegated).not.toBe(true);
    });

    test('no step marked delegated when none declare subagentModel', async () => {
      const { stage, context } = buildChainContext([{}, {}, {}]);

      await stage.execute(context);

      for (const step of context.parsedCommand!.steps!) {
        expect(step.delegated).not.toBe(true);
      }
    });
  });

  test('normalizes framework operators and updates metadata + execution plan overrides', async () => {
    const validator = {
      validateAndNormalize: jest.fn().mockReturnValue({ normalizedId: 'CAGEERF' }),
    } as unknown as FrameworkValidator;
    const logger = createLogger();
    const stage = new OperatorValidationStage(validator, logger);

    const context = new PromptRequestContext({ command: '@cageerf >>demo' }, logger);
    context.parsedCommand = {
      promptId: 'demo',
      rawArgs: '',
      format: 'symbolic',
      confidence: 0.9,
      metadata: {
        originalCommand: '>>demo',
        parseStrategy: 'symbolic',
        detectedFormat: 'symbolic',
        warnings: [],
      },
      operators: {
        hasOperators: true,
        operatorTypes: ['framework'],
        parseComplexity: 'simple',
        operators: [
          {
            type: 'framework',
            frameworkId: 'cageerf',
            normalizedId: undefined,
            scopeType: 'execution',
            temporary: false,
          },
        ],
      },
      executionPlan: { frameworkOverride: 'CAGEERF' },
    } as any;

    await stage.execute(context);

    expect(validator.validateAndNormalize).toHaveBeenCalledWith('cageerf', expect.any(Object));
    expect(context.parsedCommand?.operators?.operators[0]).toMatchObject({
      normalizedId: 'CAGEERF',
    });
    expect(context.parsedCommand?.executionPlan?.frameworkOverride).toBe('CAGEERF');
    // Nothing in production reads diagnostics back (P4.52); observe the same entry through
    // the logger side effect DiagnosticAccumulator.add() always performs.
    expect(logger.debug).toHaveBeenCalledWith(
      '[OperatorValidation] Normalized framework operators',
      { normalizedFrameworkOperators: 1 }
    );
  });
});

/**
 * `^` is the framework operator and `@` a deprecated spelling: a command typed with `@` runs
 * unchanged, and its reply carries ONE advisory line naming `^`. Real parser, real stage, real
 * ResponseAssembler; only the framework validator and the logger are doubles.
 */
describe('OperatorValidationStage — deprecated framework spelling', () => {
  const NOTE =
    'Deprecated spelling: `@ReACT` still works, but the framework operator is `^ReACT`; ' +
    '`@` is removed at the next major.';

  const createValidator = () =>
    ({
      validateAndNormalize: jest.fn((frameworkId: string) => {
        if (frameworkId.toUpperCase() !== 'REACT') {
          throw new Error(`Framework '^${frameworkId}' not found.`);
        }
        return { normalizedId: 'REACT' };
      }),
    }) as unknown as FrameworkValidator & { validateAndNormalize: jest.Mock };

  const parseInto = (command: string, logger: Logger) => {
    const parser = createSymbolicCommandParser(logger, (id) => id === 'REACT');
    const detection = parser.detectOperators(command);
    const context = new PromptRequestContext({ command }, logger);
    context.parsedCommand = {
      promptId: 'p',
      rawArgs: '',
      format: 'symbolic',
      confidence: 0.9,
      convertedPrompt: {
        id: 'p',
        name: 'P',
        description: 'P',
        category: 'development',
        userMessageTemplate: 'body',
        arguments: [],
      },
      metadata: {
        originalCommand: command,
        parseStrategy: 'symbolic',
        detectedFormat: 'symbolic',
        warnings: [],
      },
      operators: detection,
      executionPlan: parser.generateExecutionPlan(detection, 'p', ''),
    } as any;
    context.executionResults = { content: 'Step output', metadata: {}, generatedAt: Date.now() };
    return context;
  };

  test('`@ReACT >>p` validates the framework as before and records one note naming `^`', async () => {
    const logger = createLogger();
    const validator = createValidator();
    const context = parseInto('@ReACT >>p', logger);

    await new OperatorValidationStage(validator, logger).execute(context);

    expect(validator.validateAndNormalize).toHaveBeenCalledWith('ReACT', expect.any(Object));
    expect(context.parsedCommand?.executionPlan?.frameworkOverride).toBe('REACT');
    expect(context.state.framework.operatorSpellingNote).toBe(NOTE);
    // The accumulator forwards each entry to the logger: one warning, carrying the note.
    expect(logger.warn).toHaveBeenCalledTimes(1);
    expect(logger.warn).toHaveBeenCalledWith('[OperatorValidation] ' + NOTE, { sigil: '@' });
  });

  test('`^ReACT >>p` validates the framework and records no note', async () => {
    const logger = createLogger();
    const validator = createValidator();
    const context = parseInto('^ReACT >>p', logger);

    await new OperatorValidationStage(validator, logger).execute(context);

    expect(validator.validateAndNormalize).toHaveBeenCalledWith('ReACT', expect.any(Object));
    expect(context.parsedCommand?.executionPlan?.frameworkOverride).toBe('REACT');
    expect(context.state.framework.operatorSpellingNote).toBeUndefined();
    expect(logger.warn).not.toHaveBeenCalled();
  });

  test('a command with no framework operator records no note', async () => {
    const logger = createLogger();
    const context = parseInto('>>p #analytical', logger);

    await new OperatorValidationStage(createValidator(), logger).execute(context);

    expect(context.state.framework.operatorSpellingNote).toBeUndefined();
  });

  test('a deprecated spelling naming a framework the validator refuses records no note', async () => {
    const logger = createLogger();
    // No lookup: every `@word` is a framework operator, so the validator is what refuses it.
    const parser = createSymbolicCommandParser(logger);
    const context = parseInto('@ReACT >>p', logger);
    context.parsedCommand!.operators = parser.detectOperators('@Nope >>p');

    await expect(
      new OperatorValidationStage(createValidator(), logger).execute(context)
    ).rejects.toThrow("Framework '^Nope' not found.");

    expect(context.state.framework.operatorSpellingNote).toBeUndefined();
  });

  test('the reply carries the note exactly once, in the single-prompt and chain renders', async () => {
    const assembler = new ResponseAssembler();
    const logger = createLogger();

    for (const [command, count] of [
      ['@ReACT >>p', 1],
      ['@ReACT >>p --> >>q', 1],
      ['^ReACT >>p', 0],
      ['^ReACT >>p --> >>q', 0],
    ] as const) {
      const context = parseInto(command, logger);
      await new OperatorValidationStage(createValidator(), logger).execute(context);

      const single = assembler.formatSinglePromptResponse(context, {} as any);
      expect(single.split(NOTE).length - 1).toBe(count);
    }

    const chained = parseInto('@ReACT >>p --> >>q', logger);
    await new OperatorValidationStage(createValidator(), logger).execute(chained);
    chained.sessionContext = {
      sessionId: 's',
      chainId: 'chain-spelling#1',
      isChainExecution: true,
      currentStep: 1,
      totalSteps: 2,
    };
    const reply = assembler.formatChainResponse(chained, { isChainFormatting: true } as any);
    expect(reply.split(NOTE).length - 1).toBe(1);
    expect(reply).toContain('Step output');
  });
});
