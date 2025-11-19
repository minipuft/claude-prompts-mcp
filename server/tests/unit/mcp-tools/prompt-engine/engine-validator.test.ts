import { describe, expect, jest, test } from '@jest/globals';

import { EngineValidator } from '../../../../src/mcp-tools/prompt-engine/utils/validation.js';

const mockPrompt = {
  id: 'prompt-1',
  userMessageTemplate: 'Example content for gate validation',
};

describe('EngineValidator.validateWithGates', () => {
  test('returns gate results when all gates pass', async () => {
    const gateSystem = {
      validateContent: jest.fn().mockResolvedValue([
        {
          valid: true,
          errors: [],
        },
      ]),
    };

    const validator = new EngineValidator(gateSystem as any);

    const result = await validator.validateWithGates(
      mockPrompt as any,
      {},
      ['code-quality'],
      'Rendered content'
    );

    expect(result.passed).toBe(true);
    expect(result.results).toHaveLength(1);
    expect(result.results?.[0]?.gate).toBe('code-quality');
    expect(result.results?.[0]?.passed).toBe(true);
    expect(gateSystem.validateContent).toHaveBeenCalled();
  });

  test('marks failure when a gate fails validation', async () => {
    const gateSystem = {
      validateContent: jest.fn().mockResolvedValue([
        {
          valid: false,
          errors: [{ message: 'Structure mismatch' }],
        },
      ]),
    };

    const validator = new EngineValidator(gateSystem as any);

    const result = await validator.validateWithGates(
      mockPrompt as any,
      {},
      ['content-structure'],
      'Rendered content'
    );

    expect(result.passed).toBe(false);
    expect(result.results).toHaveLength(1);
    expect(result.results?.[0]?.gate).toBe('content-structure');
    expect(result.results?.[0]?.passed).toBe(false);
    expect(result.results?.[0]?.message).toContain('Structure mismatch');
  });

  test('returns early when no gates are provided', async () => {
    const gateSystem = {
      validateContent: jest.fn(),
    };

    const validator = new EngineValidator(gateSystem as any);
    const result = await validator.validateWithGates(mockPrompt as any, {}, [], 'Rendered content');

    expect(result.passed).toBe(true);
    expect(result.results).toEqual([]);
    expect(gateSystem.validateContent).not.toHaveBeenCalled();
  });
});
