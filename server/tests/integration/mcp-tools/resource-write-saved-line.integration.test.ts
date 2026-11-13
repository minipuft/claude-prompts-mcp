/**
 * Every `resource_manager` create and update reply ends with `saved: <absolute path>`, the primary
 * file the write produced, and a delete reply names no saved file (ruling R3j).
 *
 * Classification: integration. Real lifecycle processors over the real `FileOperations`,
 * `GateFileWriter`, `FrameworkFileWriter` and `CategoryFileWriter` writing into a temp directory,
 * so the path the line names is checked against the disk, not against what a stub returned. The
 * registries and the version seam are doubles: they decide nothing about where a file lands.
 */

import { afterEach, describe, expect, jest, test } from '@jest/globals';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
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

function expectSavedLine(response: ToolResponse, expectedPath: string): void {
  expect(lastLine(response)).toBe(`saved: ${expectedPath}`);
  expect(textOf(response).match(/^saved: /gm)).toHaveLength(1);
  expect(existsSync(expectedPath)).toBe(true);
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

  test('prompt: create and update end with saved: <prompt.yaml>, in structuredContent too', async () => {
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
    const lifecycle = new PromptLifecycleProcessor({
      dependencies,
      promptAnalyzer: new PromptAnalyzer(),
      gateAnalyzer: new GateAnalyzer(dependencies as never),
      fileOperations: new FileOperations({ logger, configManager }),
      getData: () => ({ convertedPrompts }),
      versionHistoryService: versionSeam(),
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
    expectSavedLine(created, yamlPath);
    expect(created.structuredContent?.['saved']).toBe(yamlPath);

    const updated = await lifecycle.updatePrompt({
      id: 'saved_probe',
      description: 'Still says where it landed',
    });
    expectSavedLine(updated, yamlPath);
    expect(updated.structuredContent?.['saved']).toBe(yamlPath);
  });

  test('gate: create and update end with saved: <gate.yaml>; delete names no saved file', async () => {
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
    const lifecycle = new GateLifecycleProcessor({
      logger,
      gateManager: registry,
      configManager,
      textDiffService: new ObjectDiffGenerator(),
      versionHistoryService: versionSeam(),
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
    expectSavedLine(created, yamlPath);

    const updated = await lifecycle.handleUpdate({
      action: 'update',
      id: 'saved-gate',
      guidance: 'Check it twice.',
    } as GateManagerInput);
    expectSavedLine(updated, yamlPath);

    const deleted = await lifecycle.handleDelete({
      action: 'delete',
      id: 'saved-gate',
      confirm: true,
    } as GateManagerInput);
    expectNoSavedLine(deleted);
  });

  test('framework: create and update end with saved: <framework.yaml>; delete names no saved file', async () => {
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
        versionHistoryService: versionSeam(),
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
    } as FrameworkManagerInput);
    expectSavedLine(created, yamlPath);

    const updated = await lifecycle.handleUpdate({
      action: 'update',
      id: 'saved-fw',
      description: 'Still says where it landed',
    } as FrameworkManagerInput);
    expectSavedLine(updated, yamlPath);

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
    const lifecycle = new CategoryLifecycleProcessor({
      logger,
      configManager,
      textDiffService: new ObjectDiffGenerator(),
      versionHistoryService: versionSeam(),
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
    expectSavedLine(created, yamlPath);

    const updated = await lifecycle.handleUpdate({
      action: 'update',
      id: 'saved-cat',
      description: 'Still says where it landed',
    } as CategoryManagerInput);
    expectSavedLine(updated, yamlPath);

    const deleted = await lifecycle.handleDelete({
      action: 'delete',
      id: 'saved-cat',
      confirm: true,
    } as CategoryManagerInput);
    expectNoSavedLine(deleted);
  });
});
