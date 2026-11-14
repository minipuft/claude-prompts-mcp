// @lifecycle canonical - A rollback rebuilt from a snapshot writes where the resource is served from.
/**
 * A rollback to a version that recorded no files (a bridge row, a row from before schema v29) is
 * rebuilt from the version's fields by the resource's own writer. That writer used to land in the
 * profile's write root whatever the resource's location, so rolling back a prompt or gate served
 * from a `paths.resources` folder left the listed file unchanged and created a second copy under
 * `<workspace>/resources/`, which outranks the listed folder and then served the restored state
 * from the wrong place. A rebuilt restore now writes where the resource is served from, as a
 * byte-exact restore already did; a bundled resource is still copied into the write root.
 *
 * Every rollback reply ends with `saved: <the file it wrote>` (R3j), so the reply names where the
 * restored bytes landed; a preview names none. A framework served from a listed folder is found by
 * `update` and `inspect` too, which read where the loader stamped it as served rather than only the
 * write root and the bundle.
 *
 * Driven through the real `ConfigLoader` and `PathResolver`, composed as `runtime/context.ts`
 * composes them, reading a real `config.jsonc` list; the real prompt and gate loaders over the
 * roots they resolve; the real writers and versioning processors; and a real
 * `VersionHistoryService` over SQLite.
 *
 * Classification: Integration (real resolver, real loaders, real files, real SQLite).
 */

import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  getDefaultRuntimeLoader,
  resetDefaultRuntimeLoader,
} from '../../../src/engine/frameworks/definitions/runtime-framework-loader.js';
import { createFrameworkManager } from '../../../src/engine/frameworks/framework-manager.js';
import { createGateManager } from '../../../src/engine/gates/gate-manager.js';
import { ConfigLoader } from '../../../src/infra/config/index.js';
import { SqliteEngine } from '../../../src/infra/database/index.js';
import { CategoryFileWriter } from '../../../src/mcp/tools/category-manager/services/category-file-writer.js';
import { categorySnapshotContract } from '../../../src/mcp/tools/category-manager/services/category-snapshot-contract.js';
import { CategoryVersioningProcessor } from '../../../src/mcp/tools/category-manager/services/category-versioning-processor.js';
import { FrameworkDiscoveryProcessor } from '../../../src/mcp/tools/framework-manager/services/framework-discovery-processor.js';
import { FrameworkDraftValidator } from '../../../src/mcp/tools/framework-manager/services/framework-draft-validator.js';
import { FrameworkFileWriter } from '../../../src/mcp/tools/framework-manager/services/framework-file-writer.js';
import { FrameworkLifecycleProcessor } from '../../../src/mcp/tools/framework-manager/services/framework-lifecycle-processor.js';
import { frameworkSnapshotContract } from '../../../src/mcp/tools/framework-manager/services/framework-snapshot-contract.js';
import { FrameworkVersioningProcessor } from '../../../src/mcp/tools/framework-manager/services/framework-versioning-processor.js';
import { GateFileWriter } from '../../../src/mcp/tools/gate-manager/services/gate-file-writer.js';
import { gateSnapshotContract } from '../../../src/mcp/tools/gate-manager/services/gate-snapshot-contract.js';
import { GateVersioningProcessor } from '../../../src/mcp/tools/gate-manager/services/gate-versioning-processor.js';
import { ObjectDiffGenerator } from '../../../src/mcp/tools/resource-manager/prompt/analysis/object-diff-generator.js';
import { FileOperations } from '../../../src/mcp/tools/resource-manager/prompt/operations/file-operations.js';
import { PromptVersioningProcessor } from '../../../src/mcp/tools/resource-manager/prompt/services/prompt-versioning-processor.js';
import { PromptAssetManager } from '../../../src/modules/prompts/index.js';
import { reloadPromptData } from '../../../src/modules/prompts/prompt-refresh-service.js';
import { ConversationStore } from '../../../src/modules/text-refs/conversation.js';
import { TextReferenceStore } from '../../../src/modules/text-refs/index.js';
import { rebuildRoot } from '../../../src/modules/versioning/byte-restore.js';
import { canonicalPromptSnapshot } from '../../../src/modules/versioning/projections/prompt-snapshot.js';
import { VersionHistoryService } from '../../../src/modules/versioning/version-history-service.js';
import { PathResolver } from '../../../src/runtime/paths.js';
import { parseYamlOrThrow } from '../../../src/shared/utils/yaml/yaml-parser.js';
import {
  createResourceFileLocator,
  resolveResourceRoots,
} from '../../../src/runtime/resource-roots.js';
import { withResourceLocations } from '../../helpers/resource-locations.js';
import { testScratchPath } from '../../helpers/scratch-path.js';

import type { ConvertedPrompt } from '../../../src/engine/execution/types.js';
import type { FrameworkManager } from '../../../src/engine/frameworks/framework-manager.js';
import type { GateManager } from '../../../src/engine/gates/gate-manager.js';
import type { CategoryResourceContext } from '../../../src/mcp/tools/category-manager/core/context.js';
import type { FrameworkResourceContext } from '../../../src/mcp/tools/framework-manager/core/context.js';
import type { GateResourceContext } from '../../../src/mcp/tools/gate-manager/core/context.js';
import type { PromptResourceContext } from '../../../src/mcp/tools/resource-manager/prompt/core/context.js';
import type { ConfigManager, Logger, ToolResponse } from '../../../src/shared/types/index.js';
import type { ResourceLocationScope } from '../../helpers/resource-locations.js';

const logger: Logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

const PROMPT_ID = 'listed_prompt';
const GATE_ID = 'listed-gate';
const CATEGORY = 'shelf';

const textOf = (response: ToolResponse): string =>
  response.content.map((block) => ('text' in block ? block.text : '')).join('\n');

/** The reply's last line: `saved: <path>` for a rollback that wrote a file. */
const lastLine = (response: ToolResponse): string =>
  textOf(response).trimEnd().split('\n').at(-1) ?? '';

/** The package's own frameworks, which the registry refuses to start without. */
const SHIPPED_FRAMEWORKS = path.resolve(
  path.dirname(new URL(import.meta.url).pathname),
  '..',
  '..',
  '..',
  'resources',
  'frameworks'
);

/** Every `prompt.yaml` or `gate.yaml` under `dir`, relative to it; `[]` when `dir` is absent. */
async function entryFilesUnder(dir: string): Promise<string[]> {
  if (!existsSync(dir)) return [];
  const { readdir } = await import('node:fs/promises');
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && /^(prompt|gate)\.yaml$/.test(entry.name))
    .map((entry) => path.relative(dir, path.join(entry.parentPath, entry.name)))
    .sort();
}

async function writePromptAt(promptsRoot: string, body: string): Promise<string> {
  const dir = path.join(promptsRoot, CATEGORY, PROMPT_ID);
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, 'prompt.yaml'),
    [
      `id: ${PROMPT_ID}`,
      'name: Listed Prompt',
      `category: ${CATEGORY}`,
      'description: a prompt from a listed folder',
      'userMessageTemplateFile: user-message.md',
      '',
    ].join('\n')
  );
  const userMessage = path.join(dir, 'user-message.md');
  await writeFile(userMessage, body);
  return userMessage;
}

async function writeGateAt(gatesRoot: string, description: string): Promise<string> {
  const file = path.join(gatesRoot, GATE_ID, 'gate.yaml');
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(
    file,
    [
      `id: ${GATE_ID}`,
      'name: Listed Gate',
      'type: validation',
      `description: ${description}`,
      'guidance: be careful',
      '',
    ].join('\n')
  );
  return file;
}

describe('a rollback rebuilt from a snapshot writes where the resource is served from', () => {
  let scratch: string;
  let workspace: string;
  let packageRoot: string;
  let locations: ResourceLocationScope;
  let resolver: PathResolver;
  let configManager: ConfigManager;
  let db: SqliteEngine;
  let versions: VersionHistoryService;

  /** The workspace folders a write root would create, and the listed folder's own. */
  const writeRootFor = (type: string): string => path.join(workspace, 'resources', type);
  const listedFor = (type: string): string => path.join(workspace, 'custom', type);
  const bundledFor = (type: string): string => path.join(packageRoot, 'resources', type);

  async function start(list: string[]): Promise<void> {
    locations = withResourceLocations({ workspace, list });
    resolver = new PathResolver({ cli: {}, packageRoot });
    const loader = new ConfigLoader(resolver.getConfigPath(), resolver);
    await loader.loadConfig();
    resolver.readResourceLocationsFrom(() => loader.getConfig().paths);
    configManager = loader as unknown as ConfigManager;
    db = await SqliteEngine.getInstance(logger, {
      dbPath: path.join(scratch, 'runtime-state', 'state.db'),
    });
    await db.initialize();
    versions = new VersionHistoryService({
      logger,
      configManager: {
        getVersioningConfig: () => ({ enabled: true, autoVersion: true, maxVersions: 50 }),
        getServerRoot: () => scratch,
      } as unknown as ConfigManager,
      resourceFileLocator: createResourceFileLocator(resolver),
    });
    versions.setDatabasePort(db);
  }

  beforeEach(async () => {
    scratch = testScratchPath('rebuilt-restore-location');
    workspace = path.join(scratch, 'workspace');
    packageRoot = path.join(scratch, 'package');
    await mkdir(bundledFor('prompts'), { recursive: true });
    await mkdir(bundledFor('gates'), { recursive: true });
    // The listed folder exists before the config naming it is read; the loader refuses one that
    // does not. Its `<type>/` subfolders are created by the fixtures that use them.
    await mkdir(path.join(workspace, 'custom'), { recursive: true });
  });

  afterEach(async () => {
    locations.cleanup();
    await db.shutdown();
    await rm(scratch, { recursive: true, force: true, maxRetries: 5 });
  });

  describe('prompt', () => {
    let promptManager: PromptAssetManager;
    let convertedPrompts: ConvertedPrompt[];
    let processor: PromptVersioningProcessor;

    /** What the server's refresh does: every root the resolver names, merged by precedence. */
    async function reload(): Promise<void> {
      convertedPrompts = (await reloadPromptData({ configManager, promptManager }))
        .convertedPrompts;
    }

    const served = (): ConvertedPrompt => {
      const prompt = convertedPrompts.find((entry) => entry.id === PROMPT_ID);
      if (prompt === undefined) throw new Error(`${PROMPT_ID} is not served`);
      return prompt;
    };

    async function startPrompts(list: string[]): Promise<void> {
      await start(list);
      promptManager = new PromptAssetManager(
        logger,
        new TextReferenceStore(logger),
        new ConversationStore(logger),
        configManager
      );
      convertedPrompts = [];
      processor = new PromptVersioningProcessor({
        dependencies: { logger, configManager, onRefresh: reload },
        fileOperations: new FileOperations({ logger, configManager }),
        textDiffService: new ObjectDiffGenerator(),
        versionHistoryService: versions,
        getData: () => ({ convertedPrompts }),
      } as unknown as PromptResourceContext);
    }

    /**
     * v1 is a bridge of `original` (no files recorded), v2 is `edited` with its files: what the
     * watcher writes for a hand edit of a resource with no history yet. Leaves `edited` on disk
     * and served.
     */
    async function recordBridgeThenEdit(userMessage: string, edited: string): Promise<void> {
      await reload();
      const before = canonicalPromptSnapshot(PROMPT_ID, served());
      await writeFile(userMessage, edited);
      await reload();
      const result = await versions.commitEdit(
        'prompt',
        PROMPT_ID,
        before,
        canonicalPromptSnapshot(PROMPT_ID, served()),
        { description: 'Update via filesystem' }
      );
      expect(result).toMatchObject({ bridged: true, version: 2 });
      expect((await versions.planByteRestore('prompt', PROMPT_ID, 1)).status).toBe(
        'projection-only'
      );
    }

    const rollBack = (version: number, preview = false): Promise<ToolResponse> =>
      processor.handleRollback({
        action: preview ? 'preview' : 'rollback',
        ...(preview ? { preview_action: 'rollback' } : { confirm: true }),
        id: PROMPT_ID,
        version,
      } as Parameters<PromptVersioningProcessor['handleRollback']>[0]);

    it('(a) rewrites the listed copy and creates nothing under <workspace>/resources/', async () => {
      await startPrompts(['./custom']);
      const userMessage = await writePromptAt(listedFor('prompts'), 'ORIGINAL BODY\n');
      await recordBridgeThenEdit(userMessage, 'EDITED BODY\n');
      expect(served().sourceRoot).toBe(listedFor('prompts'));
      expect(resolver.getPromptsPath()).toBe(writeRootFor('prompts'));

      const response = await rollBack(1);

      expect(response.isError).toBe(false);
      expect(textOf(response)).toContain('rolled back to version 1');
      // The reply names the listed file the rebuild wrote, not a write-root path.
      expect(lastLine(response)).toBe(
        `saved: ${path.join(listedFor('prompts'), CATEGORY, PROMPT_ID, 'prompt.yaml')}`
      );
      expect(textOf(response).match(/^saved: /gm)).toHaveLength(1);
      expect(await readFile(userMessage, 'utf8')).toContain('ORIGINAL BODY');
      expect(await entryFilesUnder(writeRootFor('prompts'))).toEqual([]);
      // The restored state is the one served, from the listed folder.
      expect(served().userMessageTemplate).toContain('ORIGINAL BODY');
      expect(served().sourceRoot).toBe(listedFor('prompts'));
    });

    it('(b) CONTROL: a byte-exact restore of the same listed prompt already writes in place', async () => {
      await startPrompts(['./custom']);
      const userMessage = await writePromptAt(listedFor('prompts'), 'ORIGINAL BODY\n');
      await recordBridgeThenEdit(userMessage, 'EDITED BODY\n');
      await writeFile(userMessage, 'A THIRD BODY\n');
      await reload();
      expect((await versions.planByteRestore('prompt', PROMPT_ID, 2)).status).toBe('ready');

      const response = await rollBack(2);

      expect(response.isError).toBe(false);
      expect(textOf(response)).toContain('byte for byte');
      // The one file the restore put back, where it put it.
      expect(lastLine(response)).toBe(`saved: ${userMessage}`);
      expect(response.structuredContent?.['saved']).toBe(userMessage);
      expect(await readFile(userMessage, 'utf8')).toBe('EDITED BODY\n');
      expect(await entryFilesUnder(writeRootFor('prompts'))).toEqual([]);
    });

    it('(c) a bundled prompt is still copied into the write root, and the bundle is not written', async () => {
      await startPrompts(['./custom', 'bundled']);
      const bundledMessage = await writePromptAt(bundledFor('prompts'), 'ORIGINAL BODY\n');
      await recordBridgeThenEdit(bundledMessage, 'EDITED BODY\n');
      expect(served().sourceRoot).toBe(bundledFor('prompts'));

      const response = await rollBack(1);

      expect(response.isError).toBe(false);
      expect(await readFile(bundledMessage, 'utf8')).toBe('EDITED BODY\n');
      expect(await entryFilesUnder(writeRootFor('prompts'))).toEqual([
        path.join(CATEGORY, PROMPT_ID, 'prompt.yaml'),
      ]);
      expect(
        await readFile(
          path.join(writeRootFor('prompts'), CATEGORY, PROMPT_ID, 'user-message.md'),
          'utf8'
        )
      ).toContain('ORIGINAL BODY');
      expect(await entryFilesUnder(listedFor('prompts'))).toEqual([]);
    });

    it('(d) the preview diffs the listed file the rollback then writes, and writes nothing itself', async () => {
      await startPrompts(['./custom']);
      const userMessage = await writePromptAt(listedFor('prompts'), 'ORIGINAL BODY\n');
      await recordBridgeThenEdit(userMessage, 'EDITED BODY\n');

      const preview = await rollBack(1, true);

      expect(preview.isError).toBe(false);
      // A preview writes nothing, so it names no saved file.
      expect(textOf(preview)).not.toMatch(/^saved: /m);
      const diff = String((preview.structuredContent as { diff?: unknown }).diff);
      // A diff against the listed file removes its current line; one against an empty write-root
      // folder would only add.
      expect(diff).toContain('-EDITED BODY');
      expect(diff).toContain('+ORIGINAL BODY');
      expect(await readFile(userMessage, 'utf8')).toBe('EDITED BODY\n');
      expect(await entryFilesUnder(writeRootFor('prompts'))).toEqual([]);

      await rollBack(1);
      expect(await readFile(userMessage, 'utf8')).toContain('ORIGINAL BODY');
      expect(await entryFilesUnder(writeRootFor('prompts'))).toEqual([]);
    });
  });

  describe('gate', () => {
    let gateManager: GateManager;
    let processor: GateVersioningProcessor;

    async function startGates(list: string[]): Promise<void> {
      await start(list);
      const roots = resolveResourceRoots(resolver, 'gates', resolver.getGatesPath());
      gateManager = await createGateManager(logger, {
        registryConfig: {
          loaderConfig: {
            ...(roots.primary !== undefined ? { gatesDir: roots.primary } : {}),
            additionalGatesDirs: [...roots.lookupDirs],
          },
        },
      });
      const ctx: GateResourceContext = {
        logger,
        gateManager,
        configManager,
        textDiffService: new ObjectDiffGenerator(),
        versionHistoryService: versions,
        gateFileService: new GateFileWriter({ logger, configManager }),
        onRefresh: async () => {},
      };
      processor = new GateVersioningProcessor(ctx);
    }

    const live = () => {
      const gate = gateManager.get(GATE_ID);
      if (gate === undefined) throw new Error(`${GATE_ID} is not registered`);
      return gate;
    };

    it('(a) rewrites the listed gate and creates nothing under <workspace>/resources/', async () => {
      await startGates(['./custom']);
      const gateFile = await writeGateAt(listedFor('gates'), 'original description');
      await gateManager.reload(GATE_ID);
      const before = gateSnapshotContract.project(GATE_ID, live());
      await writeGateAt(listedFor('gates'), 'edited description');
      await gateManager.reload(GATE_ID);
      expect(live().getDefinition().sourceRoot).toBe(listedFor('gates'));
      const recorded = await versions.commitEdit(
        'gate',
        GATE_ID,
        before,
        gateSnapshotContract.project(GATE_ID, live()),
        { description: 'Update via filesystem' }
      );
      expect(recorded).toMatchObject({ bridged: true, version: 2 });

      const response = await processor.handleRollback({
        action: 'rollback',
        id: GATE_ID,
        version: 1,
        confirm: true,
      });

      expect(response.isError).toBe(false);
      expect(lastLine(response)).toBe(`saved: ${gateFile}`);
      expect(await readFile(gateFile, 'utf8')).toContain('original description');
      expect(await entryFilesUnder(writeRootFor('gates'))).toEqual([]);
      expect(live().description).toBe('original description');
    });
  });

  describe('framework', () => {
    const FRAMEWORK_ID = 'listed_fw';
    let frameworkManager: FrameworkManager;
    let lifecycle: FrameworkLifecycleProcessor;
    let discovery: FrameworkDiscoveryProcessor;
    let processor: FrameworkVersioningProcessor;

    /** A framework with a phases file, so a write that lost the companion file is visible. */
    async function writeFrameworkAt(frameworksRoot: string, description: string): Promise<string> {
      const dir = path.join(frameworksRoot, FRAMEWORK_ID);
      await mkdir(dir, { recursive: true });
      await writeFile(
        path.join(dir, 'phases.yaml'),
        [
          'phases:',
          '  - id: listed_step',
          '    name: Listed step',
          '    description: the step this framework lists',
          '',
        ].join('\n')
      );
      const file = path.join(dir, 'framework.yaml');
      await writeFile(
        file,
        [
          `id: ${FRAMEWORK_ID}`,
          'name: Listed Framework',
          'type: LISTED',
          'version: 1.0.0',
          'enabled: true',
          `description: ${description}`,
          'systemPromptGuidance: think in listed steps',
          'phasesFile: phases.yaml',
          '',
        ].join('\n')
      );
      return file;
    }

    /**
     * The real framework manager over the roots the resolver names, configured as the composition
     * root configures it, with the real processors over the real file service.
     */
    async function startFrameworks(list: string[]): Promise<void> {
      await start(list);
      const roots = resolveResourceRoots(resolver, 'frameworks', resolver.getFrameworksPath());
      resetDefaultRuntimeLoader();
      getDefaultRuntimeLoader({
        ...(roots.primary !== undefined ? { frameworksDir: roots.primary } : {}),
        additionalFrameworksDirs: [...roots.lookupDirs],
        shippedFrameworksDir: SHIPPED_FRAMEWORKS,
      });
      frameworkManager = await createFrameworkManager(logger);
      const ctx = {
        logger,
        frameworkManager,
        configManager,
        fileService: new FrameworkFileWriter({ logger, configManager }),
        textDiffService: new ObjectDiffGenerator(),
        versionHistoryService: versions,
        onRefresh: async () => {},
      } as FrameworkResourceContext;
      const validator = new FrameworkDraftValidator();
      lifecycle = new FrameworkLifecycleProcessor(ctx, validator);
      discovery = new FrameworkDiscoveryProcessor(ctx, validator);
      processor = new FrameworkVersioningProcessor(ctx);
    }

    const live = () => {
      const framework = frameworkManager.getFramework(FRAMEWORK_ID);
      if (framework === undefined) throw new Error(`${FRAMEWORK_ID} is not registered`);
      return framework;
    };

    afterEach(() => {
      resetDefaultRuntimeLoader();
    });

    it('(a) update finds a framework served only from the listed folder and copies it whole into the write root', async () => {
      await startFrameworks(['./custom']);
      const listedFile = await writeFrameworkAt(listedFor('frameworks'), 'listed description');
      expect(await frameworkManager.registerFramework(FRAMEWORK_ID)).toBe(true);
      expect(live().sourceRoot).toBe(listedFor('frameworks'));

      const response = await lifecycle.handleUpdate({
        action: 'update',
        id: FRAMEWORK_ID,
        description: 'updated description',
      });

      expect(response.isError).toBe(false);
      const copied = path.join(writeRootFor('frameworks'), FRAMEWORK_ID);
      expect(lastLine(response)).toBe(`saved: ${path.join(copied, 'framework.yaml')}`);
      // An edit lands in the write root, as for a bundled framework, carrying the listed folder's
      // companion file with it: the copy is a whole framework, not a lone framework.yaml.
      expect(await readFile(path.join(copied, 'phases.yaml'), 'utf8')).toContain('listed_step');
      expect(await readFile(path.join(copied, 'framework.yaml'), 'utf8')).toContain(
        'updated description'
      );
      expect(await readFile(listedFile, 'utf8')).toContain('listed description');
      // Re-registered from the copy, which now outranks the listed folder.
      expect(live().sourceRoot).toBe(writeRootFor('frameworks'));
    });

    it('(b) inspect reads a listed framework back from its files', async () => {
      await startFrameworks(['./custom']);
      await writeFrameworkAt(listedFor('frameworks'), 'listed description');
      expect(await frameworkManager.registerFramework(FRAMEWORK_ID)).toBe(true);
      expect(live().sourceRoot).toBe(listedFor('frameworks'));

      const response = await discovery.handleInspect({ action: 'inspect', id: FRAMEWORK_ID });

      expect(response.isError).toBe(false);
      // The quality score is computed only from the files the file service read back.
      expect(textOf(response)).toContain('**Quality:**');
    });

    it('(c) CONTROL: a framework in the write root still updates and inspects', async () => {
      await startFrameworks(['./custom']);
      const file = await writeFrameworkAt(writeRootFor('frameworks'), 'workspace description');
      expect(await frameworkManager.registerFramework(FRAMEWORK_ID)).toBe(true);
      expect(live().sourceRoot).toBe(writeRootFor('frameworks'));

      const updated = await lifecycle.handleUpdate({
        action: 'update',
        id: FRAMEWORK_ID,
        description: 'updated description',
      });
      const inspected = await discovery.handleInspect({ action: 'inspect', id: FRAMEWORK_ID });

      expect(updated.isError).toBe(false);
      expect(lastLine(updated)).toBe(`saved: ${file}`);
      expect(await readFile(file, 'utf8')).toContain('updated description');
      expect(textOf(inspected)).toContain('**Quality:**');
      expect(existsSync(listedFor('frameworks'))).toBe(false);
    });

    it('(d) a rebuilt rollback rewrites the listed framework and names that file', async () => {
      await startFrameworks(['./custom']);
      const listedFile = await writeFrameworkAt(listedFor('frameworks'), 'original description');
      expect(await frameworkManager.registerFramework(FRAMEWORK_ID)).toBe(true);
      const writer = new FrameworkFileWriter({ logger, configManager });
      const project = async (): Promise<Record<string, unknown>> => {
        const loaded = await writer.loadExistingFramework(FRAMEWORK_ID, listedFor('frameworks'));
        if (loaded === null) throw new Error('the listed framework did not load');
        return frameworkSnapshotContract.project(FRAMEWORK_ID, loaded);
      };
      const before = await project();
      await writeFrameworkAt(listedFor('frameworks'), 'edited description');
      const recorded = await versions.commitEdit(
        'framework',
        FRAMEWORK_ID,
        before,
        await project(),
        {
          description: 'Update via filesystem',
        }
      );
      expect(recorded).toMatchObject({ bridged: true, version: 2 });

      const preview = await processor.handleRollback({
        action: 'preview',
        preview_action: 'rollback',
        id: FRAMEWORK_ID,
        version: 1,
      });
      expect(preview.isError).toBe(false);
      expect(textOf(preview)).not.toMatch(/^saved: /m);

      const response = await processor.handleRollback({
        action: 'rollback',
        id: FRAMEWORK_ID,
        version: 1,
        confirm: true,
      });

      expect(response.isError).toBe(false);
      expect(lastLine(response)).toBe(`saved: ${listedFile}`);
      expect(await readFile(listedFile, 'utf8')).toContain('original description');
      expect(existsSync(writeRootFor('frameworks'))).toBe(false);
    });
  });

  describe('category', () => {
    const CATEGORY_ID = 'shelf';

    it('a rebuilt rollback names the category.yaml it wrote, and its preview names none', async () => {
      await start(['./custom']);
      const ctx = {
        logger,
        configManager,
        textDiffService: new ObjectDiffGenerator(),
        versionHistoryService: versions,
        categoryFileService: new CategoryFileWriter({ logger, configManager }),
        onRefresh: async () => {},
      } as CategoryResourceContext;
      const processor = new CategoryVersioningProcessor(ctx);
      const file = path.join(writeRootFor('prompts'), CATEGORY_ID, 'category.yaml');
      const declare = async (description: string): Promise<Record<string, unknown>> => {
        await mkdir(path.dirname(file), { recursive: true });
        await writeFile(
          file,
          [`id: ${CATEGORY_ID}`, 'name: Shelf', `description: ${description}`, ''].join('\n')
        );
        return categorySnapshotContract.project(
          CATEGORY_ID,
          parseYamlOrThrow<Record<string, unknown>>(await readFile(file, 'utf8'))
        );
      };
      const before = await declare('original description');
      const after = await declare('edited description');
      const recorded = await versions.commitEdit('category', CATEGORY_ID, before, after, {
        description: 'Update via filesystem',
      });
      expect(recorded).toMatchObject({ bridged: true, version: 2 });
      expect((await versions.planByteRestore('category', CATEGORY_ID, 1)).status).toBe(
        'projection-only'
      );

      const preview = await processor.handleRollback({
        action: 'preview',
        preview_action: 'rollback',
        id: CATEGORY_ID,
        version: 1,
      });
      expect(preview.isError).toBe(false);
      expect(textOf(preview)).not.toMatch(/^saved: /m);

      const response = await processor.handleRollback({
        action: 'rollback',
        id: CATEGORY_ID,
        version: 1,
        confirm: true,
      });

      expect(response.isError).toBe(false);
      expect(lastLine(response)).toBe(`saved: ${file}`);
      expect(await readFile(file, 'utf8')).toContain('original description');
    });
  });

  describe('framework writer', () => {
    it('lands a rebuilt write under the root it is handed, and names that root in its preview', async () => {
      await start(['./custom']);
      const writer = new FrameworkFileWriter({ logger, configManager });
      const listedDir = path.join(listedFor('frameworks'), 'listed_fw');
      await mkdir(listedDir, { recursive: true });
      await writeFile(
        path.join(listedDir, 'framework.yaml'),
        [
          'id: listed_fw',
          'name: Listed',
          'type: custom',
          'version: 1.0.0',
          'enabled: true',
          'description: before',
          '',
        ].join('\n')
      );
      const root = listedFor('frameworks');
      const existing = await writer.loadExistingFramework('listed_fw', root);
      expect(existing).not.toBeNull();
      // Without the served root the file service finds nothing: the folder is neither root it
      // knows, which is what refused a listed framework's rollback outright.
      expect(await writer.loadExistingFramework('listed_fw')).toBeNull();

      const data = { id: 'listed_fw', description: 'after' };
      const preview = await writer.projectFrameworkWrite(data, existing, { root });
      expect(
        preview.find((change) => change.path === 'listed_fw/framework.yaml')?.before
      ).toContain('description: before');

      const result = await writer.writeFrameworkFiles(data, existing, { root });

      expect(result.success).toBe(true);
      expect(await readFile(path.join(listedDir, 'framework.yaml'), 'utf8')).toContain(
        'description: after'
      );
      expect(existsSync(writeRootFor('frameworks'))).toBe(false);
    });
  });
});

describe('rebuildRoot', () => {
  it('is the served root for a resource outside the bundle', () => {
    expect(rebuildRoot('/ws/custom/prompts', '/pkg/resources/prompts')).toBe('/ws/custom/prompts');
  });

  it('is undefined — the write root — for a bundled resource, an unstamped one, or no bundle', () => {
    expect(rebuildRoot('/pkg/resources/prompts', '/pkg/resources/prompts')).toBeUndefined();
    expect(rebuildRoot('/pkg/resources/prompts/', '/pkg/resources/prompts')).toBeUndefined();
    expect(rebuildRoot(undefined, '/pkg/resources/prompts')).toBeUndefined();
    expect(rebuildRoot('/ws/custom/prompts', undefined)).toBe('/ws/custom/prompts');
  });
});
