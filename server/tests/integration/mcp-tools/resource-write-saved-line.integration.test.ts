/**
 * Every `resource_manager` create and update reply ends with `saved: <absolute path>`, a file the
 * write produced (`user-message.md`, `guidance.md` or a framework companion file when an update
 * wrote only that), and a delete reply names no saved file (ruling R3j). Each step checks that the
 * named file holds what that call wrote, and `withSavedLine` refuses a path its writer did not
 * report writing. An update that changed no file ends with `nothing written: the request changed
 * no file` instead (ruling R3w).
 *
 * Classification: integration. Real lifecycle processors over the real `FileOperations`,
 * `GateFileWriter`, `FrameworkFileWriter` and `CategoryFileWriter` writing into a temp directory,
 * so the path the line names is checked against the disk, not against what a stub returned. The
 * registries and the version seam are doubles: they decide nothing about where a file lands.
 */

import { afterEach, describe, expect, jest, test } from '@jest/globals';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { CategoryFileWriter } from '../../../src/mcp/tools/category-manager/services/category-file-writer.js';
import { CategoryLifecycleProcessor } from '../../../src/mcp/tools/category-manager/services/category-lifecycle-processor.js';
import { FrameworkFileWriter } from '../../../src/mcp/tools/framework-manager/services/framework-file-writer.js';
import { FrameworkLifecycleProcessor } from '../../../src/mcp/tools/framework-manager/services/framework-lifecycle-processor.js';
import { GateFileWriter } from '../../../src/mcp/tools/gate-manager/services/gate-file-writer.js';
import { GateLifecycleProcessor } from '../../../src/mcp/tools/gate-manager/services/gate-lifecycle-processor.js';
import { ComparisonEngine } from '../../../src/mcp/tools/resource-manager/prompt/analysis/comparison-engine.js';
import { GateAnalyzer } from '../../../src/mcp/tools/resource-manager/prompt/analysis/gate-analyzer.js';
import { ObjectDiffGenerator } from '../../../src/mcp/tools/resource-manager/prompt/analysis/object-diff-generator.js';
import { PromptAnalyzer } from '../../../src/mcp/tools/resource-manager/prompt/analysis/prompt-analyzer.js';
import { FileOperations } from '../../../src/mcp/tools/resource-manager/prompt/operations/file-operations.js';
import { PromptLifecycleProcessor } from '../../../src/mcp/tools/resource-manager/prompt/services/prompt-lifecycle-processor.js';
import {
  NOTHING_WRITTEN_LINE,
  withSavedLine,
  withWriteOutcome,
} from '../../../src/mcp/tools/shared/saved-line.js';
import { PromptConverter } from '../../../src/modules/prompts/converter.js';
import { PromptLoader } from '../../../src/modules/prompts/loader.js';
import { EMPTY_QUARANTINE_VIEW } from '../../../src/shared/utils/resource-quarantine.js';
import { parseYamlOrThrow } from '../../../src/shared/utils/yaml/yaml-parser.js';

import type { CategoryResourceContext } from '../../../src/mcp/tools/category-manager/core/context.js';
import type { CategoryManagerInput } from '../../../src/mcp/tools/category-manager/core/types.js';
import type { FrameworkResourceContext } from '../../../src/mcp/tools/framework-manager/core/context.js';
import type { FrameworkManagerInput } from '../../../src/mcp/tools/framework-manager/core/types.js';
import type { FrameworkDraftValidator } from '../../../src/mcp/tools/framework-manager/services/framework-draft-validator.js';
import type { GateResourceContext } from '../../../src/mcp/tools/gate-manager/core/context.js';
import type { GateManagerInput } from '../../../src/mcp/tools/gate-manager/core/types.js';
import type { PromptResourceContext } from '../../../src/mcp/tools/resource-manager/prompt/core/context.js';
import type { ConfigManager, Logger, ToolResponse } from '../../../src/shared/types/index.js';

const createLogger = (): Logger =>
  ({ info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() }) as unknown as Logger;

/** The version seam every processor reaches; its rows are not under test. */
const versionSeam = (): Record<string, unknown> => ({
  isAutoVersionEnabled: () => true,
  saveVersion: jest.fn(async () => ({ version: 1, recorded: true, success: true })),
  recordEditResult: jest.fn(async () => ({ version: 2, recorded: true, success: true })),
  loadHistory: jest.fn(async () => ({ current_version: 1 })),
  deleteHistory: jest.fn(async () => 0),
});

const textOf = (response: ToolResponse): string =>
  response.content.map((part) => part.text).join('\n');

/** The reply's last line, which for a landed write must be `saved: <path>`. */
const lastLine = (response: ToolResponse): string => textOf(response).trimEnd().split('\n').at(-1)!;

/**
 * The reply names `expectedPath`, and that file holds `writtenText`, a value only the call under
 * test supplied — so the named file is one this call wrote, not merely one that exists.
 */
function expectSavedLine(response: ToolResponse, expectedPath: string, writtenText: string): void {
  expect(lastLine(response)).toBe(`saved: ${expectedPath}`);
  expect(textOf(response).match(/^saved: /gm)).toHaveLength(1);
  expect(existsSync(expectedPath)).toBe(true);
  expect(readFileSync(expectedPath, 'utf8')).toContain(writtenText);
}

/** Every file under `dir` with its mtime, so a call that wrote nothing leaves the map unchanged. */
function mtimesUnder(dir: string): Record<string, number> {
  return Object.fromEntries(
    readdirSync(dir, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile())
      .map((entry) => {
        const file = join(entry.parentPath, entry.name);
        return [file, statSync(file).mtimeMs];
      })
  );
}

/**
 * An update that changed no file answers success with the nothing-written line last and no
 * `saved:` line (ruling R3w); no file under `dir` changed; and the version step was handed a
 * produced state equal to the prior one, which `VersionHistoryService` records as a match, not a
 * new row (`unchanged-write-no-version.integration.test.ts`).
 */
async function expectNothingWritten(
  call: () => Promise<ToolResponse>,
  dir: string,
  recordEditResult: jest.Mock
): Promise<void> {
  const before = mtimesUnder(dir);
  const response = await call();
  expect(response.isError).not.toBe(true);
  expect(lastLine(response)).toBe(NOTHING_WRITTEN_LINE);
  expect(textOf(response)).not.toMatch(/^saved: /m);
  expect(response.structuredContent?.['saved']).toBeUndefined();
  expect(mtimesUnder(dir)).toEqual(before);
  const [, , prior, produced] = recordEditResult.mock.calls.at(-1) as unknown[];
  expect(produced).toEqual(prior);
}

function expectNoSavedLine(response: ToolResponse): void {
  expect(response.isError).not.toBe(true);
  expect(textOf(response)).not.toMatch(/^saved: /m);
}

describe('a create or update reply ends with the file it saved', () => {
  const roots: string[] = [];
  const tempRoot = (): string => {
    const dir = mkdtempSync(join(tmpdir(), 'cpm-saved-line-'));
    roots.push(dir);
    return dir;
  };

  afterEach(() => {
    for (const dir of roots.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  test('prompt: create and update end with saved: <the file written>, in structuredContent too', async () => {
    const promptsDir = join(tempRoot(), 'prompts');
    mkdirSync(promptsDir, { recursive: true });
    const logger = createLogger();
    let convertedPrompts: Record<string, unknown>[] = [];
    const reload = async (): Promise<void> => {
      const loader = new PromptLoader(logger);
      const { promptsData } = await loader.loadFromDirectories(promptsDir);
      const converted = await new PromptConverter(logger, loader).convertMarkdownPromptsToJson(
        promptsData,
        promptsDir
      );
      convertedPrompts = converted.map((prompt) => ({ ...prompt, sourceRoot: promptsDir }));
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
      onRefresh: jest.fn(reload),
      onRestart: jest.fn(async () => {}),
    };
    const versions = versionSeam();
    const lifecycle = new PromptLifecycleProcessor({
      dependencies,
      promptAnalyzer: new PromptAnalyzer(),
      gateAnalyzer: new GateAnalyzer(dependencies as never),
      fileOperations: new FileOperations({ logger, configManager }),
      getData: () => ({ convertedPrompts }),
      versionHistoryService: versions,
      textDiffService: new ObjectDiffGenerator(),
      comparisonEngine: new ComparisonEngine(logger),
    } as unknown as PromptResourceContext);
    const yamlPath = join(promptsDir, 'probe', 'saved_probe', 'prompt.yaml');

    const created = await lifecycle.createPrompt({
      id: 'saved_probe',
      name: 'Saved Probe',
      category: 'probe',
      description: 'Says where it landed',
      user_message_template: 'hello {{x}}',
    } as never);
    expectSavedLine(created, yamlPath, 'Says where it landed');
    expect(created.structuredContent?.['saved']).toBe(yamlPath);

    const updated = await lifecycle.updatePrompt({
      id: 'saved_probe',
      description: 'Still says where it landed',
    });
    expectSavedLine(updated, yamlPath, 'Still says where it landed');
    expect(updated.structuredContent?.['saved']).toBe(yamlPath);

    // A template-only update writes user-message.md alone; prompt.yaml keeps its bytes and its
    // mtime, so a line naming it would point the caller at a file this call never opened.
    const userMessagePath = join(promptsDir, 'probe', 'saved_probe', 'user-message.md');
    const yamlBefore = statSync(yamlPath).mtimeMs;
    const templateOnly = await lifecycle.updatePrompt({
      id: 'saved_probe',
      user_message_template: 'goodbye {{x}}',
    });
    expectSavedLine(templateOnly, userMessagePath, 'goodbye {{x}}');
    expect(templateOnly.structuredContent?.['saved']).toBe(userMessagePath);
    expect(statSync(yamlPath).mtimeMs).toBe(yamlBefore);

    await expectNothingWritten(
      () => lifecycle.updatePrompt({ id: 'saved_probe' }),
      promptsDir,
      versions['recordEditResult'] as jest.Mock
    );
  });

  test('gate: create and update end with saved: <the file written>; delete names no saved file', async () => {
    const gatesDir = join(tempRoot(), 'gates');
    const logger = createLogger();
    const configManager = {
      getGatesDirectory: () => gatesDir,
      getBundledResourceDirectory: () => undefined,
    } as unknown as ConfigManager;
    const loaded = new Map<string, Record<string, unknown>>();
    const registry = {
      has: (id: string) => loaded.has(id),
      get: (id: string) => loaded.get(id),
      unregister: (id: string) => loaded.delete(id),
      getQuarantine: () => EMPTY_QUARANTINE_VIEW,
      reload: (id: string) => {
        const dir = join(gatesDir, id);
        const definition = parseYamlOrThrow<Record<string, unknown>>(
          readFileSync(join(dir, 'gate.yaml'), 'utf8')
        );
        const guidance = readFileSync(join(dir, 'guidance.md'), 'utf8');
        loaded.set(id, {
          gateId: id,
          name: String(definition['name']),
          type: String(definition['type']),
          description: String(definition['description']),
          getGuidance: () => guidance,
          getDefinition: () => definition,
        });
        return Promise.resolve(true);
      },
    };
    const versions = versionSeam();
    const lifecycle = new GateLifecycleProcessor({
      logger,
      gateManager: registry,
      configManager,
      textDiffService: new ObjectDiffGenerator(),
      versionHistoryService: versions,
      gateFileService: new GateFileWriter({ logger, configManager }),
      onRefresh: jest.fn(async () => {}),
    } as unknown as GateResourceContext);
    const yamlPath = join(gatesDir, 'saved-gate', 'gate.yaml');

    const created = await lifecycle.handleCreate({
      action: 'create',
      id: 'saved-gate',
      name: 'Saved Gate',
      description: 'Says where it landed',
      guidance: 'Check it.',
    } as GateManagerInput);
    expectSavedLine(created, yamlPath, 'Says where it landed');

    const updated = await lifecycle.handleUpdate({
      action: 'update',
      id: 'saved-gate',
      description: 'Still says where it landed',
    } as GateManagerInput);
    expectSavedLine(updated, yamlPath, 'Still says where it landed');

    // A guidance-only update leaves gate.yaml untouched, so the line names the file it did write.
    const guidanceOnly = await lifecycle.handleUpdate({
      action: 'update',
      id: 'saved-gate',
      guidance: 'Check it twice.',
    } as GateManagerInput);
    expectSavedLine(guidanceOnly, join(gatesDir, 'saved-gate', 'guidance.md'), 'Check it twice.');

    await expectNothingWritten(
      () => lifecycle.handleUpdate({ action: 'update', id: 'saved-gate' } as GateManagerInput),
      gatesDir,
      versions['recordEditResult'] as jest.Mock
    );

    const deleted = await lifecycle.handleDelete({
      action: 'delete',
      id: 'saved-gate',
      confirm: true,
    } as GateManagerInput);
    expectNoSavedLine(deleted);
  });

  test('framework: create and update end with saved: <the file written>; delete names no saved file', async () => {
    const frameworksDir = join(tempRoot(), 'frameworks');
    const logger = createLogger();
    const configManager = {
      getFrameworksDirectory: () => frameworksDir,
      getBundledResourceDirectory: () => undefined,
      getFrameworksConfig: () => ({ defaultFramework: 'some-other-framework' }),
    } as unknown as ConfigManager;
    const writer = new FrameworkFileWriter({ logger, configManager });
    const registered = new Set<string>();
    const registry = {
      hasGuide: (id: string) => registered.has(id),
      getRuntimeLoader: () => ({ clearCache: () => undefined }),
      loadAndRegisterById: (id: string) => {
        registered.add(id);
        return Promise.resolve(true);
      },
      unregisterGuide: (id: string) => registered.delete(id),
    };
    const validator = {
      validate: () => ({ valid: true }),
      formatSuccess: (id: string) => `✅ Framework '${id}' created successfully`,
    } as unknown as FrameworkDraftValidator;
    const versions = versionSeam();
    const lifecycle = new FrameworkLifecycleProcessor(
      {
        logger,
        frameworkManager: {
          getFrameworkRegistry: () => registry,
          getFramework: (id: string) => (registered.has(id) ? { id } : undefined),
          getQuarantine: () => EMPTY_QUARANTINE_VIEW,
          registerFramework: () => Promise.resolve(true),
          removeFramework: (id: string) => Promise.resolve(registered.delete(id)),
          isShippedFramework: () => false,
        },
        configManager,
        fileService: writer,
        textDiffService: new ObjectDiffGenerator(),
        versionHistoryService: versions,
        onRefresh: jest.fn(async () => {}),
      } as unknown as FrameworkResourceContext,
      validator
    );
    const yamlPath = join(frameworksDir, 'saved-fw', 'framework.yaml');

    const created = await lifecycle.handleCreate({
      action: 'create',
      id: 'saved-fw',
      name: 'Saved Framework',
      description: 'Says where it landed',
      system_prompt_guidance: 'Think.',
      judge_prompt: 'Judge it.\n',
    } as FrameworkManagerInput);
    expectSavedLine(created, yamlPath, 'Says where it landed');

    const updated = await lifecycle.handleUpdate({
      action: 'update',
      id: 'saved-fw',
      description: 'Still says where it landed',
    } as FrameworkManagerInput);
    expectSavedLine(updated, yamlPath, 'Still says where it landed');

    // A judge-prompt-only update leaves framework.yaml untouched, so the line names the file it wrote.
    const judgeOnly = await lifecycle.handleUpdate({
      action: 'update',
      id: 'saved-fw',
      judge_prompt: 'Judge it again.\n',
    } as FrameworkManagerInput);
    expectSavedLine(
      judgeOnly,
      join(frameworksDir, 'saved-fw', 'judge-prompt.md'),
      'Judge it again.'
    );

    // Repeating the current judge prompt changes no file: the writer's merge drops it.
    await expectNothingWritten(
      () =>
        lifecycle.handleUpdate({
          action: 'update',
          id: 'saved-fw',
          judge_prompt: 'Judge it again.\n',
        } as FrameworkManagerInput),
      frameworksDir,
      versions['recordEditResult'] as jest.Mock
    );

    const deleted = await lifecycle.handleDelete({
      action: 'delete',
      id: 'saved-fw',
      confirm: true,
    } as FrameworkManagerInput);
    expectNoSavedLine(deleted);
  });

  test('category: create and update end with saved: <category.yaml>; delete names no saved file', async () => {
    const promptsDir = join(tempRoot(), 'prompts');
    mkdirSync(promptsDir, { recursive: true });
    const logger = createLogger();
    const configManager = {
      getResolvedPromptsDirectory: () => promptsDir,
      getBundledResourceDirectory: () => undefined,
    } as unknown as ConfigManager;
    const versions = versionSeam();
    const lifecycle = new CategoryLifecycleProcessor({
      logger,
      configManager,
      textDiffService: new ObjectDiffGenerator(),
      versionHistoryService: versions,
      categoryFileService: new CategoryFileWriter({ logger, configManager }),
      onRefresh: jest.fn(async () => {}),
    } as unknown as CategoryResourceContext);
    const yamlPath = join(promptsDir, 'saved-cat', 'category.yaml');

    const created = await lifecycle.handleCreate({
      action: 'create',
      id: 'saved-cat',
      name: 'Saved Category',
      description: 'Says where it landed',
    } as CategoryManagerInput);
    expectSavedLine(created, yamlPath, 'Says where it landed');

    const updated = await lifecycle.handleUpdate({
      action: 'update',
      id: 'saved-cat',
      description: 'Still says where it landed',
    } as CategoryManagerInput);
    expectSavedLine(updated, yamlPath, 'Still says where it landed');

    const deleted = await lifecycle.handleDelete({
      action: 'delete',
      id: 'saved-cat',
      confirm: true,
    } as CategoryManagerInput);
    expectNoSavedLine(deleted);
  });

  test('withSavedLine refuses a path its writer did not report writing, and a write of no file; withWriteOutcome answers an empty write', () => {
    const reply: ToolResponse = { content: [{ type: 'text', text: 'updated' }], isError: false };

    expect(() => withSavedLine(reply, '/r/p/prompt.yaml', ['/r/p/user-message.md'])).toThrow(
      'A resource write names /r/p/prompt.yaml as saved, but that file is not among the files ' +
        'it wrote: /r/p/user-message.md'
    );
    expect(() => withSavedLine(reply, '/r/p/prompt.yaml', [])).toThrow(
      /no file written .*answers through withWriteOutcome/
    );
    expect(lastLine(withSavedLine(reply, '/r/p/user-message.md', ['/r/p/user-message.md']))).toBe(
      'saved: /r/p/user-message.md'
    );

    expect(lastLine(withWriteOutcome(reply, { savedPath: undefined, writtenFiles: [] }))).toBe(
      NOTHING_WRITTEN_LINE
    );
    // A writer that reports no list at all is not a no-op: it did not say what it wrote.
    expect(() => withWriteOutcome(reply, { savedPath: '/r/p/prompt.yaml' })).toThrow(
      /no file written/
    );
  });
});
