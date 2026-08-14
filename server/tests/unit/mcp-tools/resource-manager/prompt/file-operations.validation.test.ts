import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path, { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseYamlOrThrow } from '../../../../../src/shared/utils/yaml/yaml-parser.js';

import {
  FileOperations,
  resolveCategoryShipStatus,
  toYamlPromptId,
} from '../../../../../src/mcp/tools/resource-manager/prompt/operations/file-operations.js';
import {
  normalizePromptId,
  validatePromptId,
} from '../../../../../src/mcp/tools/resource-manager/prompt/utils/validation.js';

import type { ConfigManager, Logger } from '../../../../../src/shared/types/index.js';

describe('FileOperations canonical prompt writes', () => {
  let workspaceDir: string;
  let promptsDir: string;
  let logger: Logger;
  let configManager: ConfigManager;

  beforeEach(() => {
    workspaceDir = mkdtempSync(join(tmpdir(), 'cpm-prompt-ops-'));
    promptsDir = join(workspaceDir, 'prompts');
    logger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    } as unknown as Logger;
    configManager = {
      getResolvedPromptsDirectory: () => promptsDir,
    } as unknown as ConfigManager;
  });

  afterEach(() => {
    rmSync(workspaceDir, { recursive: true, force: true });
  });

  /** Parsed rather than string-matched: the assertions below are about values, not formatting. */
  function readPromptYaml(category: string, id: string): Record<string, unknown> {
    return parseYamlOrThrow<Record<string, unknown>>(
      readFileSync(join(promptsDir, category, id, 'prompt.yaml'), 'utf8')
    );
  }

  it('writes prompt files without transactional verification metadata', async () => {
    const operations = new FileOperations({ logger, configManager });
    const result = await operations.updatePromptImplementation({
      id: 'sample_prompt',
      name: 'Sample Prompt',
      category: 'new-category',
      description: 'Prompt description',
      userMessageTemplate: 'hello',
      arguments: [],
      tools: [],
    });

    expect(result.message).toContain('Created prompt: sample_prompt');
    expect(result.metadata).toBeUndefined();
    expect(existsSync(join(promptsDir, 'new-category', 'sample_prompt', 'prompt.yaml'))).toBe(true);
    expect(existsSync(join(promptsDir, 'new-category', 'sample_prompt', 'user-message.md'))).toBe(
      true
    );

    const yamlContent = readFileSync(
      join(promptsDir, 'new-category', 'sample_prompt', 'prompt.yaml'),
      'utf8'
    );
    expect(yamlContent).toContain('id: sample_prompt');
    expect(yamlContent).toContain('name: Sample Prompt');
  });

  // Regression: the writer used to emit the path-qualified id into the YAML `id` field, which
  // violates the id regex. The write failed validation and rolled back; when it had already
  // landed (older builds), the loader dropped the prompt at startup with only a log line.
  it('writes a nested chain-step prompt under its qualified path with a basename id', async () => {
    const operations = new FileOperations({ logger, configManager });
    const result = await operations.updatePromptImplementation({
      id: 'parent_chain/verification',
      name: 'Verification',
      category: 'planning',
      description: 'Nested chain step used to verify path-qualified id handling',
      userMessageTemplate: 'verify {{feature}}',
      arguments: [],
      tools: [],
    });

    const nestedYamlPath = join(promptsDir, 'planning', 'parent_chain', 'verification');
    expect(result.message).toContain('Created prompt: parent_chain/verification');
    expect(existsSync(join(nestedYamlPath, 'prompt.yaml'))).toBe(true);
    expect(existsSync(join(nestedYamlPath, 'user-message.md'))).toBe(true);

    // Directory keeps the qualified path; the YAML id is the last segment only.
    const yamlContent = readFileSync(join(nestedYamlPath, 'prompt.yaml'), 'utf8');
    expect(yamlContent).toContain('id: verification');
    expect(yamlContent).not.toContain('parent_chain/verification');
  });

  it('leaves an unqualified id untouched', () => {
    expect(toYamlPromptId('sample_prompt')).toBe('sample_prompt');
    expect(toYamlPromptId('parent_chain/verification')).toBe('verification');
  });

  // P7-D1: the argument fields the tool schema used to strip have to reach disk once it stops.
  it('writes required, defaultValue and validation into the argument list', async () => {
    const operations = new FileOperations({ logger, configManager });
    await operations.updatePromptImplementation({
      id: 'arg_prompt',
      name: 'Arg Prompt',
      category: 'general',
      description: 'Carries a fully specified argument',
      userMessageTemplate: 'Do {{feature}}',
      arguments: [
        {
          name: 'feature',
          type: 'string',
          description: 'What to do',
          required: true,
          defaultValue: 'nothing',
          validation: { minLength: 3 },
        },
      ],
      tools: [],
    });

    const written = readPromptYaml('general', 'arg_prompt');
    expect(written.arguments).toEqual([
      {
        name: 'feature',
        type: 'string',
        description: 'What to do',
        required: true,
        defaultValue: 'nothing',
        validation: { minLength: 3 },
      },
    ]);
  });

  /**
   * P7-F2: `createOrUpdateYamlPrompt` built values for 10 of the 17 fields `PromptYamlSchema`
   * accepts and emitted nothing for the rest, so every update through `resource_manager` deleted
   * them. `subagentModel` and `agentType` govern `==>` delegation, so the loss was behavioural.
   *
   * One test per field rather than one asserting all five, so a writer that drops exactly one
   * produces exactly one failure naming it.
   */
  describe('field preservation across an update', () => {
    const declaredFields = {
      injection: { 'system-prompt': { enabled: false } },
      registerWithMcp: false,
      mcpPromptMode: 'launch',
      subagentModel: 'heavy',
      agentType: 'code-lifecycle-auditor',
    } as const;

    async function seedThenUpdateDescription(): Promise<Record<string, unknown>> {
      const operations = new FileOperations({ logger, configManager });
      // Seed through the writer itself, then re-declare the fields on disk. Since OQ-P7-8 the tool
      // CAN set all five, but this case is the other half of the contract: an update that supplies
      // none of them must leave a hand-authored file exactly as it found it.
      await operations.updatePromptImplementation({
        id: 'delegating_prompt',
        name: 'Delegating Prompt',
        category: 'general',
        description: 'Original description',
        userMessageTemplate: 'Delegate {{task}}',
        arguments: [],
        tools: [],
      });
      const yamlPath = join(promptsDir, 'general', 'delegating_prompt', 'prompt.yaml');
      writeFileSync(
        yamlPath,
        `${readFileSync(yamlPath, 'utf8')}\n${[
          'injection:',
          '  system-prompt:',
          '    enabled: false',
          'registerWithMcp: false',
          "mcpPromptMode: 'launch'",
          "subagentModel: 'heavy'",
          "agentType: 'code-lifecycle-auditor'",
        ].join('\n')}\n`,
        'utf8'
      );

      // The shape `updatePrompt` produces: rebased from the loaded prompt, which carries none of
      // these fields back to the writer.
      await operations.updatePromptImplementation({
        id: 'delegating_prompt',
        name: 'Delegating Prompt',
        category: 'general',
        description: 'Updated description',
        userMessageTemplate: 'Delegate {{task}}',
        arguments: [],
        tools: [],
      });

      return readPromptYaml('general', 'delegating_prompt');
    }

    for (const [field, value] of Object.entries(declaredFields)) {
      it(`preserves ${field}`, async () => {
        const written = await seedThenUpdateDescription();

        expect(written[field]).toEqual(value);
      });
    }

    it('still applies the update that carried none of them', async () => {
      const written = await seedThenUpdateDescription();

      // Guards the opposite failure: preserving by not writing at all would pass every assertion
      // above while silently dropping the actual edit.
      expect(written['description']).toBe('Updated description');
    });

    it('writes none of them for a prompt that never declared them', async () => {
      const operations = new FileOperations({ logger, configManager });
      await operations.updatePromptImplementation({
        id: 'plain_prompt',
        name: 'Plain Prompt',
        category: 'general',
        description: 'No delegation fields',
        userMessageTemplate: 'Do {{task}}',
        arguments: [],
        tools: [],
      });

      const written = readPromptYaml('general', 'plain_prompt');
      // Preserve-if-present, never write defaults. `ConvertedPrompt.registerWithMcp` and
      // `.mcpPromptMode` are always populated because the converter RESOLVES them through
      // prompt → category → global → hard-coded default; materialising a resolved default here
      // would freeze the prompt against any later change to the default it was inheriting.
      for (const field of Object.keys(declaredFields)) {
        expect(written).not.toHaveProperty(field);
      }
    });
  });

  /**
   * OQ-P7-8. `resolvePreservedPromptYamlFields` is the precedence rule the whole feature rests on:
   * a supplied value wins, an omitted one falls back to the file. The preservation tests above
   * cover the fallback; these cover the supplied branch, which had no reachable caller until the
   * five tool parameters existed.
   */
  describe('an explicitly supplied value overrides the on-disk declaration', () => {
    const authored = {
      injection: { 'system-prompt': { enabled: false } },
      registerWithMcp: false,
      mcpPromptMode: 'launch',
      subagentModel: 'heavy',
      agentType: 'code-lifecycle-auditor',
    } as const;

    const supplied = {
      injection: { 'gate-guidance': { enabled: true, target: 'gates' } },
      registerWithMcp: true,
      mcpPromptMode: 'expand',
      subagentModel: 'fast',
      agentType: 'general-purpose',
    } as const;

    async function seedAuthoredThenUpdate(
      overrides: Record<string, unknown>
    ): Promise<Record<string, unknown>> {
      const operations = new FileOperations({ logger, configManager });
      await operations.updatePromptImplementation({
        id: 'override_prompt',
        name: 'Override Prompt',
        category: 'general',
        description: 'Original description',
        userMessageTemplate: 'Delegate {{task}}',
        arguments: [],
        tools: [],
        ...authored,
      });

      await operations.updatePromptImplementation({
        id: 'override_prompt',
        name: 'Override Prompt',
        category: 'general',
        description: 'Updated description',
        userMessageTemplate: 'Delegate {{task}}',
        arguments: [],
        tools: [],
        ...overrides,
      });

      return readPromptYaml('general', 'override_prompt');
    }

    // One case per field: an override path that silently drops exactly one produces exactly one
    // failure naming it, rather than a single opaque object mismatch.
    for (const [field, value] of Object.entries(supplied)) {
      it(`overrides ${field} with the supplied value`, async () => {
        const written = await seedAuthoredThenUpdate({ [field]: value });

        expect(written[field]).toEqual(value);
      });

      it(`leaves ${field} at its authored value when the update omits it`, async () => {
        // The same seed, updated with a DIFFERENT field supplied — proves the override is
        // per-field and does not clear its neighbours.
        const other = field === 'agentType' ? 'subagentModel' : 'agentType';
        const written = await seedAuthoredThenUpdate({
          [other]: supplied[other as keyof typeof supplied],
        });

        expect(written[field]).toEqual(authored[field as keyof typeof authored]);
      });
    }
  });

  describe('categoryShipStatus surfacing (P7-D4)', () => {
    it('reports ships:true when no .gitignore exists at the resolved prompts directory', async () => {
      const operations = new FileOperations({ logger, configManager });
      const result = await operations.updatePromptImplementation({
        id: 'no_gitignore_prompt',
        name: 'No Gitignore',
        category: 'anything',
        description: 'd',
        userMessageTemplate: 'hi',
        arguments: [],
        tools: [],
      });

      expect(result.categoryShipStatus).toEqual({
        category: 'anything',
        ships: true,
        gitignorePath: join(promptsDir, '.gitignore'),
      });
    });

    it('reports ships:false for a category a local .gitignore excludes, true for one it allows', async () => {
      mkdirSync(promptsDir, { recursive: true });
      writeFileSync(join(promptsDir, '.gitignore'), '*\n!examples/\n!examples/**\n', 'utf8');
      const operations = new FileOperations({ logger, configManager });

      const blocked = await operations.updatePromptImplementation({
        id: 'p1',
        name: 'P1',
        category: 'blocked-cat',
        description: 'd',
        userMessageTemplate: 'hi',
        arguments: [],
        tools: [],
      });
      expect(blocked.categoryShipStatus).toEqual({
        category: 'blocked-cat',
        ships: false,
        gitignorePath: join(promptsDir, '.gitignore'),
      });

      const shipped = await operations.updatePromptImplementation({
        id: 'p2',
        name: 'P2',
        category: 'examples',
        description: 'd',
        userMessageTemplate: 'hi',
        arguments: [],
        tools: [],
      });
      expect(shipped.categoryShipStatus?.ships).toBe(true);
    });
  });
});

describe('normalizePromptId', () => {
  it('converts hyphens to underscores', () => {
    expect(normalizePromptId('hot-reload-test')).toBe('hot_reload_test');
  });

  it('converts spaces to underscores', () => {
    expect(normalizePromptId('hot reload test')).toBe('hot_reload_test');
  });

  it('lowercases the ID', () => {
    expect(normalizePromptId('Hot-Reload-Test')).toBe('hot_reload_test');
  });

  it('collapses multiple consecutive delimiters', () => {
    expect(normalizePromptId('hot--reload__test')).toBe('hot_reload_test');
  });

  it('trims leading/trailing underscores', () => {
    expect(normalizePromptId('-hot-reload-')).toBe('hot_reload');
  });

  it('trims whitespace', () => {
    expect(normalizePromptId('  my_prompt  ')).toBe('my_prompt');
  });

  it('returns already-normalized IDs unchanged', () => {
    expect(normalizePromptId('code_review')).toBe('code_review');
  });

  it('treats my-prompt and my_prompt as equivalent', () => {
    expect(normalizePromptId('my-prompt')).toBe(normalizePromptId('my_prompt'));
  });
});

describe('validatePromptId', () => {
  it('accepts valid underscore IDs', () => {
    expect(() => validatePromptId('code_review')).not.toThrow();
  });

  it('accepts valid hyphen IDs', () => {
    expect(() => validatePromptId('code-review')).not.toThrow();
  });

  it('accepts alphanumeric IDs', () => {
    expect(() => validatePromptId('prompt1')).not.toThrow();
  });

  it('rejects IDs starting with a number', () => {
    expect(() => validatePromptId('1prompt')).toThrow(/must start with a letter/);
  });

  it('rejects IDs starting with underscore', () => {
    expect(() => validatePromptId('_private')).toThrow(/must start with a letter/);
  });

  it('rejects IDs with special characters', () => {
    expect(() => validatePromptId('my@prompt')).toThrow(/must start with a letter/);
  });

  it('rejects empty strings', () => {
    expect(() => validatePromptId('')).toThrow(/non-empty string/);
  });

  it('rejects IDs over 100 characters', () => {
    expect(() => validatePromptId('a'.repeat(101))).toThrow(/100 characters/);
  });
});

// P7 Tier 4.1 / P7-D4: `resolveCategoryShipStatus` is the pure parser the write path consults to
// answer "will this category ship with the repo?" — table-driven, hand-crafted edge cases first,
// then bound against `git check-ignore` ground truth for every real category so the parser cannot
// drift from git's own semantics silently.
describe('resolveCategoryShipStatus pure parsing (P7-D4)', () => {
  it('ships when there is no restriction at all (empty .gitignore text)', () => {
    expect(resolveCategoryShipStatus('', 'anything')).toBe(true);
  });

  it('blocks every category under a bare `*` with no negation', () => {
    expect(resolveCategoryShipStatus('*\n', 'anything')).toBe(false);
  });

  it('un-ignores a category via `!name/` alone, without the `/**` pair', () => {
    expect(resolveCategoryShipStatus('*\n!examples/\n', 'examples')).toBe(true);
  });

  it('ignores comment and blank lines', () => {
    const text = [
      '# header comment',
      '',
      '*',
      '',
      '# allow examples',
      '!examples/',
      '!examples/**',
      '',
    ].join('\n');

    expect(resolveCategoryShipStatus(text, 'examples')).toBe(true);
    expect(resolveCategoryShipStatus(text, 'other')).toBe(false);
  });

  it('re-ignores generic children of an un-ignored directory (documentation/* pattern)', () => {
    const text = [
      '*',
      '!documentation/',
      'documentation/*',
      '!documentation/readme_improver/',
      '!documentation/readme_improver/**',
    ].join('\n');

    // A brand-new prompt under `documentation/` is NOT one of the specifically re-allowed
    // sub-prompts, so the category does not ship for it — even though `documentation/` itself
    // was un-ignored as a directory.
    expect(resolveCategoryShipStatus(text, 'documentation')).toBe(false);
  });

  it('a nested re-ignore below the category does not affect category-level ship status', () => {
    const text = ['*', '!workflow/', '!workflow/**', 'workflow/sync_indexes/'].join('\n');

    // `workflow/sync_indexes/` re-excludes one specific subdirectory; a fresh prompt id under
    // `workflow/` is unaffected, matching real git behaviour for this exact file shape.
    expect(resolveCategoryShipStatus(text, 'workflow')).toBe(true);
  });

  it('last match wins when rules conflict', () => {
    expect(resolveCategoryShipStatus('*\n!only/\nonly/\n', 'only')).toBe(false);
  });
});

describe('resolveCategoryShipStatus vs `git check-ignore` ground truth (P7-D4)', () => {
  const __dirname = path.dirname(fileURLToPath(import.meta.url));
  const serverRoot = path.resolve(__dirname, '../../../../..');
  const bundledPromptsDir = path.join(serverRoot, 'resources', 'prompts');
  const bundledGitignoreText = readFileSync(path.join(bundledPromptsDir, '.gitignore'), 'utf8');

  function realCategories(): string[] {
    return readdirSync(bundledPromptsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
      .map((entry) => entry.name);
  }

  /** Ground truth for a brand-new prompt id under `category`, straight from git itself. */
  function gitShips(category: string): boolean {
    try {
      execFileSync('git', ['check-ignore', '-q', `${category}/__new_prompt__/prompt.yaml`], {
        cwd: bundledPromptsDir,
      });
      return false; // exit 0 => git matched an ignore rule => does not ship
    } catch (error) {
      // `check-ignore -q` exits 1 when nothing matched (ships) — any other exit is a real failure.
      if ((error as { status?: number }).status === 1) {
        return true;
      }
      throw error;
    }
  }

  const categories = realCategories();

  it('discovers every bundled top-level category', () => {
    expect(categories).toEqual(
      expect.arrayContaining([
        'codebase-setup',
        'development',
        'documentation',
        'examples',
        'guidance',
        'planning',
        'workflow',
      ])
    );
  });

  for (const category of categories) {
    it(`matches git for category '${category}'`, () => {
      expect(resolveCategoryShipStatus(bundledGitignoreText, category)).toBe(gitShips(category));
    });
  }
});
