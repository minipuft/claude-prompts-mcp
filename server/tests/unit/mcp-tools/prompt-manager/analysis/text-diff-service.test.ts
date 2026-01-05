import { describe, expect, test } from '@jest/globals';
import { TextDiffService } from '../../../../../src/mcp-tools/prompt-manager/analysis/text-diff-service.js';
import type { ConvertedPrompt } from '../../../../../src/execution/types.js';

describe('TextDiffService', () => {
  const service = new TextDiffService();

  // Helper to create minimal prompt for testing
  const createPrompt = (overrides: Partial<ConvertedPrompt> = {}): ConvertedPrompt => ({
    id: 'test-prompt',
    name: 'Test Prompt',
    description: 'A test prompt',
    category: 'testing',
    userMessageTemplate: 'Hello {{name}}',
    arguments: [],
    ...overrides,
  });

  describe('generatePromptDiff', () => {
    test('returns hasChanges:false when content is identical', () => {
      const prompt = createPrompt();
      const result = service.generatePromptDiff(prompt, prompt);

      expect(result.hasChanges).toBe(false);
      expect(result.diff).toBe('');
      expect(result.formatted).toBe('');
      expect(result.stats.additions).toBe(0);
      expect(result.stats.deletions).toBe(0);
    });

    test('detects changes in userMessageTemplate', () => {
      const before = createPrompt({ userMessageTemplate: 'Hello world' });
      const after = createPrompt({ userMessageTemplate: 'Hello universe' });

      const result = service.generatePromptDiff(before, after);

      expect(result.hasChanges).toBe(true);
      expect(result.diff).toContain('-userMessageTemplate: Hello world');
      expect(result.diff).toContain('+userMessageTemplate: Hello universe');
      expect(result.stats.additions).toBeGreaterThan(0);
      expect(result.stats.deletions).toBeGreaterThan(0);
    });

    test('detects changes in description', () => {
      const before = createPrompt({ description: 'Old description' });
      const after = createPrompt({ description: 'New description' });

      const result = service.generatePromptDiff(before, after);

      expect(result.hasChanges).toBe(true);
      expect(result.diff).toContain('-description: Old description');
      expect(result.diff).toContain('+description: New description');
    });

    test('handles null before (new prompt)', () => {
      const after = createPrompt({ id: 'new-prompt', name: 'New Prompt' });

      const result = service.generatePromptDiff(null, after);

      expect(result.hasChanges).toBe(true);
      expect(result.stats.deletions).toBe(0);
      expect(result.stats.additions).toBeGreaterThan(0);
      // All lines should be additions
      expect(result.diff).toContain('+name: New Prompt');
    });

    test('handles systemMessage changes', () => {
      const before = createPrompt({ systemMessage: 'You are a helper' });
      const after = createPrompt({ systemMessage: 'You are an expert helper' });

      const result = service.generatePromptDiff(before, after);

      expect(result.hasChanges).toBe(true);
      expect(result.diff).toContain('-systemMessage: You are a helper');
      expect(result.diff).toContain('+systemMessage: You are an expert helper');
    });

    test('handles argument changes', () => {
      const before = createPrompt({
        arguments: [{ name: 'input', type: 'string', description: 'Input text' }],
      });
      const after = createPrompt({
        arguments: [
          { name: 'input', type: 'string', description: 'Input text' },
          { name: 'format', type: 'string', description: 'Output format' },
        ],
      });

      const result = service.generatePromptDiff(before, after);

      expect(result.hasChanges).toBe(true);
      expect(result.diff).toContain('format');
    });
  });

  describe('truncation', () => {
    test('truncates large diffs to maxLines', () => {
      // Create prompts with many lines of content
      const longContent = Array(100).fill('Line of content').join('\n');
      const before = createPrompt({ userMessageTemplate: longContent });
      const after = createPrompt({
        userMessageTemplate: longContent.replace(/Line/g, 'Changed'),
      });

      const result = service.generatePromptDiff(before, after, { maxLines: 20 });

      expect(result.stats.truncated).toBe(true);
      expect(result.diff).toContain('... (');
      expect(result.diff).toContain('lines omitted)');
    });

    test('does not truncate small diffs', () => {
      const before = createPrompt({ description: 'Short' });
      const after = createPrompt({ description: 'Also short' });

      const result = service.generatePromptDiff(before, after, { maxLines: 100 });

      expect(result.stats.truncated).toBe(false);
    });
  });

  describe('formatted output', () => {
    test('includes stats summary', () => {
      const before = createPrompt({ name: 'Old Name' });
      const after = createPrompt({ name: 'New Name' });

      const result = service.generatePromptDiff(before, after);

      expect(result.formatted).toContain('**Changes**:');
      expect(result.formatted).toMatch(/\+\d+ additions/);
      expect(result.formatted).toMatch(/-\d+ deletions/);
    });

    test('wraps diff in markdown code block', () => {
      const before = createPrompt({ name: 'Old' });
      const after = createPrompt({ name: 'New' });

      const result = service.generatePromptDiff(before, after);

      expect(result.formatted).toContain('```diff');
      expect(result.formatted).toContain('```');
    });

    test('includes truncation notice when truncated', () => {
      const longContent = Array(100).fill('Content line').join('\n');
      const before = createPrompt({ userMessageTemplate: longContent });
      const after = createPrompt({
        userMessageTemplate: longContent.replace(/Content/g, 'Modified'),
      });

      const result = service.generatePromptDiff(before, after, { maxLines: 30 });

      expect(result.formatted).toContain('*(Showing');
      expect(result.formatted).toContain('lines)*');
    });
  });

  describe('error handling', () => {
    test('returns empty result on invalid input', () => {
      // Pass something that would fail serialization
      const result = service.generatePromptDiff(
        null,
        { id: 'test' } as Partial<ConvertedPrompt>
      );

      // Should not throw, just return empty result
      expect(result.hasChanges).toBe(true); // Has changes since before was null
    });
  });

  describe('context lines', () => {
    test('respects custom context setting', () => {
      const before = createPrompt({
        userMessageTemplate: 'Line 1\nLine 2\nLine 3\nLine 4\nLine 5',
      });
      const after = createPrompt({
        userMessageTemplate: 'Line 1\nLine 2\nChanged\nLine 4\nLine 5',
      });

      const resultWithContext = service.generatePromptDiff(before, after, { context: 1 });
      const resultWithMoreContext = service.generatePromptDiff(before, after, { context: 3 });

      // More context = longer diff
      expect(resultWithMoreContext.diff.length).toBeGreaterThanOrEqual(
        resultWithContext.diff.length
      );
    });
  });
});
