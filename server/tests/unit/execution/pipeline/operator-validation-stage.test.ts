import { describe, expect, jest, test } from '@jest/globals';

import { ExecutionContext } from '../../../../src/engine/execution/context/execution-context.js';
import { OperatorValidationStage } from '../../../../src/engine/execution/pipeline/stages/03-operator-validation-stage.js';

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
    const stage = new OperatorValidationStage(validator, createLogger());
    const context = new ExecutionContext({ command: '>>demo' });
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
    expect(context.diagnostics.getByStage('OperatorValidation')).toEqual([]);
  });

  describe('subagentModel → delegated normalization', () => {
    const buildChainContext = (
      stepOverrides: Array<{ subagentModel?: 'heavy' | 'standard' | 'fast'; delegated?: boolean }>,
      promptDelegation = false
    ) => {
      const stage = new OperatorValidationStage(null, createLogger());
      const context = new ExecutionContext({ command: '>>a --> >>b --> >>c' });
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

    test('subagentModel: fast sets delegated on step prompt and chain operator', async () => {
      const { stage, context } = buildChainContext([{}, { subagentModel: 'fast' }, {}]);

      await stage.execute(context);

      expect(context.parsedCommand!.steps![0].delegated).not.toBe(true);
      expect(context.parsedCommand!.steps![1].delegated).toBe(true);
      expect(context.parsedCommand!.steps![2].delegated).not.toBe(true);

      const chainOp = context.parsedCommand!.operators!.operators[0] as any;
      expect(chainOp.steps[1].delegated).toBe(true);
      expect(chainOp.hasDelegation).toBe(true);
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

    test('hasDelegation not set when no steps have subagentModel or delegation', async () => {
      const { stage, context } = buildChainContext([{}, {}, {}]);

      await stage.execute(context);

      const chainOp = context.parsedCommand!.operators!.operators[0] as any;
      expect(chainOp.hasDelegation).not.toBe(true);
    });
  });

  test('normalizes framework operators and updates metadata + execution plan overrides', async () => {
    const validator = {
      validateAndNormalize: jest.fn().mockReturnValue({ normalizedId: 'CAGEERF' }),
    } as unknown as FrameworkValidator;
    const stage = new OperatorValidationStage(validator, createLogger());

    const context = new ExecutionContext({ command: '@cageerf >>demo' });
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
    expect(context.diagnostics.getByStage('OperatorValidation')).toMatchObject([
      { level: 'debug', context: { normalizedFrameworkOperators: 1 } },
    ]);
  });
});
