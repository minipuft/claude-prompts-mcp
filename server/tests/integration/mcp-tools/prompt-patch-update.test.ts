/**
 * P7 row 3.6 — patch-mode update against the REAL write path.
 *
 * Classification: integration. Real `PromptLifecycleProcessor`, real `FileOperations` (real YAML
 * serialisation, real mutation transaction, real post-write `ResourceVerificationService` check)
 * writing into a temp workspace. Only the version seam is a double, because the assertion about it
 * is what it is CALLED with — that call is the `version_history` row.
 *
 * These cover the two acceptance clauses that only the file boundary can show:
 *   (a) a one-section edit that never transmits the untouched sections produces the same FILE as
 *       the equivalent full update;
 *   (b) a rejected edit leaves the file byte-identical and consumes no version.
 */

import { describe, expect, jest, test, beforeEach, afterEach } from '@jest/globals';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ContentAnalyzer } from '../../../src/modules/semantic/content-analyzer.js';
import { ComparisonEngine } from '../../../src/mcp/tools/resource-manager/prompt/analysis/comparison-engine.js';
import { GateAnalyzer } from '../../../src/mcp/tools/resource-manager/prompt/analysis/gate-analyzer.js';
import { ObjectDiffGenerator } from '../../../src/mcp/tools/resource-manager/prompt/analysis/object-diff-generator.js';
import { PromptAnalyzer } from '../../../src/mcp/tools/resource-manager/prompt/analysis/prompt-analyzer.js';
import { FileOperations } from '../../../src/mcp/tools/resource-manager/prompt/operations/file-operations.js';
import { PromptLifecycleProcessor } from '../../../src/mcp/tools/resource-manager/prompt/services/prompt-lifecycle-processor.js';
import { PromptVersioningProcessor } from '../../../src/mcp/tools/resource-manager/prompt/services/prompt-versioning-processor.js';
import { PromptConverter } from '../../../src/modules/prompts/converter.js';
import { PromptLoader } from '../../../src/modules/prompts/loader.js';
import { parseYamlOrThrow, serializeYaml } from '../../../src/shared/utils/yaml/yaml-parser.js';

import type { PromptResourceContext } from '../../../src/mcp/tools/resource-manager/prompt/core/context.js';
import type { ConfigManager, Logger } from '../../../src/shared/types/index.js';

const PROMPT_ID = 'patch_target';
const CATEGORY = 'general';

const TEMPLATE = [
  '## Context',
  '{{input}}',
  '',
  '## Output',
  'Answer in prose.',
  '',
  '## Notes',
  'Leave this section alone.',
].join('\n');

const PATCHED_TEMPLATE = TEMPLATE.replace('Answer in prose.', 'Answer in bullet points.');

const createLogger = () =>
  ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }) as unknown as Logger;

type RollbackMock = jest.Mock<
  () => Promise<{
    success: boolean;
    error?: string;
    saved_version?: number;
    snapshot?: Record<string, unknown>;
  }>
>;

interface Harness {
  processor: PromptLifecycleProcessor;
  fileOperations: FileOperations;
  recordEditResult: jest.Mock;
  /** `rollback` double on `versionHistoryService` — unset by default; tests configure it. */
  rollback: RollbackMock;
  /**
   * Every file the writer produced for this prompt, keyed by name. The writer externalises the two
   * text bodies to `user-message.md` / `system-message.md`, so reading `prompt.yaml` alone would
   * assert on a file that contains neither of the things a patch edits.
   */
  readFiles: () => Record<string, string>;
  livePrompt: Record<string, unknown>;
  /** Shared context object — reused to build a `PromptVersioningProcessor` against the same state. */
  context: PromptResourceContext;
  /** Resolved prompts directory for this workspace (`{workspaceDir}/prompts`). */
  promptsDir: string;
  logger: Logger;
}

function createHarness(workspaceDir: string): Harness {
  const promptsDir = join(workspaceDir, 'prompts');
  const logger = createLogger();
  let livePrompt: Record<string, unknown>;
  let convertedPrompts: Record<string, unknown>[];
  const configManager = {
    getConfigPath: () => join(workspaceDir, 'config.yaml'),
    getServerRoot: () => workspaceDir,
    getResolvedPromptsDirectory: () => promptsDir,
  } as unknown as ConfigManager;
  const dependencies = {
    logger,
    configManager,
    semanticAnalyzer: new ContentAnalyzer(createLogger()),
    onRefresh: jest.fn(async () => {
      const promptLoader = new PromptLoader(logger);
      const { promptsData } = await promptLoader.loadFromDirectories(promptsDir);
      const converter = new PromptConverter(logger, promptLoader);
      const converted = await converter.convertMarkdownPromptsToJson(promptsData, promptsDir);
      const reloaded = converted.find((prompt) => prompt.id === PROMPT_ID);
      if (reloaded !== undefined) {
        for (const key of Object.keys(livePrompt)) delete livePrompt[key];
        Object.assign(livePrompt, reloaded);
      }
      convertedPrompts = converted.map((prompt) =>
        prompt.id === PROMPT_ID ? livePrompt : (prompt as unknown as Record<string, unknown>)
      );
    }),
    onRestart: jest.fn(async () => {}),
  };
  const fileOperations = new FileOperations({
    logger,
    configManager,
  });

  livePrompt = {
    id: PROMPT_ID,
    name: 'Patch Target',
    category: CATEGORY,
    description: 'A prompt used to exercise anchored patching',
    userMessageTemplate: TEMPLATE,
    systemMessage: 'Be precise.',
    arguments: [],
    chainSteps: [],
  };
  convertedPrompts = [livePrompt];

  const recordEditResult = jest.fn(async () => ({ version: 3, success: true })) as jest.Mock;
  const rollback: RollbackMock = jest.fn(async () => ({
    success: false,
    error: 'rollback not configured for this test',
  }));

  const context = {
    dependencies,
    promptAnalyzer: new PromptAnalyzer(dependencies),
    gateAnalyzer: new GateAnalyzer(dependencies as never),
    fileOperations,
    getData: () => ({ convertedPrompts }),
    versionHistoryService: {
      isAutoVersionEnabled: () => true,
      loadHistory: jest.fn(async () => ({ current_version: 3 })),
      recordEditResult,
      rollback,
      // Bridge the test-configured `rollback` double into the two-phase contract the processor
      // now calls (resolveRollbackTarget → commitEdit → write). Tests keep configuring
      // `harness.rollback` with the old single-call shape; the bridge projects it so this mock
      // cannot silently drift from ONE of the two phases while the other stays green.
      resolveRollbackTarget: async () => {
        const result = await rollback();
        return result.success
          ? { ok: true as const, entry: { snapshot: result.snapshot } }
          : { ok: false as const, error: result.error ?? 'Version not found' };
      },
      commitEdit: async () => {
        const result = await rollback();
        return { version: result.saved_version ?? 0, bridged: false };
      },
    },
    textDiffService: new ObjectDiffGenerator(),
    comparisonEngine: new ComparisonEngine(logger),
  } as unknown as PromptResourceContext;

  return {
    processor: new PromptLifecycleProcessor(context),
    fileOperations,
    recordEditResult,
    rollback,
    readFiles: () => {
      const dir = join(promptsDir, CATEGORY, PROMPT_ID);
      const files: Record<string, string> = {};
      for (const name of readdirSync(dir).sort()) {
        files[name] = readFileSync(join(dir, name), 'utf8');
      }
      return files;
    },
    livePrompt,
    context,
    promptsDir,
    logger,
  };
}

/** Path to the on-disk `prompt.yaml` for the fixed `PROMPT_ID`/`CATEGORY` under this workspace. */
function promptYamlPath(harness: Harness): string {
  return join(harness.promptsDir, CATEGORY, PROMPT_ID, 'prompt.yaml');
}

function readParsedPromptYaml(harness: Harness): Record<string, unknown> {
  return parseYamlOrThrow<Record<string, unknown>>(readFileSync(promptYamlPath(harness), 'utf8'));
}

async function seed(harness: Harness): Promise<void> {
  await harness.fileOperations.updatePromptImplementation({ ...harness.livePrompt });
}

describe('patch-mode update against the real writer', () => {
  let workspaces: string[] = [];

  function workspace(): string {
    const dir = mkdtempSync(join(tmpdir(), 'cpm-patch-'));
    workspaces.push(dir);
    return dir;
  }

  beforeEach(() => {
    workspaces = [];
  });

  afterEach(() => {
    for (const dir of workspaces) rmSync(dir, { recursive: true, force: true });
  });

  /**
   * Acceptance (a) + (c) at the file boundary. Two independent workspaces run the same edit two
   * ways; the produced files must be byte-identical. Byte comparison is safe here because the
   * fixture declares no `arguments` — the converter's `required: false` materialisation (Tier 1,
   * DEV-T1-3) has nothing to materialise onto, so no normalisation is needed.
   */
  test('produces a byte-identical file to the equivalent full update', async () => {
    const patched = createHarness(workspace());
    await seed(patched);
    const patchResponse = await patched.processor.updatePrompt({
      id: PROMPT_ID,
      patch: [
        {
          field: 'user_message_template',
          old_string: 'Answer in prose.',
          new_string: 'Answer in bullet points.',
        },
      ],
    } as never);

    const full = createHarness(workspace());
    await seed(full);
    const fullResponse = await full.processor.updatePrompt({
      id: PROMPT_ID,
      user_message_template: PATCHED_TEMPLATE,
    } as never);

    expect(patchResponse.isError).toBe(false);
    expect(fullResponse.isError).toBe(false);
    expect(patched.readFiles()).toEqual(full.readFiles());
    expect(patched.readFiles()['user-message.md']).toContain('Answer in bullet points.');
    expect(patched.readFiles()['user-message.md']).toContain('Leave this section alone.');
  });

  test('records the same version snapshot as the full update', async () => {
    const patched = createHarness(workspace());
    await seed(patched);
    await patched.processor.updatePrompt({
      id: PROMPT_ID,
      patch: [
        {
          field: 'user_message_template',
          old_string: 'Answer in prose.',
          new_string: 'Answer in bullet points.',
        },
      ],
    } as never);

    const full = createHarness(workspace());
    await seed(full);
    await full.processor.updatePrompt({
      id: PROMPT_ID,
      user_message_template: PATCHED_TEMPLATE,
    } as never);

    expect(patched.recordEditResult.mock.calls[0]).toEqual(full.recordEditResult.mock.calls[0]);
  });

  test('a template-syntax error leaves the file untouched and spends no version', async () => {
    const harness = createHarness(workspace());
    await seed(harness);
    const before = harness.readFiles();

    const response = await harness.processor.updatePrompt({
      id: PROMPT_ID,
      patch: [
        {
          field: 'user_message_template',
          old_string: 'Answer in prose.',
          new_string: '{% for x in %}Answer in prose.',
        },
      ],
    } as never);

    expect(response.isError).toBe(true);
    expect(harness.readFiles()).toEqual(before);
    expect(harness.recordEditResult).not.toHaveBeenCalled();
  });

  test('a failed anchor leaves the file untouched and spends no version', async () => {
    const harness = createHarness(workspace());
    await seed(harness);
    const before = harness.readFiles();

    const response = await harness.processor.updatePrompt({
      id: PROMPT_ID,
      patch: [
        { field: 'user_message_template', old_string: 'not present anywhere', new_string: 'x' },
      ],
    } as never);

    expect(response.isError).toBe(true);
    expect(harness.readFiles()).toEqual(before);
    expect(harness.recordEditResult).not.toHaveBeenCalled();
  });

  test('dry_run leaves the file untouched and spends no version', async () => {
    const harness = createHarness(workspace());
    await seed(harness);
    const before = harness.readFiles();

    const response = await harness.processor.updatePrompt({
      id: PROMPT_ID,
      patch: [
        {
          field: 'user_message_template',
          old_string: 'Answer in prose.',
          new_string: 'Answer in bullet points.',
        },
      ],
      dry_run: true,
    } as never);

    expect(response.isError).toBe(false);
    expect(harness.readFiles()).toEqual(before);
    expect(harness.recordEditResult).not.toHaveBeenCalled();
  });

  test('a multi-field patch writes every touched body in one version', async () => {
    const harness = createHarness(workspace());
    await seed(harness);

    const response = await harness.processor.updatePrompt({
      id: PROMPT_ID,
      patch: [
        {
          field: 'user_message_template',
          old_string: 'Answer in prose.',
          new_string: 'Answer in bullet points.',
        },
        { field: 'system_message', old_string: 'precise', new_string: 'exhaustive' },
        { field: 'description', old_string: 'anchored patching', new_string: 'patch mode' },
      ],
    } as never);

    expect(response.isError).toBe(false);
    const files = harness.readFiles();
    expect(files['user-message.md']).toContain('Answer in bullet points.');
    expect(files['system-message.md']).toContain('Be exhaustive.');
    expect(files['prompt.yaml']).toContain('patch mode');
    expect(harness.recordEditResult).toHaveBeenCalledTimes(1);
  });
});

/**
 * tier-b-settability-proposal, increments 1+2 (owner ruling 2026-08-16):
 *   Fix A — the writer preserves `tools` and authored `category` instead of dropping/rewriting
 *           them on every update (P6-F10, P7-F8).
 *   Fix C — `create` gets the same pre-write template-syntax check `update` already has (P7-F12).
 *
 * Same classification as the suite above: real processor, real `FileOperations`, real writer,
 * writing into a temp workspace. Only the version seam is a double.
 */
describe('tools/category preservation and create pre-verify (Fix A + Fix C)', () => {
  let workspaces: string[] = [];

  function workspace(): string {
    const dir = mkdtempSync(join(tmpdir(), 'cpm-fixac-'));
    workspaces.push(dir);
    return dir;
  }

  beforeEach(() => {
    workspaces = [];
  });

  afterEach(() => {
    for (const dir of workspaces) rmSync(dir, { recursive: true, force: true });
  });

  /**
   * Test 1 (P6-F10 regression, reproduced) — a patch-only edit against a template must not lose
   * the on-disk `tools:` id list or authored `category:` (the DEV-T3-6 incident shape: `tools:
   * [prompt_builder]` and `category: prompt-authoring` on disk, directory `general/`). Asserts
   * PARSED values, not byte-identity — byte-identity is Fix B's bar, not this increment's.
   */
  test('patch-only update retains authored tools and category', async () => {
    const harness = createHarness(workspace());
    await seed(harness);

    const authored = readParsedPromptYaml(harness);
    authored['tools'] = ['prompt_builder'];
    authored['category'] = 'prompt-authoring';
    writeFileSync(promptYamlPath(harness), serializeYaml(authored, { sortKeys: false }), 'utf8');

    const response = await harness.processor.updatePrompt({
      id: PROMPT_ID,
      patch: [
        {
          field: 'user_message_template',
          old_string: 'Answer in prose.',
          new_string: 'Answer in bullet points.',
        },
      ],
    } as never);

    expect(response.isError).toBe(false);
    const after = readParsedPromptYaml(harness);
    expect(after['tools']).toEqual(['prompt_builder']);
    expect(after['category']).toBe('prompt-authoring');
    // The edit itself still landed — preservation must not come at the cost of the actual write.
    expect(harness.readFiles()['user-message.md']).toContain('Answer in bullet points.');
  });

  /**
   * Test 2 — a metadata-only update (no `tools` supplied) must retain the tools binding end to
   * end: the yaml id list, the tool FILES on disk (untouched, not rewritten), and a fresh loader
   * reload of the directory (real `PromptLoader` + `PromptConverter`, no doubles) resolving
   * `scriptTools` from that binding.
   */
  test('description-only update retains tools end-to-end (yaml, files, loader reload)', async () => {
    const dir = workspace();
    const harness = createHarness(dir);
    await seed(harness);

    const addTools = await harness.processor.updatePrompt({
      id: PROMPT_ID,
      tools: [{ id: 'my_tool', name: 'My Tool', script: "print('hi')", runtime: 'python' }],
    } as never);
    expect(addTools.isError).toBe(false);

    const toolDir = join(harness.promptsDir, CATEGORY, PROMPT_ID, 'tools', 'my_tool');
    const toolYamlBefore = readFileSync(join(toolDir, 'tool.yaml'), 'utf8');
    const scriptBefore = readFileSync(join(toolDir, 'script.py'), 'utf8');

    const response = await harness.processor.updatePrompt({
      id: PROMPT_ID,
      description: 'Updated description only',
    } as never);
    expect(response.isError).toBe(false);

    // yaml binding survives a call that never mentioned tools
    const after = readParsedPromptYaml(harness);
    expect(after['tools']).toEqual(['my_tool']);
    expect(after['description']).toBe('Updated description only');

    // tool files are untouched byte-for-byte — the writer's tools branch did not fire
    expect(readFileSync(join(toolDir, 'tool.yaml'), 'utf8')).toBe(toolYamlBefore);
    expect(readFileSync(join(toolDir, 'script.py'), 'utf8')).toBe(scriptBefore);

    // end-to-end: a fresh loader + converter (real modules) resolve scriptTools from the
    // preserved binding, not from any in-memory state this test controls.
    const promptLoader = new PromptLoader(harness.logger);
    const { promptsData } = await promptLoader.loadFromDirectories(harness.promptsDir);
    const converter = new PromptConverter(harness.logger, promptLoader);
    const converted = await converter.convertMarkdownPromptsToJson(promptsData, harness.promptsDir);
    const reloaded = converted.find((p) => p.id === PROMPT_ID);

    expect(reloaded).toBeDefined();
    expect((reloaded?.scriptTools ?? []).map((t) => t.id)).toEqual(['my_tool']);
  });

  /**
   * Test 3 — version snapshots stay tools-blind (accepted, Open Decision 1), so a rollback's
   * restored `promptData` never carries `tools`. Proves the writer-side preservation covers that
   * gap: rollback writes through the same `updatePromptImplementation`, and Fix A's preservation
   * runs there regardless of who called it.
   */
  test('update then rollback preserves tools', async () => {
    const dir = workspace();
    const harness = createHarness(dir);
    await seed(harness);

    await harness.processor.updatePrompt({
      id: PROMPT_ID,
      tools: [{ id: 'my_tool', name: 'My Tool', script: "print('hi')", runtime: 'python' }],
    } as never);
    expect(readParsedPromptYaml(harness)['tools']).toEqual(['my_tool']);

    // A tools-blind restored snapshot — exactly the shape `buildRestoreFromSnapshot` produces in
    // production, since `canonicalPromptSnapshot` never projects `tools` (P7-F8).
    harness.rollback.mockResolvedValue({
      success: true,
      saved_version: 2,
      snapshot: {
        name: 'Patch Target',
        category: CATEGORY,
        description: 'A prompt used to exercise anchored patching',
        userMessageTemplate: TEMPLATE,
        systemMessage: 'Be precise.',
        arguments: [],
        chainSteps: [],
      },
    });

    const versioningProcessor = new PromptVersioningProcessor(harness.context);
    const response = await versioningProcessor.handleRollback({
      id: PROMPT_ID,
      version: 1,
      confirm: true,
    } as never);

    expect(response.isError).toBe(false);
    const after = readParsedPromptYaml(harness);
    expect(after['tools']).toEqual(['my_tool']);
  });

  /**
   * Test 4 — `createPrompt` refuses a template that will not compile BEFORE any write, unlike the
   * pre-Fix-C behaviour where the only check ran AFTER the files landed on disk. Refusal must
   * leave no trace: no prompt directory at all (not a write-then-rollback).
   */
  test('create with a broken template is refused before any write', async () => {
    const harness = createHarness(workspace());
    const brokenId = 'broken_create_target';

    const response = await harness.processor.createPrompt({
      id: brokenId,
      name: 'Broken Create Target',
      description: 'A create whose template does not compile',
      user_message_template: '{% for x in %}broken',
    } as never);

    expect(response.isError).toBe(true);
    const text = (response.content[0] as { text: string }).text;
    expect(text).toMatch(/blocked/i);
    expect(text).toMatch(/userMessageTemplate/);
    expect(text).toMatch(/unexpected token/i);

    const promptDir = join(harness.promptsDir, 'general', brokenId);
    expect(existsSync(promptDir)).toBe(false);
    expect(harness.recordEditResult).not.toHaveBeenCalled();
  });

  test('a valid create is unaffected by the new pre-verify hop', async () => {
    const harness = createHarness(workspace());
    const validId = 'valid_create_target';

    const response = await harness.processor.createPrompt({
      id: validId,
      name: 'Valid Create Target',
      description: 'A create with a syntactically valid template',
      user_message_template: 'Hello {{name}}',
    } as never);

    if (response.isError) {
      throw new Error(response.content.map((part) => ('text' in part ? part.text : '')).join(''));
    }
    const promptDir = join(harness.promptsDir, 'general', validId);
    expect(existsSync(promptDir)).toBe(true);
    expect(existsSync(join(promptDir, 'prompt.yaml'))).toBe(true);
    expect(existsSync(join(promptDir, 'user-message.md'))).toBe(true);
  });
});

/**
 * tier-b-settability-proposal, increment 3 (owner ruling 2026-08-16):
 *   Fix B — write-scope narrowing: a patch-only edit must leave `prompt.yaml` byte-identical
 *           (comments, key order, authored shapes included) — a stronger bar than value
 *           preservation, because a re-serialization can preserve every VALUE while still
 *           changing every BYTE.
 *   Part 2 — true category MOVE, exercised end-to-end through the real processor + a fresh
 *           `PromptLoader`/`PromptConverter` reload, proving registry/loader coherence.
 */
describe('write-scope byte-identity and category move (Fix B + Part 2)', () => {
  let workspaces: string[] = [];

  function workspace(): string {
    const dir = mkdtempSync(join(tmpdir(), 'cpm-fixb-'));
    workspaces.push(dir);
    return dir;
  }

  beforeEach(() => {
    workspaces = [];
  });

  afterEach(() => {
    for (const dir of workspaces) rmSync(dir, { recursive: true, force: true });
  });

  /**
   * Test 1 — byte-identity. A hand-authored `prompt.yaml` with a comment, non-default key order,
   * and a `tools:` list is re-written by NOTHING a patch-only `user_message_template` edit
   * touches — the file this test reads back must be the exact bytes it wrote, not a value-equal
   * re-serialization. `system-message.md` is asserted untouched the same way.
   *
   * FALSIFICATION: neuter the scope table (make `writesYaml` always `true` in
   * `createOrUpdateYamlPrompt`) and `rawAfter` no longer equals `rawBefore` — the comment and key
   * order are lost to `serializeYaml`, which has no comment model.
   */
  test('a patch-only edit leaves prompt.yaml byte-identical, system-message.md untouched', async () => {
    const harness = createHarness(workspace());
    await seed(harness);

    const handAuthoredYaml = [
      '# hand-authored comment — must survive a scoped-out write untouched',
      `id: ${PROMPT_ID}`,
      'tools:',
      '  - prompt_builder',
      'name: Patch Target',
      `category: ${CATEGORY}`,
      'description: A prompt used to exercise anchored patching',
      'userMessageTemplateFile: user-message.md',
      'systemMessageFile: system-message.md',
      '',
    ].join('\n');
    writeFileSync(promptYamlPath(harness), handAuthoredYaml, 'utf8');
    const systemMessageBefore = harness.readFiles()['system-message.md'];

    const response = await harness.processor.updatePrompt({
      id: PROMPT_ID,
      patch: [
        {
          field: 'user_message_template',
          old_string: 'Answer in prose.',
          new_string: 'Answer in bullet points.',
        },
      ],
    } as never);

    expect(response.isError).toBe(false);
    const rawAfter = readFileSync(promptYamlPath(harness), 'utf8');
    expect(rawAfter).toBe(handAuthoredYaml);
    expect(harness.readFiles()['system-message.md']).toBe(systemMessageBefore);
    expect(harness.readFiles()['user-message.md']).toContain('Answer in bullet points.');
  });

  /**
   * Test 2 — category move, end-to-end. `category` is the only field supplied, so under Fix B's
   * scope table alone this would be a narrow yaml-only rewrite — Part 2 forces the FULL state
   * once a move is detected, which is what lets `tools/` and the message bodies survive
   * relocation at all. Confirms no orphan via a full loader reload: the prompt resolves under
   * the NEW category with its tool binding intact, and the OLD category no longer exists.
   *
   * FALSIFICATION: comment out the `fs.rm(moveSource, ...)` step and `existsSync(oldDir)` below
   * goes true — the loader would then see the prompt id twice (old + new directory), which
   * `PromptLoader`/`PromptConverter` do not deduplicate across categories.
   */
  test('category move relocates the prompt; loader reload finds it under the new category', async () => {
    const dir = workspace();
    const harness = createHarness(dir);
    await seed(harness);

    const withTools = await harness.processor.updatePrompt({
      id: PROMPT_ID,
      tools: [{ id: 'move_tool', name: 'Move Tool', script: "print('x')", runtime: 'python' }],
    } as never);
    expect(withTools.isError).toBe(false);

    const response = await harness.processor.updatePrompt({
      id: PROMPT_ID,
      category: 'relocated',
    } as never);
    expect(response.isError).toBe(false);

    const oldDir = join(harness.promptsDir, CATEGORY, PROMPT_ID);
    const newDir = join(harness.promptsDir, 'relocated', PROMPT_ID);
    expect(existsSync(oldDir)).toBe(false);
    expect(existsSync(newDir)).toBe(true);
    expect(existsSync(join(newDir, 'user-message.md'))).toBe(true);
    expect(existsSync(join(newDir, 'system-message.md'))).toBe(true);
    expect(existsSync(join(newDir, 'tools', 'move_tool', 'tool.yaml'))).toBe(true);

    const promptLoader = new PromptLoader(harness.logger);
    const { promptsData } = await promptLoader.loadFromDirectories(harness.promptsDir);
    const converter = new PromptConverter(harness.logger, promptLoader);
    const converted = await converter.convertMarkdownPromptsToJson(promptsData, harness.promptsDir);
    const reloaded = converted.find((p) => p.id === PROMPT_ID);

    expect(reloaded).toBeDefined();
    expect(reloaded?.category).toBe('relocated');
    expect((reloaded?.scriptTools ?? []).map((t) => t.id)).toEqual(['move_tool']);
    // No orphan: exactly one resolution of the id — a lingering old-directory copy (the move
    // failing to remove `oldDir`) would double this, since the loader has no cross-category
    // dedup for a prompt id declared in two places. `categories` itself may still list the old,
    // now-empty, category directory (`loader.ts` lists every subdirectory regardless of content)
    // — that is a cosmetic directory-listing residue, not a broken reference, and out of scope.
    expect(converted.filter((p) => p.id === PROMPT_ID)).toHaveLength(1);
  });

  /**
   * Test 5 (TESTS §5) — an update that does NOT change category behaves exactly as before: no
   * move machinery engages, single target, existing behaviour untouched. Regression guard
   * alongside the untouched parity tests in the describe block above.
   */
  test('an update with an unchanged category never engages the move path', async () => {
    const harness = createHarness(workspace());
    await seed(harness);

    const response = await harness.processor.updatePrompt({
      id: PROMPT_ID,
      category: CATEGORY,
      description: 'Same category, different description',
    } as never);

    expect(response.isError).toBe(false);
    expect(response.content[0]?.text).not.toMatch(/Moved prompt/);
    const promptDir = join(harness.promptsDir, CATEGORY, PROMPT_ID);
    expect(existsSync(promptDir)).toBe(true);
    const after = readParsedPromptYaml(harness);
    expect(after['description']).toBe('Same category, different description');
  });
});

/**
 * tier-b-settability-proposal §2 Fix D / §4 test 5 (owner-scoped increment): `argument_updates`
 * — structured per-field overlay onto EXISTING arguments, addressed by `name`. Same classification
 * as the suites above: real processor, real `FileOperations`, real writer, writing into a temp
 * workspace. Only the version seam is a double.
 */
describe('argument_updates — structured per-field overlay (Fix D)', () => {
  let workspaces: string[] = [];

  function workspace(): string {
    const dir = mkdtempSync(join(tmpdir(), 'cpm-argupdates-'));
    workspaces.push(dir);
    return dir;
  }

  beforeEach(() => {
    workspaces = [];
  });

  afterEach(() => {
    for (const dir of workspaces) rmSync(dir, { recursive: true, force: true });
  });

  const BASE_ARGUMENTS = [
    { name: 'team', type: 'string', description: 'Team name', required: true },
    { name: 'period', type: 'string', description: 'Reporting period' },
  ];

  /**
   * Seed the fixture prompt WITH `arguments` already authored — on disk AND in the in-memory
   * `currentPrompt` the harness's `getData()` returns. `argument_updates` merges onto
   * `canonicalPromptSnapshot(id, currentPrompt).arguments`, which reads the in-memory prompt, not
   * the file — going through an ordinary `updatePrompt({arguments: ...})` call first would leave
   * `harness.livePrompt` (the fixed object `getData()` returns) stale, since the real
   * `FileOperations` write never mutates it. Setting it directly before `seed()` keeps disk and
   * in-memory state consistent from the start, matching what a fresh loader reload would produce.
   */
  async function seedWithArguments(harness: Harness): Promise<void> {
    harness.livePrompt['arguments'] = BASE_ARGUMENTS.map((argument) => ({ ...argument }));
    await seed(harness);
  }

  /**
   * FALSIFICATION (per the task's falsify-then-restore instruction): neutering the merge — making
   * `mergeArgumentUpdates` return `baseArguments` unmodified instead of overlaying — turns this red
   * (`after['arguments']` would equal `BASE_ARGUMENTS`, not the reworded array, and the
   * byte-identity assertion against the equivalent full update would fail). Verified by temporarily
   * replacing the merge result with `{ ok: true, arguments: baseArguments.map((a) => ({ ...a })) }`
   * in `argument-updates.ts` and re-running this test — restored immediately after confirming red.
   */
  test('reword one argument description — only that argument changes, version parity, byte-identical vs equivalent full update', async () => {
    const overlaid = createHarness(workspace());
    await seedWithArguments(overlaid);
    const overlaidResponse = await overlaid.processor.updatePrompt({
      id: PROMPT_ID,
      argument_updates: [{ name: 'team', description: 'Team or org name' }],
    } as never);

    const full = createHarness(workspace());
    await seedWithArguments(full);
    const fullResponse = await full.processor.updatePrompt({
      id: PROMPT_ID,
      arguments: [
        { name: 'team', type: 'string', description: 'Team or org name', required: true },
        { name: 'period', type: 'string', description: 'Reporting period' },
      ],
    } as never);

    if (overlaidResponse.isError) {
      throw new Error(
        overlaidResponse.content.map((part) => ('text' in part ? part.text : '')).join('')
      );
    }
    expect(fullResponse.isError).toBe(false);

    // Only `team.description` changed — `period` is deep-equal to the seeded base, byte-identical
    // output vs the equivalent full-`arguments` update (the existing parity pattern above).
    expect(overlaid.readFiles()).toEqual(full.readFiles());
    const afterYaml = readParsedPromptYaml(overlaid);
    expect(afterYaml['arguments']).toEqual([
      { name: 'team', type: 'string', description: 'Team or org name', required: true },
      { name: 'period', type: 'string', description: 'Reporting period' },
    ]);

    // Version parity at the `recordEditResult` seam.
    expect(overlaid.recordEditResult.mock.calls[0]).toEqual(full.recordEditResult.mock.calls[0]);
  });

  test('an unmatched argument name is refused — file byte-identical, no version row', async () => {
    const harness = createHarness(workspace());
    await seedWithArguments(harness);
    const before = harness.readFiles();

    const response = await harness.processor.updatePrompt({
      id: PROMPT_ID,
      argument_updates: [{ name: 'not_a_real_argument', description: 'x' }],
    } as never);

    expect(response.isError).toBe(true);
    expect((response.content[0] as { text: string }).text).toMatch(/not_a_real_argument/);
    expect(harness.readFiles()).toEqual(before);
    expect(harness.recordEditResult).not.toHaveBeenCalled();
  });

  test('argument_updates combined with arguments in the same call is a conflict refusal', async () => {
    const harness = createHarness(workspace());
    await seedWithArguments(harness);
    const before = harness.readFiles();

    const response = await harness.processor.updatePrompt({
      id: PROMPT_ID,
      arguments: BASE_ARGUMENTS,
      argument_updates: [{ name: 'team', description: 'x' }],
    } as never);

    expect(response.isError).toBe(true);
    expect((response.content[0] as { text: string }).text).toMatch(/argument_updates/);
    expect(harness.readFiles()).toEqual(before);
    expect(harness.recordEditResult).not.toHaveBeenCalled();
  });

  test('dry_run with argument_updates previews without writing or spending a version', async () => {
    const harness = createHarness(workspace());
    await seedWithArguments(harness);
    const before = harness.readFiles();

    const response = await harness.processor.updatePrompt({
      id: PROMPT_ID,
      argument_updates: [{ name: 'team', description: 'Preview only' }],
      dry_run: true,
    } as never);

    expect(response.isError).toBe(false);
    expect(harness.readFiles()).toEqual(before);
    expect(harness.recordEditResult).not.toHaveBeenCalled();
  });
});
