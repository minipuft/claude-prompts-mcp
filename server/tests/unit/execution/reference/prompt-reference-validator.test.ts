/**
 * Unit tests for PromptReferenceValidator
 *
 * Tests creation-time validation of {{ref:prompt_id}} references:
 * - Self-reference detection
 * - Missing reference detection (strict mode)
 * - Circular chain detection
 */

import { PromptReferenceValidator } from '../../../../src/execution/reference/prompt-reference-validator.js';
import type { ConvertedPrompt } from '../../../../src/types/index.js';

describe('PromptReferenceValidator', () => {
  // Helper to create mock prompts
  const createMockPrompt = (
    id: string,
    userMessageTemplate = '',
    systemMessage?: string
  ): ConvertedPrompt =>
    ({
      id,
      name: `Test ${id}`,
      category: 'test',
      description: `Test prompt ${id}`,
      userMessageTemplate,
      systemMessage,
      arguments: [],
    }) as ConvertedPrompt;

  describe('validate()', () => {
    describe('self-reference detection', () => {
      it('should detect self-reference in user message template', () => {
        const existingPrompts: ConvertedPrompt[] = [];
        const validator = new PromptReferenceValidator(existingPrompts);

        const result = validator.validate('my_prompt', 'Hello {{ref:my_prompt}} world');

        expect(result.valid).toBe(false);
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0].type).toBe('self_reference');
        expect(result.errors[0].promptId).toBe('my_prompt');
        expect(result.errors[0].details).toContain('references itself');
      });

      it('should detect self-reference in system message', () => {
        const existingPrompts: ConvertedPrompt[] = [];
        const validator = new PromptReferenceValidator(existingPrompts);

        const result = validator.validate(
          'my_prompt',
          'Normal template',
          'System with {{ref:my_prompt}}'
        );

        expect(result.valid).toBe(false);
        expect(result.errors[0].type).toBe('self_reference');
      });
    });

    describe('missing reference detection (strict mode)', () => {
      it('should detect reference to non-existent prompt', () => {
        const existingPrompts: ConvertedPrompt[] = [];
        const validator = new PromptReferenceValidator(existingPrompts);

        const result = validator.validate('my_prompt', 'Using {{ref:nonexistent}}');

        expect(result.valid).toBe(false);
        expect(result.errors).toHaveLength(1);
        expect(result.errors[0].type).toBe('missing_reference');
        expect(result.errors[0].promptId).toBe('nonexistent');
        expect(result.errors[0].details).toContain('does not exist');
      });

      it('should detect multiple missing references', () => {
        const existingPrompts: ConvertedPrompt[] = [];
        const validator = new PromptReferenceValidator(existingPrompts);

        const result = validator.validate(
          'my_prompt',
          '{{ref:missing1}} and {{ref:missing2}}'
        );

        expect(result.valid).toBe(false);
        expect(result.errors).toHaveLength(2);
        expect(result.errors.map((e) => e.promptId)).toEqual(['missing1', 'missing2']);
      });

      it('should pass when referenced prompt exists', () => {
        const existingPrompts = [createMockPrompt('intro', 'Welcome!')];
        const validator = new PromptReferenceValidator(existingPrompts);

        const result = validator.validate('my_prompt', 'Start with {{ref:intro}}');

        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });
    });

    describe('circular chain detection', () => {
      it('should detect simple A -> B -> A cycle', () => {
        // B references A
        const existingPrompts = [createMockPrompt('prompt_b', '{{ref:prompt_a}}')];
        const validator = new PromptReferenceValidator(existingPrompts);

        // A references B - this creates a cycle
        const result = validator.validate('prompt_a', 'Using {{ref:prompt_b}}');

        expect(result.valid).toBe(false);
        expect(result.errors.some((e) => e.type === 'circular_reference')).toBe(true);
        const circularError = result.errors.find((e) => e.type === 'circular_reference');
        expect(circularError?.chain).toContain('prompt_a');
        expect(circularError?.chain).toContain('prompt_b');
      });

      it('should detect longer A -> B -> C -> A cycle', () => {
        const existingPrompts = [
          createMockPrompt('prompt_b', '{{ref:prompt_c}}'),
          createMockPrompt('prompt_c', '{{ref:prompt_a}}'),
        ];
        const validator = new PromptReferenceValidator(existingPrompts);

        const result = validator.validate('prompt_a', 'Using {{ref:prompt_b}}');

        expect(result.valid).toBe(false);
        expect(result.errors.some((e) => e.type === 'circular_reference')).toBe(true);
      });

      it('should allow non-circular chains', () => {
        // B -> C (no cycle back to A)
        const existingPrompts = [
          createMockPrompt('prompt_b', '{{ref:prompt_c}}'),
          createMockPrompt('prompt_c', 'Final content'),
        ];
        const validator = new PromptReferenceValidator(existingPrompts);

        // A -> B -> C (no cycle)
        const result = validator.validate('prompt_a', 'Using {{ref:prompt_b}}');

        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });
    });

    describe('valid templates', () => {
      it('should pass for template with no references', () => {
        const existingPrompts: ConvertedPrompt[] = [];
        const validator = new PromptReferenceValidator(existingPrompts);

        const result = validator.validate('my_prompt', 'Just regular content');

        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });

      it('should pass for template with valid references', () => {
        const existingPrompts = [
          createMockPrompt('intro', 'Welcome message'),
          createMockPrompt('outro', 'Goodbye message'),
        ];
        const validator = new PromptReferenceValidator(existingPrompts);

        const result = validator.validate(
          'my_prompt',
          '{{ref:intro}} Main content {{ref:outro}}'
        );

        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });

      it('should handle duplicate references correctly', () => {
        const existingPrompts = [createMockPrompt('intro', 'Welcome!')];
        const validator = new PromptReferenceValidator(existingPrompts);

        // Same reference used twice
        const result = validator.validate(
          'my_prompt',
          '{{ref:intro}} ... {{ref:intro}}'
        );

        expect(result.valid).toBe(true);
        expect(result.errors).toHaveLength(0);
      });
    });

    describe('edge cases', () => {
      it('should handle empty template', () => {
        const validator = new PromptReferenceValidator([]);

        const result = validator.validate('my_prompt', '');

        expect(result.valid).toBe(true);
      });

      it('should handle similar but not matching patterns', () => {
        const validator = new PromptReferenceValidator([]);

        // These should NOT be detected as references
        const result = validator.validate(
          'my_prompt',
          '{{ref: spaced}} and {ref:no_braces} and {{ref}}'
        );

        expect(result.valid).toBe(true);
      });

      it('should handle prompt IDs with hyphens and underscores', () => {
        const existingPrompts = [createMockPrompt('my-prompt_v2', 'Content')];
        const validator = new PromptReferenceValidator(existingPrompts);

        const result = validator.validate('new_prompt', '{{ref:my-prompt_v2}}');

        expect(result.valid).toBe(true);
      });
    });

    describe('combined errors', () => {
      it('should report both self-reference and missing reference', () => {
        const validator = new PromptReferenceValidator([]);

        const result = validator.validate(
          'my_prompt',
          '{{ref:my_prompt}} and {{ref:missing}}'
        );

        expect(result.valid).toBe(false);
        expect(result.errors).toHaveLength(2);
        expect(result.errors.map((e) => e.type)).toContain('self_reference');
        expect(result.errors.map((e) => e.type)).toContain('missing_reference');
      });
    });
  });
});
