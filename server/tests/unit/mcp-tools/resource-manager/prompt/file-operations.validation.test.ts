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

import {
  parseYamlOrThrow,
  serializeYaml,
} from '../../../../../src/shared/utils/yaml/yaml-parser.js';

import {
  FileOperations,
  toYamlPromptId,
} from '../../../../../src/mcp/tools/resource-manager/prompt/operations/file-operations.js';
import {
  diagnosePromptWrite,
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

  describe('the receipt root is where the write lands (P1.4)', () => {
    it('reports every affected file beneath getResolvedPromptsDirectory()', async () => {
      const operations = new FileOperations({ logger, configManager });

      const result = await operations.updatePromptImplementation({
        id: 'receipt_root_probe',
        name: 'Receipt Root Probe',
        category: 'some-category',
        description: 'd',
        userMessageTemplate: 'hi',
        arguments: [],
        tools: [],
      });

      // `PromptMutationReceipt.resource_root` is this same call. Asserting the written paths
      // against it is what makes the receipt's claim checkable — with a workspace overlaying the
      // bundled tree, "where prompts are read from" and "where a write goes" are two questions,
      // and a receipt naming the wrong one sends the caller to a file that does not exist.
      const writeRoot = configManager.getResolvedPromptsDirectory();
      expect(result.affectedFiles?.length).toBeGreaterThan(0);
      for (const file of result.affectedFiles ?? []) {
        expect(path.resolve(file).startsWith(path.resolve(writeRoot))).toBe(true);
      }
      expect(
        existsSync(join(writeRoot, 'some-category', 'receipt_root_probe', 'prompt.yaml'))
      ).toBe(true);
    });
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
   * One test per field rather than one aggregate assertion, so a writer that drops exactly one
   * produces exactly one failure naming it.
   */
  describe('field preservation across an update', () => {
    const declaredFields = {
      composer: { inputArgument: 'task' },
      injection: { 'system-prompt': { enabled: false } },
      registerWithMcp: false,
      mcpPromptMode: 'launch',
      subagentModel: 'heavy',
      agentType: 'code-lifecycle-auditor',
    } as const;

    async function seedThenUpdateDescription(): Promise<Record<string, unknown>> {
      const operations = new FileOperations({ logger, configManager });
      // Seed through the writer itself, then re-declare the fields on disk. Since OQ-P7-8 the tool
      // CAN set every preserved field, but this case is the other half of the contract: an update that supplies
      // none of them must leave a hand-authored file exactly as it found it.
      await operations.updatePromptImplementation({
        id: 'delegating_prompt',
        name: 'Delegating Prompt',
        category: 'general',
        description: 'Original description',
        userMessageTemplate: 'Delegate {{task}}',
        arguments: [{ name: 'task', type: 'string' }],
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
          'composer:',
          '  inputArgument: task',
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
        arguments: [{ name: 'task', type: 'string' }],
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
   * explicit tool parameters existed.
   */
  describe('an explicitly supplied value overrides the on-disk declaration', () => {
    const authored = {
      composer: { inputArgument: 'task' },
      injection: { 'system-prompt': { enabled: false } },
      registerWithMcp: false,
      mcpPromptMode: 'launch',
      subagentModel: 'heavy',
      agentType: 'code-lifecycle-auditor',
    } as const;

    const supplied = {
      composer: { inputArgument: 'request' },
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
        arguments: [
          { name: 'task', type: 'string' },
          { name: 'request', type: 'string' },
        ],
        tools: [],
        ...authored,
      });

      await operations.updatePromptImplementation({
        id: 'override_prompt',
        name: 'Override Prompt',
        category: 'general',
        description: 'Updated description',
        userMessageTemplate: 'Delegate {{task}}',
        arguments: [
          { name: 'task', type: 'string' },
          { name: 'request', type: 'string' },
        ],
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

  /**
   * Fix A (tier-b-settability-proposal, owner ruling 2026-08-16): the writer preserves `tools`
   * and authored `category` instead of dropping/overwriting them on every update (P6-F10, P7-F8).
   * Mirrors the "field preservation" describe block above — same seed/reauthor/update shape.
   */
  describe('tools and category preservation across an update (Fix A / P6-F10, P7-F8)', () => {
    async function seedWithToolsAndDivergentCategory(): Promise<void> {
      const operations = new FileOperations({ logger, configManager });
      await operations.updatePromptImplementation({
        id: 'tooled_prompt',
        name: 'Tooled Prompt',
        category: 'general',
        description: 'Original description',
        userMessageTemplate: 'Use {{tool}}',
        arguments: [],
        tools: [{ id: 'my_tool', name: 'My Tool', script: "print('hi')", runtime: 'python' }],
      });

      // Simulate an authored `category:` that diverges from the directory the prompt lives in —
      // the exact incident shape (DEV-T3-6): `category: prompt-authoring` on disk, directory
      // `examples/`.
      const yamlPath = join(promptsDir, 'general', 'tooled_prompt', 'prompt.yaml');
      const authored = parseYamlOrThrow<Record<string, unknown>>(readFileSync(yamlPath, 'utf8'));
      authored['category'] = 'legacy-category';
      writeFileSync(yamlPath, serializeYaml(authored, { sortKeys: false }), 'utf8');
    }

    async function updateDescriptionOnly(): Promise<Record<string, unknown>> {
      const operations = new FileOperations({ logger, configManager });
      // The shape a metadata-only update produces: no `tools`, directory-derived `category`
      // (loader-resolved, per `canonicalPromptSnapshot`'s `?? 'general'` fallback) — and, since
      // Fix B, an explicit `suppliedKeys` naming only what THIS call actually supplied. Full
      // precedence (Fix B upgrade of this describe block's own interim rule) reads
      // `suppliedKeys.has('category')` to decide caller-supplied vs disk-preserved; a direct
      // `FileOperations` call with no second argument defaults to "everything supplied" (the
      // pre-Fix-B compatibility default for callers with no scope plumbing), which would make
      // `promptData.category` — always structurally present, defaulted or not — win over disk on
      // every call. Passing the real narrow scope here is what lets this test assert the
      // disk-preservation branch at all.
      await operations.updatePromptImplementation(
        {
          id: 'tooled_prompt',
          name: 'Tooled Prompt',
          category: 'general',
          description: 'Updated description',
          userMessageTemplate: 'Use {{tool}}',
          arguments: [],
          tools: [],
        },
        new Set(['description'])
      );
      return readPromptYaml('general', 'tooled_prompt');
    }

    it('preserves the tools id list when the update supplies no tool definitions', async () => {
      await seedWithToolsAndDivergentCategory();
      const written = await updateDescriptionOnly();
      expect(written['tools']).toEqual(['my_tool']);
    });

    it('preserves the authored category over the directory-derived slug', async () => {
      await seedWithToolsAndDivergentCategory();
      const written = await updateDescriptionOnly();
      expect(written['category']).toBe('legacy-category');
    });

    it('still applies the description update alongside preservation', async () => {
      await seedWithToolsAndDivergentCategory();
      const written = await updateDescriptionOnly();
      expect(written['description']).toBe('Updated description');
    });

    it('does not preserve tools when the update supplies its own tool definitions', async () => {
      const operations = new FileOperations({ logger, configManager });
      await operations.updatePromptImplementation({
        id: 'retooled_prompt',
        name: 'Retooled Prompt',
        category: 'general',
        description: 'd',
        userMessageTemplate: 'Use {{tool}}',
        arguments: [],
        tools: [{ id: 'old_tool', name: 'Old', script: "print('old')", runtime: 'python' }],
      });
      await operations.updatePromptImplementation({
        id: 'retooled_prompt',
        name: 'Retooled Prompt',
        category: 'general',
        description: 'd',
        userMessageTemplate: 'Use {{tool}}',
        arguments: [],
        tools: [{ id: 'new_tool', name: 'New', script: "print('new')", runtime: 'python' }],
      });

      const written = readPromptYaml('general', 'retooled_prompt');
      expect(written['tools']).toEqual(['new_tool']);
    });

    it('omits `category` from the YAML when neither the caller nor disk declares one', async () => {
      const operations = new FileOperations({ logger, configManager });
      // `category` deliberately absent from `suppliedKeys` — a real narrow update
      // (`suppliedKeys` computed from which args the caller actually sent) that never touches
      // category, landing on a prompt with no prior file to fall back to either.
      await operations.updatePromptImplementation(
        {
          id: 'brand_new_prompt',
          name: 'Brand New',
          category: 'general',
          description: 'd',
          userMessageTemplate: 'hi',
          arguments: [],
          tools: [],
        },
        new Set(['description', 'userMessageTemplate'])
      );

      // `loader.ts` derives the runtime category from the directory regardless of what the YAML
      // says (Open Decision 3) — with neither the caller nor disk declaring one, the key is
      // omitted rather than baked in as the directory slug.
      const written = readPromptYaml('general', 'brand_new_prompt');
      expect(written).not.toHaveProperty('category');
    });

    it('writes the supplied category verbatim on a fresh create (full precedence, caller-supplied branch)', async () => {
      const operations = new FileOperations({ logger, configManager });
      // `create` and `rollback` pass the full key set (they own whole state) — the default here
      // (omitting the second argument) is exactly that: every key, including `category`, counts
      // as supplied. A fresh create has no on-disk value to defer to, so this is the only way the
      // caller's own category reaches the file at all.
      await operations.updatePromptImplementation({
        id: 'freshly_created_prompt',
        name: 'Freshly Created',
        category: 'general',
        description: 'd',
        userMessageTemplate: 'hi',
        arguments: [],
        tools: [],
      });

      const written = readPromptYaml('general', 'freshly_created_prompt');
      expect(written['category']).toBe('general');
    });
  });

  /**
   * Fix C (tier-b-settability-proposal, P7-F12): `create` gets the same pre-write template-syntax
   * check `update` already had. `diagnosePromptWrite` is differential by design — a defect present
   * on BOTH sides of an edit is reported but not blocking, so a legacy Handlebars-era prompt can
   * still be edited. `create` supplies `before: null`, which forces every defect into `blocking`
   * — there is no pre-existing state to amnesty against, because a create IS the introduction.
   */
  describe('diagnosePromptWrite(null, …) on a fresh create (Fix C / P7-F12)', () => {
    const brokenTemplate = '{% for x in %}broken';

    const legacyPrompt = {
      id: 'legacy',
      name: 'Legacy',
      category: 'general',
      description: 'A prompt with a pre-existing template defect',
      userMessageTemplate: brokenTemplate,
      arguments: [],
      chainSteps: [],
    };

    it('amnesties an update that carries the SAME pre-existing defect forward unchanged', () => {
      const editedLegacyPrompt = { ...legacyPrompt, description: 'updated description only' };

      const diagnosis = diagnosePromptWrite(legacyPrompt, editedLegacyPrompt);

      expect(diagnosis.blocking).toHaveLength(0);
      expect(diagnosis.preExisting.length).toBeGreaterThan(0);
    });

    it('blocks the identical defect on create, where update-mode would have amnestied it', () => {
      const diagnosis = diagnosePromptWrite(null, legacyPrompt);

      expect(diagnosis.blocking.length).toBeGreaterThan(0);
      expect(diagnosis.blocking[0]?.key).toBe('syntax:userMessageTemplate');
      expect(diagnosis.preExisting).toHaveLength(0);
    });
  });

  /**
   * Fix B (tier-b-settability-proposal §2, owner ruling 2026-08-16): `suppliedKeys` → which of
   * the three canonical files a write touches. Every case supplies a DIFFERENT value for ALL
   * THREE fields (description, userMessageTemplate, systemMessage) and varies ONLY the
   * `suppliedKeys` scope — a scope gate that leaks would show up as an unexpected byte diff on a
   * file the case declares untouched, not merely as a stale value that happens to match.
   *
   * FALSIFICATION: comment out the `writesYaml`/`writesUserMessage`/`writesSystemMessage` gates
   * in `createOrUpdateYamlPrompt` (always write) and the first three rows go red — every file
   * changes regardless of scope. Comment out the `suppliedKeys ?? ALL_PROMPT_DATA_KEYS` default
   * fallback and the fourth (rollback/create) row goes red instead.
   */
  describe('write-scope table: suppliedKeys → files rewritten (Fix B)', () => {
    const promptId = 'scope_table_prompt';
    const category = 'general';

    async function seedFullPrompt(): Promise<void> {
      const operations = new FileOperations({ logger, configManager });
      await operations.updatePromptImplementation({
        id: promptId,
        name: 'Scope Table Prompt',
        category,
        description: 'Original description',
        userMessageTemplate: 'Original template',
        systemMessage: 'Original system message',
        arguments: [],
        tools: [{ id: 'seed_tool', name: 'Seed Tool', script: "print('x')", runtime: 'python' }],
      });
    }

    function snapshotFiles(): Record<string, string> {
      const dir = join(promptsDir, category, promptId);
      return {
        'prompt.yaml': readFileSync(join(dir, 'prompt.yaml'), 'utf8'),
        'user-message.md': readFileSync(join(dir, 'user-message.md'), 'utf8'),
        'system-message.md': readFileSync(join(dir, 'system-message.md'), 'utf8'),
      };
    }

    // Every field differs from the seed, regardless of which row is under test.
    const changedPromptData = {
      id: promptId,
      name: 'Scope Table Prompt',
      category,
      description: 'Patched description',
      userMessageTemplate: 'Patched template',
      systemMessage: 'Patched system message',
      arguments: [],
      tools: [],
    };

    const rows: Array<{
      name: string;
      suppliedKeys: string[] | undefined;
      expectYaml: boolean;
      expectUserMessage: boolean;
      expectSystemMessage: boolean;
    }> = [
      {
        name: 'description supplied → prompt.yaml only (description IS yaml-resident, per the proposal’s table)',
        suppliedKeys: ['description'],
        expectYaml: true,
        expectUserMessage: false,
        expectSystemMessage: false,
      },
      {
        name: 'userMessageTemplate supplied → user-message.md only',
        suppliedKeys: ['userMessageTemplate'],
        expectYaml: false,
        expectUserMessage: true,
        expectSystemMessage: false,
      },
      {
        name: 'systemMessage supplied → system-message.md only',
        suppliedKeys: ['systemMessage'],
        expectYaml: false,
        expectUserMessage: false,
        expectSystemMessage: true,
      },
      {
        name: 'no suppliedKeys argument (create/rollback full-set shape) → every file',
        suppliedKeys: undefined,
        expectYaml: true,
        expectUserMessage: true,
        expectSystemMessage: true,
      },
    ];

    for (const row of rows) {
      it(row.name, async () => {
        await seedFullPrompt();
        const before = snapshotFiles();

        const operations = new FileOperations({ logger, configManager });
        await operations.updatePromptImplementation(
          changedPromptData,
          row.suppliedKeys !== undefined ? new Set(row.suppliedKeys) : undefined
        );

        const after = snapshotFiles();
        expect(after['prompt.yaml'] !== before['prompt.yaml']).toBe(row.expectYaml);
        expect(after['user-message.md'] !== before['user-message.md']).toBe(row.expectUserMessage);
        expect(after['system-message.md'] !== before['system-message.md']).toBe(
          row.expectSystemMessage
        );
      });
    }
  });

  /**
   * Part 2 — true category MOVE (owner ruling 2026-08-16, tier-b-settability-proposal §Open
   * Decision 3, overriding the proposal's original "refuse" recommendation). A caller-supplied
   * `category` that slugs to a directory other than the one the prompt currently lives under
   * relocates the whole directory tree — atomically, via the same `ResourceMutationTransaction`
   * every other write already uses.
   */
  describe('category MOVE (Part 2)', () => {
    async function seedMoveable(): Promise<void> {
      const operations = new FileOperations({ logger, configManager });
      await operations.updatePromptImplementation({
        id: 'moveable_prompt',
        name: 'Moveable Prompt',
        category: 'origin-category',
        description: 'Will be moved',
        userMessageTemplate: 'Use {{tool}}',
        systemMessage: 'Be careful',
        arguments: [],
        tools: [{ id: 'move_tool', name: 'Move Tool', script: "print('x')", runtime: 'python' }],
      });
    }

    it('relocates the whole directory tree (tools included) and removes the old one', async () => {
      await seedMoveable();
      const oldDir = join(promptsDir, 'origin-category', 'moveable_prompt');
      const newDir = join(promptsDir, 'target-category', 'moveable_prompt');
      expect(existsSync(oldDir)).toBe(true);

      const operations = new FileOperations({ logger, configManager });
      const result = await operations.updatePromptImplementation({
        id: 'moveable_prompt',
        name: 'Moveable Prompt',
        category: 'target-category',
        description: 'Will be moved',
        userMessageTemplate: 'Use {{tool}}',
        systemMessage: 'Be careful',
        arguments: [],
        tools: [],
      });

      // FALSIFICATION: comment out the `fs.rm(moveSource, ...)` call in
      // `relocatePromptDirectory` and this line goes red — the old directory survives as an
      // orphan alongside the new one.
      expect(existsSync(oldDir)).toBe(false);
      expect(existsSync(newDir)).toBe(true);
      expect(existsSync(join(newDir, 'prompt.yaml'))).toBe(true);
      expect(existsSync(join(newDir, 'user-message.md'))).toBe(true);
      expect(existsSync(join(newDir, 'system-message.md'))).toBe(true);
      // Physically relocated via the directory copy, not regenerated — `tools:[]` was supplied
      // on this call, so `createOrUpdateTools` never ran.
      expect(existsSync(join(newDir, 'tools', 'move_tool', 'tool.yaml'))).toBe(true);
      expect(existsSync(join(newDir, 'tools', 'move_tool', 'script.py'))).toBe(true);

      const written = readPromptYaml('target-category', 'moveable_prompt');
      expect(written['tools']).toEqual(['move_tool']);
      expect(written['category']).toBe('target-category');
      expect(result.message).toMatch(/Moved prompt/);
    });

    it('a mid-move failure restores the original directory intact and leaves no partial new directory', async () => {
      await seedMoveable();
      const oldDir = join(promptsDir, 'origin-category', 'moveable_prompt');
      const newDir = join(promptsDir, 'target-category-2', 'moveable_prompt');

      const operations = new FileOperations({ logger, configManager });
      // An empty `description` fails `PromptYamlSchema`'s `min(1)` — the writer itself does not
      // validate what it writes, so this reaches the post-write `validateFile` check AFTER the
      // move's copy+remove has already run, exercising the transaction's restore path for a
      // failure that occurs MID-MOVE rather than before it starts.
      await expect(
        operations.updatePromptImplementation({
          id: 'moveable_prompt',
          name: 'Moveable Prompt',
          category: 'target-category-2',
          description: '',
          userMessageTemplate: 'Use {{tool}}',
          systemMessage: 'Be careful',
          arguments: [],
          tools: [],
        })
      ).rejects.toThrow(/rolled back/);

      // FALSIFICATION: comment out the second transaction target (the move source) in
      // `updatePromptImplementation` and this restore never happens — `oldDir` stays deleted.
      expect(existsSync(oldDir)).toBe(true);
      expect(existsSync(join(oldDir, 'tools', 'move_tool', 'tool.yaml'))).toBe(true);
      expect(existsSync(newDir)).toBe(false);
    });

    it('never treats a nested chain-step id as a category move', async () => {
      const operations = new FileOperations({ logger, configManager });
      await operations.updatePromptImplementation({
        id: 'origin-category/nested_step',
        name: 'Nested Step',
        category: 'target-category-3',
        description: 'd',
        userMessageTemplate: 'hi',
        arguments: [],
        tools: [],
      });

      // No move-source search runs for a nested id — this is an ordinary create at the target.
      expect(
        existsSync(
          join(promptsDir, 'target-category-3', 'origin-category', 'nested_step', 'prompt.yaml')
        )
      ).toBe(true);
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
