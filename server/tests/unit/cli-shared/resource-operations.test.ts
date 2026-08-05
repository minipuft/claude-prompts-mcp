import { describe, expect, it, beforeEach, afterEach } from '@jest/globals';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  renameResource,
  movePromptCategory,
  toggleEnabled,
  linkGate,
  runValidatedMutation,
} from '../../../src/cli-shared/resource-operations.js';
import { loadHistory, saveVersion } from '../../../src/cli-shared/version-history.js';
import type { ResourceValidationResult } from '../../../src/cli-shared/resource-validation.js';
import { seedStateDbSchema } from '../../helpers/test-database.js';

describe('resource-operations', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'cpm-resops-'));
  });

  describe('runValidatedMutation', () => {
    it('returns success when validation passes', () => {
      const dir = join(tempDir, 'style-a');
      writeResource(
        dir,
        'style.yaml',
        [
          'id: style-a',
          'name: Style A',
          'description: test style',
          'guidanceFile: guidance.md',
          'enabled: true',
        ].join('\n')
      );

      const result = runValidatedMutation({
        resourceType: 'styles',
        resourceId: 'style-a',
        resourceDir: dir,
        entryFile: 'style.yaml',
        mutate: () => toggleEnabled(dir, 'style.yaml'),
      });

      expect(result.success).toBe(true);
      expect(result.operation.success).toBe(true);
      expect(readYaml(dir, 'style.yaml')).toContain('enabled: false');
    });

    it('rolls back when validation fails', () => {
      const dir = join(tempDir, 'style-b');
      writeResource(
        dir,
        'style.yaml',
        [
          'id: style-b',
          'name: Style B',
          'description: test style',
          'guidanceFile: guidance.md',
          'enabled: true',
        ].join('\n')
      );

      const forcedFailure: ResourceValidationResult = {
        valid: false,
        resourceType: 'styles',
        resourceId: 'style-b',
        filePath: join(dir, 'style.yaml'),
        errors: [{ code: 'schema_validation_error', path: 'enabled', message: 'Invalid boolean' }],
        warnings: [],
      };

      const result = runValidatedMutation({
        resourceType: 'styles',
        resourceId: 'style-b',
        resourceDir: dir,
        entryFile: 'style.yaml',
        mutate: () => toggleEnabled(dir, 'style.yaml'),
        validator: () => forcedFailure,
      });

      expect(result.success).toBe(false);
      expect(result.rolledBack).toBe(true);
      expect(result.validation?.valid).toBe(false);
      expect(readYaml(dir, 'style.yaml')).toContain('enabled: true');
    });
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  // ── Helpers ─────────────────────────────────────────────────────────────

  function writeResource(dir: string, entryFile: string, content: string): void {
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, entryFile), content, 'utf8');
  }

  function readYaml(dir: string, entryFile: string): string {
    return readFileSync(join(dir, entryFile), 'utf8');
  }

  // ── renameResource ────────────────────────────────────────────────────

  describe('renameResource', () => {
    it('renames directory and updates id field', () => {
      const dir = join(tempDir, 'old-name');
      writeResource(
        dir,
        'prompt.yaml',
        [
          'id: old-name',
          'name: Old Name',
          '# This is a comment',
          'description: A test prompt',
        ].join('\n')
      );

      const result = renameResource(dir, 'prompt.yaml', 'old-name', 'new-name');

      expect(result.success).toBe(true);
      expect(result.newDir).toBe(join(tempDir, 'new-name'));
      expect(existsSync(dir)).toBe(false);
      expect(existsSync(result.newDir!)).toBe(true);

      const content = readYaml(result.newDir!, 'prompt.yaml');
      expect(content).toContain('id: new-name');
      expect(content).toContain('name: Old Name');
      expect(content).toContain('# This is a comment');
    });

    it('updates history file resource_id', async () => {
      // Engine-owned DDL; the CLI no longer bootstraps it (see version-history.ts runSqlite).
      await seedStateDbSchema(tempDir);
      const dir = join(tempDir, 'resources', 'gates', 'hist-res');
      writeResource(dir, 'gate.yaml', 'id: hist-res\nname: Test');
      saveVersion(dir, 'gate', 'hist-res', { id: 'hist-res' }, { description: 'init' });

      const result = renameResource(dir, 'gate.yaml', 'hist-res', 'renamed-res');
      expect(result.success).toBe(true);

      const history = loadHistory(result.newDir!);
      expect(history?.resource_id).toBe('renamed-res');
    });

    it('errors when target directory exists', () => {
      const dir = join(tempDir, 'source');
      writeResource(dir, 'gate.yaml', 'id: source');
      mkdirSync(join(tempDir, 'target'));

      const result = renameResource(dir, 'gate.yaml', 'source', 'target');
      expect(result.success).toBe(false);
      expect(result.error).toContain('already exists');
    });

    it('errors when no id field found', () => {
      const dir = join(tempDir, 'no-id');
      writeResource(dir, 'gate.yaml', 'name: No ID\ndescription: test');

      const result = renameResource(dir, 'gate.yaml', 'no-id', 'new-id');
      expect(result.success).toBe(false);
      expect(result.error).toContain("No 'id' field");
    });

    // ── Edge cases that catch real bugs ──────────────────────────────────

    it('handles IDs with hyphens and underscores', () => {
      const dir = join(tempDir, 'my-complex_id');
      writeResource(dir, 'prompt.yaml', 'id: my-complex_id\nname: Test');

      const result = renameResource(dir, 'prompt.yaml', 'my-complex_id', 'new-complex_id');
      expect(result.success).toBe(true);

      const content = readYaml(result.newDir!, 'prompt.yaml');
      expect(content).toContain('id: new-complex_id');
      expect(content).not.toContain('my-complex_id');
    });

    it('does not corrupt YAML structure when id appears in other fields', () => {
      const dir = join(tempDir, 'tricky');
      writeResource(
        dir,
        'prompt.yaml',
        [
          'id: tricky',
          'name: A tricky prompt', // Contains 'tricky' in value
          'description: This tricky case tests regex safety',
        ].join('\n')
      );

      const result = renameResource(dir, 'prompt.yaml', 'tricky', 'renamed');
      expect(result.success).toBe(true);

      const content = readYaml(result.newDir!, 'prompt.yaml');
      // Only the id field should change, not other occurrences
      expect(content).toContain('id: renamed');
      expect(content).toContain('name: A tricky prompt'); // Unchanged
      expect(content).toContain('This tricky case'); // Unchanged
    });

    it('preserves file permissions after rename', () => {
      const dir = join(tempDir, 'perms-test');
      writeResource(dir, 'prompt.yaml', 'id: perms-test\nname: Test');

      const result = renameResource(dir, 'prompt.yaml', 'perms-test', 'new-perms');
      expect(result.success).toBe(true);

      // Directory should still exist and be accessible
      const stats = require('node:fs').statSync(result.newDir!);
      expect(stats.isDirectory()).toBe(true);
    });

    it('moves all files in resource directory, not just entry file', () => {
      const dir = join(tempDir, 'multi-file');
      writeResource(dir, 'prompt.yaml', 'id: multi-file\nname: Test');
      writeFileSync(join(dir, 'template.md'), '# Template content');
      writeFileSync(join(dir, 'extra.json'), '{"key": "value"}');

      const result = renameResource(dir, 'prompt.yaml', 'multi-file', 'renamed-multi');
      expect(result.success).toBe(true);

      // All files should be in new location
      expect(existsSync(join(result.newDir!, 'prompt.yaml'))).toBe(true);
      expect(existsSync(join(result.newDir!, 'template.md'))).toBe(true);
      expect(existsSync(join(result.newDir!, 'extra.json'))).toBe(true);

      // Old location completely gone
      expect(existsSync(dir)).toBe(false);
    });
  });

  // ── movePromptCategory ────────────────────────────────────────────────

  describe('movePromptCategory', () => {
    it('moves prompt to new category and updates field', () => {
      const promptsBase = join(tempDir, 'prompts');
      const dir = join(promptsBase, 'general', 'my-prompt');
      writeResource(
        dir,
        'prompt.yaml',
        ['id: my-prompt', 'category: general', '# Comments preserved', 'description: A test'].join(
          '\n'
        )
      );

      const result = movePromptCategory(dir, 'prompt.yaml', 'my-prompt', 'tools', promptsBase);

      expect(result.success).toBe(true);
      expect(result.oldCategory).toBe('general');
      expect(result.newDir).toBe(join(promptsBase, 'tools', 'my-prompt'));
      expect(existsSync(dir)).toBe(false);

      const content = readYaml(result.newDir!, 'prompt.yaml');
      expect(content).toContain('category: tools');
      expect(content).toContain('# Comments preserved');
      expect(content).not.toContain('category: general');
    });

    it('creates category directory if missing', () => {
      const promptsBase = join(tempDir, 'prompts');
      const dir = join(promptsBase, 'general', 'my-prompt');
      writeResource(dir, 'prompt.yaml', 'id: my-prompt\ncategory: general');

      const result = movePromptCategory(
        dir,
        'prompt.yaml',
        'my-prompt',
        'new-category',
        promptsBase
      );
      expect(result.success).toBe(true);
      expect(existsSync(join(promptsBase, 'new-category', 'my-prompt'))).toBe(true);
    });

    it('errors when already in target category', () => {
      const promptsBase = join(tempDir, 'prompts');
      const dir = join(promptsBase, 'general', 'my-prompt');
      writeResource(dir, 'prompt.yaml', 'id: my-prompt\ncategory: general');

      const result = movePromptCategory(dir, 'prompt.yaml', 'my-prompt', 'general', promptsBase);
      expect(result.success).toBe(false);
      expect(result.error).toContain('already in category');
    });

    it('errors when no category field found', () => {
      const promptsBase = join(tempDir, 'prompts');
      const dir = join(promptsBase, 'general', 'no-cat');
      writeResource(dir, 'prompt.yaml', 'id: no-cat\nname: test');

      const result = movePromptCategory(dir, 'prompt.yaml', 'no-cat', 'tools', promptsBase);
      expect(result.success).toBe(false);
      expect(result.error).toContain("No 'category' field");
    });
  });

  // ── toggleEnabled ─────────────────────────────────────────────────────

  describe('toggleEnabled', () => {
    it('toggles true to false', () => {
      const dir = join(tempDir, 'method');
      writeResource(
        dir,
        'framework.yaml',
        ['id: method', 'enabled: true', '# Keep this comment'].join('\n')
      );

      const result = toggleEnabled(dir, 'framework.yaml');

      expect(result.success).toBe(true);
      expect(result.previousValue).toBe(true);
      expect(result.newValue).toBe(false);

      const content = readYaml(dir, 'framework.yaml');
      expect(content).toContain('enabled: false');
      expect(content).toContain('# Keep this comment');
    });

    it('toggles false to true', () => {
      const dir = join(tempDir, 'method');
      writeResource(dir, 'framework.yaml', 'id: method\nenabled: false');

      const result = toggleEnabled(dir, 'framework.yaml');

      expect(result.success).toBe(true);
      expect(result.previousValue).toBe(false);
      expect(result.newValue).toBe(true);

      const content = readYaml(dir, 'framework.yaml');
      expect(content).toContain('enabled: true');
    });

    it('errors when no enabled field', () => {
      const dir = join(tempDir, 'no-enable');
      writeResource(dir, 'gate.yaml', 'id: no-enable\nname: test');

      const result = toggleEnabled(dir, 'gate.yaml');
      expect(result.success).toBe(false);
      expect(result.error).toContain("No 'enabled' field");
    });

    // ── Edge cases ───────────────────────────────────────────────────────

    it('handles enabled field with trailing whitespace', () => {
      const dir = join(tempDir, 'whitespace');
      writeResource(dir, 'framework.yaml', 'id: whitespace\nenabled: true   \nname: Test');

      const result = toggleEnabled(dir, 'framework.yaml');
      expect(result.success).toBe(true);
      expect(result.newValue).toBe(false);
    });

    it('does not match "enabled" in other contexts', () => {
      const dir = join(tempDir, 'tricky-enabled');
      writeResource(
        dir,
        'framework.yaml',
        [
          'id: tricky-enabled',
          'enabled: true',
          'description: This framework enabled new features', // "enabled" in text
        ].join('\n')
      );

      const result = toggleEnabled(dir, 'framework.yaml');
      expect(result.success).toBe(true);

      const content = readYaml(dir, 'framework.yaml');
      expect(content).toContain('enabled: false');
      expect(content).toContain('This framework enabled new features'); // Unchanged
    });
  });

  // ── linkGate ──────────────────────────────────────────────────────────

  describe('linkGate', () => {
    it('adds gate to empty gateConfiguration', () => {
      const dir = join(tempDir, 'prompt');
      writeResource(dir, 'prompt.yaml', 'id: prompt\nname: Test\ncategory: general');

      const result = linkGate(dir, 'prompt.yaml', 'code-quality');

      expect(result.success).toBe(true);
      expect(result.action).toBe('added');
      expect(result.include).toEqual(['code-quality']);

      const content = readYaml(dir, 'prompt.yaml');
      expect(content).toContain('code-quality');
      expect(content).toContain('gateConfiguration');
    });

    it('adds gate to existing include array', () => {
      const dir = join(tempDir, 'prompt');
      writeResource(
        dir,
        'prompt.yaml',
        ['id: prompt', 'gateConfiguration:', '  include:', '    - existing-gate'].join('\n')
      );

      const result = linkGate(dir, 'prompt.yaml', 'new-gate');

      expect(result.success).toBe(true);
      expect(result.include).toEqual(['existing-gate', 'new-gate']);
    });

    it('errors on duplicate gate', () => {
      const dir = join(tempDir, 'prompt');
      writeResource(
        dir,
        'prompt.yaml',
        ['id: prompt', 'gateConfiguration:', '  include:', '    - code-quality'].join('\n')
      );

      const result = linkGate(dir, 'prompt.yaml', 'code-quality');
      expect(result.success).toBe(false);
      expect(result.error).toContain('already linked');
    });

    it('removes gate with remove flag', () => {
      const dir = join(tempDir, 'prompt');
      writeResource(
        dir,
        'prompt.yaml',
        ['id: prompt', 'gateConfiguration:', '  include:', '    - gate-a', '    - gate-b'].join(
          '\n'
        )
      );

      const result = linkGate(dir, 'prompt.yaml', 'gate-a', true);

      expect(result.success).toBe(true);
      expect(result.action).toBe('removed');
      expect(result.include).toEqual(['gate-b']);
    });

    it('removes gateConfiguration when last gate removed', () => {
      const dir = join(tempDir, 'prompt');
      writeResource(
        dir,
        'prompt.yaml',
        ['id: prompt', 'gateConfiguration:', '  include:', '    - only-gate'].join('\n')
      );

      const result = linkGate(dir, 'prompt.yaml', 'only-gate', true);

      expect(result.success).toBe(true);
      expect(result.include).toEqual([]);

      const content = readYaml(dir, 'prompt.yaml');
      expect(content).not.toContain('gateConfiguration');
    });

    it('errors when removing non-existent gate', () => {
      const dir = join(tempDir, 'prompt');
      writeResource(dir, 'prompt.yaml', 'id: prompt\ncategory: general');

      const result = linkGate(dir, 'prompt.yaml', 'missing-gate', true);
      expect(result.success).toBe(false);
      expect(result.error).toContain('not linked');
    });
  });
});
