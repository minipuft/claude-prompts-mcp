/**
 * Gate + Framework Versioning Through the Real Write Path
 *
 * Closes the coverage gap recorded as F10 in
 * `plans/techincal_debt/resource-versioning-consolidation-2026-08-17.md`: the existing
 * `version-history-workflow.test.ts` exercises gate and framework versioning only at the
 * VersionHistoryService level (a resourceType string passed to a simulated manager). It never
 * reaches `GateLifecycleProcessor` or `GateVersioningProcessor`, which is where F1 and F2 live —
 * so the suite has been green throughout the lifetime of both defects.
 *
 * Uses real:
 * - GateLifecycleProcessor, GateVersioningProcessor (the processors under test)
 * - GateFileWriter (real YAML write + on-disk field preservation)
 * - VersionHistoryService over a real SqliteEngine in a temp dir
 *
 * Doubles:
 * - Logger (capture)
 * - ConfigManager (temp gates directory)
 * - Gate registry — a DISK-BACKED double whose `get()` serves a cached view and whose `reload()`
 *   re-reads from disk. This is deliberate rather than convenient: the production GateManager has
 *   exactly this staleness, and `workspace-and-mutations.yaml:24-29` records a conformance row
 *   that passed while its rollback never ran because a stale registry served the expected content
 *   either way. A double that always re-read from disk would hide the same class of false pass.
 *
 * Classification: Integration (real processors, real writer, real SQLite, real temp filesystem)
 */

import { readFileSync, existsSync } from 'node:fs';
import * as fs from 'node:fs/promises';
import os from 'node:os';
import * as path from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';

import { SqliteEngine } from '../../../src/infra/database/index.js';
import { ObjectDiffGenerator } from '../../../src/mcp/tools/resource-manager/prompt/analysis/object-diff-generator.js';
import { GateFileWriter } from '../../../src/mcp/tools/gate-manager/services/gate-file-writer.js';
import { GateLifecycleProcessor } from '../../../src/mcp/tools/gate-manager/services/gate-lifecycle-processor.js';
import { GateVersioningProcessor } from '../../../src/mcp/tools/gate-manager/services/gate-versioning-processor.js';
import { FrameworkFileWriter } from '../../../src/mcp/tools/framework-manager/services/framework-file-writer.js';
import { FrameworkLifecycleProcessor } from '../../../src/mcp/tools/framework-manager/services/framework-lifecycle-processor.js';
import { FrameworkVersioningProcessor } from '../../../src/mcp/tools/framework-manager/services/framework-versioning-processor.js';
import { FileOperations } from '../../../src/mcp/tools/resource-manager/prompt/operations/file-operations.js';
import { PromptVersioningProcessor } from '../../../src/mcp/tools/resource-manager/prompt/services/prompt-versioning-processor.js';
import { VersionHistoryService } from '../../../src/modules/versioning/version-history-service.js';
import { parseYamlOrThrow } from '../../../src/shared/utils/yaml/yaml-parser.js';
import { MockLogger } from '../../helpers/test-helpers.js';

import type { GateResourceContext } from '../../../src/mcp/tools/gate-manager/core/context.js';
import type { GateManagerInput } from '../../../src/mcp/tools/gate-manager/core/types.js';
import type { FrameworkResourceContext } from '../../../src/mcp/tools/framework-manager/core/context.js';
import type { FrameworkManagerInput } from '../../../src/mcp/tools/framework-manager/core/types.js';
import type { PromptResourceContext } from '../../../src/mcp/tools/resource-manager/prompt/core/context.js';
import type { VersioningConfigProvider } from '../../../src/modules/versioning/version-history-service.js';
import type { ConfigManager, Logger } from '../../../src/shared/types/index.js';

const GATE_ID = 'versioning-probe';

/** Minimal versioning config provider — versioning enabled, auto-version on. */
class TestVersioningConfigProvider implements VersioningConfigProvider {
  getVersioningConfig() {
    return { enabled: true, max_versions: 10, auto_version: true };
  }
  getServerRoot(): string {
    return process.cwd();
  }
}

/**
 * The view of a gate that `GateLifecycleProcessor` and `GateVersioningProcessor` consume:
 * `gateId`, `name`, `type`, `description`, `getGuidance()`, `getDefinition()`.
 */
interface GateView {
  gateId: string;
  name: string;
  type: string;
  description: string;
  getGuidance(): string;
  getDefinition(): Record<string, unknown>;
}

/**
 * Disk-backed registry double. `reload(id)` re-reads `gate.yaml` + `guidance.md`; `get(id)` serves
 * whatever the last reload cached. Every read-back in this file forces an explicit `reload` for
 * the reason in the file header.
 */
class DiskBackedGateRegistry {
  private cache = new Map<string, GateView>();

  constructor(private readonly gatesDir: string) {}

  has(id: string): boolean {
    return this.cache.has(id);
  }

  get(id: string): GateView | undefined {
    return this.cache.get(id);
  }

  async reload(id: string): Promise<boolean> {
    const yamlPath = path.join(this.gatesDir, id, 'gate.yaml');
    if (!existsSync(yamlPath)) {
      this.cache.delete(id);
      return false;
    }
    const definition = parseYamlOrThrow<Record<string, unknown>>(readFileSync(yamlPath, 'utf8'));
    const guidancePath = path.join(this.gatesDir, id, 'guidance.md');
    const guidance = existsSync(guidancePath) ? readFileSync(guidancePath, 'utf8') : '';

    this.cache.set(id, {
      gateId: String(definition['id'] ?? id),
      name: String(definition['name'] ?? ''),
      type: String(definition['type'] ?? 'validation'),
      description: String(definition['description'] ?? ''),
      getGuidance: () => guidance,
      getDefinition: () => definition,
    });
    return true;
  }
}

describe('Gate versioning through the real write path', () => {
  let tempDir: string;
  let gatesDir: string;
  let dbManager: SqliteEngine;
  let versionHistoryService: VersionHistoryService;
  let registry: DiskBackedGateRegistry;
  let lifecycle: GateLifecycleProcessor;
  let versioning: GateVersioningProcessor;
  let mockLogger: MockLogger;

  /** Row count for this gate's history — the measurement F3's claim is about. */
  function countVersionRows(resourceId: string = GATE_ID): number {
    const row = dbManager.queryOne<{ cnt: number }>(
      `SELECT COUNT(*) as cnt FROM version_history WHERE resource_type = ? AND resource_id = ?`,
      ['gate', resourceId]
    );
    return row?.cnt ?? 0;
  }

  function readGateYaml(): Record<string, unknown> {
    return parseYamlOrThrow<Record<string, unknown>>(
      readFileSync(path.join(gatesDir, GATE_ID, 'gate.yaml'), 'utf8')
    );
  }

  function readGuidance(): string {
    return readFileSync(path.join(gatesDir, GATE_ID, 'guidance.md'), 'utf8');
  }

  /** Drive an action through the processor under test, then reload so reads see disk. */
  async function run(args: GateManagerInput) {
    const response =
      args.action === 'create'
        ? await lifecycle.handleCreate(args)
        : args.action === 'update'
          ? await lifecycle.handleUpdate(args)
          : args.action === 'rollback'
            ? await versioning.handleRollback(args)
            : args.action === 'delete'
              ? await lifecycle.handleDelete(args)
              : await versioning.handleHistory(args);
    await registry.reload(GATE_ID);
    return response;
  }

  beforeEach(async () => {
    mockLogger = new MockLogger();
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gate-versioning-test-'));
    gatesDir = path.join(tempDir, 'gates');
    await fs.mkdir(gatesDir, { recursive: true });

    dbManager = await SqliteEngine.getInstance(tempDir, mockLogger as unknown as Logger);
    await dbManager.initialize();

    versionHistoryService = new VersionHistoryService({
      logger: mockLogger as unknown as Logger,
      configManager: new TestVersioningConfigProvider(),
      dbManager,
    });

    registry = new DiskBackedGateRegistry(gatesDir);

    const configManager = {
      getGatesDirectory: () => gatesDir,
    } as unknown as ConfigManager;

    const ctx: GateResourceContext = {
      logger: mockLogger as unknown as Logger,
      gateManager: registry as unknown as GateResourceContext['gateManager'],
      configManager,
      textDiffService: new ObjectDiffGenerator(),
      versionHistoryService,
      gateFileService: new GateFileWriter({
        logger: mockLogger as unknown as Logger,
        configManager,
      }),
      onRefresh: async () => {
        await registry.reload(GATE_ID);
      },
    };

    lifecycle = new GateLifecycleProcessor(ctx);
    versioning = new GateVersioningProcessor(ctx);
  });

  afterEach(async () => {
    try {
      await dbManager.shutdown();
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  /**
   * F1 — go-forward numbering.
   *
   * A version number should name the state its edit PRODUCED, so the newest recorded version
   * equals what the resource currently is. Gates call `saveVersion(beforeState)`, so the newest
   * row holds the state the edit REPLACED, and the state now on disk is recorded nowhere.
   *
   * Expected RED against HEAD: newest snapshot carries the v1 description, not the v2 one.
   */
  it('records the state each edit produced, so the newest version matches the live gate', async () => {
    await run({
      action: 'create',
      id: GATE_ID,
      name: 'Versioning Probe',
      type: 'validation',
      description: 'v1 description',
      guidance: 'v1 guidance body',
    } as GateManagerInput);

    await run({
      action: 'update',
      id: GATE_ID,
      description: 'v2 description',
      guidance: 'v2 guidance body',
    } as GateManagerInput);

    const history = await versionHistoryService.loadHistory('gate', GATE_ID);
    expect(history).not.toBeNull();

    const newest = history!.versions[0]!;
    const live = registry.get(GATE_ID)!;

    // The live gate is v2 — that is what `inspect` would show.
    expect(live.description).toBe('v2 description');

    // The newest recorded version must agree with it.
    expect(newest.snapshot['description']).toBe('v2 description');
    expect(newest.snapshot['guidance']).toBe('v2 guidance body');
  });

  /**
   * F2 — restore fidelity.
   *
   * A rollback must reconstruct the target version exactly. The gate path fills absent snapshot
   * fields from the LIVE gate (`snapshot['x'] ?? existingGate.x`), so the result matches neither
   * the target version nor the current state. The prompt path refuses instead, naming the missing
   * field.
   *
   * Expected RED against HEAD: `description` comes back as the live v2 value because the seeded
   * snapshot omits it, rather than the rollback being refused.
   */
  it('restores the recorded snapshot exactly, refusing when the record is incomplete', async () => {
    await run({
      action: 'create',
      id: GATE_ID,
      name: 'Versioning Probe',
      type: 'validation',
      description: 'v1 description',
      guidance: 'v1 guidance body',
    } as GateManagerInput);

    // Record a version whose snapshot is INCOMPLETE — no `description` key at all.
    await versionHistoryService.saveVersion(
      'gate',
      GATE_ID,
      {
        id: GATE_ID,
        name: 'Versioning Probe',
        type: 'validation',
        guidance: 'recorded guidance body',
      },
      { description: 'incomplete snapshot' }
    );

    // Move the live gate away from the recorded state.
    await run({
      action: 'update',
      id: GATE_ID,
      description: 'v2 description',
      guidance: 'v2 guidance body',
    } as GateManagerInput);

    const targetVersion = (await versionHistoryService.loadHistory('gate', GATE_ID))!.versions.find(
      (v) => v.description === 'incomplete snapshot'
    )!.version;

    const response = await run({
      action: 'rollback',
      id: GATE_ID,
      version: targetVersion,
      confirm: true,
    } as GateManagerInput);

    // An incomplete record is not restorable. Substituting the live value is what produces a
    // state matching neither version, so the rollback must be refused and the gate left alone.
    expect(response.isError).toBe(true);
    expect(readGateYaml()['description']).toBe('v2 description');
    expect(readGuidance().trim()).toBe('v2 guidance body');
  });

  /**
   * F3 — a refused rollback writes no history rows.
   *
   * `rollback()` calls `recordEditResult` before the caller can reject the restore, so a refusal
   * leaves a bridge row and a restore row behind. Target-not-found is already validated ahead of
   * any write; the incomplete-snapshot refusal is not.
   *
   * Expected RED against HEAD on the incomplete-snapshot case once F2's refusal exists; today the
   * gate path never refuses, so this asserts the row-count invariant that Tier 2 must establish.
   */
  it('leaves the version row count unchanged when a rollback is refused', async () => {
    await run({
      action: 'create',
      id: GATE_ID,
      name: 'Versioning Probe',
      type: 'validation',
      description: 'v1 description',
      guidance: 'v1 guidance body',
    } as GateManagerInput);

    await run({
      action: 'update',
      id: GATE_ID,
      description: 'v2 description',
      guidance: 'v2 guidance body',
    } as GateManagerInput);

    const before = countVersionRows();

    // Guard against a vacuous pass: if `countVersionRows` were broken and always returned 0, every
    // assertion below would hold trivially. The create+update above must have produced rows.
    expect(before).toBeGreaterThan(0);

    // Target version does not exist. `VersionHistoryService.rollback` validates this ahead of any
    // write, so the refusal must cost nothing.
    //
    // The missing-`confirm` refusal is NOT asserted here: that guard moved to the router
    // (DESTRUCTIVE_ACTIONS) and this suite drives the processor directly, so a call without
    // `confirm` no longer reaches a guard at this level. Its coverage lives in
    // tests/unit/mcp-tools/resource-manager/router.test.ts, where it is verified to red when the
    // guard is disabled.
    const missing = await run({
      action: 'rollback',
      id: GATE_ID,
      version: 9999,
      confirm: true,
    } as GateManagerInput);
    expect(missing.isError).toBe(true);
    expect(countVersionRows()).toBe(before);
  });

  /**
   * F8 — `dry_run` must move NEITHER side-effect surface.
   *
   * Both are asserted because they fail independently: an implementation that returns before the
   * file write but after `commitEdit` leaves the file untouched and the table changed, and reads
   * as correct to anyone checking only the file. The row count catches that; the file bytes catch
   * the inverse.
   */
  it('previews a rollback without writing the file or recording a version', async () => {
    await run({
      action: 'create',
      id: GATE_ID,
      name: 'Versioning Probe',
      type: 'validation',
      description: 'v1 description',
      guidance: 'v1 guidance body',
    } as GateManagerInput);

    await run({
      action: 'update',
      id: GATE_ID,
      description: 'v2 description',
      guidance: 'v2 guidance body',
    } as GateManagerInput);

    const history = (await versionHistoryService.loadHistory('gate', GATE_ID))!;
    const target = history.versions.find((v) => v.snapshot['description'] === 'v1 description')!;

    const rowsBefore = countVersionRows();
    const yamlBefore = JSON.stringify(readGateYaml());
    const guidanceBefore = readGuidance();
    expect(rowsBefore).toBeGreaterThan(0);

    const preview = await run({
      action: 'rollback',
      id: GATE_ID,
      version: target.version,
      confirm: true,
      dry_run: true,
    } as GateManagerInput);

    expect(preview.isError).toBe(false);
    expect(preview.content[0]!.text).toContain('Dry run');
    expect(preview.content[0]!.text).toContain('Nothing was written');

    expect(countVersionRows()).toBe(rowsBefore);
    expect(JSON.stringify(readGateYaml())).toBe(yamlBefore);
    expect(readGuidance()).toBe(guidanceBefore);

    // The same call without `dry_run` must actually do it — otherwise the assertions above are
    // satisfied by a rollback that is simply broken.
    const applied = await run({
      action: 'rollback',
      id: GATE_ID,
      version: target.version,
      confirm: true,
    } as GateManagerInput);

    expect(applied.isError).toBe(false);
    expect(readGateYaml()['description']).toBe('v1 description');
    expect(countVersionRows()).toBeGreaterThan(rowsBefore);
  });

  /**
   * F18 — steady state is ONE row per edit, not two.
   *
   * `recordEditResult` bridges the prior live state whenever it does not match the newest recorded
   * snapshot. That is correct once, at the era transition. It must not happen on every edit — and
   * it did, because `latestSnapshotMatches` compares `JSON.stringify` (order-sensitive) while the
   * two projections emitted the same keys in different orders. Nothing about snapshot CONTENT
   * detects that, which is why the existing assertions were all green while every gate's history
   * filled with bridge rows.
   */
  it('records one row per edit after the first, not a bridge row every time', async () => {
    await run({
      action: 'create',
      id: GATE_ID,
      name: 'Versioning Probe',
      type: 'validation',
      description: 'v1 description',
      guidance: 'v1 guidance body',
      // `pass_criteria` is load-bearing for THIS assertion, not incidental. It is an optional
      // projected key, and the key-order divergence F18 describes only appears once at least one
      // optional key is present — with none, both projections emit the same five required keys in
      // the same order and the test cannot fail. A fixture inside the bound proves nothing.
      pass_criteria: [{ type: 'inline_guidance', min_length: 10, required_patterns: ['ALPHA'] }],
    } as GateManagerInput);

    await run({
      action: 'update',
      id: GATE_ID,
      description: 'v2 description',
    } as GateManagerInput);

    // The first update bridges: nothing was recorded at create time, so the live pre-edit state is
    // genuinely unrecorded. From here the newest row already equals the live state.
    const afterFirst = countVersionRows();

    await run({
      action: 'update',
      id: GATE_ID,
      description: 'v3 description',
    } as GateManagerInput);

    expect(countVersionRows() - afterFirst).toBe(1);

    const history = (await versionHistoryService.loadHistory('gate', GATE_ID))!;
    const bridges = history.versions.filter((v) => v.description.startsWith('Bridge:'));
    expect(bridges).toHaveLength(1);
  });

  it('previews a delete without removing the gate directory', async () => {
    await run({
      action: 'create',
      id: GATE_ID,
      name: 'Versioning Probe',
      type: 'validation',
      description: 'v1 description',
      guidance: 'v1 guidance body',
    } as GateManagerInput);

    const preview = await run({
      action: 'delete',
      id: GATE_ID,
      confirm: true,
      dry_run: true,
    } as GateManagerInput);

    expect(preview.isError).toBe(false);
    expect(preview.content[0]!.text).toContain('Dry run');
    expect(readGateYaml()['id']).toBe(GATE_ID);
  });
});

describe('Framework versioning through the real write path', () => {
  const FRAMEWORK_ID = 'probe-framework';

  let tempDir: string;
  let dbManager: SqliteEngine;
  let versionHistoryService: VersionHistoryService;
  let fileService: FrameworkFileWriter;
  let lifecycle: FrameworkLifecycleProcessor;
  let versioning: FrameworkVersioningProcessor;
  let mockLogger: MockLogger;
  /** Live view the processors read through `frameworkManager.getFramework()`. */
  let liveFramework: { id: string; name: string; description: string };

  function frameworkYamlPath(): string {
    return path.join(tempDir, 'resources', 'frameworks', FRAMEWORK_ID, 'framework.yaml');
  }

  function readFrameworkYaml(): Record<string, unknown> {
    return parseYamlOrThrow<Record<string, unknown>>(readFileSync(frameworkYamlPath(), 'utf8'));
  }

  /** Re-read the framework from disk into the live view — the registry-reload discipline. */
  function reloadFramework(): void {
    const yaml = readFrameworkYaml();
    liveFramework = {
      id: String(yaml['id'] ?? FRAMEWORK_ID),
      name: String(yaml['name'] ?? ''),
      description: String(yaml['description'] ?? ''),
    };
  }

  beforeEach(async () => {
    mockLogger = new MockLogger();
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'framework-versioning-test-'));

    dbManager = await SqliteEngine.getInstance(tempDir, mockLogger as unknown as Logger);
    await dbManager.initialize();

    versionHistoryService = new VersionHistoryService({
      logger: mockLogger as unknown as Logger,
      configManager: new TestVersioningConfigProvider(),
      dbManager,
    });

    // `getFrameworkDir` resolves to <serverRoot>/resources/frameworks/<id>.
    const configManager = {
      getServerRoot: () => tempDir,
    } as unknown as ConfigManager;

    fileService = new FrameworkFileWriter({
      logger: mockLogger as unknown as Logger,
      configManager,
    });

    liveFramework = { id: FRAMEWORK_ID, name: '', description: '' };

    const ctx: FrameworkResourceContext = {
      logger: mockLogger as unknown as Logger,
      frameworkManager: {
        getFramework: (id: string) => (id === FRAMEWORK_ID ? liveFramework : undefined),
      } as unknown as FrameworkResourceContext['frameworkManager'],
      configManager,
      fileService,
      textDiffService: new ObjectDiffGenerator(),
      versionHistoryService,
      onRefresh: async () => {
        reloadFramework();
      },
    };

    lifecycle = new FrameworkLifecycleProcessor(
      ctx,
      // handleUpdate and handleRollback never reach the draft validator; only handleCreate does,
      // and this suite seeds files directly rather than driving creation through it.
      {} as unknown as ConstructorParameters<typeof FrameworkLifecycleProcessor>[1]
    );
    versioning = new FrameworkVersioningProcessor(ctx);

    // Seed v1 straight through the real writer, bypassing handleCreate's validation gauntlet:
    // F1 lives in handleUpdate and F2 in handleRollback, so creation is setup, not subject.
    await fileService.writeFrameworkFiles({
      id: FRAMEWORK_ID,
      name: 'v1 name',
      type: 'PROBE',
      description: 'v1 description',
      system_prompt_guidance: 'v1 guidance',
      enabled: true,
    });
    reloadFramework();
  });

  afterEach(async () => {
    try {
      await dbManager.shutdown();
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  /**
   * F1 — go-forward numbering, framework mirror of the gate case above.
   *
   * Expected RED against HEAD: `saveVersion(beforeState)` records the state the edit replaced.
   */
  it('records the state each edit produced, so the newest version matches the live framework', async () => {
    await lifecycle.handleUpdate({
      action: 'update',
      id: FRAMEWORK_ID,
      name: 'v2 name',
    } as FrameworkManagerInput);
    reloadFramework();

    const history = await versionHistoryService.loadHistory('framework', FRAMEWORK_ID);
    expect(history).not.toBeNull();

    expect(liveFramework.name).toBe('v2 name');
    expect(history!.versions[0]!.snapshot['name']).toBe('v2 name');
  });

  /**
   * F2 — restore fidelity, framework mirror.
   *
   * Expected RED against HEAD: `snapshot['name'] ?? existingFramework.name` substitutes the live
   * value for the absent one instead of refusing.
   */
  it('restores the recorded snapshot exactly, refusing when the record is incomplete', async () => {
    // A version whose snapshot omits `name` entirely.
    await versionHistoryService.saveVersion(
      'framework',
      FRAMEWORK_ID,
      { id: FRAMEWORK_ID, type: 'PROBE', description: 'recorded description', enabled: true },
      { description: 'incomplete snapshot' }
    );

    await lifecycle.handleUpdate({
      action: 'update',
      id: FRAMEWORK_ID,
      name: 'v2 name',
    } as FrameworkManagerInput);
    reloadFramework();

    const target = (await versionHistoryService.loadHistory(
      'framework',
      FRAMEWORK_ID
    ))!.versions.find((v) => v.description === 'incomplete snapshot')!.version;

    const response = await versioning.handleRollback({
      action: 'rollback',
      id: FRAMEWORK_ID,
      version: target,
      confirm: true,
    } as FrameworkManagerInput);
    reloadFramework();

    expect(response.isError).toBe(true);
    expect(readFrameworkYaml()['name']).toBe('v2 name');
  });
});

describe('Prompt rollback refusal writes no version rows', () => {
  const PROMPT_ID = 'refusal_probe';
  const CATEGORY = 'general';

  let tempDir: string;
  let promptsDir: string;
  let dbManager: SqliteEngine;
  let versionHistoryService: VersionHistoryService;
  let fileOperations: FileOperations;
  let processor: PromptVersioningProcessor;
  let convertedPrompts: Array<Record<string, unknown>>;
  let mockLogger: MockLogger;

  function countPromptVersionRows(): number {
    const row = dbManager.queryOne<{ cnt: number }>(
      `SELECT COUNT(*) as cnt FROM version_history WHERE resource_type = ? AND resource_id = ?`,
      ['prompt', PROMPT_ID]
    );
    return row?.cnt ?? 0;
  }

  beforeEach(async () => {
    mockLogger = new MockLogger();
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'prompt-refusal-test-'));
    promptsDir = path.join(tempDir, 'prompts');

    dbManager = await SqliteEngine.getInstance(tempDir, mockLogger as unknown as Logger);
    await dbManager.initialize();

    versionHistoryService = new VersionHistoryService({
      logger: mockLogger as unknown as Logger,
      configManager: new TestVersioningConfigProvider(),
      dbManager,
    });

    fileOperations = new FileOperations({
      logger: mockLogger as unknown as Logger,
      configManager: {
        getResolvedPromptsDirectory: () => promptsDir,
      } as unknown as ConfigManager,
    });

    convertedPrompts = [];
    processor = new PromptVersioningProcessor({
      dependencies: {
        logger: mockLogger as unknown as Logger,
        onRefresh: async () => {},
      },
      fileOperations,
      versionHistoryService,
      getData: () => ({ convertedPrompts }),
    } as unknown as PromptResourceContext);
  });

  afterEach(async () => {
    try {
      await dbManager.shutdown();
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  /**
   * F3 — the one refusal path reachable today that DOES write.
   *
   * `VersionHistoryService.rollback` calls `recordEditResult` — writing a bridge row and a restore
   * row — and only then does `buildRestoreFromSnapshot` reject an incomplete snapshot. The
   * processor's own error text admits it. Target-not-found and missing-`confirm` are both
   * validated ahead of any write and are covered by the gate suite above (DEV-T0-1).
   *
   * Expected RED against HEAD: the row count grows by the bridge row plus the restore row even
   * though the prompt is correctly left untouched.
   */
  it('writes no version rows when the target snapshot is not restorable', async () => {
    await fileOperations.updatePromptImplementation({
      id: PROMPT_ID,
      name: 'Refusal Probe',
      category: CATEGORY,
      description: 'live description',
      userMessageTemplate: 'live template',
      arguments: [],
    });

    // A snapshot missing `userMessageTemplate` — a REQUIRED_SNAPSHOT_FIELDS member, so the
    // restore builder must refuse rather than substitute the live value.
    await versionHistoryService.saveVersion(
      'prompt',
      PROMPT_ID,
      {
        id: PROMPT_ID,
        name: 'Refusal Probe',
        category: CATEGORY,
        description: 'recorded description',
        arguments: [],
      },
      { description: 'incomplete snapshot' }
    );

    convertedPrompts = [
      {
        id: PROMPT_ID,
        name: 'Refusal Probe',
        category: CATEGORY,
        description: 'live description',
        userMessageTemplate: 'live template',
        arguments: [],
      },
    ];

    const before = countPromptVersionRows();
    // Vacuity guard: the seeded version above must actually be in the table.
    expect(before).toBeGreaterThan(0);

    const response = await processor.handleRollback({
      action: 'rollback',
      id: PROMPT_ID,
      version: 1,
      confirm: true,
    });

    // The refusal itself is correct — this is the behaviour to preserve.
    expect(response.isError).toBe(true);

    // Nothing was restorable, so nothing should have been recorded.
    expect(countPromptVersionRows()).toBe(before);
  });
});
