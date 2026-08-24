/**
 * Unit tests for VersionHistoryService (SQLite-backed)
 *
 * Tests the core versioning functionality:
 * - saveVersion: Auto-versioning, FIFO pruning, disabled mode
 * - loadHistory: Loading existing/non-existing history
 * - getVersion: Retrieving specific version snapshots
 * - rollback: Pre-rollback save, restoring versions
 * - compareVersions: Comparing two version snapshots
 * - deleteHistory: Cleanup on resource deletion
 * - formatHistoryForDisplay: Display formatting
 */

import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';

import { createTestDatabaseManager } from '../../helpers/test-database.js';
import { ConfigLoader } from '../../../src/infra/config/index.js';
import { VersionHistoryService } from '../../../src/modules/versioning/version-history-service.js';

import type { TestDatabaseContext } from '../../helpers/test-database.js';
import type { DatabasePort } from '../../../src/shared/types/persistence.js';
import type { VersioningConfig } from '../../../src/shared/types/index.js';
import type { VersioningConfigProvider } from '../../../src/modules/versioning/version-history-service.js';

/**
 * Mock ConfigManager that implements VersioningConfigProvider
 * Allows tests to control versioning config dynamically
 */
class MockVersioningConfigProvider implements VersioningConfigProvider {
  private config: VersioningConfig;
  private serverRoot: string;

  constructor(config: VersioningConfig, serverRoot: string) {
    this.config = config;
    this.serverRoot = serverRoot;
  }

  getVersioningConfig(): VersioningConfig {
    return this.config;
  }

  getServerRoot(): string {
    return this.serverRoot;
  }

  setConfig(config: Partial<VersioningConfig>): void {
    this.config = { ...this.config, ...config };
  }
}

describe('VersionHistoryService', () => {
  let service: VersionHistoryService;
  let mockConfigProvider: MockVersioningConfigProvider;
  let dbCtx: TestDatabaseContext;

  beforeEach(async () => {
    dbCtx = await createTestDatabaseManager('version-history');
    mockConfigProvider = new MockVersioningConfigProvider(
      {
        enabled: true,
        max_versions: 5,
        auto_version: true,
      },
      dbCtx.testDir
    );
    service = new VersionHistoryService({
      logger: dbCtx.logger,
      configManager: mockConfigProvider,
      dbManager: dbCtx.dbManager,
    });
  });

  afterEach(async () => {
    await dbCtx.cleanup();
  });

  // ==========================================================================
  // Configuration Tests
  // ==========================================================================

  describe('configuration', () => {
    it('should report enabled status correctly', () => {
      expect(service.isEnabled()).toBe(true);
      expect(service.isAutoVersionEnabled()).toBe(true);
    });

    it('should reflect config changes from ConfigManager', () => {
      mockConfigProvider.setConfig({ enabled: false });
      expect(service.isEnabled()).toBe(false);
      expect(service.isAutoVersionEnabled()).toBe(false);
    });

    it('should reflect partial config updates', () => {
      mockConfigProvider.setConfig({ max_versions: 100 });
      expect(service.isEnabled()).toBe(true);
    });
  });

  // ==========================================================================
  // saveVersion Tests
  // ==========================================================================

  describe('saveVersion', () => {
    it('should save first version successfully', async () => {
      const snapshot = { name: 'test', content: 'hello' };

      const result = await service.saveVersion('prompt', 'test-prompt', snapshot, {
        description: 'Initial version',
      });

      expect(result.success).toBe(true);
      expect(result.version).toBe(1);

      const history = await service.loadHistory('prompt', 'test-prompt');
      expect(history).not.toBeNull();
      expect(history!.current_version).toBe(1);
      expect(history!.versions).toHaveLength(1);
      expect(history!.versions[0].snapshot).toEqual(snapshot);
    });

    it('should increment version on subsequent saves', async () => {
      await service.saveVersion('prompt', 'test-prompt', { v: 1 });
      const result = await service.saveVersion('prompt', 'test-prompt', { v: 2 });

      expect(result.success).toBe(true);
      expect(result.version).toBe(2);

      const history = await service.loadHistory('prompt', 'test-prompt');
      expect(history!.versions).toHaveLength(2);
      expect(history!.versions[0].version).toBe(2); // newest first
      expect(history!.versions[1].version).toBe(1);
    });

    it('should prune old versions when exceeding max_versions', async () => {
      for (let i = 1; i <= 6; i++) {
        await service.saveVersion('prompt', 'test-prompt', { version: i });
      }

      const history = await service.loadHistory('prompt', 'test-prompt');
      expect(history!.versions).toHaveLength(5);
      expect(history!.current_version).toBe(6);

      const versions = history!.versions.map((v) => v.version);
      expect(versions).toEqual([6, 5, 4, 3, 2]);
    });

    it('should include diff_summary and description in entry', async () => {
      await service.saveVersion(
        'gate',
        'test-gate',
        { criteria: 'x' },
        {
          description: 'Added criteria field',
          diff_summary: '+1/-0',
        }
      );

      const history = await service.loadHistory('gate', 'test-gate');
      expect(history!.versions[0].description).toBe('Added criteria field');
      expect(history!.versions[0].diff_summary).toBe('+1/-0');
    });

    it('should return version 0 when disabled', async () => {
      mockConfigProvider.setConfig({ enabled: false });

      const result = await service.saveVersion('prompt', 'test', { x: 1 });

      expect(result.success).toBe(true);
      expect(result.version).toBe(0);

      const history = await service.loadHistory('prompt', 'test');
      expect(history).toBeNull();
    });
  });

  // ==========================================================================
  // Persistence failure posture (P7 row 2.3, OQ-P7-6)
  // ==========================================================================

  /**
   * `saveVersion` used to catch every persistence error and return `{success:false}`; all three
   * callers logged a warning and PROCEEDED, so a snapshot that never landed on a durable table was
   * reported to the operator as a successful update. architecture.md's posture is that persistence
   * throws and the caller decides.
   *
   * Asserted through an injected failure rather than a real broken database: the point is the
   * posture at the boundary, and a real failure mode is neither reproducible nor necessary to
   * observe it.
   */
  describe('persistence failure posture', () => {
    /** Wraps the live port and fails exactly the write, so reads still work for seeding. */
    function failingWrites(realDb: DatabasePort): { db: DatabasePort; fail: () => void } {
      let failing = false;
      const db: DatabasePort = {
        isInitialized: () => realDb.isInitialized(),
        initialize: () => realDb.initialize(),
        query: (sql, params) => realDb.query(sql, params),
        queryOne: (sql, params) => realDb.queryOne(sql, params),
        run: (sql, params) => {
          if (failing) throw new Error('disk I/O error');
          realDb.run(sql, params);
        },
        transaction: (fn) => realDb.transaction(fn),
        beginTransaction: () => realDb.beginTransaction(),
        commit: () => realDb.commit(),
        rollback: () => realDb.rollback(),
      };
      return {
        db,
        fail: () => {
          failing = true;
        },
      };
    }

    it('throws instead of returning a failure result the caller can ignore', async () => {
      const { db, fail } = failingWrites(dbCtx.dbManager);
      const failingService = new VersionHistoryService({
        logger: dbCtx.logger,
        configManager: mockConfigProvider,
        dbManager: db,
      });
      fail();

      await expect(failingService.saveVersion('prompt', 'doomed', { x: 1 })).rejects.toThrow(
        /Failed to persist version snapshot for prompt\/doomed/
      );

      // And nothing was recorded — the gap the old posture left silently.
      expect(await service.loadHistory('prompt', 'doomed')).toBeNull();
    });

    it('still reports a rollback whose pre-rollback snapshot cannot persist as a failure', async () => {
      // The one caller that already had a catch boundary: `rollback` converts the throw into the
      // same `{success:false}` it returned before, so its contract is unchanged.
      const { db, fail } = failingWrites(dbCtx.dbManager);
      const failingService = new VersionHistoryService({
        logger: dbCtx.logger,
        configManager: mockConfigProvider,
        dbManager: db,
      });

      await failingService.saveVersion('prompt', 'rollback-target', { state: 'v1' });
      fail();

      const result = await failingService.rollback('prompt', 'rollback-target', 1, {
        state: 'live',
      });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Failed to persist version snapshot');
      expect(result.snapshot).toBeUndefined();
    });

    it('does not throw when versioning is disabled — that path never reaches the database', async () => {
      const { db, fail } = failingWrites(dbCtx.dbManager);
      const failingService = new VersionHistoryService({
        logger: dbCtx.logger,
        configManager: mockConfigProvider,
        dbManager: db,
      });
      mockConfigProvider.setConfig({ enabled: false });
      fail();

      await expect(failingService.saveVersion('prompt', 'disabled', { x: 1 })).resolves.toEqual({
        success: true,
        version: 0,
      });
    });
  });

  // ==========================================================================
  // Config key spelling (P7 row 2.6, finding P7-F1)
  // ==========================================================================

  /**
   * `config.json` ships `versioning.autoVersion` / `maxVersions` (camelCase) while
   * `VersioningConfig` declares `auto_version` / `max_versions`. The spellings never met, so the
   * whole block was inert; the defaults coincided with the shipped values, which is why it had no
   * live symptom.
   *
   * These drive a REAL `ConfigLoader` into a real service, because that is the only place the two
   * spellings are joined — a mocked provider returns whatever the test hands it and would pass
   * against the inert code.
   */
  describe('camelCase versioning config reaches the service', () => {
    async function serviceFromConfig(raw: Record<string, unknown>) {
      const dir = await mkdtemp(path.join(tmpdir(), 'versioning-config-'));
      const configPath = path.join(dir, 'config.json');
      await writeFile(configPath, JSON.stringify({ versioning: raw }), 'utf8');
      const loader = new ConfigLoader(configPath);
      await loader.loadConfig();
      return {
        service: new VersionHistoryService({
          logger: dbCtx.logger,
          configManager: loader,
          dbManager: dbCtx.dbManager,
        }),
        cleanup: () => rm(dir, { recursive: true, force: true }),
      };
    }

    it('honours "autoVersion": false', async () => {
      const { service: configured, cleanup } = await serviceFromConfig({
        enabled: true,
        autoVersion: false,
      });

      expect(configured.isEnabled()).toBe(true);
      expect(configured.isAutoVersionEnabled()).toBe(false);

      await cleanup();
    });

    it('honours "maxVersions" as the pruning bound, not just as a readable value', async () => {
      const { service: configured, cleanup } = await serviceFromConfig({
        enabled: true,
        maxVersions: 2,
      });

      for (let i = 1; i <= 4; i++) {
        await configured.saveVersion('prompt', 'bounded', { v: i });
      }

      const history = await configured.loadHistory('prompt', 'bounded');
      expect(history!.versions.map((v) => v.version)).toEqual([4, 3]);

      await cleanup();
    });
  });

  // ==========================================================================
  // loadHistory Tests
  // ==========================================================================

  describe('loadHistory', () => {
    it('should return null for non-existent history', async () => {
      const history = await service.loadHistory('prompt', 'nonexistent');
      expect(history).toBeNull();
    });

    it('should load existing history', async () => {
      await service.saveVersion('methodology', 'test-method', { phases: [] });

      const history = await service.loadHistory('methodology', 'test-method');
      expect(history).not.toBeNull();
      expect(history!.resource_type).toBe('methodology');
      expect(history!.resource_id).toBe('test-method');
    });
  });

  // ==========================================================================
  // getVersion Tests
  // ==========================================================================

  describe('getVersion', () => {
    beforeEach(async () => {
      await service.saveVersion('prompt', 'test', { state: 'v1' });
      await service.saveVersion('prompt', 'test', { state: 'v2' });
      await service.saveVersion('prompt', 'test', { state: 'v3' });
    });

    it('should retrieve specific version', async () => {
      const entry = await service.getVersion('prompt', 'test', 2);

      expect(entry).not.toBeNull();
      expect(entry!.version).toBe(2);
      expect(entry!.snapshot).toEqual({ state: 'v2' });
    });

    it('should return null for non-existent version', async () => {
      const entry = await service.getVersion('prompt', 'test', 99);
      expect(entry).toBeNull();
    });
  });

  // ==========================================================================
  // getLatestVersion Tests
  // ==========================================================================

  describe('getLatestVersion', () => {
    it('should return 0 when no history exists', async () => {
      const version = await service.getLatestVersion('prompt', 'nonexistent');
      expect(version).toBe(0);
    });

    it('should return current version number', async () => {
      await service.saveVersion('prompt', 'test', { x: 1 });
      await service.saveVersion('prompt', 'test', { x: 2 });

      const version = await service.getLatestVersion('prompt', 'test');
      expect(version).toBe(2);
    });
  });

  // ==========================================================================
  // rollback Tests
  // ==========================================================================

  describe('rollback', () => {
    beforeEach(async () => {
      await service.saveVersion('gate', 'test-gate', { criteria: 'original' });
      await service.saveVersion('gate', 'test-gate', { criteria: 'modified' });
      await service.saveVersion('gate', 'test-gate', { criteria: 'latest' });
    });

    // Deliberately re-encoded for go-forward semantics (P7 row 2.4, OQ-P7-3): the live state
    // differs from v3's snapshot, so it is bridged as v4, and the RESTORED state is recorded as
    // v5 — the newest version now holds what the rollback produced, not what preceded it.
    it('should rollback to previous version successfully', async () => {
      const currentSnapshot = { criteria: 'current-state' };

      const result = await service.rollback('gate', 'test-gate', 1, currentSnapshot);

      expect(result.success).toBe(true);
      expect(result.restored_version).toBe(1);
      expect(result.saved_version).toBe(5); // v4 = bridged live state, v5 = restored state
      expect(result.snapshot).toEqual({ criteria: 'original' });

      const history = await service.loadHistory('gate', 'test-gate');
      expect(history!.current_version).toBe(5);
      const bridged = await service.getVersion('gate', 'test-gate', 4);
      expect(bridged!.snapshot).toEqual({ criteria: 'current-state' });
      expect(bridged!.description).toContain('Bridge');
      const restored = await service.getVersion('gate', 'test-gate', 5);
      expect(restored!.snapshot).toEqual({ criteria: 'original' });
      expect(restored!.description).toBe('Rollback to v1');
    });

    // P7 row 2.4 — go-forward numbering semantics
    it('records exactly one row per rollback when the live state is already recorded', async () => {
      // Live state equals v3's snapshot → no bridge; restored state becomes v4.
      const result = await service.rollback('gate', 'test-gate', 1, { criteria: 'latest' });

      expect(result.saved_version).toBe(4);
      expect(await service.getLatestVersion('gate', 'test-gate')).toBe(4);
      const restored = await service.getVersion('gate', 'test-gate', 4);
      expect(restored!.snapshot).toEqual({ criteria: 'original' });
    });

    it('consumes no version number when the target does not exist', async () => {
      const before = await service.getLatestVersion('gate', 'test-gate');
      const result = await service.rollback('gate', 'test-gate', 99, { criteria: 'anything' });

      expect(result.success).toBe(false);
      expect(await service.getLatestVersion('gate', 'test-gate')).toBe(before);
    });

    it('recordEditResult: newest version equals the produced state, single row at steady state', async () => {
      // Prior live equals v3's snapshot → no bridge row.
      const result = await service.recordEditResult(
        'gate',
        'test-gate',
        { criteria: 'latest' },
        { criteria: 'edited' },
        { description: 'Update via resource_manager' }
      );

      expect(result.bridged).toBe(false);
      expect(result.version).toBe(4);
      const newest = await service.getVersion('gate', 'test-gate', 4);
      expect(newest!.snapshot).toEqual({ criteria: 'edited' });
    });

    it('recordEditResult: bridges an unrecorded prior live state before recording the result', async () => {
      const result = await service.recordEditResult(
        'gate',
        'test-gate',
        { criteria: 'out-of-band' },
        { criteria: 'edited' },
        { description: 'Update via resource_manager' }
      );

      expect(result.bridged).toBe(true);
      expect(result.version).toBe(5);
      const bridge = await service.getVersion('gate', 'test-gate', 4);
      expect(bridge!.snapshot).toEqual({ criteria: 'out-of-band' });
      expect(bridge!.description).toContain('Bridge');
    });

    it('recordEditResult: object key order does not create a phantom bridge', async () => {
      await service.saveVersion('gate', 'key-order', {
        arguments: [{ name: 'input', type: 'string', required: true }],
      });

      const result = await service.recordEditResult(
        'gate',
        'key-order',
        { arguments: [{ name: 'input', required: true, type: 'string' }] },
        { arguments: [{ name: 'input', required: true, type: 'number' }] }
      );

      expect(result.bridged).toBe(false);
      expect(result.version).toBe(2);
    });

    it('should fail when target version does not exist', async () => {
      const result = await service.rollback('gate', 'test-gate', 99, { x: 1 });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Version 99 not found');
    });

    it('should fail when versioning is disabled', async () => {
      mockConfigProvider.setConfig({ enabled: false });

      const result = await service.rollback('gate', 'test-gate', 1, { x: 1 });

      expect(result.success).toBe(false);
      expect(result.error).toContain('disabled');
    });
  });

  // ==========================================================================
  // compareVersions Tests
  // ==========================================================================

  describe('compareVersions', () => {
    beforeEach(async () => {
      await service.saveVersion('prompt', 'test', { content: 'version 1' });
      await service.saveVersion('prompt', 'test', { content: 'version 2' });
    });

    it('should compare two existing versions', async () => {
      const result = await service.compareVersions('prompt', 'test', 1, 2);

      expect(result.success).toBe(true);
      expect(result.from).toBeDefined();
      expect(result.to).toBeDefined();
      expect(result.from!.version).toBe(1);
      expect(result.to!.version).toBe(2);
      expect(result.from!.snapshot).toEqual({ content: 'version 1' });
      expect(result.to!.snapshot).toEqual({ content: 'version 2' });
    });

    it('should fail when from_version does not exist', async () => {
      const result = await service.compareVersions('prompt', 'test', 99, 2);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Version 99 not found');
    });

    it('should fail when to_version does not exist', async () => {
      const result = await service.compareVersions('prompt', 'test', 1, 99);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Version 99 not found');
    });
  });

  // ==========================================================================
  // deleteHistory Tests
  // ==========================================================================

  describe('deleteHistory', () => {
    it('should delete existing history', async () => {
      await service.saveVersion('prompt', 'test', { x: 1 });

      let history = await service.loadHistory('prompt', 'test');
      expect(history).not.toBeNull();

      const result = await service.deleteHistory('prompt', 'test');
      expect(result).toBe(true);

      history = await service.loadHistory('prompt', 'test');
      expect(history).toBeNull();
    });

    it('should return true when no history exists', async () => {
      const result = await service.deleteHistory('prompt', 'nonexistent');
      expect(result).toBe(true);
    });
  });

  // ==========================================================================
  // formatHistoryForDisplay Tests
  // ==========================================================================

  describe('formatHistoryForDisplay', () => {
    it('should format history with table headers', async () => {
      await service.saveVersion('prompt', 'test-prompt', { x: 1 }, { description: 'Initial' });

      const history = await service.loadHistory('prompt', 'test-prompt');
      const formatted = service.formatHistoryForDisplay(history!, 10);

      expect(formatted).toContain('**Version History**');
      expect(formatted).toContain('test-prompt');
      expect(formatted).toContain('| Version | Date | Changes | Description |');
      expect(formatted).toContain('Initial');
    });

    it('should mark current version', async () => {
      await service.saveVersion('prompt', 'test', { x: 1 });
      await service.saveVersion('prompt', 'test', { x: 2 });

      const history = await service.loadHistory('prompt', 'test');
      const formatted = service.formatHistoryForDisplay(history!, 10);

      expect(formatted).toContain('(latest)');
    });

    it('should respect limit parameter', async () => {
      for (let i = 1; i <= 5; i++) {
        await service.saveVersion('prompt', 'test', { v: i });
      }

      const history = await service.loadHistory('prompt', 'test');
      const formatted = service.formatHistoryForDisplay(history!, 2);

      expect(formatted).toContain('and 3 more versions');
    });

    it('should show diff_summary when present', async () => {
      await service.saveVersion(
        'prompt',
        'test',
        { x: 1 },
        { description: 'Test', diff_summary: '+5/-2' }
      );

      const history = await service.loadHistory('prompt', 'test');
      const formatted = service.formatHistoryForDisplay(history!, 10);

      expect(formatted).toContain('+5/-2');
    });
  });

  // ==========================================================================
  // Resource Type Isolation Tests
  // ==========================================================================

  describe('resource type isolation', () => {
    it('should isolate history by resource type and id', async () => {
      await service.saveVersion('prompt', 'my-prompt', { template: 'x' });
      await service.saveVersion('gate', 'code-quality', { criteria: 'y' });
      await service.saveVersion('methodology', 'CAGEERF', { phases: [] });

      const promptHistory = await service.loadHistory('prompt', 'my-prompt');
      expect(promptHistory!.resource_type).toBe('prompt');
      expect(promptHistory!.resource_id).toBe('my-prompt');
      expect(promptHistory!.versions).toHaveLength(1);

      const gateHistory = await service.loadHistory('gate', 'code-quality');
      expect(gateHistory!.resource_type).toBe('gate');
      expect(gateHistory!.resource_id).toBe('code-quality');

      const methodHistory = await service.loadHistory('methodology', 'CAGEERF');
      expect(methodHistory!.resource_type).toBe('methodology');
      expect(methodHistory!.resource_id).toBe('CAGEERF');
    });

    it('should not cross-contaminate between resource ids', async () => {
      await service.saveVersion('prompt', 'prompt-a', { x: 1 });
      await service.saveVersion('prompt', 'prompt-b', { y: 2 });

      const historyA = await service.loadHistory('prompt', 'prompt-a');
      expect(historyA!.versions).toHaveLength(1);
      expect(historyA!.versions[0].snapshot).toEqual({ x: 1 });

      const historyB = await service.loadHistory('prompt', 'prompt-b');
      expect(historyB!.versions).toHaveLength(1);
      expect(historyB!.versions[0].snapshot).toEqual({ y: 2 });
    });
  });
});
