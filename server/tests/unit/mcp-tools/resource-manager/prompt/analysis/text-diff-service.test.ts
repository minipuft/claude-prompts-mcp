import { describe, expect, test } from '@jest/globals';
import {
  ObjectDiffGenerator,
  type FileContentChange,
} from '../../../../../../src/mcp/tools/resource-manager/prompt/analysis/object-diff-generator.js';

describe('ObjectDiffGenerator', () => {
  const service = new ObjectDiffGenerator();

  const USER_MESSAGE = 'general/test_prompt/user-message.md';

  const change = (overrides: Partial<FileContentChange> = {}): FileContentChange => ({
    path: USER_MESSAGE,
    previousPath: USER_MESSAGE,
    before: 'Hello {{name}}\n',
    after: 'Hello {{name}}\n',
    ...overrides,
  });

  const longChange = (): FileContentChange => {
    const content = Array(100).fill('Line of content').join('\n');
    return change({ before: content, after: content.replace(/Line/g, 'Changed') });
  };

  describe('generateFileChangeDiff', () => {
    test('returns hasChanges:false when no file content changes', () => {
      const result = service.generateFileChangeDiff([change()]);

      expect(result.hasChanges).toBe(false);
      expect(result.diff).toBe('');
      expect(result.formatted).toBe('');
      expect(result.stats.additions).toBe(0);
      expect(result.stats.deletions).toBe(0);
    });

    test('names a changed file on both sides and shows only its changed lines', () => {
      const result = service.generateFileChangeDiff([
        change({ before: 'Hello world\nKeep me\n', after: 'Hello universe\nKeep me\n' }),
      ]);

      expect(result.hasChanges).toBe(true);
      expect(result.diff).toContain(`--- a/${USER_MESSAGE}`);
      expect(result.diff).toContain(`+++ b/${USER_MESSAGE}`);
      expect(result.diff).toContain('-Hello world');
      expect(result.diff).toContain('+Hello universe');
      expect(result.stats).toMatchObject({ additions: 1, deletions: 1, hunks: 1 });
    });

    test('keeps a long line as the file holds it rather than rewrapping it', () => {
      const long = 'word '.repeat(40).trim();

      const result = service.generateFileChangeDiff([
        change({ before: `${long}\n`, after: `${long}!\n` }),
      ]);

      expect(result.diff).toContain(`-${long}\n+${long}!`);
    });

    test('diffs a created file from /dev/null and a deleted file to it', () => {
      const result = service.generateFileChangeDiff([
        change({
          path: 'general/p/system-message.md',
          previousPath: 'general/p/system-message.md',
          before: null,
          after: 'Be precise.\n',
        }),
        change({
          path: 'general/p/tools/old/tool.yaml',
          previousPath: 'general/p/tools/old/tool.yaml',
          before: 'id: old\n',
          after: null,
        }),
      ]);

      expect(result.diff).toContain('--- /dev/null\n+++ b/general/p/system-message.md');
      expect(result.diff).toContain('--- a/general/p/tools/old/tool.yaml\n+++ /dev/null');
      expect(result.stats).toMatchObject({ additions: 1, deletions: 1, hunks: 2 });
    });

    test('omits a file whose content does not change and names the rest', () => {
      const result = service.generateFileChangeDiff([
        change({
          path: 'general/test_prompt/prompt.yaml',
          previousPath: 'general/test_prompt/prompt.yaml',
          before: 'id: test_prompt\n',
          after: 'id: test_prompt\n',
        }),
        change({ before: 'a\n', after: 'b\n' }),
      ]);

      expect(result.diff).not.toContain('prompt.yaml');
      expect(result.diff).toContain(USER_MESSAGE);
    });

    test('names the previous path when a write relocates the file', () => {
      const result = service.generateFileChangeDiff([
        change({
          previousPath: 'old_category/test_prompt/user-message.md',
          before: 'a\n',
          after: 'b\n',
        }),
      ]);

      expect(result.diff).toContain('--- a/old_category/test_prompt/user-message.md');
      expect(result.diff).toContain(`+++ b/${USER_MESSAGE}`);
    });
  });

  describe('truncation', () => {
    test('truncates large diffs to maxLines', () => {
      const result = service.generateFileChangeDiff([longChange()], { maxLines: 20 });

      expect(result.stats.truncated).toBe(true);
      expect(result.diff).toContain('... (');
      expect(result.diff).toContain('lines omitted)');
    });

    test('does not truncate small diffs', () => {
      const result = service.generateFileChangeDiff(
        [change({ before: 'Short\n', after: 'Also short\n' })],
        {
          maxLines: 100,
        }
      );

      expect(result.stats.truncated).toBe(false);
    });
  });

  describe('formatted output', () => {
    test('includes stats summary', () => {
      const result = service.generateFileChangeDiff([change({ before: 'Old\n', after: 'New\n' })]);

      expect(result.formatted).toContain('**Changes**:');
      expect(result.formatted).toMatch(/\+\d+ additions/);
      expect(result.formatted).toMatch(/-\d+ deletions/);
    });

    test('wraps diff in markdown code block', () => {
      const result = service.generateFileChangeDiff([change({ before: 'Old\n', after: 'New\n' })]);

      expect(result.formatted).toContain('```diff');
      expect(result.formatted).toContain('```');
    });

    test('reports the configured line budget when truncated', () => {
      const result = service.generateFileChangeDiff([longChange()], { maxLines: 30 });

      expect(result.formatted).toContain('*(Showing 30 of');
      expect(result.formatted).toContain('lines)*');
    });
  });

  describe('context lines', () => {
    test('respects custom context setting', () => {
      const before = 'Line 1\nLine 2\nLine 3\nLine 4\nLine 5\n';
      const edited = change({ before, after: before.replace('Line 3', 'Changed') });

      const resultWithContext = service.generateFileChangeDiff([edited], { context: 1 });
      const resultWithMoreContext = service.generateFileChangeDiff([edited], { context: 3 });

      expect(resultWithMoreContext.diff.length).toBeGreaterThan(resultWithContext.diff.length);
    });
  });

  describe('generateObjectDiff', () => {
    test('diffs two objects as YAML under the given file name', () => {
      const result = service.generateObjectDiff({ name: 'Old' }, { name: 'New' }, 'gate.yaml');

      expect(result.hasChanges).toBe(true);
      expect(result.diff).toContain('-name: Old');
      expect(result.diff).toContain('+name: New');
    });
  });
});
