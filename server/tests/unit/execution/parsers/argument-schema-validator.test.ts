import { describe, expect, test } from '@jest/globals';

import { ArgumentSchemaValidator } from '../../../../dist/execution/parsers/argument-schema.js';

import type { ConvertedPrompt } from '../../../../dist/types/index.js';

const basePrompt: ConvertedPrompt = {
  id: 'schema_prompt',
  name: 'Schema Prompt',
  description: '',
  category: 'general',
  userMessageTemplate: 'Schema prompt',
  arguments: [],
};

describe('ArgumentSchemaValidator', () => {
  test('passes validation when arguments match metadata', () => {
    const prompt: ConvertedPrompt = {
      ...basePrompt,
      arguments: [
        {
          name: 'topic',
          required: true,
          type: 'string',
          validation: {
            minLength: 3,
            pattern: '^[A-Za-z ]+$',
          },
        },
        {
          name: 'iterations',
          required: false,
          type: 'number',
        },
      ],
    };

    const validator = new ArgumentSchemaValidator();
    const result = validator.validate(prompt, {
      topic: 'Schema Validation',
      iterations: 2,
    });

    expect(result.success).toBe(true);
    expect(result.issues).toHaveLength(0);
  });

  test('returns schema issues when arguments violate constraints', () => {
    const prompt: ConvertedPrompt = {
      ...basePrompt,
      arguments: [
        {
          name: 'topic',
          required: true,
          type: 'string',
          validation: {
            minLength: 2,
          },
        },
        {
          name: 'iterations',
          required: true,
          type: 'number',
        },
      ],
    };

    const validator = new ArgumentSchemaValidator();
    const result = validator.validate(prompt, {
      topic: 'ok',
      iterations: 'not-a-number',
    });

    expect(result.success).toBe(false);
    expect(result.issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ argument: 'iterations' })])
    );
  });
});
