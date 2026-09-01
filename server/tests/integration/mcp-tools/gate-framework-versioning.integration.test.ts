/**
 * Gate + Framework Versioning Through the Real Write Path
 *
 * Closes the coverage gap recorded as F10 in
 * `plans/reference/technical-debt/resource-versioning-consolidation-2026-08-17.md`: the existing
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

import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';

import { SqliteEngine } from '../../../src/infra/database/index.js';
import { ObjectDiffGenerator } from '../../../src/mcp/tools/resource-manager/prompt/analysis/object-diff-generator.js';
import { GateFileWriter } from '../../../src/mcp/tools/gate-manager/services/gate-file-writer.js';
import { GateLifecycleProcessor } from '../../../src/mcp/tools/gate-manager/services/gate-lifecycle-processor.js';
import { GateVersioningProcessor } from '../../../src/mcp/tools/gate-manager/services/gate-versioning-processor.js';
import { validateFrameworkSchema } from '../../../src/engine/frameworks/definitions/framework-schema.js';
import { FrameworkDraftValidator } from '../../../src/mcp/tools/framework-manager/services/framework-draft-validator.js';
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
import type {
  FrameworkCreationData,
  FrameworkManagerInput,
} from '../../../src/mcp/tools/framework-manager/core/types.js';
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
  getFrameworksDirectory(): string {
    return path.join(process.cwd(), 'resources', 'frameworks');
  }
  getBundledResourceDirectory(): string | undefined {
    return undefined;
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
      getBundledResourceDirectory: () => undefined,
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

  /**
   * The safety property the plan says must survive: **validate → record → write**.
   *
   * The ordering is the whole reason `commitEdit`/`recordEditResult` is called before the file
   * writer rather than after it — a persistence failure has to abort the edit with nothing on
   * disk, because the alternative is a file whose current state is recorded in no version row.
   * That is precisely F1's defect arriving through a different door, and it is unrecoverable: the
   * operator cannot roll back to a state that was never written down.
   *
   * Nothing asserted it until now. The ordering is correct at HEAD and commented in all three
   * lifecycle processors, so every existing test passes either way — which is the same shape as
   * `workspace-and-mutations.yaml:24-29`, an assertion that held while its mutation never ran.
   *
   * Fault injection rather than a real disk failure: the property is about ORDER, and a spy that
   * throws where persistence throws observes order without needing the filesystem to cooperate.
   * `recordEditResult` is the seam because `commitEdit` delegates to it, so one fault covers the
   * update path (which calls `recordEditResult` directly) and the rollback path (which reaches it
   * through `commitEdit`).
   */
  describe('safety property — a persistence failure leaves the file unmodified', () => {
    /** Replace the persistence step with one that throws the way `saveVersion` throws. */
    function failPersistence(method: 'recordEditResult' | 'commitEdit') {
      return jest
        .spyOn(versionHistoryService, method)
        .mockRejectedValue(new Error('Failed to save version: disk full') as never);
    }

    it('aborts an update with nothing written when recording the version throws', async () => {
      await run({
        action: 'create',
        id: GATE_ID,
        name: 'Versioning Probe',
        type: 'validation',
        description: 'v1 description',
        guidance: 'v1 guidance body',
      } as GateManagerInput);

      // Captured as bytes, not as a parsed object: the claim is that the file was never opened
      // for writing, and a re-serialized comparison would forgive a rewrite that happened to
      // round-trip to the same YAML.
      const yamlBefore = readFileSync(path.join(gatesDir, GATE_ID, 'gate.yaml'), 'utf8');
      const guidanceBefore = readGuidance();
      const rowsBefore = countVersionRows();

      const spy = failPersistence('recordEditResult');
      let persistenceWasReached = false;
      try {
        // The handler boundary owns the catch (architecture.md), so this surfaces as an error
        // response rather than a rejection. Either is acceptable — what must NOT happen is a
        // success, so both shapes are funnelled into one assertion below.
        const outcome = await run({
          action: 'update',
          id: GATE_ID,
          description: 'v2 description',
          guidance: 'v2 guidance body',
        } as GateManagerInput).catch((error: unknown) => ({
          isError: true,
          content: [{ text: String(error) }],
        }));

        expect(outcome.isError).toBe(true);
        // Read before `mockRestore`, which resets `mock.calls` along with the implementation.
        persistenceWasReached = spy.mock.calls.length > 0;
      } finally {
        spy.mockRestore();
      }

      expect(readFileSync(path.join(gatesDir, GATE_ID, 'gate.yaml'), 'utf8')).toBe(yamlBefore);
      expect(readGuidance()).toBe(guidanceBefore);
      expect(countVersionRows()).toBe(rowsBefore);

      // Guard against a vacuous pass. If the update had been rejected before it ever reached the
      // persistence step — an unknown id, a validation refusal — the file would also be
      // unchanged, and this test would assert nothing about ordering. The fault having been
      // reached is what makes the untouched file evidence about `record → write` specifically.
      expect(persistenceWasReached).toBe(true);
    });

    it('aborts a rollback with nothing written when committing the edit throws', async () => {
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

      const yamlBefore = readFileSync(path.join(gatesDir, GATE_ID, 'gate.yaml'), 'utf8');
      const guidanceBefore = readGuidance();
      const rowsBefore = countVersionRows();

      const spy = failPersistence('commitEdit');
      let persistenceWasReached = false;
      try {
        const outcome = await run({
          action: 'rollback',
          id: GATE_ID,
          version: target.version,
          confirm: true,
        } as GateManagerInput).catch((error: unknown) => ({
          isError: true,
          content: [{ text: String(error) }],
        }));

        expect(outcome.isError).toBe(true);
        // Read before `mockRestore`, which resets `mock.calls` along with the implementation.
        persistenceWasReached = spy.mock.calls.length > 0;
      } finally {
        spy.mockRestore();
      }

      // The gate still holds v2 — the rollback the operator asked for did not half-happen.
      expect(readFileSync(path.join(gatesDir, GATE_ID, 'gate.yaml'), 'utf8')).toBe(yamlBefore);
      expect(readGuidance()).toBe(guidanceBefore);
      expect(countVersionRows()).toBe(rowsBefore);
      expect(persistenceWasReached).toBe(true);
    });
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
      getFrameworksDirectory: () => path.join(tempDir, 'resources', 'frameworks'),
      getBundledResourceDirectory: () => undefined,
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
        getBundledResourceDirectory: () => undefined,
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

/**
 * F17 — a created gate must be usable by the process that created it.
 *
 * WHY THIS NEEDS ITS OWN HARNESS. The suites above wire `onRefresh` to
 * `registry.reload(GATE_ID)`, and their `run()` helper reloads after every action. Production does
 * neither: the gate handler's `onRefresh` resolves to the application's full server refresh, which
 * reloads PROMPT data and never touches the gate registry. That makes the doubles above strictly
 * more capable than the real wiring, and it is why F17 lived through a green suite — every test
 * that could have caught it was handed a registry that refreshed itself.
 *
 * So this block models the real thing: `onRefresh` does not touch the gate registry, and no helper
 * reloads between calls. What survives here is what survives in the server.
 */
describe('gate registry coherence — production-shaped refresh (F17)', () => {
  const ID = 'coherence-probe';

  let tempDir: string;
  let gatesDir: string;
  let dbManager: SqliteEngine;
  let registry: DriftableGateRegistry;
  let lifecycle: GateLifecycleProcessor;
  let mockLogger: MockLogger;
  let promptRefreshes: number;

  /**
   * Adds `unregister` to the disk-backed double, which `handleDelete` calls and which no test
   * above reaches (the only delete case there is `dry_run`, which returns first).
   */
  class DriftableGateRegistry {
    private cache = new Map<string, Record<string, unknown>>();

    constructor(private readonly dir: string) {}

    has(id: string): boolean {
      return this.cache.has(id);
    }

    get(id: string): Record<string, unknown> | undefined {
      return this.cache.get(id);
    }

    unregister(id: string): boolean {
      return this.cache.delete(id);
    }

    /** Mirrors `GateRegistry.reloadGuide`: reads from disk and registers whether or not known. */
    async reload(id: string): Promise<boolean> {
      const yamlPath = path.join(this.dir, id, 'gate.yaml');
      if (!existsSync(yamlPath)) {
        this.cache.delete(id);
        return false;
      }
      this.cache.set(id, parseYamlOrThrow<Record<string, unknown>>(readFileSync(yamlPath, 'utf8')));
      return true;
    }
  }

  beforeEach(async () => {
    mockLogger = new MockLogger();
    promptRefreshes = 0;
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'gate-coherence-test-'));
    gatesDir = path.join(tempDir, 'gates');
    await fs.mkdir(gatesDir, { recursive: true });

    dbManager = await SqliteEngine.getInstance(tempDir, mockLogger as unknown as Logger);
    await dbManager.initialize();

    registry = new DriftableGateRegistry(gatesDir);

    const configManager = {
      getGatesDirectory: () => gatesDir,
      getBundledResourceDirectory: () => undefined,
    } as unknown as ConfigManager;

    const ctx: GateResourceContext = {
      logger: mockLogger as unknown as Logger,
      gateManager: registry as unknown as GateResourceContext['gateManager'],
      configManager,
      textDiffService: new ObjectDiffGenerator(),
      versionHistoryService: new VersionHistoryService({
        logger: mockLogger as unknown as Logger,
        configManager: new TestVersioningConfigProvider(),
        dbManager,
      }),
      gateFileService: new GateFileWriter({
        logger: mockLogger as unknown as Logger,
        configManager,
      }),
      // The point of this harness. Production's refresh reloads prompt-side state and leaves the
      // gate registry alone; counting calls proves it still runs without being what registers.
      onRefresh: async () => {
        promptRefreshes += 1;
      },
    };

    lifecycle = new GateLifecycleProcessor(ctx);
  });

  afterEach(async () => {
    try {
      await dbManager.shutdown();
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  async function create() {
    return lifecycle.handleCreate({
      action: 'create',
      id: ID,
      name: 'Coherence Probe',
      type: 'validation',
      description: 'd1',
      guidance: 'g1 guidance body',
    } as GateManagerInput);
  }

  it('registers the gate it just created, so the creating process can use it', async () => {
    const response = await create();

    expect(response.isError).toBe(false);
    // The claim under test is registry membership, not the wording — a message saying "reloaded"
    // is what shipped before, and it was false.
    expect(registry.has(ID)).toBe(true);
    expect(existsSync(path.join(gatesDir, ID, 'gate.yaml'))).toBe(true);

    // The prompt-side refresh still runs; it is simply not what makes the gate resolvable.
    expect(promptRefreshes).toBe(1);
  });

  it('says the gate is not active instead of claiming a reload, when registration fails', async () => {
    // Force the failure mode the old message asserted away. An operator who hits this needs to
    // learn it from the create response, not from the next action returning "not found".
    jest.spyOn(registry, 'reload').mockResolvedValue(false as never);

    const response = await create();
    const text = response.content[0]!.text!;

    expect(text).toContain('NOT active');
    expect(text).toContain('reload');
    expect(text).not.toContain('Gate registry reloaded');
    // Still not an error: the files really were written, and saying otherwise is its own lie.
    expect(response.isError).toBe(false);
    expect(existsSync(path.join(gatesDir, ID, 'gate.yaml'))).toBe(true);
  });

  it('deletes a gate that is on disk but absent from the registry', async () => {
    await create();
    // Drift: on disk, unknown to the registry. This is the exact state a pre-fix create produced,
    // and the state in which the tool could not clean up after itself.
    registry.unregister(ID);
    expect(registry.has(ID)).toBe(false);

    const response = await lifecycle.handleDelete({
      action: 'delete',
      id: ID,
      confirm: true,
    } as GateManagerInput);

    expect(response.isError).toBe(false);
    expect(existsSync(path.join(gatesDir, ID))).toBe(false);
    // The message reports which removal happened rather than asserting both.
    expect(response.content[0]!.text).toContain('not in the gate registry');
  });

  it('reloads a gate that is on disk but absent from the registry', async () => {
    await create();
    registry.unregister(ID);

    const response = await lifecycle.handleReload({
      action: 'reload',
      id: ID,
    } as GateManagerInput);

    expect(response.isError).toBe(false);
    expect(registry.has(ID)).toBe(true);
  });

  it('still refuses to reload an id with nothing on disk, naming the path it looked at', async () => {
    // Guards the guard removal: dropping the membership check must not turn a genuine miss into a
    // silent success. The refusal should point at the registry/disk, not at the caller's id.
    const response = await lifecycle.handleReload({
      action: 'reload',
      id: 'no-such-gate',
    } as GateManagerInput);

    expect(response.isError).toBe(true);
    expect(response.content[0]!.text).toContain('no gate definition could be loaded from disk');
    expect(response.content[0]!.text).toContain('no-such-gate');
  });
});

describe('framework create — pre-write and post-write validation must agree (G1)', () => {
  const ID = 'g1-agreement-probe';

  let tempDir: string;
  let frameworksDir: string;
  let mockLogger: MockLogger;
  let draftValidator: FrameworkDraftValidator;
  let fileService: FrameworkFileWriter;
  let lifecycle: FrameworkLifecycleProcessor;
  let registeredGuides: Set<string>;
  let registeredFrameworks: Set<string>;

  /**
   * The draft a caller sends. It satisfies every check `FrameworkDraftValidator` performs
   * (`system_prompt_guidance` non-empty, `phases` non-empty, `framework_gates` non-empty) and is
   * rejected by `validateFrameworkSchema` on the file the writer produces from it, because
   * `FrameworkGateSchema` requires `name` on every entry and the draft validator never inspects
   * array elements.
   *
   * `framework_gates` is not a declared parameter on `resourceManagerInputSchema` nor in
   * `tooling/contracts/resource-manager.json` — it reaches the handler only through
   * `.passthrough()` — so a caller has no advertised element shape to conform to, while the draft
   * validator hard-requires the field.
   */
  function draft(): FrameworkCreationData {
    return {
      id: ID,
      name: 'G1 Agreement Probe',
      type: 'G1_AGREEMENT_PROBE',
      system_prompt_guidance: 'Apply the probe method.',
      enabled: true,
      phases: [
        { id: 'analyze', name: 'Analyze', description: 'Understand the problem' },
        { id: 'design', name: 'Design', description: 'Plan the solution' },
      ],
      framework_gates: [
        { id: 'analysis-complete', description: 'Validates the analysis phase' },
      ] as unknown as NonNullable<FrameworkCreationData['framework_gates']>,
    };
  }

  function frameworkYamlPath(): string {
    return path.join(frameworksDir, ID, 'framework.yaml');
  }

  /**
   * Registry double mirroring `RuntimeFrameworkLoader`'s load gate exactly: `validateOnLoad`
   * runs `validateFrameworkSchema` on the on-disk definition and returns `undefined` when it
   * fails (`runtime-framework-loader.ts:286-294`). Registering unconditionally would make the
   * double MORE capable than production and would hide the fact that relaxing the transaction
   * verifier alone just moves the same rejection to `createFrameworkAtomic` step 3.
   */
  function makeRegistry() {
    return {
      hasGuide: (id: string) => registeredGuides.has(id),
      unregisterGuide: (id: string) => registeredGuides.delete(id),
      getRuntimeLoader: () => ({ clearCache: () => undefined }),
      loadAndRegisterById: async (id: string) => {
        const yamlPath = path.join(frameworksDir, id, 'framework.yaml');
        if (!existsSync(yamlPath)) return false;
        const data = parseYamlOrThrow<Record<string, unknown>>(readFileSync(yamlPath, 'utf8'));
        if (!validateFrameworkSchema(data, id).valid) return false;
        registeredGuides.add(id);
        return true;
      },
    };
  }

  beforeEach(async () => {
    mockLogger = new MockLogger();
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'framework-g1-'));
    frameworksDir = path.join(tempDir, 'resources', 'frameworks');
    registeredGuides = new Set<string>();
    registeredFrameworks = new Set<string>();

    const configManager = {
      getServerRoot: () => tempDir,
      getFrameworksDirectory: () => path.join(tempDir, 'resources', 'frameworks'),
      getBundledResourceDirectory: () => undefined,
    } as unknown as ConfigManager;

    // Real writer, real ResourceMutationTransaction, real ResourceVerificationService.
    fileService = new FrameworkFileWriter({
      logger: mockLogger as unknown as Logger,
      configManager,
    });
    draftValidator = new FrameworkDraftValidator();

    const ctx: FrameworkResourceContext = {
      logger: mockLogger as unknown as Logger,
      frameworkManager: {
        getFramework: (id: string) => (registeredFrameworks.has(id) ? { id } : undefined),
        getFrameworkRegistry: makeRegistry,
        registerFramework: async (id: string) => {
          if (!registeredGuides.has(id.toLowerCase())) return false;
          registeredFrameworks.add(id);
          return true;
        },
      } as unknown as FrameworkResourceContext['frameworkManager'],
      configManager,
      fileService,
      textDiffService: new ObjectDiffGenerator(),
      // `handleCreate` never reaches versioning. Throwing rather than stubbing means a future
      // edit that starts using it fails loudly instead of silently exercising a double.
      versionHistoryService: new Proxy(
        {},
        {
          get() {
            throw new Error('handleCreate must not reach versionHistoryService');
          },
        }
      ) as unknown as FrameworkResourceContext['versionHistoryService'],
      onRefresh: async () => undefined,
    };

    lifecycle = new FrameworkLifecycleProcessor(ctx, draftValidator);
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  /**
   * The invariant, stated without pre-committing to which layer is wrong (R-2 is the operator's
   * ruling): the pre-write validator's verdict on a draft and the post-write verifier's verdict
   * on the file built from that same draft must be the same verdict.
   *
   * RED against HEAD: draft accepted, write rolled back.
   */
  it('does not accept a draft pre-write and reject the file built from it post-write', async () => {
    const payload = draft();

    const draftVerdict = draftValidator.validate(payload);
    const writeResult = await fileService.writeFrameworkFiles(payload, null);

    expect(writeResult.success).toBe(draftVerdict.valid);
  });

  /**
   * Same invariant at the tool surface, through the real `handleCreate` — the path an operator
   * drives. Ruling-agnostic in the same way: whichever layer ends up owning the rejection, the
   * handler's verdict must match the draft validator's.
   *
   * RED against HEAD: the draft validator passes, so `handleCreate` reports success-then-rollback.
   */
  it('reports the same verdict from handleCreate as the draft validator gave', async () => {
    const payload = draft();
    const draftVerdict = draftValidator.validate(payload);

    const response = await lifecycle.handleCreate({
      action: 'create',
      id: payload.id,
      name: payload.name,
      framework: payload.type,
      system_prompt_guidance: payload.system_prompt_guidance,
      phases: payload.phases,
      framework_gates: payload.framework_gates,
    } as FrameworkManagerInput);

    expect(response.isError).toBe(!draftVerdict.valid);
    expect(existsSync(frameworkYamlPath())).toBe(draftVerdict.valid);
  });

  /**
   * The agreement invariant above is satisfied by a validator that rejects EVERYTHING, so it
   * cannot on its own show the fix is the right one. This is the other half: the same draft with
   * a `name` on the gate entry must be accepted by BOTH layers and reach disk.
   *
   * FALSIFICATION: make `validateElementShapes` return a constant error and this reds while the
   * two agreement tests stay green.
   */
  it('accepts a well-formed draft at both layers and writes the file', async () => {
    const payload = draft();
    payload.framework_gates = [
      {
        id: 'analysis-complete',
        name: 'Analysis Gate',
        description: 'Validates the analysis phase',
        frameworkArea: 'analysis',
        priority: 'high',
        validationCriteria: ['Problem clearly defined'],
      },
    ];

    const draftVerdict = draftValidator.validate(payload);
    expect(draftVerdict.valid).toBe(true);

    const response = await lifecycle.handleCreate({
      action: 'create',
      id: payload.id,
      name: payload.name,
      framework: payload.type,
      system_prompt_guidance: payload.system_prompt_guidance,
      phases: payload.phases,
      framework_gates: payload.framework_gates,
    } as FrameworkManagerInput);

    expect(response.isError).toBe(false);
    expect(existsSync(frameworkYamlPath())).toBe(true);
    expect(registeredFrameworks.has(ID)).toBe(true);
  });

  /**
   * G3's requirement stated at the surface an operator actually reads. The rejection must name
   * the FIELD and the EXPECTATION, and must still hand over the worked example — which before
   * this change was reachable only when `framework_gates` was absent entirely, never when it was
   * present but under-specified (implementation notes M-4).
   */
  it('names the offending field and expectation, and still shows the example', async () => {
    const payload = draft();

    const response = await lifecycle.handleCreate({
      action: 'create',
      id: payload.id,
      name: payload.name,
      framework: payload.type,
      system_prompt_guidance: payload.system_prompt_guidance,
      phases: payload.phases,
      framework_gates: payload.framework_gates,
    } as FrameworkManagerInput);

    const text = response.content[0]!.text!;
    expect(response.isError).toBe(true);
    expect(text).toContain('framework_gates[0].name');
    expect(text).toContain('expected string, received undefined');
    // The example is what tells a caller the shape; `framework_gates` is not a declared parameter
    // anywhere on the tool surface, so this response is the only place it is published.
    expect(text).toContain('**Example framework_gates:**');
    expect(text).toContain('Analysis Gate');
  });
});

/**
 * G2 — the framework half of the F17 shape, with the same harness discipline.
 *
 * `onRefresh` for this tool is supplied at `src/mcp/tools/index.ts:597-600` and its entire body is
 * a comment plus `logger.debug`. So the context below wires it to a COUNTER and nothing else: it
 * must still run, and it must not be what makes an edit visible. A double that reloaded the
 * registry from `onRefresh` would be strictly more capable than production, which is exactly how
 * the gate-side defect lived through a green suite.
 *
 * ONE double stands in for three production objects — `RuntimeFrameworkLoader`,
 * `FrameworkRegistry` and `FrameworkManager`. What production does differently, stated so a green
 * run is not over-read:
 *
 *  - `FrameworkManager.registerFramework` runs `generateSingleFrameworkDefinition(guide)` and
 *    stores a `FrameworkDefinition`; this double stores the parsed YAML, so `getFramework()`
 *    returns raw fields. Tests therefore assert on `name`, which survives both shapes.
 *  - `RuntimeFrameworkLoader` reads a directory of files and resolves overlays; this reads one
 *    `framework.yaml`.
 *  - The loader's cache and its `validateOnLoad` gate ARE modelled, deliberately: a cache that
 *    self-cleared would hide the `clearCache`-before-register ordering, and a load that skipped
 *    `validateFrameworkSchema` would hide that an invalid file cannot register at all.
 */
describe('framework registry coherence — production-shaped refresh (G2)', () => {
  const ID = 'framework-coherence-probe';

  let tempDir: string;
  let frameworksDir: string;
  let mockLogger: MockLogger;
  let fileService: FrameworkFileWriter;
  let lifecycle: FrameworkLifecycleProcessor;
  let registry: DriftableFrameworkRegistry;
  let promptRefreshes: number;

  class DriftableFrameworkRegistry {
    /** `RuntimeFrameworkLoader`'s parsed-definition cache. Cleared ONLY by `clearCache`. */
    private readonly loaderCache = new Map<string, Record<string, unknown>>();
    private readonly guides = new Map<string, Record<string, unknown>>();
    private readonly frameworks = new Map<string, Record<string, unknown>>();
    /** Recorded so a test can assert the ordering rather than only its consequence. */
    readonly clearCacheCalls: string[] = [];

    constructor(private readonly dir: string) {}

    // ---- RuntimeFrameworkLoader surface -------------------------------------------------
    getRuntimeLoader(): { clearCache: (id?: string) => void } {
      return { clearCache: (id?: string) => this.clearCache(id) };
    }

    clearCache(id?: string): void {
      this.clearCacheCalls.push(id ?? '(all)');
      if (id === undefined) this.loaderCache.clear();
      else this.loaderCache.delete(id.toLowerCase());
    }

    /** Mirrors the loader's read path, INCLUDING its `validateOnLoad` default of true. */
    private load(id: string): Record<string, unknown> | undefined {
      const cached = this.loaderCache.get(id);
      if (cached !== undefined) return cached;

      const yamlPath = path.join(this.dir, id, 'framework.yaml');
      if (!existsSync(yamlPath)) return undefined;
      const data = parseYamlOrThrow<Record<string, unknown>>(readFileSync(yamlPath, 'utf8'));
      if (!validateFrameworkSchema(data, id).valid) return undefined;
      this.loaderCache.set(id, data);
      return data;
    }

    // ---- FrameworkRegistry surface ------------------------------------------------------
    getFrameworkRegistry(): DriftableFrameworkRegistry {
      return this;
    }

    hasGuide(id: string): boolean {
      return this.guides.has(id.toLowerCase());
    }

    unregisterGuide(id: string): boolean {
      return this.guides.delete(id.toLowerCase());
    }

    async loadAndRegisterById(id: string): Promise<boolean> {
      const data = this.load(id.toLowerCase());
      if (data === undefined) return false;
      this.guides.set(id.toLowerCase(), data);
      return true;
    }

    // ---- FrameworkManager surface -------------------------------------------------------
    getFramework(id: string): Record<string, unknown> | undefined {
      return this.frameworks.get(id.toLowerCase());
    }

    async registerFramework(id: string): Promise<boolean> {
      const loaded = await this.loadAndRegisterById(id);
      if (!loaded) return false;
      this.frameworks.set(id.toLowerCase(), this.guides.get(id.toLowerCase())!);
      return true;
    }

    unregister(id: string): boolean {
      const hadDefinition = this.frameworks.delete(id.toLowerCase());
      const hadGuide = this.guides.delete(id.toLowerCase());
      return hadDefinition || hadGuide;
    }

    /** Test-only drift: forget the framework while leaving its files on disk. */
    forget(id: string): void {
      this.unregister(id);
    }
  }

  beforeEach(async () => {
    mockLogger = new MockLogger();
    promptRefreshes = 0;
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'framework-coherence-'));
    frameworksDir = path.join(tempDir, 'resources', 'frameworks');
    await fs.mkdir(frameworksDir, { recursive: true });

    const configManager = {
      getServerRoot: () => tempDir,
      getFrameworksDirectory: () => path.join(tempDir, 'resources', 'frameworks'),
      getBundledResourceDirectory: () => undefined,
    } as unknown as ConfigManager;
    fileService = new FrameworkFileWriter({
      logger: mockLogger as unknown as Logger,
      configManager,
    });
    registry = new DriftableFrameworkRegistry(frameworksDir);

    const ctx: FrameworkResourceContext = {
      logger: mockLogger as unknown as Logger,
      frameworkManager: registry as unknown as FrameworkResourceContext['frameworkManager'],
      configManager,
      fileService,
      textDiffService: new ObjectDiffGenerator(),
      // Answers exactly one question and throws for everything else, so a future edit that starts
      // using versioning fails loudly rather than silently exercising a stub.
      versionHistoryService: new Proxy(
        {},
        {
          get(_target, property) {
            if (property === 'isAutoVersionEnabled') return () => false;
            throw new Error(
              `this harness does not provide versionHistoryService.${String(property)}`
            );
          },
        }
      ) as unknown as FrameworkResourceContext['versionHistoryService'],
      // The point of this harness. Production's refresh is a `logger.debug`; counting calls proves
      // it still runs without being what registers.
      onRefresh: async () => {
        promptRefreshes += 1;
      },
    };

    lifecycle = new FrameworkLifecycleProcessor(ctx, new FrameworkDraftValidator());
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  async function create(name = 'Original Name') {
    return lifecycle.handleCreate({
      action: 'create',
      id: ID,
      name,
      framework: 'COHERENCE_PROBE',
      system_prompt_guidance: 'Apply the coherence probe.',
      phases: [{ id: 'analyze', name: 'Analyze', description: 'Understand the problem' }],
      framework_gates: [
        {
          id: 'analysis-complete',
          name: 'Analysis Gate',
          description: 'Validates the analysis phase',
          frameworkArea: 'analysis',
          priority: 'high',
          validationCriteria: ['Problem clearly defined'],
        },
      ],
    } as FrameworkManagerInput);
  }

  it('makes an update visible to the process that made it, in one process', async () => {
    expect((await create()).isError).toBe(false);
    expect(registry.getFramework(ID)?.['name']).toBe('Original Name');

    const response = await lifecycle.handleUpdate({
      action: 'update',
      id: ID,
      name: 'Renamed In Flight',
    } as FrameworkManagerInput);

    expect(response.isError).toBe(false);
    // The claim under test is what the registry now holds, not the wording — the message that
    // shipped before said "Framework registry reloaded" and it was false.
    expect(registry.getFramework(ID)?.['name']).toBe('Renamed In Flight');
    expect(response.content[0]!.text).not.toContain('Framework registry reloaded');
    expect(response.content[0]!.text).toContain('Re-registered');

    // onRefresh still runs and is still not what made the edit visible.
    expect(promptRefreshes).toBe(2);
  });

  it('clears the loader cache before re-registering, or the re-register serves stale content', async () => {
    await create();
    registry.clearCacheCalls.length = 0;

    await lifecycle.handleUpdate({
      action: 'update',
      id: ID,
      name: 'Cache Ordering Probe',
    } as FrameworkManagerInput);

    // FALSIFICATION: drop the `clearCache` call in `reregister` and this is `[]` while the
    // assertion above also reds, because `loadAndRegisterById` would re-serve the cached
    // pre-edit YAML — which is the failure `createFrameworkAtomic` step 2 exists to prevent.
    expect(registry.clearCacheCalls).toContain(ID);
  });

  it('says the edit is not live instead of claiming a reload, when re-registration fails', async () => {
    await create();
    jest.spyOn(registry, 'registerFramework').mockResolvedValue(false as never);

    const response = await lifecycle.handleUpdate({
      action: 'update',
      id: ID,
      name: 'Will Not Register',
    } as FrameworkManagerInput);

    const text = response.content[0]!.text!;
    expect(text).toContain('NOT re-registered');
    expect(text).toContain('reload');
    expect(text).not.toContain('Framework registry reloaded');
    // Still not an error: the files really were written.
    expect(response.isError).toBe(false);
    expect(existsSync(path.join(frameworksDir, ID, 'framework.yaml'))).toBe(true);
  });

  it('deletes a framework that is on disk but absent from the registry', async () => {
    await create();
    registry.forget(ID);
    expect(registry.getFramework(ID)).toBeUndefined();

    const response = await lifecycle.handleDelete({
      action: 'delete',
      id: ID,
      confirm: true,
    } as FrameworkManagerInput);

    expect(response.isError).toBe(false);
    expect(existsSync(path.join(frameworksDir, ID))).toBe(false);
    expect(response.content[0]!.text).toContain('not in the framework registry');
  });

  it('reloads a framework that is on disk but absent from the registry', async () => {
    await create();
    registry.forget(ID);

    const response = await lifecycle.handleReload({
      action: 'reload',
      id: ID,
    } as FrameworkManagerInput);

    expect(response.isError).toBe(false);
    expect(registry.getFramework(ID)?.['name']).toBe('Original Name');
  });

  it('still refuses to reload an id with nothing on disk, naming the path it looked at', async () => {
    // Guards the guard removal: dropping the membership check must not turn a genuine miss into a
    // silent success.
    const response = await lifecycle.handleReload({
      action: 'reload',
      id: 'no-such-framework',
    } as FrameworkManagerInput);

    expect(response.isError).toBe(true);
    const text = response.content[0]!.text!;
    // Asserts the CAUSE-AGNOSTIC wording, deliberately. `reregisterFramework` returns false for
    // an uninitialized manager, an unavailable registry, a guide that loads but cannot be
    // retrieved, a definition that fails to generate, or a thrown error. The earlier text named
    // only the missing-file cause, so four of five failures sent the operator to check a file
    // that was already there.
    expect(text).toContain('it could not be registered from disk');
    expect(text).toContain('Check the server log for the reason');
    expect(text).toContain(path.join('no-such-framework', 'framework.yaml'));
  });

  it('does not promise a version_history purge its live path never performs (G4)', async () => {
    await create();

    const response = await lifecycle.handleDelete({
      action: 'delete',
      id: ID,
      dry_run: true,
    } as FrameworkManagerInput);

    const text = response.content[0]!.text!;
    expect(text).toContain('are NOT removed');
    expect(text).not.toContain('Would purge');
    // The dry run must still be a dry run.
    expect(existsSync(path.join(frameworksDir, ID, 'framework.yaml'))).toBe(true);
  });
});
