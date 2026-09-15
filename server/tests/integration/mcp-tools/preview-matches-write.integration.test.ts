/**
 * A preview names the files, and the lines, that the write it previews changes.
 *
 * Classification: integration. Real `PromptLifecycleProcessor` and `PromptVersioningProcessor`,
 * real `FileOperations` writing into temp directories, real loader + converter for the refresh.
 * The version seam is a double: its rows are not what these tests compare.
 *
 * The property is checked the way a reader relies on a preview: apply the preview's diff to the
 * files as they were, and the result must be the files as the write left them — with no changed
 * file missing from the diff and no file in it whose bytes did not change. A projection that
 * rewraps a template, renames a file or merges several files into one fails on the first file it
 * misdescribes.
 */

import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { applyPatch, parsePatch } from 'diff';
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, relative, sep } from 'node:path';

import { ComparisonEngine } from '../../../src/mcp/tools/resource-manager/prompt/analysis/comparison-engine.js';
import { GateAnalyzer } from '../../../src/mcp/tools/resource-manager/prompt/analysis/gate-analyzer.js';
import { ObjectDiffGenerator } from '../../../src/mcp/tools/resource-manager/prompt/analysis/object-diff-generator.js';
import { PromptAnalyzer } from '../../../src/mcp/tools/resource-manager/prompt/analysis/prompt-analyzer.js';
import { FileOperations } from '../../../src/mcp/tools/resource-manager/prompt/operations/file-operations.js';
import { PromptLifecycleProcessor } from '../../../src/mcp/tools/resource-manager/prompt/services/prompt-lifecycle-processor.js';
import { PromptVersioningProcessor } from '../../../src/mcp/tools/resource-manager/prompt/services/prompt-versioning-processor.js';
import { canonicalPromptSnapshot } from '../../../src/mcp/tools/resource-manager/prompt/utils/validation.js';
import { PREVIEWABLE_ACTIONS_BY_TYPE } from '../../../src/mcp/tools/shared/preview-action.js';
import { PromptConverter } from '../../../src/modules/prompts/converter.js';
import { PromptLoader } from '../../../src/modules/prompts/loader.js';
import { ContentAnalyzer } from '../../../src/modules/semantic/content-analyzer.js';

import type { PromptResourceContext } from '../../../src/mcp/tools/resource-manager/prompt/core/context.js';
import type { ConfigManager, Logger, ToolResponse } from '../../../src/shared/types/index.js';

const CATEGORY = 'general';

/** Longer than the 100-column wrap any YAML re-serialization of the template would apply. */
const LONG_LINE =
  'Explain the tradeoffs in detail, naming every assumption, every constraint, and every alternative you rejected.';

const TEMPLATE = [
  '## Context',
  '{{input}}',
  '',
  '## Output',
  LONG_LINE,
  'Answer in prose.',
  '',
].join('\n');

const createLogger = (): Logger =>
  ({ debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn() }) as unknown as Logger;

interface PreviewPayload {
  diff: string;
  stats: { additions: number; deletions: number; truncated: boolean };
}

const textOf = (response: ToolResponse): string =>
  (response.content[0] as { text: string } | undefined)?.text ?? '';

const payloadOf = (response: ToolResponse): PreviewPayload =>
  (response as unknown as { structuredContent: PreviewPayload }).structuredContent;

/** Every file under `root`, keyed by `/`-separated path relative to it. */
function readTree(root: string): Record<string, string> {
  const files: Record<string, string> = {};
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else files[relative(root, full).split(sep).join('/')] = readFileSync(full, 'utf8');
    }
  };
  walk(root);
  return files;
}

const stripSide = (name: string): string => name.replace(/^[ab]\//, '');

/**
 * Apply `diff` to the tree before the write and require the tree after it, and require the diff to
 * name exactly the files whose bytes changed. Returns the files the diff names.
 */
function expectDiffReproducesWrite(
  diff: string,
  before: Record<string, string>,
  after: Record<string, string>
): string[] {
  const changedOnDisk = [...new Set([...Object.keys(before), ...Object.keys(after)])]
    .filter((file) => before[file] !== after[file])
    .sort();

  const patches = parsePatch(diff).map((patch) => ({
    patch,
    oldName: patch.oldFileName ?? '',
    newName: patch.newFileName ?? '',
  }));
  const fileOf = ({ oldName, newName }: { oldName: string; newName: string }): string =>
    stripSide(newName === '/dev/null' ? oldName : newName);

  const named = patches.map(fileOf).sort();
  expect(named).toEqual(changedOnDisk);

  for (const side of patches) {
    const file = fileOf(side);
    const source = side.oldName === '/dev/null' ? '' : (before[stripSide(side.oldName)] ?? '');
    const expected = side.newName === '/dev/null' ? '' : after[file];
    expect({ file, content: applyPatch(source, side.patch) }).toEqual({ file, content: expected });
  }

  return named;
}

function writeDirectoryPrompt(
  root: string,
  id: string,
  options: { template: string; systemMessage?: string }
): void {
  const dir = join(root, CATEGORY, id);
  mkdirSync(dir, { recursive: true });
  const yaml = [
    `id: ${id}`,
    `name: ${id}`,
    `category: ${CATEGORY}`,
    'description: A prompt whose preview is compared with its write',
    ...(options.systemMessage !== undefined ? ['systemMessageFile: system-message.md'] : []),
    'userMessageTemplateFile: user-message.md',
    '',
  ].join('\n');
  writeFileSync(join(dir, 'prompt.yaml'), yaml);
  writeFileSync(join(dir, 'user-message.md'), options.template);
  if (options.systemMessage !== undefined) {
    writeFileSync(join(dir, 'system-message.md'), options.systemMessage);
  }
}

interface Harness {
  lifecycle: PromptLifecycleProcessor;
  versioning: PromptVersioningProcessor;
  recordEditResult: jest.Mock<(...args: unknown[]) => Promise<unknown>>;
  resolveRollbackTarget: jest.Mock<(...args: unknown[]) => Promise<unknown>>;
  live: (id: string) => Record<string, unknown> | undefined;
}

/**
 * `servedFrom` is the root the prompts are loaded from before the first write — the writable root
 * itself, or a bundled root the writer must copy up from. Every refresh reloads the writable root.
 */
async function createHarness(
  promptsDir: string,
  servedFrom: string = promptsDir
): Promise<Harness> {
  const logger = createLogger();
  let convertedPrompts: Record<string, unknown>[] = [];
  const reloadFrom = async (dir: string): Promise<void> => {
    const loader = new PromptLoader(logger);
    const { promptsData } = await loader.loadFromDirectories(dir);
    const converted = await new PromptConverter(logger, loader).convertMarkdownPromptsToJson(
      promptsData,
      dir
    );
    convertedPrompts = converted.map((prompt) => ({ ...prompt, sourceRoot: dir }));
  };

  const configManager = {
    getConfigPath: () => join(promptsDir, 'config.json'),
    getServerRoot: () => promptsDir,
    getResolvedPromptsDirectory: () => promptsDir,
    getBundledResourceDirectory: () => undefined,
  } as unknown as ConfigManager;
  const dependencies = {
    logger,
    configManager,
    semanticAnalyzer: new ContentAnalyzer(createLogger()),
    onRefresh: jest.fn(async () => reloadFrom(promptsDir)),
    onRestart: jest.fn(async () => {}),
  };
  const recordEditResult = jest.fn<(...args: unknown[]) => Promise<unknown>>(async () => ({
    version: 2,
    success: true,
    bridged: false,
  }));
  const resolveRollbackTarget = jest.fn<(...args: unknown[]) => Promise<unknown>>(async () => ({
    ok: false,
    error: 'no rollback target configured for this test',
  }));

  const context = {
    dependencies,
    promptAnalyzer: new PromptAnalyzer(dependencies),
    gateAnalyzer: new GateAnalyzer(dependencies as never),
    fileOperations: new FileOperations({ logger, configManager }),
    getData: () => ({ convertedPrompts }),
    versionHistoryService: {
      isAutoVersionEnabled: () => true,
      loadHistory: jest.fn(async () => ({ current_version: 1 })),
      recordEditResult,
      resolveRollbackTarget,
      commitEdit: jest.fn(async () => ({ version: 3, bridged: false })),
    },
    textDiffService: new ObjectDiffGenerator(),
    comparisonEngine: new ComparisonEngine(logger),
  } as unknown as PromptResourceContext;

  await reloadFrom(servedFrom);
  return {
    lifecycle: new PromptLifecycleProcessor(context),
    versioning: new PromptVersioningProcessor(context),
    recordEditResult,
    resolveRollbackTarget,
    live: (id) => convertedPrompts.find((prompt) => prompt['id'] === id),
  };
}

const PATCH_ONE_LINE = {
  field: 'user_message_template',
  old_string: 'Answer in prose.',
  new_string: 'Answer in bullet points.',
};

describe('a preview names the files and lines its write changes', () => {
  const roots: string[] = [];
  const tempRoot = (): string => {
    const dir = mkdtempSync(join(tmpdir(), 'cpm-preview-write-'));
    roots.push(dir);
    return dir;
  };

  afterEach(() => {
    for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  /**
   * Preview, confirm it wrote nothing, then send the identical payload as an update. `readRoot`
   * is where the prompt's current files are; `writeRoot` is where the update lands.
   */
  async function previewThenUpdate(
    harness: Harness,
    args: Record<string, unknown>,
    readRoot: string,
    writeRoot: string = readRoot
  ): Promise<{
    preview: PreviewPayload;
    update: ToolResponse;
    before: Record<string, string>;
    after: Record<string, string>;
  }> {
    const before = readTree(readRoot);
    const writableBefore = readTree(writeRoot);

    const previewResponse = await harness.lifecycle.updatePrompt({
      ...args,
      action: 'preview',
      preview_action: 'update',
    });
    expect(previewResponse.isError).toBe(false);
    expect(readTree(readRoot)).toEqual(before);
    expect(readTree(writeRoot)).toEqual(writableBefore);
    const preview = payloadOf(previewResponse);
    expect(preview.stats.truncated).toBe(false);

    const update = await harness.lifecycle.updatePrompt({ ...args });
    return { preview, update, before, after: readTree(writeRoot) };
  }

  test('directory layout: a one-line template patch is previewed as that line of user-message.md', async () => {
    const promptsDir = tempRoot();
    writeDirectoryPrompt(promptsDir, 'dir_prompt', {
      template: TEMPLATE,
      systemMessage: 'Be precise.',
    });
    const harness = await createHarness(promptsDir);

    const { preview, update, before, after } = await previewThenUpdate(
      harness,
      { id: 'dir_prompt', patch: [PATCH_ONE_LINE] },
      promptsDir
    );

    expect(update.isError).toBe(false);
    expect(expectDiffReproducesWrite(preview.diff, before, after)).toEqual([
      'general/dir_prompt/user-message.md',
    ]);
    // The update reports the diff it was previewed as, and records the same counts on its version.
    expect(textOf(update)).toContain(preview.diff);
    expect(harness.recordEditResult.mock.calls[0]?.[4]).toMatchObject({
      diff_summary: `+${preview.stats.additions}/-${preview.stats.deletions}`,
    });
  });

  test('directory layout: a description change is previewed as prompt.yaml alone', async () => {
    const promptsDir = tempRoot();
    writeDirectoryPrompt(promptsDir, 'dir_prompt', { template: TEMPLATE });
    const harness = await createHarness(promptsDir);

    const { preview, update, before, after } = await previewThenUpdate(
      harness,
      { id: 'dir_prompt', description: 'A description the update replaces' },
      promptsDir
    );

    expect(update.isError).toBe(false);
    expect(expectDiffReproducesWrite(preview.diff, before, after)).toEqual([
      'general/dir_prompt/prompt.yaml',
    ]);
  });

  test('directory layout: unsetting the system message is previewed as the file it deletes', async () => {
    const promptsDir = tempRoot();
    writeDirectoryPrompt(promptsDir, 'dir_prompt', {
      template: TEMPLATE,
      systemMessage: 'Be precise.',
    });
    const harness = await createHarness(promptsDir);

    const { preview, before, after } = await previewThenUpdate(
      harness,
      { id: 'dir_prompt', unset: ['system_message'] },
      promptsDir
    );

    expect(expectDiffReproducesWrite(preview.diff, before, after)).toEqual([
      'general/dir_prompt/prompt.yaml',
      'general/dir_prompt/system-message.md',
    ]);
  });

  test('directory layout: binding a script tool is previewed as the tool files it writes', async () => {
    const promptsDir = tempRoot();
    writeDirectoryPrompt(promptsDir, 'dir_prompt', { template: TEMPLATE });
    const harness = await createHarness(promptsDir);

    const { preview, before, after } = await previewThenUpdate(
      harness,
      {
        id: 'dir_prompt',
        tools: [{ id: 'word_count', name: 'Word Count', script: "print('3')", runtime: 'python' }],
      },
      promptsDir
    );

    expect(expectDiffReproducesWrite(preview.diff, before, after)).toEqual([
      'general/dir_prompt/prompt.yaml',
      'general/dir_prompt/tools/word_count/script.py',
      'general/dir_prompt/tools/word_count/tool.yaml',
    ]);
  });

  /**
   * The writer only produces the directory layout, so an update to a `{category}/{id}.yaml`
   * prompt writes a new directory beside the file. Whether it should is a separate question; the
   * preview has to say what it does.
   */
  test('single-file layout: the preview names the directory files the update writes', async () => {
    const promptsDir = tempRoot();
    mkdirSync(join(promptsDir, CATEGORY), { recursive: true });
    writeFileSync(
      join(promptsDir, CATEGORY, 'flat_prompt.yaml'),
      [
        'id: flat_prompt',
        'name: flat_prompt',
        `category: ${CATEGORY}`,
        'description: A single-file prompt',
        'userMessageTemplate: |',
        ...TEMPLATE.split('\n').map((line) => (line === '' ? '' : `  ${line}`)),
        '',
      ].join('\n')
    );
    const harness = await createHarness(promptsDir);
    expect(harness.live('flat_prompt')).toBeDefined();

    const { preview, before, after } = await previewThenUpdate(
      harness,
      { id: 'flat_prompt', patch: [PATCH_ONE_LINE] },
      promptsDir
    );

    expect(expectDiffReproducesWrite(preview.diff, before, after)).toEqual([
      'general/flat_prompt/prompt.yaml',
      'general/flat_prompt/user-message.md',
    ]);
  });

  test('copy-on-write: a bundled prompt is previewed from its bundled files into the writable root', async () => {
    const bundledDir = tempRoot();
    const writableDir = tempRoot();
    writeDirectoryPrompt(bundledDir, 'bundled_prompt', { template: TEMPLATE });
    const bundledBefore = readTree(bundledDir);
    const harness = await createHarness(writableDir, bundledDir);

    const { preview, update, after } = await previewThenUpdate(
      harness,
      { id: 'bundled_prompt', patch: [PATCH_ONE_LINE] },
      bundledDir,
      writableDir
    );

    expect(update.isError).toBe(false);
    expect(readTree(bundledDir)).toEqual(bundledBefore);
    expect(expectDiffReproducesWrite(preview.diff, bundledBefore, after)).toEqual([
      'general/bundled_prompt/user-message.md',
    ]);
  });

  test('rollback: the preview names the files and lines the rollback restores', async () => {
    const promptsDir = tempRoot();
    writeDirectoryPrompt(promptsDir, 'dir_prompt', {
      template: TEMPLATE,
      systemMessage: 'Be precise.',
    });
    const harness = await createHarness(promptsDir);
    const recorded = canonicalPromptSnapshot('dir_prompt', harness.live('dir_prompt'));

    const edited = await harness.lifecycle.updatePrompt({
      id: 'dir_prompt',
      patch: [PATCH_ONE_LINE],
      description: 'Edited after the recorded version',
    });
    expect(edited.isError).toBe(false);
    harness.resolveRollbackTarget.mockResolvedValue({ ok: true, entry: { snapshot: recorded } });

    const before = readTree(promptsDir);
    const previewResponse = await harness.versioning.handleRollback({
      action: 'preview',
      preview_action: 'rollback',
      id: 'dir_prompt',
      version: 1,
    });
    expect(previewResponse.isError).toBe(false);
    expect(readTree(promptsDir)).toEqual(before);

    const rollback = await harness.versioning.handleRollback({
      action: 'rollback',
      id: 'dir_prompt',
      version: 1,
      confirm: true,
    });
    expect(rollback.isError).toBe(false);

    expect(
      expectDiffReproducesWrite(payloadOf(previewResponse).diff, before, readTree(promptsDir))
    ).toEqual(['general/dir_prompt/prompt.yaml', 'general/dir_prompt/user-message.md']);
  });
});

/**
 * Every previewable (resource type, action) pair sits in exactly one bucket, so a pair added to
 * `PREVIEWABLE_ACTIONS_BY_TYPE` fails here until someone decides whether its preview has been
 * proven against the write it previews.
 */
describe('preview coverage', () => {
  const PROVEN_AGAINST_THE_WRITE: Record<string, string> = {
    'prompt:update': 'directory, single-file and copy-on-write cases above',
    'prompt:rollback': 'rollback case above',
  };
  /** A delete preview lists what would be removed; it renders no diff that could disagree. */
  const RENDERS_NO_DIFF = ['prompt:delete', 'gate:delete', 'framework:delete'];
  const STILL_DIFFING_A_PROJECTION: Record<string, string> = {
    'gate:rollback':
      '☐ as of 2026-09-14 · GateVersioningProcessor diffs the snapshot rendered as `<id>/gate.yaml`, ' +
      'while GateFileWriter writes gate.yaml and guidance.md · flips when the preview diffs the files ' +
      'GateFileWriter would write',
    'framework:rollback':
      '☐ as of 2026-09-14 · FrameworkVersioningProcessor diffs the snapshot rendered as ' +
      '`<id>/framework.yaml`, while FrameworkFileWriter writes framework.yaml, phases.yaml, ' +
      'system-prompt.md and judge-prompt.md · flips when the preview diffs the files ' +
      'FrameworkFileWriter would write',
  };

  test('every previewable action is classified exactly once', () => {
    const previewable = Object.entries(PREVIEWABLE_ACTIONS_BY_TYPE)
      .flatMap(([type, actions]) => actions.map((action) => `${type}:${action}`))
      .sort();
    const classified = [
      ...Object.keys(PROVEN_AGAINST_THE_WRITE),
      ...RENDERS_NO_DIFF,
      ...Object.keys(STILL_DIFFING_A_PROJECTION),
    ].sort();

    expect(classified).toEqual(previewable);
  });
});
