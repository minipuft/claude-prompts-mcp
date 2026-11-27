import { describe, expect, it, beforeEach, afterEach } from '@jest/globals';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import {
  initWorkspace,
  formatStarterPromptYaml,
  STARTER_PROMPTS,
} from '../../../src/cli-shared/workspace-init.js';
import type { StarterPrompt } from '../../../src/cli-shared/workspace-init.js';

describe('workspace-init', () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'cpm-workspace-'));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('initWorkspace', () => {
    it('creates workspace with starter prompts', () => {
      const targetPath = join(tempDir, 'new-workspace');
      const result = initWorkspace(targetPath);

      expect(result.success).toBe(true);
      expect(result.message).toContain('Workspace created at');

      // Verify directory structure
      const promptsDir = join(targetPath, 'resources', 'prompts');
      expect(existsSync(promptsDir)).toBe(true);

      // Verify each starter prompt was created
      for (const prompt of STARTER_PROMPTS) {
        const promptDir = join(promptsDir, prompt.category, prompt.id);
        expect(existsSync(join(promptDir, 'prompt.yaml'))).toBe(true);
        expect(existsSync(join(promptDir, 'user-message.md'))).toBe(true);
      }
    });

    it('fails if workspace already exists (resources/prompts)', () => {
      const targetPath = join(tempDir, 'existing');
      const promptsDir = join(targetPath, 'resources', 'prompts');
      mkdirSync(promptsDir, { recursive: true });
      writeFileSync(join(promptsDir, 'something.yaml'), 'id: test');

      const result = initWorkspace(targetPath);

      expect(result.success).toBe(false);
      expect(result.message).toContain('Workspace already exists');
    });

    it('refuses a prompts folder at the workspace root that holds a prompt, creating nothing', () => {
      const targetPath = join(tempDir, 'root-layout');
      const promptDir = join(targetPath, 'prompts', 'demo', 'hello');
      mkdirSync(promptDir, { recursive: true });
      writeFileSync(join(promptDir, 'prompt.yaml'), 'id: hello');

      const result = initWorkspace(targetPath);

      expect(result.success).toBe(false);
      expect(result.message).toContain('Refusing to create a workspace:');
      expect(result.message).toContain(
        `Move: ${join(targetPath, 'prompts')} -> ${join(targetPath, 'resources', 'prompts')}`
      );
      expect(existsSync(join(targetPath, 'resources'))).toBe(false);
    });

    it('scaffolds beside a root prompts folder that holds no prompt', () => {
      const targetPath = join(tempDir, 'unrelated-prompts');
      const legacyDir = join(targetPath, 'prompts');
      mkdirSync(legacyDir, { recursive: true });
      writeFileSync(join(legacyDir, 'notes.yaml'), 'id: test');

      const result = initWorkspace(targetPath);

      expect(result.success).toBe(true);
      expect(existsSync(join(targetPath, 'resources', 'prompts'))).toBe(true);
    });

    it('succeeds if prompts directory exists but is empty', () => {
      const targetPath = join(tempDir, 'empty-prompts');
      mkdirSync(join(targetPath, 'resources', 'prompts'), { recursive: true });

      const result = initWorkspace(targetPath);

      expect(result.success).toBe(true);
    });

    it('creates correct number of files', () => {
      const targetPath = join(tempDir, 'count-check');
      initWorkspace(targetPath);

      const promptsDir = join(targetPath, 'resources', 'prompts');
      const categories = readdirSync(promptsDir);

      let fileCount = 0;
      for (const category of categories) {
        const categoryDir = join(promptsDir, category);
        const prompts = readdirSync(categoryDir);
        for (const prompt of prompts) {
          const promptDir = join(categoryDir, prompt);
          fileCount += readdirSync(promptDir).length;
        }
      }

      // Each starter prompt produces 2 files (prompt.yaml + user-message.md)
      expect(fileCount).toBe(STARTER_PROMPTS.length * 2);
    });
  });

  describe('formatStarterPromptYaml', () => {
    it('formats a prompt to valid YAML structure', () => {
      const prompt: StarterPrompt = {
        id: 'test_prompt',
        category: 'testing',
        description: 'A test prompt.',
        userMessageTemplate: 'Test template',
        arguments: [{ name: 'input', type: 'string', description: 'Test input.' }],
      };

      const yaml = formatStarterPromptYaml(prompt);

      expect(yaml).toContain('id: test_prompt');
      expect(yaml).toContain('name: test_prompt');
      expect(yaml).toContain('category: testing');
      expect(yaml).toContain('description: >-');
      expect(yaml).toContain('userMessageTemplateFile: user-message.md');
      expect(yaml).toContain('  - name: input');
      expect(yaml).toContain('    type: string');
    });
  });

  describe('STARTER_PROMPTS', () => {
    it('contains expected starter prompts', () => {
      const ids = STARTER_PROMPTS.map((p) => p.id);
      expect(ids).toContain('quick_review');
      expect(ids).toContain('explain');
      expect(ids).toContain('improve');
    });

    it('each prompt has required fields', () => {
      for (const prompt of STARTER_PROMPTS) {
        expect(prompt.id).toBeTruthy();
        expect(prompt.category).toBeTruthy();
        expect(prompt.description).toBeTruthy();
        expect(prompt.userMessageTemplate).toBeTruthy();
        expect(prompt.arguments.length).toBeGreaterThan(0);
      }
    });
  });
});
