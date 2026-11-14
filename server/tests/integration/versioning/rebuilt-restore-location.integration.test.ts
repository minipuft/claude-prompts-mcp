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

import { createGateManager } from '../../../src/engine/gates/gate-manager.js';
import { ConfigLoader } from '../../../src/infra/config/index.js';
import { SqliteEngine } from '../../../src/infra/database/index.js';
import { FrameworkFileWriter } from '../../../src/mcp/tools/framework-manager/services/framework-file-writer.js';
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
import {
  createResourceFileLocator,
  resolveResourceRoots,
} from '../../../src/runtime/resource-roots.js';
import { withResourceLocations } from '../../helpers/resource-locations.js';
import { testScratchPath } from '../../helpers/scratch-path.js';

import type { ConvertedPrompt } from '../../../src/engine/execution/types.js';
import type { GateManager } from '../../../src/engine/gates/gate-manager.js';
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
      expect(await readFile(gateFile, 'utf8')).toContain('original description');
      expect(await entryFilesUnder(writeRootFor('gates'))).toEqual([]);
      expect(live().description).toBe('original description');
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
