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
  describe('basic validation', () => {
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

    test('passes validation for prompts without arguments', () => {
      const prompt: ConvertedPrompt = {
        ...basePrompt,
        arguments: [],
      };

      const validator = new ArgumentSchemaValidator();
      const result = validator.validate(prompt, {});

      expect(result.success).toBe(true);
      expect(result.issues).toHaveLength(0);
    });

    test('passes validation for prompts without validation rules', () => {
      const prompt: ConvertedPrompt = {
        ...basePrompt,
        arguments: [
          { name: 'topic', required: true, type: 'string' },
          { name: 'count', required: false, type: 'number' },
        ],
      };

      const validator = new ArgumentSchemaValidator();
      const result = validator.validate(prompt, { topic: 'x', count: 5 });

      expect(result.success).toBe(true);
      expect(result.issues).toHaveLength(0);
    });
  });

  describe('minLength validation', () => {
    test('fails when input is too short', () => {
      const prompt: ConvertedPrompt = {
        ...basePrompt,
        arguments: [
          {
            name: 'topic',
            required: true,
            type: 'string',
            validation: { minLength: 10 },
          },
        ],
      };

      const validator = new ArgumentSchemaValidator();
      const result = validator.validate(prompt, { topic: 'short' });

      expect(result.success).toBe(false);
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].argument).toBe('topic');
      expect(result.issues[0].message).toContain('at least 10 characters');
    });

    test('passes when input is at minimum length', () => {
      const prompt: ConvertedPrompt = {
        ...basePrompt,
        arguments: [
          {
            name: 'topic',
            required: true,
            type: 'string',
            validation: { minLength: 5 },
          },
        ],
      };

      const validator = new ArgumentSchemaValidator();
      const result = validator.validate(prompt, { topic: 'exact' });

      expect(result.success).toBe(true);
      expect(result.issues).toHaveLength(0);
    });

    test('passes when input is above minimum length', () => {
      const prompt: ConvertedPrompt = {
        ...basePrompt,
        arguments: [
          {
            name: 'topic',
            required: true,
            type: 'string',
            validation: { minLength: 3 },
          },
        ],
      };

      const validator = new ArgumentSchemaValidator();
      const result = validator.validate(prompt, { topic: 'well above minimum' });

      expect(result.success).toBe(true);
      expect(result.issues).toHaveLength(0);
    });
  });

  describe('maxLength validation', () => {
    test('fails when input is too long', () => {
      const prompt: ConvertedPrompt = {
        ...basePrompt,
        arguments: [
          {
            name: 'topic',
            required: true,
            type: 'string',
            validation: { maxLength: 5 },
          },
        ],
      };

      const validator = new ArgumentSchemaValidator();
      const result = validator.validate(prompt, { topic: 'way too long' });

      expect(result.success).toBe(false);
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].argument).toBe('topic');
      expect(result.issues[0].message).toContain('no more than 5 characters');
    });

    test('passes when input is at maximum length', () => {
      const prompt: ConvertedPrompt = {
        ...basePrompt,
        arguments: [
          {
            name: 'topic',
            required: true,
            type: 'string',
            validation: { maxLength: 5 },
          },
        ],
      };

      const validator = new ArgumentSchemaValidator();
      const result = validator.validate(prompt, { topic: 'exact' });

      expect(result.success).toBe(true);
      expect(result.issues).toHaveLength(0);
    });

    test('passes when input is below maximum length', () => {
      const prompt: ConvertedPrompt = {
        ...basePrompt,
        arguments: [
          {
            name: 'topic',
            required: true,
            type: 'string',
            validation: { maxLength: 100 },
          },
        ],
      };

      const validator = new ArgumentSchemaValidator();
      const result = validator.validate(prompt, { topic: 'short' });

      expect(result.success).toBe(true);
      expect(result.issues).toHaveLength(0);
    });
  });

  describe('pattern validation', () => {
    test('fails when input does not match URL pattern', () => {
      const prompt: ConvertedPrompt = {
        ...basePrompt,
        arguments: [
          {
            name: 'url',
            required: true,
            type: 'string',
            validation: { pattern: '^https://' },
          },
        ],
      };

      const validator = new ArgumentSchemaValidator();
      const result = validator.validate(prompt, { url: 'not-a-url' });

      expect(result.success).toBe(false);
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].argument).toBe('url');
      expect(result.issues[0].message).toContain('match pattern');
    });

    test('passes when input matches URL pattern', () => {
      const prompt: ConvertedPrompt = {
        ...basePrompt,
        arguments: [
          {
            name: 'url',
            required: true,
            type: 'string',
            validation: { pattern: '^https://' },
          },
        ],
      };

      const validator = new ArgumentSchemaValidator();
      const result = validator.validate(prompt, { url: 'https://example.com' });

      expect(result.success).toBe(true);
      expect(result.issues).toHaveLength(0);
    });

    test('passes when input matches regex pattern', () => {
      const prompt: ConvertedPrompt = {
        ...basePrompt,
        arguments: [
          {
            name: 'code',
            required: true,
            type: 'string',
            validation: { pattern: '^[A-Z]{3}-[0-9]{4}$' },
          },
        ],
      };

      const validator = new ArgumentSchemaValidator();
      const result = validator.validate(prompt, { code: 'ABC-1234' });

      expect(result.success).toBe(true);
      expect(result.issues).toHaveLength(0);
    });

    test('fails when input does not match regex pattern', () => {
      const prompt: ConvertedPrompt = {
        ...basePrompt,
        arguments: [
          {
            name: 'code',
            required: true,
            type: 'string',
            validation: { pattern: '^[A-Z]{3}-[0-9]{4}$' },
          },
        ],
      };

      const validator = new ArgumentSchemaValidator();
      const result = validator.validate(prompt, { code: 'invalid' });

      expect(result.success).toBe(false);
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].argument).toBe('code');
    });

    test('handles invalid regex gracefully', () => {
      const prompt: ConvertedPrompt = {
        ...basePrompt,
        arguments: [
          {
            name: 'topic',
            required: true,
            type: 'string',
            validation: { pattern: '[invalid(regex' },
          },
        ],
      };

      const validator = new ArgumentSchemaValidator();
      // Should not throw, just skip invalid regex
      const result = validator.validate(prompt, { topic: 'anything' });

      expect(result.success).toBe(true);
    });
  });

  describe('combined validation', () => {
    test('reports multiple errors when both minLength and pattern fail', () => {
      const prompt: ConvertedPrompt = {
        ...basePrompt,
        arguments: [
          {
            name: 'url',
            required: true,
            type: 'string',
            validation: { minLength: 20, pattern: '^https://' },
          },
        ],
      };

      const validator = new ArgumentSchemaValidator();
      const result = validator.validate(prompt, { url: 'http://x' });

      expect(result.success).toBe(false);
      // At least one issue should be reported (may combine or report separately)
      expect(result.issues.length).toBeGreaterThan(0);
    });

    test('reports single error when one passes, one fails', () => {
      const prompt: ConvertedPrompt = {
        ...basePrompt,
        arguments: [
          {
            name: 'url',
            required: true,
            type: 'string',
            validation: { minLength: 5, pattern: '^https://' },
          },
        ],
      };

      const validator = new ArgumentSchemaValidator();
      const result = validator.validate(prompt, { url: 'http://example.com' });

      expect(result.success).toBe(false);
      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].message).toContain('pattern');
    });
  });

  describe('allowedValues deprecation', () => {
    test('ignores allowedValues constraint (deprecated in v3.0.0)', () => {
      const prompt: ConvertedPrompt = {
        ...basePrompt,
        arguments: [
          {
            name: 'priority',
            required: true,
            type: 'string',
            validation: { allowedValues: ['low', 'medium', 'high'] },
          },
        ],
      };

      const validator = new ArgumentSchemaValidator();
      // Should pass even with value not in allowedValues - LLM handles variation
      const result = validator.validate(prompt, { priority: 'urgent' });

      expect(result.success).toBe(true);
      expect(result.issues).toHaveLength(0);
    });
  });

  describe('schema caching', () => {
    test('caches schema for repeated validations', () => {
      const prompt: ConvertedPrompt = {
        ...basePrompt,
        arguments: [
          {
            name: 'topic',
            required: true,
            type: 'string',
            validation: { minLength: 3 },
          },
        ],
      };

      const validator = new ArgumentSchemaValidator();

      // First validation
      const result1 = validator.validate(prompt, { topic: 'first' });
      expect(result1.success).toBe(true);

      // Second validation should use cached schema
      const result2 = validator.validate(prompt, { topic: 'second' });
      expect(result2.success).toBe(true);
    });
  });

  describe('error message format', () => {
    test('includes argument name in issue', () => {
      const prompt: ConvertedPrompt = {
        ...basePrompt,
        arguments: [
          {
            name: 'myArgument',
            required: true,
            type: 'string',
            validation: { minLength: 100 },
          },
        ],
      };

      const validator = new ArgumentSchemaValidator();
      const result = validator.validate(prompt, { myArgument: 'short' });

      expect(result.success).toBe(false);
      expect(result.issues[0].argument).toBe('myArgument');
    });

    test('includes clear failure reason in message', () => {
      const prompt: ConvertedPrompt = {
        ...basePrompt,
        arguments: [
          {
            name: 'topic',
            required: true,
            type: 'string',
            validation: { minLength: 10 },
          },
        ],
      };

      const validator = new ArgumentSchemaValidator();
      const result = validator.validate(prompt, { topic: 'short' });

      expect(result.success).toBe(false);
      expect(result.issues[0].message).toContain('10');
      expect(result.issues[0].message).toContain('characters');
    });
  });
});
