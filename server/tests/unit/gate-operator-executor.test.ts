import { describe, test, expect, beforeEach, jest } from '@jest/globals';
import { GateOperatorExecutor } from '../../src/execution/operators/gate-operator-executor.js';
import type { GateOperator } from '../../src/execution/parsers/types/operator-types.js';

const baseGate: GateOperator = {
  type: 'gate',
  criteria: 'output must mention success',
  parsedCriteria: ['output must mention success'],
  scope: 'execution',
  retryOnFailure: true,
  maxRetries: 1,
};

const mockLogger = {
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

describe('GateOperatorExecutor', () => {
  let createTemporaryGate: jest.Mock<string | null, [any, string | undefined]>;
  let validateContent: jest.Mock<Promise<any[]>, [string[], string, any]>;
  let executor: GateOperatorExecutor;

  beforeEach(() => {
    jest.clearAllMocks();
    createTemporaryGate = jest.fn(() => 'inline_gate_1');
    validateContent = jest.fn(async () => [
      {
        gateId: 'inline_gate_1',
        passed: true,
        retryHints: [],
      },
    ]);

    const gateSystem = {
      createTemporaryGate,
      validateContent,
    } as any;

    executor = new GateOperatorExecutor(gateSystem, mockLogger as any);
  });

  test('passes validation results through and reports success', async () => {
    const result = await executor.execute({
      gate: baseGate,
      executionResult: 'The operation completed with success.',
      executionId: 'exec-123',
    });

    expect(createTemporaryGate).toHaveBeenCalledTimes(1);
    expect(validateContent).toHaveBeenCalledWith(
      ['inline_gate_1'],
      expect.any(String),
      expect.objectContaining({ metadata: { executionId: 'exec-123' } }),
    );

    expect(result.passed).toBe(true);
    expect(result.retryRequired).toBe(false);
    expect(result.retryHints).toEqual([]);
    expect(result.gateResults).toHaveLength(1);
  });

  test('flags retry when gate fails with retry hints', async () => {
    validateContent.mockResolvedValueOnce([
      {
        gateId: 'inline_gate_1',
        passed: false,
        retryHints: ['add more detail about validation'],
      },
    ]);

    const result = await executor.execute({
      gate: { ...baseGate, maxRetries: 2 },
      executionResult: 'Result missing details',
      executionId: 'exec-456',
    });

    expect(result.passed).toBe(false);
    expect(result.retryRequired).toBe(true);
    expect(result.retryHints).toEqual(['add more detail about validation']);
  });

  test('handles temporary gate creation failure gracefully', async () => {
    createTemporaryGate.mockReturnValueOnce(null);

    const result = await executor.execute({
      gate: baseGate,
      executionResult: 'anything',
      executionId: 'exec-789',
    });

    expect(result.passed).toBe(false);
    expect(result.retryRequired).toBe(false);
    expect(result.gateResults).toEqual([]);
    expect(result.retryHints).toEqual([]);
    expect(validateContent).not.toHaveBeenCalled();
  });
});
