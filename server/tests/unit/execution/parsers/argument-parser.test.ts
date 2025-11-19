import { describe, expect, test, jest } from '@jest/globals';

import { ArgumentParser } from '../../../../dist/execution/parsers/argument-parser.js';

import type { ConvertedPrompt } from '../../../../dist/types/index.js';

const createLogger = () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
});

describe('ArgumentParser schema enforcement', () => {
  test('reports validation errors when schema validation fails', async () => {
    const parser = new ArgumentParser(createLogger());
    const promptData: ConvertedPrompt = {
      id: 'test',
      name: 'Test',
      description: '',
      category: 'general',
      userMessageTemplate: 'Hello {{iterations}}',
      arguments: [
        {
          name: 'iterations',
          required: true,
          type: 'number',
        },
      ],
    };

    const result = await parser.parseArguments('', promptData, {});
    expect(result.validationResults).toHaveLength(1);
    expect(result.validationResults[0].valid).toBe(false);
    expect(result.validationResults[0].errors?.[0]?.code).toBe('REQUIRED_ARGUMENT_MISSING');
  });
});
