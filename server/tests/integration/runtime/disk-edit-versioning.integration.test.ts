// @lifecycle canonical - A file edited on disk records a version, or its refusal, before the reload.
/**
 * A hand edit carries the guarantees of a tool write: a version row and a rollback point, written
 * before the reload that serves the edit is reported. A file its loader refuses records no version,
 * is logged as `refused` with the loader's reason, is listed under **Refused files** in `status`,
 * and the previous definition keeps serving.
 *
 * Driven through the change tracker's real watcher registration, a real `VersionHistoryService`
 * over a real SQLite file, the real prompt and gate loaders, and — for the ordering case — a real
 * `HotReloadObserver`, whose file-event input is the one thing simulated (no `fs.watch` timing).
 *
 * Classification: Integration (real SQLite, real filesystem, real loaders).
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { GateRegistry } from '../../../src/engine/gates/registry/gate-registry.js';
import { SqliteEngine } from '../../../src/infra/database/index.js';
import { ChangesActionHandler } from '../../../src/mcp/tools/system-control/handlers/changes-action-handler.js';
import { StatusActionHandler } from '../../../src/mcp/tools/system-control/handlers/status-action-handler.js';
import { HotReloadObserver } from '../../../src/modules/hot-reload/hot-reload-observer.js';
import { PromptConverter } from '../../../src/modules/prompts/converter.js';
import { PromptLoader } from '../../../src/modules/prompts/loader.js';
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
const DB_PATH = path.join(TEST_DIR, 'runtime-state', 'state.db');

const configManager = {
  getResolvedPromptsDirectory: () => PROMPTS,
  getGatesDirectory: () => GATES,
  getVersioningConfig: () => ({ enabled: true, autoVersion: true, maxVersions: 50 }),
  getServerRoot: () => TEST_DIR,
} as unknown as ConfigLoader;

const promptDir = (id: string): string => path.join(PROMPTS, 'general', id);
const gateFile = (id: string): string => path.join(GATES, id, 'gate.yaml');

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

  const live: LiveResources = {
    prompt: (id) => livePrompts.find((prompt) => prompt.id === id),
    gate: (id) => gates.getGuide(id),
  };

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

  const historyOf = async (type: 'prompt' | 'gate', id: string) =>
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
    await mkdir(PROMPTS, { recursive: true });
    await mkdir(GATES, { recursive: true });
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
});
