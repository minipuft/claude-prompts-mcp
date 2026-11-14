// @lifecycle canonical - A file edited on disk records a version, or its refusal, before the reload.
/**
 * A hand edit carries the guarantees of a tool write: a version row and a rollback point, written
 * before the reload that serves the edit is reported. A file its loader refuses records no version,
 * is logged as `refused` with the loader's reason, is listed under **Refused files** in `status`,
 * and the previous definition keeps serving.
 *
 * Driven through the change tracker's real watcher registration, a real `VersionHistoryService`
 * over a real SQLite file, the real prompt, gate and framework loaders, and — for the ordering
 * case — a real `HotReloadObserver`, whose file-event input is the one thing simulated (no
 * `fs.watch` timing). Frameworks and categories (f–h) are versioned the same way; their prior state
 * comes from the framework registry and from the category bytes last seen, never from the disk the
 * edit already changed. A rollback is driven through the server's byte-restore path.
 *
 * Classification: Integration (real SQLite, real filesystem, real loaders).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { GenericFrameworkGuide } from '../../../src/engine/frameworks/definitions/generic-framework-guide.js';
import { FrameworkRegistry } from '../../../src/engine/frameworks/definitions/registry.js';
import { GateRegistry } from '../../../src/engine/gates/registry/gate-registry.js';
import { SqliteEngine } from '../../../src/infra/database/index.js';
import { ChangesActionHandler } from '../../../src/mcp/tools/system-control/handlers/changes-action-handler.js';
import { StatusActionHandler } from '../../../src/mcp/tools/system-control/handlers/status-action-handler.js';
import { HotReloadObserver } from '../../../src/modules/hot-reload/hot-reload-observer.js';
import { PromptConverter } from '../../../src/modules/prompts/converter.js';
import { PromptLoader } from '../../../src/modules/prompts/loader.js';
import { applyByteRestore } from '../../../src/modules/versioning/byte-restore.js';
import { projectCategorySnapshot } from '../../../src/modules/versioning/projections/category-snapshot.js';
import { projectFrameworkSnapshot } from '../../../src/modules/versioning/projections/framework-snapshot.js';
import { VersionHistoryService } from '../../../src/modules/versioning/version-history-service.js';
import { DiskEditVersionRecorder } from '../../../src/runtime/disk-edit-versioning.js';
import { PathResolver } from '../../../src/runtime/paths.js';
import {
  buildResourceChangeTrackerAuxiliaryReloadConfig,
  initializeResourceChangeTracker,
} from '../../../src/runtime/resource-change-tracking.js';
import { ResourceLocationLedger } from '../../../src/runtime/resource-location-report.js';
import { createResourceFileLocator } from '../../../src/runtime/resource-roots.js';
import { withResourceLocations } from '../../helpers/resource-locations.js';
import { testScratchPath } from '../../helpers/scratch-path.js';

import type { ConvertedPrompt } from '../../../src/engine/execution/types.js';
import type { ConfigLoader } from '../../../src/infra/config/index.js';
import type { ResourceChangeTracker } from '../../../src/infra/observability/tracking/index.js';
import type { SystemControlContext } from '../../../src/mcp/tools/system-control/core/types.js';
import type { ResourceType } from '../../../src/modules/versioning/types.js';
import type { AuxiliaryReloadConfig } from '../../../src/modules/hot-reload/hot-reload-observer.js';
import type {
  DiskEditVersioning,
  LiveResources,
} from '../../../src/runtime/disk-edit-versioning.js';
import type { FileChangeOperation, Logger, ToolResponse } from '../../../src/shared/types/index.js';
import type { DatabasePort } from '../../../src/shared/types/persistence.js';
import type { ResourceLocationScope } from '../../helpers/resource-locations.js';

const logger: Logger = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };

const TEST_DIR = testScratchPath('disk-edit-versioning');
const PACKAGE_ROOT = path.join(TEST_DIR, 'package');
const WORKSPACE = path.join(TEST_DIR, 'workspace');
const PROMPTS = path.join(WORKSPACE, 'resources', 'prompts');
const GATES = path.join(WORKSPACE, 'resources', 'gates');
const FRAMEWORKS = path.join(WORKSPACE, 'resources', 'frameworks');
const DB_PATH = path.join(TEST_DIR, 'runtime-state', 'state.db');

const configManager = {
  getResolvedPromptsDirectory: () => PROMPTS,
  getGatesDirectory: () => GATES,
  getFrameworksDirectory: () => FRAMEWORKS,
  getVersioningConfig: () => ({ enabled: true, autoVersion: true, maxVersions: 50 }),
  getServerRoot: () => TEST_DIR,
} as unknown as ConfigLoader;

const promptDir = (id: string): string => path.join(PROMPTS, 'general', id);
const gateFile = (id: string): string => path.join(GATES, id, 'gate.yaml');
const frameworkFile = (id: string): string => path.join(FRAMEWORKS, id, 'framework.yaml');
const categoryFile = (id: string): string => path.join(PROMPTS, id, 'category.yaml');

/** A framework's bytes, with a comment no projection writes back — a byte restore is visible. */
const frameworkYaml = (id: string, name: string, guidance: string): string =>
  [
    `# ${id}, authored by hand`,
    `id: ${id}`,
    `name: ${name}`,
    'type: custom',
    'version: 1.0.0',
    'enabled: true',
    'description: a framework',
    `systemPromptGuidance: ${guidance}`,
    '',
  ].join('\n');

/** A category's bytes, with the same hand-authored comment. */
const categoryYaml = (id: string, description: string): string =>
  [`# ${id}, authored by hand`, `id: ${id}`, `name: ${id}`, `description: ${description}`, ''].join(
    '\n'
  );

async function writeAt(file: string, content: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, content);
}

async function writePrompt(id: string, body: string): Promise<void> {
  await mkdir(promptDir(id), { recursive: true });
  await writeFile(
    path.join(promptDir(id), 'prompt.yaml'),
    [
      `id: ${id}`,
      `name: ${id}`,
      'description: a prompt',
      'userMessageTemplateFile: user-message.md',
      '',
    ].join('\n')
  );
  await writeFile(path.join(promptDir(id), 'user-message.md'), body);
}

async function writeGate(id: string, description: string): Promise<void> {
  await mkdir(path.dirname(gateFile(id)), { recursive: true });
  await writeFile(
    gateFile(id),
    [
      `id: ${id}`,
      `name: ${id}`,
      'type: validation',
      `description: ${description}`,
      'guidance: be good',
      '',
    ].join('\n')
  );
}

describe('a disk edit records a version, or its refusal, before the reload', () => {
  let db: SqliteEngine;
  let tracker: ResourceChangeTracker;
  let resolver: PathResolver;
  let versions: VersionHistoryService;
  let gates: GateRegistry;
  let locations: ResourceLocationScope;
  let livePrompts: ConvertedPrompt[] = [];
  let frameworks: FrameworkRegistry;

  // The framework accessor `hot-reload-auxiliaries.ts` hands the recorder: the registry's guide.
  const live: LiveResources = {
    prompt: (id) => livePrompts.find((prompt) => prompt.id === id),
    gate: (id) => gates.getGuide(id),
    framework: (id) => {
      const guide = frameworks
        .getGuideEntries(false)
        .find((entry) => entry.guide.frameworkId === id)?.guide;
      return guide instanceof GenericFrameworkGuide ? guide.getDefinition() : undefined;
    },
  };

  /** What the framework handler does after the tracker: the registry serves the file again. */
  async function loadFramework(id: string): Promise<void> {
    if (!(await frameworks.loadAndRegisterById(id))) throw new Error(`framework ${id} not loaded`);
  }

  /** Roll back through the server's byte-restore path; the restored file's bytes. */
  async function rollBack(type: ResourceType, id: string, version: number, file: string) {
    const available = await versions.planByteRestore(type, id, version);
    if (available.status !== 'ready') throw new Error(`v${version} not byte-restorable`);
    const outcome = await applyByteRestore({
      plan: available.plan,
      bytes: available.bytes,
      commit: async () => {},
    });
    expect(outcome.applied).toBe(true);
    return await readFile(file, 'utf8');
  }

  /** What `fullServerRefresh` does to the catalog: the prompt loader and converter, over the root. */
  async function reloadPrompts(): Promise<void> {
    const loader = new PromptLoader(logger);
    const { promptsData } = await loader.loadFromDirectories(PROMPTS);
    livePrompts = await new PromptConverter(logger, loader).convertMarkdownPromptsToJson(
      promptsData,
      PROMPTS
    );
  }

  function registrationFor(recorder: DiskEditVersioning): AuxiliaryReloadConfig {
    const built = buildResourceChangeTrackerAuxiliaryReloadConfig(
      logger,
      configManager,
      resolver,
      recorder
    );
    if (built === undefined) throw new Error('tracker registration was not built');
    return built;
  }

  const fileEvent = (
    registration: AuxiliaryReloadConfig,
    file: string,
    changeType: FileChangeOperation
  ) =>
    registration.handler({
      type: 'prompt_changed',
      reason: 'test',
      affectedFiles: [file],
      changeType,
      timestamp: Date.now(),
      requiresFullReload: false,
    });

  const historyOf = async (type: ResourceType, id: string) =>
    (await versions.loadHistory(type, id))?.versions ?? [];

  const changeRows = (id: string) =>
    db.query<{
      operation: string;
      version_recorded: number | null;
      reason: string | null;
      file_path: string;
    }>(
      `SELECT operation, version_recorded, reason, file_path FROM resource_changes
       WHERE resource_id = ? ORDER BY id ASC`,
      [id]
    );

  /** The bytes a version row recorded for one file of its resource. */
  const recordedBytes = (id: string, version: number, fileName: string): string | undefined => {
    const row = db.queryOne<{ bytes: Uint8Array }>(
      `SELECT o.bytes AS bytes FROM version_history v
       JOIN version_entries e ON e.version_row_id = v.id
       JOIN objects o ON o.tenant_id = e.tenant_id AND o.hash = e.object_hash
       WHERE v.resource_type = 'prompt' AND v.resource_id = ? AND v.version = ? AND e.path LIKE ?`,
      [id, version, `%${fileName}`]
    );
    return row === null ? undefined : Buffer.from(row.bytes).toString('utf8');
  };

  function systemContext(ledger: ResourceLocationLedger): SystemControlContext {
    return {
      logger,
      startTime: Date.now(),
      frameworkStateStore: {
        getSystemHealth: () => ({
          status: 'healthy',
          frameworkSystemEnabled: true,
          activeFramework: 'CAGEERF',
        }),
      },
      resourceLocations: ledger.view(),
      createMinimalSystemResponse: (text: string): ToolResponse => ({
        content: [{ type: 'text', text }],
        isError: false,
      }),
    } as unknown as SystemControlContext;
  }
  const textOf = (response: ToolResponse): string => (response.content[0] as { text: string }).text;

  beforeAll(async () => {
    await mkdir(path.join(PACKAGE_ROOT, 'resources', 'prompts'), { recursive: true });
    await mkdir(PROMPTS, { recursive: true });
    await mkdir(GATES, { recursive: true });
    locations = withResourceLocations({ workspace: WORKSPACE });
    resolver = new PathResolver({ cli: {}, packageRoot: PACKAGE_ROOT });
    db = await SqliteEngine.getInstance(logger, { dbPath: DB_PATH });
    await db.initialize();
    tracker = await initializeResourceChangeTracker(logger, DB_PATH);
    versions = new VersionHistoryService({
      logger,
      configManager,
      resourceFileLocator: createResourceFileLocator(resolver),
    });
    versions.setDatabasePort(db);
  });

  afterAll(async () => {
    locations.cleanup();
    await db.shutdown();
    await rm(TEST_DIR, { recursive: true, force: true, maxRetries: 5 });
  });

  beforeEach(async () => {
    await rm(PROMPTS, { recursive: true, force: true });
    await rm(GATES, { recursive: true, force: true });
    await rm(FRAMEWORKS, { recursive: true, force: true });
    await mkdir(PROMPTS, { recursive: true });
    await mkdir(GATES, { recursive: true });
    await mkdir(FRAMEWORKS, { recursive: true });
    frameworks = new FrameworkRegistry(logger, {
      autoLoadBuiltIn: false,
      validateOnRegistration: false,
      runtimeLoaderConfig: { frameworksDir: FRAMEWORKS },
    });
    await frameworks.initialize();
    db.run('DELETE FROM resource_changes');
    db.run('DELETE FROM version_history');
    livePrompts = [];
  });

  it('(a) records the edited bytes as a version, then logs the change, then reloads — in that order', async () => {
    await writePrompt('edited', 'OLD BODY');
    await reloadPrompts();
    const sequence: string[] = [];

    // Slower than the batch window, so a reload that does not wait for the handler fires first.
    const recorder = new DiskEditVersionRecorder(versions, live);
    const slow: DiskEditVersioning = {
      rememberLoadedCategories: (files) => recorder.rememberLoadedCategories(files),
      record: async (change) => {
        await new Promise((resolve) => setTimeout(resolve, 150));
        const outcome = await recorder.record(change);
        sequence.push(`version:${outcome.kind}`);
        return outcome;
      },
    };
    const logChange = tracker.logChange.bind(tracker);
    const spy = jest.spyOn(tracker, 'logChange').mockImplementation(async (params) => {
      await logChange(params);
      sequence.push(`logged:${params.operation}`);
    });

    const observer = new HotReloadObserver(logger, {
      enabled: true,
      autoReload: true,
      batchChanges: true,
      batchTimeoutMs: 10,
      reloadDelayMs: 0,
    });
    observer.setAuxiliaryReloads([registrationFor(slow)]);
    const reloaded = new Promise<void>((resolve) =>
      observer.setReloadCallback(async () => {
        sequence.push('reload');
        resolve();
      })
    );

    const companion = path.join(promptDir('edited'), 'user-message.md');
    await writeFile(companion, 'NEW BODY');
    (
      observer as unknown as { fileObserver: { emit(name: string, event: unknown): void } }
    ).fileObserver.emit('fileChange', {
      type: 'modified',
      filePath: companion,
      filename: 'user-message.md',
      timestamp: Date.now(),
      isPromptFile: true,
      isConfigFile: false,
      isFrameworkFile: false,
      isAuxiliaryFile: true,
    });
    await reloaded;
    spy.mockRestore();

    expect(sequence).toEqual(['version:recorded', 'logged:modified', 'reload']);

    // v1 is the bridge holding the state the edit replaced (the rollback point); v2 is the edit.
    const history = await historyOf('prompt', 'edited');
    expect(history.map((entry) => [entry.version, entry.snapshot['userMessageTemplate']])).toEqual([
      [2, 'NEW BODY'],
      [1, 'OLD BODY'],
    ]);
    expect(history[0]?.description).toBe('Update via filesystem');
    expect(recordedBytes('edited', 2, 'user-message.md')).toBe('NEW BODY');
    expect(changeRows('edited')).toEqual([
      expect.objectContaining({ operation: 'modified', version_recorded: 1, reason: null }),
    ]);
  });

  it('(b) records nothing for a disk state the catalog already serves', async () => {
    await writePrompt('quiet', 'SAME BODY');
    await reloadPrompts();
    const registration = registrationFor(new DiskEditVersionRecorder(versions, live));

    // A never-versioned prompt, touched without a change: no bridge, no version, no change row.
    await fileEvent(registration, path.join(promptDir('quiet'), 'user-message.md'), 'modified');
    expect(await historyOf('prompt', 'quiet')).toEqual([]);

    // After a real edit and the reload that serves it, the same state again records nothing more.
    await writeFile(path.join(promptDir('quiet'), 'user-message.md'), 'EDITED BODY');
    await fileEvent(registration, path.join(promptDir('quiet'), 'user-message.md'), 'modified');
    await reloadPrompts();
    const rowsBefore = changeRows('quiet');
    await fileEvent(registration, path.join(promptDir('quiet'), 'user-message.md'), 'modified');
    expect((await historyOf('prompt', 'quiet')).map((entry) => entry.version)).toEqual([2, 1]);
    expect(changeRows('quiet')).toEqual(rowsBefore);
  });

  it('(c) a version the database refuses throws at the persistence layer, and the change row says so', async () => {
    await writePrompt('stuck', 'BEFORE');
    await reloadPrompts();
    const failing = new VersionHistoryService({
      logger,
      configManager,
      resourceFileLocator: createResourceFileLocator(resolver),
    });
    failing.setDatabasePort({
      transaction: () => Promise.reject(new Error('disk I/O error')),
      queryOne: () => null,
      query: () => [],
      run: () => undefined,
    } as unknown as DatabasePort);

    await expect(failing.saveVersion('prompt', 'stuck', { id: 'stuck' })).rejects.toThrow(
      'Failed to persist version snapshot for prompt/stuck: disk I/O error'
    );

    await writeFile(path.join(promptDir('stuck'), 'user-message.md'), 'AFTER');
    await fileEvent(
      registrationFor(new DiskEditVersionRecorder(failing, live)),
      path.join(promptDir('stuck'), 'user-message.md'),
      'modified'
    );

    expect(changeRows('stuck')).toEqual([
      expect.objectContaining({
        operation: 'modified',
        version_recorded: 0,
        reason: 'Failed to persist version snapshot for prompt/stuck: disk I/O error',
      }),
    ]);
  });

  it('(d) a refused gate is logged with its reason and listed in status; the previous definition serves — (e) a valid edit is in neither', async () => {
    await writeGate('broken', 'the good definition');
    await writeGate('fine', 'first');
    gates = new GateRegistry(logger, { loaderConfig: { gatesDir: GATES } });
    await gates.initialize();
    const registration = registrationFor(new DiskEditVersionRecorder(versions, live));
    const ledger = new ResourceLocationLedger(resolver, logger, gates.getLoader().getQuarantine());
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

    try {
      await writeFile(gateFile('broken'), 'id: broken\nname: [unclosed\n');
      await writeGate('fine', 'second');
      // The watcher order: the change tracker first, then the gate's own reload.
      for (const id of ['broken', 'fine']) {
        await fileEvent(registration, gateFile(id), 'modified');
        await gates.reloadGuide(id);
      }
    } finally {
      errorSpy.mockRestore();
    }

    // The previous definition keeps serving; the valid edit took effect.
    expect(gates.getGuide('broken')?.description).toBe('the good definition');
    expect(gates.getGuide('fine')?.description).toBe('second');

    const [refusedRow] = changeRows('broken');
    expect(refusedRow).toEqual(
      expect.objectContaining({ operation: 'refused', file_path: gateFile('broken') })
    );
    expect(refusedRow?.reason).toMatch(/YAML parse error/);
    expect(await historyOf('gate', 'broken')).toEqual([]);
    // CONTROL: the valid edit is a versioned modification with no reason.
    expect(changeRows('fine')).toEqual([
      expect.objectContaining({ operation: 'modified', version_recorded: 1, reason: null }),
    ]);

    const changes = textOf(
      await new ChangesActionHandler(systemContext(ledger)).execute({ operation: 'list' })
    );
    expect(changes).toContain('Operation: refused');
    expect(changes).toContain(`- Reason: ${refusedRow?.reason ?? ''}`);

    const status = textOf(
      await new StatusActionHandler(systemContext(ledger)).execute({ include_metrics: false })
    );
    const refusedSection = status.slice(status.indexOf('**Refused files**'));
    expect(refusedSection).toMatch(
      new RegExp(
        `^\\*\\*Refused files\\*\\*\\n- ${gateFile('broken').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')} — gate \`broken\` \\(since \\d{4}-\\d{2}-\\d{2}T`
      )
    );
    // CONTROL: the valid gate is not listed.
    expect(refusedSection).not.toContain(gateFile('fine'));
    // The parser quotes the offending line after its first; a refused file's content is never echoed.
    expect(changes).not.toContain('[unclosed');
    expect(refusedSection).not.toContain('[unclosed');
  });

  it('(f) a framework edited on disk records a version from the registry, and rolls back to its bytes', async () => {
    const oldBytes = frameworkYaml('fw_kept', 'Old name', 'OLD GUIDANCE');
    await writeAt(frameworkFile('fw_kept'), oldBytes);
    await writeAt(frameworkFile('fw_new'), frameworkYaml('fw_new', 'Was', 'WAS GUIDANCE'));
    await loadFramework('fw_kept');
    await loadFramework('fw_new');
    // `fw_kept` was versioned when it was written; `fw_new` never was.
    const v1 = await versions.saveVersion(
      'framework',
      'fw_kept',
      projectFrameworkSnapshot('fw_kept', {
        framework: {
          name: 'Old name',
          type: 'custom',
          enabled: true,
          description: 'a framework',
          systemPromptGuidance: 'OLD GUIDANCE',
        },
      }),
      { description: 'Created via resource_manager' }
    );
    expect(v1.version).toBe(1);
    const registration = registrationFor(new DiskEditVersionRecorder(versions, live));

    for (const id of ['fw_kept', 'fw_new']) {
      await writeFile(frameworkFile(id), frameworkYaml(id, 'New name', 'NEW GUIDANCE'));
      await fileEvent(registration, frameworkFile(id), 'modified');
      await loadFramework(id);
    }

    // The edit is one row after the recorded one: the registry's state WAS version 1, so no bridge.
    const kept = await historyOf('framework', 'fw_kept');
    expect(kept.map((entry) => [entry.version, entry.description])).toEqual([
      [2, 'Update via filesystem'],
      [1, 'Created via resource_manager'],
    ]);
    expect(kept[0]?.snapshot['system_prompt_guidance']).toBe('NEW GUIDANCE');

    // Never versioned: the bridge holds the state only the registry still knew when the event came.
    const fresh = await historyOf('framework', 'fw_new');
    expect(fresh.map((entry) => [entry.snapshot['name'], entry.description])).toEqual([
      ['New name', 'Update via filesystem'],
      ['Was', 'Bridge: prior live state (era transition or out-of-band edit)'],
    ]);
    expect(fresh[1]?.snapshot['system_prompt_guidance']).toBe('WAS GUIDANCE');

    // Versioned, not change-logged: the change log's vocabulary is prompts and gates.
    expect(changeRows('fw_kept')).toEqual([]);

    // Rollback restores the bytes version 1 recorded, comment included.
    expect(await rollBack('framework', 'fw_kept', 1, frameworkFile('fw_kept'))).toBe(oldBytes);
  });

  it('(g) a category.yaml edited on disk records a version from the bytes last seen, and rolls back to them', async () => {
    const oldBytes = categoryYaml('notes', 'old description');
    await writeAt(categoryFile('notes'), oldBytes);
    await writeAt(categoryFile('drafts'), categoryYaml('drafts', 'was'));
    const v1 = await versions.saveVersion(
      'category',
      'notes',
      projectCategorySnapshot('notes', {
        id: 'notes',
        name: 'notes',
        description: 'old description',
      }),
      { description: 'Created via resource_manager' }
    );
    expect(v1.version).toBe(1);
    // Built after the files exist: the registration reads every served `category.yaml` as it starts.
    const registration = registrationFor(new DiskEditVersionRecorder(versions, live));

    for (const id of ['notes', 'drafts']) {
      await writeFile(categoryFile(id), categoryYaml(id, 'new description'));
      await fileEvent(registration, categoryFile(id), 'modified');
    }

    const notes = await historyOf('category', 'notes');
    expect(
      notes.map((entry) => [entry.version, entry.snapshot['description'], entry.description])
    ).toEqual([
      [2, 'new description', 'Update via filesystem'],
      [1, 'old description', 'Created via resource_manager'],
    ]);
    const drafts = await historyOf('category', 'drafts');
    expect(drafts.map((entry) => [entry.snapshot['description'], entry.description])).toEqual([
      ['new description', 'Update via filesystem'],
      ['was', 'Bridge: prior live state (era transition or out-of-band edit)'],
    ]);

    // The bytes a record projected are the next prior state: the same file again records nothing.
    await fileEvent(registration, categoryFile('notes'), 'modified');
    expect(await historyOf('category', 'notes')).toHaveLength(2);

    expect(await rollBack('category', 'notes', 1, categoryFile('notes'))).toBe(oldBytes);
  });

  it('(h) a category.yaml added beside served prompts is a creation, with no bridge of derived defaults', async () => {
    // The catalog serves a `fresh` category already — with a formatted name and a generated
    // description, because no file declares them. None of that is an authored state to bridge.
    await writePrompt('in_fresh', 'BODY');
    await mkdir(path.join(PROMPTS, 'fresh'), { recursive: true });
    const registration = registrationFor(new DiskEditVersionRecorder(versions, live));

    await writeAt(categoryFile('fresh'), categoryYaml('fresh', 'declared now'));
    await fileEvent(registration, categoryFile('fresh'), 'added');

    const history = await historyOf('category', 'fresh');
    expect(history.map((entry) => [entry.snapshot['description'], entry.description])).toEqual([
      ['declared now', 'Created via filesystem'],
    ]);
  });

  // Row 2.5 asks for style versioning or the reason it cannot be. It is not a bounded addition:
  // `version_history` has no `style` type (`StoredResourceType`), and adding one widens
  // `ResourceType`, which `resource_manager` routes on (a public MCP contract change), plus
  // `FileBackedResourceType`'s enumerator and byte-restore tables, a style snapshot contract with a
  // restore writer that no server surface has, and `cpm`'s `HistoryResourceType`.
  it.skip('row 2.5: a style file edited on disk records a version — refused, styles carry no history', () => {});
});
