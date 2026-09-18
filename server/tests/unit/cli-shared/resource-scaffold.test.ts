import { describe, expect, it, beforeEach, afterEach } from '@jest/globals';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  createResourceDir,
  deleteResource,
  deleteResourceDir,
  resourceExists,
} from '../../../src/cli-shared/resource-scaffold.js';
import { loadHistory, saveVersion } from '../../../src/cli-shared/version-history.js';
import { seedStateDbSchema } from '../../helpers/test-database.js';

describe('resource-scaffold', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'cpm-scaffold-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('resourceExists', () => {
    it('returns undefined for nonexistent prompt', () => {
      expect(resourceExists(tempDir, 'prompts', 'nope')).toBeUndefined();
    });

    it('returns the directory-form path for an existing prompt with category', () => {
      const dir = join(tempDir, 'general', 'my-prompt');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'prompt.yaml'), 'id: my-prompt');

      expect(resourceExists(tempDir, 'prompts', 'my-prompt', 'general')).toBe(
        join(dir, 'prompt.yaml')
      );
    });

    it('returns the directory-form path for an existing gate (flat)', () => {
      const dir = join(tempDir, 'my-gate');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'gate.yaml'), 'id: my-gate');

      expect(resourceExists(tempDir, 'gates', 'my-gate')).toBe(join(dir, 'gate.yaml'));
    });

    it('returns undefined for wrong category', () => {
      const dir = join(tempDir, 'tools', 'my-prompt');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'prompt.yaml'), 'id: my-prompt');

      expect(resourceExists(tempDir, 'prompts', 'my-prompt', 'general')).toBeUndefined();
    });

    it('returns the single-file path when only the file form exists (P4.63)', () => {
      const category = join(tempDir, 'general');
      mkdirSync(category, { recursive: true });
      writeFileSync(join(category, 'x.yaml'), 'id: x');

      expect(resourceExists(tempDir, 'prompts', 'x', 'general')).toBe(join(category, 'x.yaml'));
    });

    it('creates cleanly when only an unrelated single-file id exists', () => {
      const category = join(tempDir, 'general');
      mkdirSync(category, { recursive: true });
      writeFileSync(join(category, 'y.yaml'), 'id: y');

      expect(resourceExists(tempDir, 'prompts', 'x', 'general')).toBeUndefined();
    });

    it('reports the directory form when an id is spelled both ways, as the loader would serve it', () => {
      const category = join(tempDir, 'general');
      const dir = join(category, 'twin');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'prompt.yaml'), 'id: twin');
      writeFileSync(join(category, 'twin.yaml'), 'id: twin');

      expect(resourceExists(tempDir, 'prompts', 'twin', 'general')).toBe(join(dir, 'prompt.yaml'));
    });
  });

  describe('createResourceDir', () => {
    it('creates prompt directory with YAML and companion', () => {
      const result = createResourceDir(tempDir, 'prompts', 'analysis', {
        name: 'Code Analysis',
        description: 'Analyze source code',
        category: 'tools',
      });

      expect(result.success).toBe(true);
      expect(result.path).toContain('tools/analysis');

      const yamlPath = join(result.path!, 'prompt.yaml');
      expect(existsSync(yamlPath)).toBe(true);

      const content = readFileSync(yamlPath, 'utf8');
      expect(content).toContain('id: analysis');
      expect(content).toContain('name: Code Analysis');
      expect(content).toContain('category: tools');
      expect(content).toContain('Analyze source code');
      expect(content).toContain('userMessageTemplateFile: user-message.md');

      expect(existsSync(join(result.path!, 'user-message.md'))).toBe(true);
    });

    it('creates gate directory with YAML and guidance', () => {
      const result = createResourceDir(tempDir, 'gates', 'quality-check', {
        name: 'Quality Check',
      });

      expect(result.success).toBe(true);

      const content = readFileSync(join(result.path!, 'gate.yaml'), 'utf8');
      expect(content).toContain('id: quality-check');
      expect(content).toContain('name: Quality Check');
      expect(content).toContain('type: validation');
      expect(content).toContain('guidanceFile: guidance.md');

      expect(existsSync(join(result.path!, 'guidance.md'))).toBe(true);
    });

    it('creates framework directory with YAML and system-prompt', () => {
      const result = createResourceDir(tempDir, 'frameworks', 'my-method', {
        name: 'My Method',
        description: 'A custom method',
      });

      expect(result.success).toBe(true);

      const content = readFileSync(join(result.path!, 'framework.yaml'), 'utf8');
      expect(content).toContain('id: my-method');
      expect(content).toContain('name: My Method');
      expect(content).toContain('type: MY_METHOD');
      expect(content).toContain('version: 1.0.0');
      expect(content).toContain('enabled: false');

      expect(existsSync(join(result.path!, 'system-prompt.md'))).toBe(true);
    });

    it('creates style directory with YAML and guidance', () => {
      const result = createResourceDir(tempDir, 'styles', 'my-style', {
        name: 'My Style',
        description: 'A custom style',
      });

      expect(result.success).toBe(true);

      const content = readFileSync(join(result.path!, 'style.yaml'), 'utf8');
      expect(content).toContain('id: my-style');
      expect(content).toContain('name: My Style');
      expect(content).toContain('enabled: true');
      expect(content).toContain('guidanceFile: guidance.md');

      expect(existsSync(join(result.path!, 'guidance.md'))).toBe(true);
    });

    it('generates companion files with starter content', () => {
      const prompt = createResourceDir(tempDir, 'prompts', 'starter-p');
      const gate = createResourceDir(join(tempDir, '2'), 'gates', 'starter-g');
      const method = createResourceDir(join(tempDir, '3'), 'frameworks', 'starter-m');
      const style = createResourceDir(join(tempDir, '4'), 'styles', 'starter-s');

      const promptContent = readFileSync(join(prompt.path!, 'user-message.md'), 'utf8');
      expect(promptContent.length).toBeGreaterThan(0);
      expect(promptContent).toContain('{{');

      const gateContent = readFileSync(join(gate.path!, 'guidance.md'), 'utf8');
      expect(gateContent).toContain('Validation Criteria');

      const methodContent = readFileSync(join(method.path!, 'system-prompt.md'), 'utf8');
      expect(methodContent.length).toBeGreaterThan(0);

      const styleContent = readFileSync(join(style.path!, 'guidance.md'), 'utf8');
      expect(styleContent).toContain('Style Guidance');
    });

    it('defaults prompt category to general', () => {
      const result = createResourceDir(tempDir, 'prompts', 'default-cat');
      expect(result.success).toBe(true);
      expect(result.path).toContain('general/default-cat');
    });

    it('errors when resource already exists', () => {
      createResourceDir(tempDir, 'gates', 'existing');
      const result = createResourceDir(tempDir, 'gates', 'existing');
      expect(result.success).toBe(false);
      expect(result.error).toContain('already exists');
    });

    it('uses id as name when name is not provided', () => {
      const result = createResourceDir(tempDir, 'gates', 'auto-name');
      const content = readFileSync(join(result.path!, 'gate.yaml'), 'utf8');
      expect(content).toContain('name: auto-name');
    });

    it('supports opting out of validation for scaffold writes', () => {
      const result = createResourceDir(tempDir, 'prompts', 'no-validate', {
        validate: false,
      });
      expect(result.success).toBe(true);
      expect(result.validation).toBeUndefined();
    });

    it('reports rolledBack on write failure and cleans up partial directory', () => {
      // Create a read-only directory so file writes inside it fail
      const readOnlyDir = join(tempDir, 'readonly-parent', 'sub');
      mkdirSync(readOnlyDir, { recursive: true });
      const { chmodSync } = require('node:fs');
      chmodSync(readOnlyDir, 0o444);

      try {
        const result = createResourceDir(readOnlyDir, 'gates', 'will-fail');
        expect(result.success).toBe(false);
        expect(result.rolledBack).toBe(true);
      } finally {
        chmodSync(readOnlyDir, 0o755);
      }
    });
  });

  describe('a create that fails validation', () => {
    it('removes its files and leaves the history stored under that id', async () => {
      // A create writes no history, so rows already under this id belong to an earlier resource
      // of the same name (`resource_manager` keeps a deleted prompt's rows); cleanup must not
      // erase them.
      await seedStateDbSchema(tempDir);
      const ref = { resourceType: 'prompt' as const, resourceId: 'reused' };
      saveVersion(tempDir, ref.resourceType, ref.resourceId, { id: 'reused' });

      const result = createResourceDir(tempDir, 'prompts', 'reused', { name: '' });

      expect(result.success).toBe(false);
      expect(result.rolledBack).toBe(true);
      expect(existsSync(join(tempDir, 'general', 'reused'))).toBe(false);
      expect(loadHistory(tempDir, ref)?.versions).toHaveLength(1);
    });
  });

  describe('deleteResourceDir', () => {
    it('deletes existing resource directory', () => {
      const result = createResourceDir(tempDir, 'gates', 'to-delete');
      expect(result.success).toBe(true);
      expect(existsSync(result.path!)).toBe(true);

      const deleteResult = deleteResourceDir(result.path!, {
        resourceType: 'gate',
        resourceId: 'to-delete',
      });
      expect(deleteResult.success).toBe(true);
      expect(existsSync(result.path!)).toBe(false);
    });

    it('deletes history file along with directory', () => {
      const dir = join(tempDir, 'with-history');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'gate.yaml'), 'id: x');
      writeFileSync(join(dir, '.history.json'), '{}');

      const result = deleteResourceDir(dir, { resourceType: 'gate', resourceId: 'with-history' });
      expect(result.success).toBe(true);
      expect(existsSync(dir)).toBe(false);
    });

    it('errors when directory does not exist', () => {
      const result = deleteResourceDir(join(tempDir, 'nonexistent'), {
        resourceType: 'gate',
        resourceId: 'nonexistent',
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('does not exist');
    });
  });

  describe('deleteResource', () => {
    const ref = { resourceType: 'prompt' as const, resourceId: 'solo' };

    it('removes a single-file prompt and leaves the category around it', () => {
      const category = join(tempDir, 'general');
      mkdirSync(join(category, 'sibling'), { recursive: true });
      writeFileSync(join(category, 'sibling', 'prompt.yaml'), 'id: sibling');
      writeFileSync(join(category, 'solo.yaml'), 'id: solo');

      const result = deleteResource({ form: 'file', file: join(category, 'solo.yaml') }, ref);

      expect(result.success).toBe(true);
      expect(existsSync(join(category, 'solo.yaml'))).toBe(false);
      expect(existsSync(join(category, 'sibling', 'prompt.yaml'))).toBe(true);
    });

    it('refuses a file location that names a directory rather than emptying it', () => {
      const dir = join(tempDir, 'general');
      mkdirSync(join(dir, 'sibling'), { recursive: true });

      const result = deleteResource({ form: 'file', file: dir }, ref);

      expect(result.success).toBe(false);
      expect(existsSync(join(dir, 'sibling'))).toBe(true);
    });

    it('removes a directory prompt with its directory', () => {
      const dir = join(tempDir, 'general', 'solo');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'prompt.yaml'), 'id: solo');

      const result = deleteResource({ form: 'dir', dir, file: join(dir, 'prompt.yaml') }, ref);

      expect(result.success).toBe(true);
      expect(existsSync(dir)).toBe(false);
    });
  });
});
