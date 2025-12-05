import { describe, expect, jest, test } from '@jest/globals';

import { ExecutionContext } from '../../../../src/execution/context/execution-context.js';
import { OperatorValidationStage } from '../../../../src/execution/pipeline/stages/03-operator-validation-stage.js';

import type { FrameworkValidator } from '../../../../src/frameworks/framework-validator.js';
import type { Logger } from '../../../../src/logging/index.js';

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
    expect(context.metadata.operatorValidation).toBeUndefined();
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
    expect(context.metadata.operatorValidation).toMatchObject({
      normalizedFrameworkOperators: 1,
    });
  });
});
