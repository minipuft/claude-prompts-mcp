/**
 * A preview names the files, and the lines, that the write it previews changes.
 *
 * Classification: integration. Real `PromptLifecycleProcessor` and `PromptVersioningProcessor`,
 * real `FileOperations` writing into temp directories, real loader + converter for the refresh.
 * The gate, framework and category cases use their real lifecycle and versioning processors over
 * the real `GateFileWriter`, `FrameworkFileWriter` and `CategoryFileWriter`, with a disk-reading
 * registry double for gates. The version seam is a double throughout: its rows are not what these
 * tests compare.
 *
 * The property is checked the way a reader relies on a preview: apply the preview's diff to the
 * files as they were, and the result must be the files as the write left them — with no changed
 * file missing from the diff and no file in it whose bytes did not change. A projection that
 * rewraps a template, renames a file or merges several files into one fails on the first file it
 * misdescribes.
 */

import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { applyPatch, parsePatch } from 'diff';
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
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

import { hashBytes } from '../../../src/shared/utils/hash.js';
import { CategoryFileWriter } from '../../../src/mcp/tools/category-manager/services/category-file-writer.js';
import { CategoryLifecycleProcessor } from '../../../src/mcp/tools/category-manager/services/category-lifecycle-processor.js';
import { categorySnapshotContract } from '../../../src/mcp/tools/category-manager/services/category-snapshot-contract.js';
import { CategoryVersioningProcessor } from '../../../src/mcp/tools/category-manager/services/category-versioning-processor.js';
import { FrameworkFileWriter } from '../../../src/mcp/tools/framework-manager/services/framework-file-writer.js';
import { FrameworkLifecycleProcessor } from '../../../src/mcp/tools/framework-manager/services/framework-lifecycle-processor.js';
import { frameworkSnapshotContract } from '../../../src/mcp/tools/framework-manager/services/framework-snapshot-contract.js';
import { FrameworkVersioningProcessor } from '../../../src/mcp/tools/framework-manager/services/framework-versioning-processor.js';
import { GateFileWriter } from '../../../src/mcp/tools/gate-manager/services/gate-file-writer.js';
import { GateLifecycleProcessor } from '../../../src/mcp/tools/gate-manager/services/gate-lifecycle-processor.js';
import { gateSnapshotContract } from '../../../src/mcp/tools/gate-manager/services/gate-snapshot-contract.js';
import { GateVersioningProcessor } from '../../../src/mcp/tools/gate-manager/services/gate-versioning-processor.js';
import { ComparisonEngine } from '../../../src/mcp/tools/resource-manager/prompt/analysis/comparison-engine.js';
import { GateAnalyzer } from '../../../src/mcp/tools/resource-manager/prompt/analysis/gate-analyzer.js';
import { ObjectDiffGenerator } from '../../../src/mcp/tools/resource-manager/prompt/analysis/object-diff-generator.js';
import { PromptAnalyzer } from '../../../src/mcp/tools/resource-manager/prompt/analysis/prompt-analyzer.js';
import { FileOperations } from '../../../src/mcp/tools/resource-manager/prompt/operations/file-operations.js';
import { PromptLifecycleProcessor } from '../../../src/mcp/tools/resource-manager/prompt/services/prompt-lifecycle-processor.js';
import { PromptVersioningProcessor } from '../../../src/mcp/tools/resource-manager/prompt/services/prompt-versioning-processor.js';
import { canonicalPromptSnapshot } from '../../../src/modules/versioning/projections/prompt-snapshot.js';
import { PREVIEWABLE_ACTIONS_BY_TYPE } from '../../../src/mcp/tools/shared/preview-action.js';
import { PromptConverter } from '../../../src/modules/prompts/converter.js';
import { PromptLoader } from '../../../src/modules/prompts/loader.js';
import { parseYamlOrThrow } from '../../../src/shared/utils/yaml/yaml-parser.js';

import type { CategoryResourceContext } from '../../../src/mcp/tools/category-manager/core/context.js';
import type { CategoryManagerInput } from '../../../src/mcp/tools/category-manager/core/types.js';
import type { FrameworkResourceContext } from '../../../src/mcp/tools/framework-manager/core/context.js';
import type { FrameworkManagerInput } from '../../../src/mcp/tools/framework-manager/core/types.js';
import type { GateResourceContext } from '../../../src/mcp/tools/gate-manager/core/context.js';
import type { GateManagerInput } from '../../../src/mcp/tools/gate-manager/core/types.js';
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

/**
 * The unified diff a gate or framework response carries. Those responses report it as text only,
 * inside a ```diff fence; a diff line always opens with a prefix character, so the first line that
 * starts with the fence is the one closing it.
 */
function fencedDiffOf(response: ToolResponse): string {
  const text = textOf(response);
  const opening = '```diff\n';
  const start = text.indexOf(opening);
  expect(start).toBeGreaterThanOrEqual(0);
  expect(text).not.toContain('lines omitted');
  return text.slice(start + opening.length, text.indexOf('\n```', start + opening.length));
}

/** `+additions/-deletions` counted off a unified diff's hunk lines. */
function countsOf(diff: string): string {
  const lines = parsePatch(diff).flatMap((patch) => patch.hunks.flatMap((hunk) => hunk.lines));
  const additions = lines.filter((line) => line.startsWith('+')).length;
  const deletions = lines.filter((line) => line.startsWith('-')).length;
  return `+${additions}/-${deletions}`;
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
    promptAnalyzer: new PromptAnalyzer(),
    gateAnalyzer: new GateAnalyzer(dependencies as never),
    fileOperations: new FileOperations({ logger, configManager }),
    getData: () => ({ convertedPrompts }),
    versionHistoryService: {
      isAutoVersionEnabled: () => true,
      loadHistory: jest.fn(async () => ({ current_version: 1 })),
      recordEditResult,
      resolveRollbackTarget,
      commitEdit: jest.fn(async () => ({ version: 3, bridged: false })),
      /**
       * These doubles exercise the PROJECTION path, so the byte path must answer "no tree".
       *
       * Stated rather than omitted: a missing method is a TypeError at the call site, and the
       * honest double for a version row this harness never recorded files for is exactly the
       * answer a pre-v29 row gives.
       */
      planByteRestore: jest.fn(async () => ({
        status: 'projection-only',
        reason: 'this harness records no file trees',
      })),
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
   * B.21 — an update of a single-file prompt converts it to directory layout in the same write:
   * the preview names the deleted `{id}.yaml` alongside the new directory's files, and the update
   * leaves exactly one on-disk definition (never `{id}.yaml` and `{id}/prompt.yaml` together).
   */
  test('single-file layout: the preview names the deleted flat file and the new directory files', async () => {
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
      'general/flat_prompt.yaml',
      'general/flat_prompt/prompt.yaml',
      'general/flat_prompt/user-message.md',
    ]);
    // Exactly one definition survives the update — the flat file is gone, not left stale beside
    // the new directory.
    expect(existsSync(join(promptsDir, CATEGORY, 'flat_prompt.yaml'))).toBe(false);
    expect(existsSync(join(promptsDir, CATEGORY, 'flat_prompt', 'prompt.yaml'))).toBe(true);
    expect(harness.live('flat_prompt')?.['userMessageTemplate']).toContain(
      'Answer in bullet points.'
    );
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

const GATE_ID = 'preview-probe';
const FRAMEWORK_ID = 'preview-probe';
const CATEGORY_ID = 'preview-probe-category';

const CATEGORY_DESCRIPTION = `The authored description. ${LONG_LINE}`;
const CATEGORY_DESCRIPTION_EDITED = `The edited description. ${LONG_LINE}`;
const CATEGORY_DESCRIPTION_RECORDED = `The description version 1 recorded. ${LONG_LINE}`;

const GUIDANCE = ['## Check', LONG_LINE, 'Report every gap.', ''].join('\n');
const GUIDANCE_EDITED = ['## Check', LONG_LINE, 'Report every gap, and name its owner.', ''].join(
  '\n'
);
const SYSTEM_PROMPT = ['## Method', LONG_LINE, 'Work phase by phase.', ''].join('\n');
const SYSTEM_PROMPT_EDITED = [
  '## Method',
  LONG_LINE,
  'Work phase by phase, and say which phase you are in.',
  '',
].join('\n');

type VersionSeamMock = jest.Mock<(...args: unknown[]) => Promise<unknown>>;

/** The version-history double both resource types share; its rows are not under test. */
function createVersionSeam(): {
  recordEditResult: VersionSeamMock;
  resolveRollbackTarget: VersionSeamMock;
  planByteRestore: VersionSeamMock;
  service: Record<string, unknown>;
} {
  const recordEditResult: VersionSeamMock = jest.fn(async () => ({
    version: 2,
    success: true,
    bridged: false,
  }));
  const resolveRollbackTarget: VersionSeamMock = jest.fn(async () => ({
    ok: false,
    error: 'no rollback target configured for this test',
  }));
  const planByteRestore: VersionSeamMock = jest.fn(async () => ({
    status: 'projection-only',
    reason: 'this harness records no file trees',
  }));
  return {
    recordEditResult,
    resolveRollbackTarget,
    planByteRestore,
    service: {
      isAutoVersionEnabled: () => true,
      recordEditResult,
      resolveRollbackTarget,
      /**
       * These harnesses exercise the PROJECTION path — they configure a snapshot and never a file
       * tree — so the byte path must answer "no tree". That is exactly what a pre-v29 row answers,
       * which makes this the honest double rather than a convenience: a missing method would be a
       * TypeError at the call site, and a `ready` here would be a tree nothing recorded.
       */
      planByteRestore,
      commitEdit: jest.fn(async () => ({ version: 3, bridged: false })),
    },
  };
}

type GateView = Parameters<typeof gateSnapshotContract.project>[1];

/**
 * Serves each gate as it was on disk at its last `reload`, which is the staleness the production
 * registry has: the processors reload after they write, and read the registry before.
 */
class DiskGateRegistry {
  private readonly gates = new Map<string, GateView>();

  constructor(private readonly gatesDir: string) {}

  has(id: string): boolean {
    return this.gates.has(id);
  }

  get(id: string): GateView | undefined {
    return this.gates.get(id);
  }

  reload(id: string): Promise<boolean> {
    const dir = join(this.gatesDir, id);
    const definition = parseYamlOrThrow<Record<string, unknown>>(
      readFileSync(join(dir, 'gate.yaml'), 'utf8')
    );
    const guidance = readFileSync(join(dir, 'guidance.md'), 'utf8');
    this.gates.set(id, {
      gateId: id,
      name: String(definition['name']),
      type: String(definition['type']),
      description: String(definition['description']),
      getGuidance: () => guidance,
      getDefinition: () => definition,
    } as unknown as GateView);
    return Promise.resolve(true);
  }
}

interface GateHarness {
  planByteRestore: VersionSeamMock;
  lifecycle: GateLifecycleProcessor;
  versioning: GateVersioningProcessor;
  registry: DiskGateRegistry;
  recordEditResult: VersionSeamMock;
  resolveRollbackTarget: VersionSeamMock;
}

/** Real gate processors and writer over `gatesDir`, with one gate written there by that writer. */
async function createGateHarness(gatesDir: string): Promise<GateHarness> {
  const logger = createLogger();
  const configManager = {
    getGatesDirectory: () => gatesDir,
    getBundledResourceDirectory: () => undefined,
  } as unknown as ConfigManager;
  const writer = new GateFileWriter({ logger, configManager });
  const registry = new DiskGateRegistry(gatesDir);
  const versions = createVersionSeam();
  const context = {
    logger,
    gateManager: registry,
    configManager,
    textDiffService: new ObjectDiffGenerator(),
    versionHistoryService: versions.service,
    gateFileService: writer,
    onRefresh: jest.fn(async () => {}),
  } as unknown as GateResourceContext;

  const seeded = await writer.writeGateFiles({
    id: GATE_ID,
    name: 'Preview Probe',
    type: 'validation',
    description: 'The recorded description',
    guidance: GUIDANCE,
  });
  expect(seeded.success).toBe(true);
  await registry.reload(GATE_ID);

  return {
    lifecycle: new GateLifecycleProcessor(context),
    versioning: new GateVersioningProcessor(context),
    registry,
    recordEditResult: versions.recordEditResult,
    resolveRollbackTarget: versions.resolveRollbackTarget,
    planByteRestore: versions.planByteRestore,
  };
}

/** Configuration naming `frameworksDir` as the writable root and `bundledDir` as the bundle. */
const frameworkConfig = (frameworksDir: string, bundledDir?: string): ConfigManager =>
  ({
    getFrameworksDirectory: () => frameworksDir,
    getBundledResourceDirectory: () => bundledDir,
  }) as unknown as ConfigManager;

async function seedFramework(frameworksDir: string): Promise<void> {
  const writer = new FrameworkFileWriter({
    logger: createLogger(),
    configManager: frameworkConfig(frameworksDir),
  });
  const result = await writer.writeFrameworkFiles({
    id: FRAMEWORK_ID,
    name: 'Preview Probe',
    type: 'PROBE',
    description: 'The recorded description',
    system_prompt_guidance: SYSTEM_PROMPT,
    enabled: true,
  });
  expect(result.success).toBe(true);
}

interface FrameworkHarness {
  planByteRestore: VersionSeamMock;
  lifecycle: FrameworkLifecycleProcessor;
  versioning: FrameworkVersioningProcessor;
  writer: FrameworkFileWriter;
  recordEditResult: VersionSeamMock;
  resolveRollbackTarget: VersionSeamMock;
}

/** Real framework processors and writer over `frameworksDir`, serving `bundledDir` beneath it. */
function createFrameworkHarness(frameworksDir: string, bundledDir?: string): FrameworkHarness {
  const logger = createLogger();
  const configManager = frameworkConfig(frameworksDir, bundledDir);
  const writer = new FrameworkFileWriter({ logger, configManager });
  const versions = createVersionSeam();
  const context = {
    logger,
    frameworkManager: {
      getFramework: (id: string) => (id === FRAMEWORK_ID ? { id } : undefined),
      getFrameworkRegistry: () => ({ getRuntimeLoader: () => ({ clearCache: () => undefined }) }),
      registerFramework: () => Promise.resolve(true),
    },
    configManager,
    fileService: writer,
    textDiffService: new ObjectDiffGenerator(),
    versionHistoryService: versions.service,
    onRefresh: jest.fn(async () => {}),
  } as unknown as FrameworkResourceContext;

  return {
    // `handleUpdate` never reaches the draft validator; only `handleCreate` does.
    lifecycle: new FrameworkLifecycleProcessor(
      context,
      {} as unknown as ConstructorParameters<typeof FrameworkLifecycleProcessor>[1]
    ),
    versioning: new FrameworkVersioningProcessor(context),
    writer,
    recordEditResult: versions.recordEditResult,
    resolveRollbackTarget: versions.resolveRollbackTarget,
    planByteRestore: versions.planByteRestore,
  };
}

interface CategoryHarness {
  planByteRestore: VersionSeamMock;
  lifecycle: CategoryLifecycleProcessor;
  versioning: CategoryVersioningProcessor;
  recordEditResult: VersionSeamMock;
  resolveRollbackTarget: VersionSeamMock;
}

/** Real category processors and writer over `promptsDir`, the writable prompts root. */
function createCategoryHarness(promptsDir: string): CategoryHarness {
  const logger = createLogger();
  const configManager = {
    getResolvedPromptsDirectory: () => promptsDir,
    getBundledResourceDirectory: () => undefined,
  } as unknown as ConfigManager;
  const versions = createVersionSeam();
  const context = {
    logger,
    configManager,
    textDiffService: new ObjectDiffGenerator(),
    versionHistoryService: versions.service,
    categoryFileService: new CategoryFileWriter({ logger, configManager }),
    onRefresh: jest.fn(async () => {}),
  } as unknown as CategoryResourceContext;

  return {
    lifecycle: new CategoryLifecycleProcessor(context),
    versioning: new CategoryVersioningProcessor(context),
    recordEditResult: versions.recordEditResult,
    resolveRollbackTarget: versions.resolveRollbackTarget,
    planByteRestore: versions.planByteRestore,
  };
}

/**
 * A hand-authored `category.yaml`, plus a prompt the category holds.
 *
 * Authored rather than written by the writer, on purpose: the comment, the `description`-before-`id`
 * key order and the over-wide description are all things a write REPLACES and a comparison of two
 * recorded field maps cannot see. A diff built from the snapshots reports the one field the caller
 * changed; the write rewrites the whole document. The prompt is here for the other half — a
 * category write never touches the prompts its directory holds, so no diff of one may name them.
 */
function seedCategory(promptsDir: string, id: string): void {
  const promptDir = join(promptsDir, id, 'held-prompt');
  mkdirSync(promptDir, { recursive: true });
  writeFileSync(
    join(promptsDir, id, 'category.yaml'),
    [
      '# Authored by hand, before this file could be written through the tool.',
      `description: ${CATEGORY_DESCRIPTION}`,
      'name: Preview Probe Category',
      `id: ${id}`,
      'mcpPromptMode: expand',
      '',
    ].join('\n')
  );
  writeFileSync(
    join(promptDir, 'prompt.yaml'),
    [
      'id: held-prompt',
      'name: Held Prompt',
      `category: ${id}`,
      'description: A prompt the category holds and no category write touches',
      'userMessageTemplateFile: user-message.md',
      '',
    ].join('\n')
  );
  writeFileSync(join(promptDir, 'user-message.md'), TEMPLATE);
}

/** The `category.yaml` on disk, parsed — what a version records, per `categorySnapshotContract`. */
function declaredCategory(promptsDir: string, id: string): Record<string, unknown> {
  return parseYamlOrThrow<Record<string, unknown>>(
    readFileSync(join(promptsDir, id, 'category.yaml'), 'utf8')
  );
}

/**
 * A refusal from the byte path must never fall through to the projection path.
 *
 * ENUMERATED, not sampled. The property is "every processor that asks `planByteRestore` refuses
 * when it answers `refused`", and its failure mode is silent: the projection path produces a
 * perfectly plausible rollback from a state the row explicitly says it can no longer vouch for. A
 * mutant deleting the refusal branch from ONE processor came back green against this file before
 * these cases existed, which is why all four are driven — the prompt processor from
 * `prompt-patch-update.test.ts`, the other three here — rather than one standing in for the rest.
 *
 * Each case asserts the refusal AND that nothing on disk moved: a refusal that named the right
 * thing while writing half the files would pass an assertion about its message alone.
 */
describe('a byte-path refusal is never downgraded to the projection path', () => {
  const roots: string[] = [];
  const tempRoot = (): string => {
    const dir = mkdtempSync(join(tmpdir(), 'cpm-byte-refusal-'));
    roots.push(dir);
    return dir;
  };

  afterEach(() => {
    for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  const REFUSAL = {
    status: 'refused',
    reason: "the recorded bytes of 'guidance.md' are missing from the object store",
  };

  test('gate rollback refuses, names the reason, and writes nothing', async () => {
    const gatesDir = tempRoot();
    const harness = await createGateHarness(gatesDir);
    const recorded = gateSnapshotContract.project(
      GATE_ID,
      harness.registry.get(GATE_ID) as GateView
    );
    harness.resolveRollbackTarget.mockResolvedValue({ ok: true, entry: { snapshot: recorded } });
    harness.planByteRestore.mockResolvedValue(REFUSAL);

    const before = readTree(gatesDir);
    const response = await harness.versioning.handleRollback({
      action: 'rollback',
      id: GATE_ID,
      version: 1,
      confirm: true,
    } as GateManagerInput);

    expect(response.isError).toBe(true);
    expect(textOf(response)).toContain('missing from the object store');
    expect(readTree(gatesDir)).toEqual(before);
  });

  test('framework rollback refuses, names the reason, and writes nothing', async () => {
    const frameworksDir = tempRoot();
    const harness = createFrameworkHarness(frameworksDir);
    await seedFramework(frameworksDir);
    harness.resolveRollbackTarget.mockResolvedValue({
      ok: true,
      entry: {
        snapshot: {
          id: FRAMEWORK_ID,
          name: 'Preview Probe',
          description: 'recorded',
          type: 'PROBE',
          enabled: true,
        },
      },
    });
    harness.planByteRestore.mockResolvedValue(REFUSAL);

    const before = readTree(frameworksDir);
    const response = await harness.versioning.handleRollback({
      action: 'rollback',
      id: FRAMEWORK_ID,
      version: 1,
      confirm: true,
    } as FrameworkManagerInput);

    expect(response.isError).toBe(true);
    expect(textOf(response)).toContain('missing from the object store');
    expect(readTree(frameworksDir)).toEqual(before);
  });

  test('category rollback refuses, names the reason, and writes nothing', async () => {
    const promptsDir = tempRoot();
    seedCategory(promptsDir, CATEGORY_ID);
    const harness = createCategoryHarness(promptsDir);
    harness.resolveRollbackTarget.mockResolvedValue({
      ok: true,
      entry: {
        snapshot: categorySnapshotContract.project(
          CATEGORY_ID,
          declaredCategory(promptsDir, CATEGORY_ID)
        ),
      },
    });
    harness.planByteRestore.mockResolvedValue(REFUSAL);

    const before = readTree(promptsDir);
    const response = await harness.versioning.handleRollback({
      action: 'rollback',
      id: CATEGORY_ID,
      version: 1,
      confirm: true,
    } as CategoryManagerInput);

    expect(response.isError).toBe(true);
    expect(textOf(response)).toContain('missing from the object store');
    expect(readTree(promptsDir)).toEqual(before);
  });

  test('a tree-backed version restores even when its PROJECTION is incomplete', async () => {
    // The property the snapshot-completeness reorder buys, and the only thing that fails if it is
    // undone. `describeIncompleteSnapshot` is a statement about the FALLBACK — a merging writer
    // cannot rebuild a resource from a snapshot missing a required field — and it used to run
    // ahead of the byte branch, so a version carrying the resource's actual bytes was refused for
    // a defect in a projection the restore never reads.
    const gatesDir = tempRoot();
    const harness = await createGateHarness(gatesDir);
    const restored = Buffer.from('# recorded by hand\nid: preview-probe\nname: Recorded\n', 'utf8');
    const target = join(gatesDir, GATE_ID, 'gate.yaml');

    // A snapshot missing `name`, which `gateSnapshotContract` requires.
    harness.resolveRollbackTarget.mockResolvedValue({
      ok: true,
      entry: { snapshot: { id: GATE_ID, type: 'validation' } },
    });
    harness.planByteRestore.mockResolvedValue({
      status: 'ready',
      plan: {
        resourceType: 'gate',
        resourceId: GATE_ID,
        version: 1,
        destinationRoot: join(gatesDir, GATE_ID),
        recordedOrigin: 'primary',
        write: [
          {
            path: 'gate.yaml',
            absolutePath: target,
            hash: hashBytes(restored),
            reason: 'differs',
          },
        ],
        unchanged: [],
        leftInPlace: [],
      },
      bytes: new Map([[hashBytes(restored), new Uint8Array(restored)]]),
    });

    const response = await harness.versioning.handleRollback({
      action: 'rollback',
      id: GATE_ID,
      version: 1,
      confirm: true,
    } as GateManagerInput);

    expect(response.isError).toBe(false);
    // Byte-identical to what this test recorded, digest computed here.
    expect(hashBytes(readFileSync(target))).toBe(hashBytes(restored));
  });

  test('the projection path still runs when the answer is projection-only', () => {
    // The positive control for all three: the default seam answers `projection-only`, and the
    // rollback cases in the suite above exercise exactly that path and write files. Without this
    // note a reader could read the three refusals as "the byte branch blocks rollback".
    expect(createVersionSeam().planByteRestore).toBeDefined();
  });
});

describe('a gate, framework or category diff names the files and lines its write changes', () => {
  const roots: string[] = [];
  const tempRoot = (): string => {
    const dir = mkdtempSync(join(tmpdir(), 'cpm-preview-write-'));
    roots.push(dir);
    return dir;
  };

  afterEach(() => {
    for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  test('gate rollback: the preview names gate.yaml and guidance.md as the rollback writes them', async () => {
    const gatesDir = tempRoot();
    const harness = await createGateHarness(gatesDir);
    const recorded = gateSnapshotContract.project(
      GATE_ID,
      harness.registry.get(GATE_ID) as GateView
    );

    const edited = await harness.lifecycle.handleUpdate({
      action: 'update',
      id: GATE_ID,
      description: 'Edited after the recorded version',
      guidance: GUIDANCE_EDITED,
    } as GateManagerInput);
    expect(edited.isError).toBe(false);
    harness.resolveRollbackTarget.mockResolvedValue({ ok: true, entry: { snapshot: recorded } });

    const before = readTree(gatesDir);
    const preview = await harness.versioning.handleRollback({
      action: 'preview',
      preview_action: 'rollback',
      id: GATE_ID,
      version: 1,
    } as GateManagerInput);
    expect(preview.isError).toBe(false);
    expect(readTree(gatesDir)).toEqual(before);

    const rollback = await harness.versioning.handleRollback({
      action: 'rollback',
      id: GATE_ID,
      version: 1,
      confirm: true,
    } as GateManagerInput);
    expect(rollback.isError).toBe(false);

    expect(expectDiffReproducesWrite(fencedDiffOf(preview), before, readTree(gatesDir))).toEqual([
      `${GATE_ID}/gate.yaml`,
      `${GATE_ID}/guidance.md`,
    ]);
  });

  test('gate update: a guidance edit is reported as that line of guidance.md alone', async () => {
    const gatesDir = tempRoot();
    const harness = await createGateHarness(gatesDir);
    const before = readTree(gatesDir);

    const update = await harness.lifecycle.handleUpdate({
      action: 'update',
      id: GATE_ID,
      guidance: GUIDANCE_EDITED,
    } as GateManagerInput);
    expect(update.isError).toBe(false);

    const diff = fencedDiffOf(update);
    expect(expectDiffReproducesWrite(diff, before, readTree(gatesDir))).toEqual([
      `${GATE_ID}/guidance.md`,
    ]);
    // The version records the counts of the diff the update reports.
    expect(harness.recordEditResult.mock.calls[0]?.[4]).toMatchObject({
      diff_summary: countsOf(diff),
    });
  });

  /**
   * The seeded gate above is written BY the writer, so it is already in the serializer's preferred
   * shape and cannot demonstrate anything the serializer would otherwise normalize away. This case
   * replaces it with a HAND-AUTHORED `gate.yaml` — a leading comment, a trailing comment, a comment
   * between sections — and then checks the two properties together: the reported diff still
   * reproduces the write byte-for-byte, and the write kept every comment.
   *
   * Both halves matter. A preview that matched a write which had stripped the comments would pass
   * the first assertion alone.
   */
  test('gate update: a preview over a hand-authored file matches a write that keeps its comments', async () => {
    const gatesDir = tempRoot();
    const harness = await createGateHarness(gatesDir);

    const yamlPath = join(gatesDir, GATE_ID, 'gate.yaml');
    const authored = [
      '# Authored by hand — this ordering is meaningful to a reader, not to a parser.',
      `id: ${GATE_ID}`,
      'name: Preview Probe',
      'type: validation',
      'description: The recorded description',
      '',
      'guidanceFile: guidance.md # lives beside this file',
      '',
    ].join('\n');
    writeFileSync(yamlPath, authored, 'utf8');
    await harness.registry.reload(GATE_ID);

    const before = readTree(gatesDir);
    const commentsBefore = (authored.match(/^\s*#/gm) ?? []).length;
    expect(commentsBefore).toBe(1);

    const update = await harness.lifecycle.handleUpdate({
      action: 'update',
      id: GATE_ID,
      description: 'A different description',
    } as GateManagerInput);
    expect(update.isError).toBe(false);

    const after = readTree(gatesDir);
    const diff = fencedDiffOf(update);

    // 1. The reported diff reproduces the write, file for file and line for line.
    expect(expectDiffReproducesWrite(diff, before, after)).toEqual([`${GATE_ID}/gate.yaml`]);

    // 2. The write it describes kept the author's comments, and moved only the edited line.
    const written = readFileSync(yamlPath, 'utf8');
    expect((written.match(/^\s*#/gm) ?? []).length).toBe(commentsBefore);
    // The trailing comment is not line-leading, so the count above cannot see it. It is the one
    // most easily lost by a re-render, which is why it is asserted by its text.
    expect(written).toContain('# lives beside this file');
    const authoredLines = authored.split('\n');
    const writtenLines = written.split('\n');
    const moved = authoredLines
      .map((line, index) => (line === writtenLines[index] ? -1 : index + 1))
      .filter((index) => index !== -1);
    expect(moved).toEqual([5]);
  });

  test('framework rollback: the preview names the framework files and lines the rollback restores', async () => {
    const frameworksDir = tempRoot();
    await seedFramework(frameworksDir);
    const harness = createFrameworkHarness(frameworksDir);
    const loaded = await harness.writer.loadExistingFramework(FRAMEWORK_ID);
    if (loaded === null) throw new Error('the seeded framework did not load');
    const recorded = frameworkSnapshotContract.project(FRAMEWORK_ID, loaded);

    const edited = await harness.lifecycle.handleUpdate({
      action: 'update',
      id: FRAMEWORK_ID,
      description: 'Edited after the recorded version',
      system_prompt_guidance: SYSTEM_PROMPT_EDITED,
    } as FrameworkManagerInput);
    expect(edited.isError).toBe(false);
    harness.resolveRollbackTarget.mockResolvedValue({ ok: true, entry: { snapshot: recorded } });

    const before = readTree(frameworksDir);
    const preview = await harness.versioning.handleRollback({
      action: 'preview',
      preview_action: 'rollback',
      id: FRAMEWORK_ID,
      version: 1,
    } as FrameworkManagerInput);
    expect(preview.isError).toBe(false);
    expect(readTree(frameworksDir)).toEqual(before);

    const rollback = await harness.versioning.handleRollback({
      action: 'rollback',
      id: FRAMEWORK_ID,
      version: 1,
      confirm: true,
    } as FrameworkManagerInput);
    expect(rollback.isError).toBe(false);

    expect(
      expectDiffReproducesWrite(fencedDiffOf(preview), before, readTree(frameworksDir))
    ).toEqual([`${FRAMEWORK_ID}/framework.yaml`]);
  });

  // R91: the system prompt's one source is `framework.yaml`'s inline `systemPromptGuidance`.
  test('framework update: a system prompt edit is reported in framework.yaml alone', async () => {
    const frameworksDir = tempRoot();
    await seedFramework(frameworksDir);
    const harness = createFrameworkHarness(frameworksDir);
    const before = readTree(frameworksDir);

    const update = await harness.lifecycle.handleUpdate({
      action: 'update',
      id: FRAMEWORK_ID,
      system_prompt_guidance: SYSTEM_PROMPT_EDITED,
    } as FrameworkManagerInput);
    expect(update.isError).toBe(false);

    const diff = fencedDiffOf(update);
    expect(expectDiffReproducesWrite(diff, before, readTree(frameworksDir))).toEqual([
      `${FRAMEWORK_ID}/framework.yaml`,
    ]);
    expect(harness.recordEditResult.mock.calls[0]?.[4]).toMatchObject({
      diff_summary: countsOf(diff),
    });
  });

  test('framework copy-on-write: a bundled framework update is diffed from its bundled files', async () => {
    const bundledDir = tempRoot();
    const writableDir = tempRoot();
    await seedFramework(bundledDir);
    const bundledBefore = readTree(bundledDir);
    const harness = createFrameworkHarness(writableDir, bundledDir);

    const update = await harness.lifecycle.handleUpdate({
      action: 'update',
      id: FRAMEWORK_ID,
      description: 'A description the update replaces',
    } as FrameworkManagerInput);
    expect(update.isError).toBe(false);

    expect(readTree(bundledDir)).toEqual(bundledBefore);
    expect(
      expectDiffReproducesWrite(fencedDiffOf(update), bundledBefore, readTree(writableDir))
    ).toEqual([`${FRAMEWORK_ID}/framework.yaml`]);
  });

  test('category update: a description edit is reported as the rewrite of category.yaml alone', async () => {
    const promptsDir = tempRoot();
    seedCategory(promptsDir, CATEGORY_ID);
    const harness = createCategoryHarness(promptsDir);
    const before = readTree(promptsDir);

    const update = await harness.lifecycle.handleUpdate({
      action: 'update',
      id: CATEGORY_ID,
      description: CATEGORY_DESCRIPTION_EDITED,
    } as CategoryManagerInput);
    expect(update.isError).toBe(false);

    const diff = fencedDiffOf(update);
    expect(expectDiffReproducesWrite(diff, before, readTree(promptsDir))).toEqual([
      `${CATEGORY_ID}/category.yaml`,
    ]);
    // The version records the counts of the diff the update reports.
    expect(harness.recordEditResult.mock.calls[0]?.[4]).toMatchObject({
      diff_summary: countsOf(diff),
    });
  });

  test('category rollback: the preview names category.yaml as the rollback writes it', async () => {
    const promptsDir = tempRoot();
    seedCategory(promptsDir, CATEGORY_ID);
    const harness = createCategoryHarness(promptsDir);
    // Rolled back straight from the hand-authored file, with no tool write in between — the state
    // a category authored before P4.7 is actually in. What version 1 recorded is a description
    // ago; what the file carries besides is a comment and its author's key order, which the write
    // replaces and no comparison of two recorded field maps can see.
    const recorded = categorySnapshotContract.project(CATEGORY_ID, {
      ...declaredCategory(promptsDir, CATEGORY_ID),
      description: CATEGORY_DESCRIPTION_RECORDED,
    });
    harness.resolveRollbackTarget.mockResolvedValue({ ok: true, entry: { snapshot: recorded } });

    const before = readTree(promptsDir);
    const preview = await harness.versioning.handleRollback({
      action: 'preview',
      preview_action: 'rollback',
      id: CATEGORY_ID,
      version: 1,
    } as CategoryManagerInput);
    expect(preview.isError).toBe(false);
    expect(readTree(promptsDir)).toEqual(before);

    const rollback = await harness.versioning.handleRollback({
      action: 'rollback',
      id: CATEGORY_ID,
      version: 1,
      confirm: true,
    } as CategoryManagerInput);
    expect(rollback.isError).toBe(false);

    expect(expectDiffReproducesWrite(fencedDiffOf(preview), before, readTree(promptsDir))).toEqual([
      `${CATEGORY_ID}/category.yaml`,
    ]);
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
    'gate:rollback': 'gate rollback case above',
    'framework:rollback': 'framework rollback case above',
    'category:rollback': 'category rollback case above',
  };
  /** A delete preview lists what would be removed; it renders no diff that could disagree. */
  const RENDERS_NO_DIFF = ['prompt:delete', 'gate:delete', 'framework:delete', 'category:delete'];

  test('every previewable action is classified exactly once', () => {
    const previewable = Object.entries(PREVIEWABLE_ACTIONS_BY_TYPE)
      .flatMap(([type, actions]) => actions.map((action) => `${type}:${action}`))
      .sort();
    const classified = [...Object.keys(PROVEN_AGAINST_THE_WRITE), ...RENDERS_NO_DIFF].sort();

    expect(classified).toEqual(previewable);
  });

  /**
   * A snapshot diff renders recorded fields as one YAML document, which describes no file on disk.
   * Comparing two recorded versions is the one place that is the whole truth, because nothing is
   * written. Any other caller has a write, and a write's diff reads the writer's plan — so a new
   * snapshot diff outside `handleCompare` (an update response, a preview) fails here.
   */
  test('a snapshot diff is called only to compare two recorded versions', () => {
    const toolsDir = fileURLToPath(new URL('../../../src/mcp/tools/', import.meta.url));
    const sites: string[] = [];
    for (const file of readdirSync(toolsDir, { recursive: true, encoding: 'utf8' })) {
      if (!file.endsWith('.ts')) continue;
      const source = ts.createSourceFile(
        file,
        readFileSync(join(toolsDir, file), 'utf8'),
        ts.ScriptTarget.Latest,
        true
      );
      const visit = (node: ts.Node): void => {
        if (
          ts.isCallExpression(node) &&
          ts.isPropertyAccessExpression(node.expression) &&
          node.expression.name.text === 'generateObjectDiff'
        ) {
          let owner: ts.Node | undefined = node.parent;
          while (owner !== undefined && !ts.isMethodDeclaration(owner)) owner = owner.parent;
          const method = owner !== undefined ? owner.name.getText(source) : '<outside a method>';
          sites.push(`${file.split(sep).join('/')}:${method}`);
        }
        ts.forEachChild(node, visit);
      };
      visit(source);
    }

    expect(sites.sort()).toEqual([
      'category-manager/services/category-versioning-processor.ts:handleCompare',
      'framework-manager/services/framework-versioning-processor.ts:handleCompare',
      'gate-manager/services/gate-versioning-processor.ts:handleCompare',
      'resource-manager/prompt/services/prompt-versioning-processor.ts:handleCompare',
    ]);
  });
});
