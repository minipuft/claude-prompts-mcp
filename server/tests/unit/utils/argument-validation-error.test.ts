import { describe, expect, test } from '@jest/globals';

import { ArgumentValidationError } from '../../../dist/utils/errorHandling.js';

import type {
  SchemaValidationIssue,
  PromptDefinitionForError,
} from '../../../dist/utils/errorHandling.js';

describe('ArgumentValidationError', () => {
  const basePromptDef: PromptDefinitionForError = {
    id: 'test_prompt',
    arguments: [
      {
        name: 'topic',
        type: 'string',
        required: true,
        validation: { minLength: 10 },
      },
      {
        name: 'url',
        type: 'string',
        required: false,
        validation: { pattern: '^https://' },
      },
    ],
  };

  describe('message formatting', () => {
    test('formats error message with issue details', () => {
      const issues: SchemaValidationIssue[] = [
        { argument: 'topic', message: 'Value must contain at least 10 characters' },
      ];

      const error = new ArgumentValidationError(issues, basePromptDef);

      expect(error.message).toContain('Argument validation failed');
      expect(error.message).toContain('topic');
      expect(error.message).toContain('at least 10 characters');
    });

    test('includes retry hint in message', () => {
      const issues: SchemaValidationIssue[] = [
        { argument: 'topic', message: 'Value must contain at least 10 characters' },
      ];

      const error = new ArgumentValidationError(issues, basePromptDef);

      expect(error.message).toContain('Retry with:');
      expect(error.message).toContain('>>test_prompt');
    });

    test('formats multiple issues correctly', () => {
      const issues: SchemaValidationIssue[] = [
        { argument: 'topic', message: 'Value must contain at least 10 characters' },
        { argument: 'url', message: 'Value must match pattern ^https://' },
      ];

      const error = new ArgumentValidationError(issues, basePromptDef);

      expect(error.message).toContain('topic');
      expect(error.message).toContain('url');
    });
  });

  describe('retry hint generation', () => {
    test('generates hint with minLength placeholder', () => {
      const issues: SchemaValidationIssue[] = [{ argument: 'topic', message: 'Too short' }];

      const promptDef: PromptDefinitionForError = {
        id: 'length_prompt',
        arguments: [
          {
            name: 'topic',
            required: true,
            validation: { minLength: 10 },
          },
        ],
      };

      const error = new ArgumentValidationError(issues, promptDef);

      expect(error.message).toContain('at least 10 chars');
    });

    test('generates hint with maxLength placeholder', () => {
      const issues: SchemaValidationIssue[] = [{ argument: 'topic', message: 'Too long' }];

      const promptDef: PromptDefinitionForError = {
        id: 'length_prompt',
        arguments: [
          {
            name: 'topic',
            required: true,
            validation: { maxLength: 50 },
          },
        ],
      };

      const error = new ArgumentValidationError(issues, promptDef);

      expect(error.message).toContain('max 50 chars');
    });

    test('generates hint with minLength and maxLength combined', () => {
      const issues: SchemaValidationIssue[] = [{ argument: 'topic', message: 'Length issue' }];

      const promptDef: PromptDefinitionForError = {
        id: 'length_prompt',
        arguments: [
          {
            name: 'topic',
            required: true,
            validation: { minLength: 10, maxLength: 50 },
          },
        ],
      };

      const error = new ArgumentValidationError(issues, promptDef);

      expect(error.message).toContain('10-50 chars');
    });

    test('generates hint with URL pattern placeholder', () => {
      const issues: SchemaValidationIssue[] = [{ argument: 'url', message: 'Pattern mismatch' }];

      const promptDef: PromptDefinitionForError = {
        id: 'url_prompt',
        arguments: [
          {
            name: 'url',
            required: true,
            validation: { pattern: '^https://' },
          },
        ],
      };

      const error = new ArgumentValidationError(issues, promptDef);

      expect(error.message).toContain('https://example.com');
    });

    test('generates hint with http pattern placeholder', () => {
      const issues: SchemaValidationIssue[] = [{ argument: 'url', message: 'Pattern mismatch' }];

      const promptDef: PromptDefinitionForError = {
        id: 'url_prompt',
        arguments: [
          {
            name: 'url',
            required: true,
            validation: { pattern: '^http://' },
          },
        ],
      };

      const error = new ArgumentValidationError(issues, promptDef);

      expect(error.message).toContain('http://example.com');
    });

    test('includes only required and failed arguments in retry hint', () => {
      const issues: SchemaValidationIssue[] = [{ argument: 'url', message: 'Pattern mismatch' }];

      const error = new ArgumentValidationError(issues, basePromptDef);

      // Should include required 'topic' and failed 'url'
      expect(error.message).toContain('topic=');
      expect(error.message).toContain('url=');
    });
  });

  describe('error properties', () => {
    test('has correct error code', () => {
      const issues: SchemaValidationIssue[] = [{ argument: 'topic', message: 'Too short' }];

      const error = new ArgumentValidationError(issues, basePromptDef);

      expect(error.code).toBe('ARGUMENT_VALIDATION_ERROR');
    });

    test('stores issues for inspection', () => {
      const issues: SchemaValidationIssue[] = [
        { argument: 'topic', message: 'Too short', code: 'too_small' },
      ];

      const error = new ArgumentValidationError(issues, basePromptDef);

      expect(error.issues).toEqual(issues);
    });

    test('stores prompt definition for inspection', () => {
      const issues: SchemaValidationIssue[] = [{ argument: 'topic', message: 'Too short' }];

      const error = new ArgumentValidationError(issues, basePromptDef);

      expect(error.promptDefinition).toEqual(basePromptDef);
    });

    test('has error context with suggestions', () => {
      const issues: SchemaValidationIssue[] = [{ argument: 'topic', message: 'Too short' }];

      const error = new ArgumentValidationError(issues, basePromptDef);

      expect(error.context.suggestions).toBeDefined();
      expect(error.context.suggestions?.length).toBeGreaterThan(0);
    });

    test('has recovery options', () => {
      const issues: SchemaValidationIssue[] = [{ argument: 'topic', message: 'Too short' }];

      const error = new ArgumentValidationError(issues, basePromptDef);

      expect(error.context.recoveryOptions).toBeDefined();
      expect(error.context.recoveryOptions).toContain('Retry with corrected arguments');
    });
  });

  describe('enhanced message', () => {
    test('getEnhancedMessage includes structured format', () => {
      const issues: SchemaValidationIssue[] = [{ argument: 'topic', message: 'Too short' }];

      const error = new ArgumentValidationError(issues, basePromptDef);
      const enhanced = error.getEnhancedMessage();

      expect(enhanced).toContain('Argument Validation Failed');
      expect(enhanced).toContain('Issues Found');
      expect(enhanced).toContain('Retry Command');
      expect(enhanced).toContain('Tips');
    });

    test('getEnhancedMessage includes code block for retry', () => {
      const issues: SchemaValidationIssue[] = [{ argument: 'topic', message: 'Too short' }];

      const error = new ArgumentValidationError(issues, basePromptDef);
      const enhanced = error.getEnhancedMessage();

      expect(enhanced).toContain('```');
      expect(enhanced).toContain('>>test_prompt');
    });
  });

  describe('extends BaseError', () => {
    test('is instance of Error', () => {
      const issues: SchemaValidationIssue[] = [{ argument: 'topic', message: 'Too short' }];

      const error = new ArgumentValidationError(issues, basePromptDef);

      expect(error).toBeInstanceOf(Error);
    });

    test('has name property', () => {
      const issues: SchemaValidationIssue[] = [{ argument: 'topic', message: 'Too short' }];

      const error = new ArgumentValidationError(issues, basePromptDef);

      expect(error.name).toBe('ArgumentValidationError');
    });

    test('has timestamp', () => {
      const issues: SchemaValidationIssue[] = [{ argument: 'topic', message: 'Too short' }];

      const error = new ArgumentValidationError(issues, basePromptDef);

      expect(error.timestamp).toBeDefined();
      expect(new Date(error.timestamp).getTime()).not.toBeNaN();
    });
  });
});
