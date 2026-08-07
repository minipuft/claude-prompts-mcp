/**
 * Version History Workflow Integration Test
 *
 * Tests the complete versioning workflow through resource managers:
 * - Version history tracking through update cycles
 * - History retrieval, rollback, and comparison operations
 * - Config hot-reload behavior
 *
 * Uses real:
 * - VersionHistoryService (real version management)
 * - Real temp filesystem for sidecar files
 *
 * Mocks:
 * - Logger (capture output)
 * - ConfigManager (controlled config)
 *
 * Classification: Integration (real modules, real temp filesystem)
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import os from 'node:os';

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';

import { MockLogger } from '../../helpers/test-helpers.js';
import { VersionHistoryService } from '../../../src/modules/versioning/version-history-service.js';

import type { VersioningConfig, HistoryFile } from '../../../src/modules/versioning/types.js';
import { SqliteEngine } from '../../../src/infra/database/index.js';

/** Subset of the resource-manager `ResourceType` union that this workflow versions. */
type VersionedResourceType = 'prompt' | 'gate' | 'framework';
import type { VersioningConfigProvider } from '../../../src/modules/versioning/version-history-service.js';
import type { Logger } from '../../../src/infra/logging/index.js';

/**
 * Mock ConfigManager implementing VersioningConfigProvider
 */
class MockVersioningConfigProvider implements VersioningConfigProvider {
  private config: VersioningConfig;

  constructor(config: VersioningConfig) {
    this.config = config;
  }

  getVersioningConfig(): VersioningConfig {
    return this.config;
  }

  /**
   * Required by VersioningConfigProvider. Absent since this file was written, which left three
   * standing type errors in the ratchet baseline; every new construction surfaced the same one.
   */
  getServerRoot(): string {
    return process.cwd();
  }

  setConfig(config: Partial<VersioningConfig>): void {
    this.config = { ...this.config, ...config };
  }
}

/**
 * Simulates a resource manager that uses VersionHistoryService
 * to track version history during CRUD operations.
 */
class SimulatedResourceManager {
  private versionHistoryService: VersionHistoryService;
  private resourceType: VersionedResourceType;
  private resourceId: string;
  private currentState: Record<string, unknown>;

  constructor(deps: {
    versionHistoryService: VersionHistoryService;
    resourceType: VersionedResourceType;
    resourceId: string;
  }) {
    this.versionHistoryService = deps.versionHistoryService;
    this.resourceType = deps.resourceType;
    this.resourceId = deps.resourceId;
    this.currentState = {};
  }

  async create(data: Record<string, unknown>): Promise<{ success: boolean }> {
    this.currentState = { ...data, id: this.resourceId };

    // Save initial version
    await this.versionHistoryService.saveVersion(
      this.resourceType,
      this.resourceId,
      this.currentState,
      { description: 'Initial creation' }
    );

    return { success: true };
  }

  async update(
    data: Record<string, unknown>,
    options?: { skipVersion?: boolean }
  ): Promise<{ success: boolean }> {
    // Save current state as version before update (unless skipped)
    if (
      !options?.skipVersion &&
      this.versionHistoryService.isAutoVersionEnabled() &&
      Object.keys(this.currentState).length > 0
    ) {
      await this.versionHistoryService.saveVersion(
        this.resourceType,
        this.resourceId,
        this.currentState,
        { description: 'Pre-update snapshot' }
      );
    }

    // Apply update
    this.currentState = { ...this.currentState, ...data };

    return { success: true };
  }

  async history(limit?: number): Promise<HistoryFile | null> {
    const history = await this.versionHistoryService.loadHistory(
      this.resourceType,
      this.resourceId
    );
    if (!history) return null;

    if (limit && history.versions.length > limit) {
      history.versions = history.versions.slice(0, limit);
    }

    return history;
  }

  async rollback(
    version: number
  ): Promise<{ success: boolean; restoredState?: Record<string, unknown> }> {
    const result = await this.versionHistoryService.rollback(
      this.resourceType,
      this.resourceId,
      version,
      this.currentState
    );

    if (result.success && result.snapshot) {
      this.currentState = result.snapshot as Record<string, unknown>;
      return { success: true, restoredState: this.currentState };
    }

    return { success: false };
  }

  async compare(fromVersion: number, toVersion: number) {
    const result = await this.versionHistoryService.compareVersions(
      this.resourceType,
      this.resourceId,
      fromVersion,
      toVersion
    );

    if (!result.success) {
      return { success: false, error: result.error };
    }

    // Compute changes from the two snapshots
    const from = result.from!.snapshot;
    const to = result.to!.snapshot;

    const added = Object.keys(to).filter((k) => !(k in from));
    const removed = Object.keys(from).filter((k) => !(k in to));
    const modified = Object.keys(from).filter(
      (k) => k in to && JSON.stringify(from[k]) !== JSON.stringify(to[k])
    );

    return {
      success: true,
      from_version: fromVersion,
      to_version: toVersion,
      changes: { added, removed, modified },
    };
  }

  getCurrentState(): Record<string, unknown> {
    return this.currentState;
  }
}

describe('Version History Workflow Integration', () => {
  let versionHistoryService: VersionHistoryService;
  let mockLogger: MockLogger;
  let mockConfigProvider: MockVersioningConfigProvider;
  let tempDir: string;
  let dbManager: SqliteEngine;

  beforeEach(async () => {
    mockLogger = new MockLogger();
    mockConfigProvider = new MockVersioningConfigProvider({
      enabled: true,
      max_versions: 10,
      auto_version: true,
    });

    // Temp dir first: the SQLite engine is created inside it so teardown removes both.
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'version-workflow-test-'));

    dbManager = await SqliteEngine.getInstance(tempDir, mockLogger as unknown as Logger);
    await dbManager.initialize();

    versionHistoryService = new VersionHistoryService({
      logger: mockLogger as unknown as Logger,
      configManager: mockConfigProvider,
      dbManager,
    });
  });

  afterEach(async () => {
    try {
      await dbManager.shutdown();
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('Complete CRUD → Version Lifecycle', () => {
    it('should track versions through create → update → update workflow', async () => {
      const manager = new SimulatedResourceManager({
        versionHistoryService,
        resourceType: 'prompt',
        resourceId: 'my-prompt',
      });

      // Create
      await manager.create({ name: 'My Prompt', template: 'Hello {{name}}' });

      // Update 1
      await manager.update({ template: 'Hello {{name}}! Welcome.' });

      // Update 2
      await manager.update({ template: 'Greetings {{name}}! How are you?' });

      // Check history
      const history = await manager.history();
      expect(history).not.toBeNull();
      expect(history!.versions).toHaveLength(3);
      expect(history!.current_version).toBe(3);

      // Verify version ordering (newest first)
      expect(history!.versions[0].version).toBe(3);
      expect(history!.versions[2].version).toBe(1);
    });

    it('should allow skipping version on minor updates', async () => {
      const manager = new SimulatedResourceManager({
        versionHistoryService,
        resourceType: 'gate',
        resourceId: 'quality',
      });

      await manager.create({ name: 'Quality Gate', type: 'validation' });
      await manager.update({ description: 'Added description' }); // Creates version
      await manager.update({ typo: 'fixed' }, { skipVersion: true }); // Skipped
      await manager.update({ enhanced: true }); // Creates version

      const history = await manager.history();
      // Should have 3 versions: initial + 2 updates (one skipped)
      expect(history!.versions).toHaveLength(3);
    });
  });

  describe('History Retrieval with Limits', () => {
    it('should limit history results when requested', async () => {
      const manager = new SimulatedResourceManager({
        versionHistoryService,
        resourceType: 'prompt',
        resourceId: 'versioned',
      });

      // Create many versions
      await manager.create({ name: 'v1' });
      for (let i = 2; i <= 6; i++) {
        await manager.update({ name: `v${i}` });
      }

      // Get full history
      const fullHistory = await manager.history();
      expect(fullHistory!.versions).toHaveLength(6);

      // Get limited history
      const limitedHistory = await manager.history(3);
      expect(limitedHistory!.versions).toHaveLength(3);
      expect(limitedHistory!.versions[0].version).toBe(6); // Still newest first
    });
  });

  /**
   * Tier 4 — version_history workspace scoping.
   *
   * All nine query sites filtered a hardcoded `tenant_id = 'default'` literal, so every project
   * sharing one state.db read, wrote, and pruned the same rollback history. These read the table
   * directly: `getHistory()` projects rows without the scope columns, so asserting through it
   * would pass whatever those columns held.
   */
  describe('workspace scoping', () => {
    it('stamps the configured workspace on rows it writes', async () => {
      const scoped = new VersionHistoryService({
        logger: mockLogger as unknown as Logger,
        configManager: mockConfigProvider,
        dbManager,
        scope: { workspaceId: 'ws-alpha', organizationId: 'org-alpha' },
      });

      await scoped.saveVersion(
        'prompt',
        'scoped-resource',
        { id: 'scoped-resource' },
        {
          description: 'scoped write',
        }
      );

      const rows = dbManager.query<{
        tenant_id: string;
        workspace_id: string | null;
        organization_id: string | null;
      }>(`SELECT tenant_id, workspace_id, organization_id FROM version_history`);

      expect(rows).toHaveLength(1);
      expect(rows[0]?.workspace_id).toBe('ws-alpha');
      expect(rows[0]?.organization_id).toBe('org-alpha');
      // tenant_id derives from the same scope rather than staying the literal 'default' that
      // made every project's rollback history indistinguishable.
      expect(rows[0]?.tenant_id).toBe('ws-alpha');
    });

    it('does not let one workspace read or version over another', async () => {
      const alpha = new VersionHistoryService({
        logger: mockLogger as unknown as Logger,
        configManager: mockConfigProvider,
        dbManager,
        scope: { workspaceId: 'ws-alpha' },
      });
      const beta = new VersionHistoryService({
        logger: mockLogger as unknown as Logger,
        configManager: mockConfigProvider,
        dbManager,
        scope: { workspaceId: 'ws-beta' },
      });

      await alpha.saveVersion('prompt', 'shared-id', { v: 'a1' }, { description: 'a1' });
      await alpha.saveVersion('prompt', 'shared-id', { v: 'a2' }, { description: 'a2' });

      // Same resource id in another workspace must start at version 1, not continue alpha's
      // sequence — MAX(version) is scoped, which is why writes and reads had to move together.
      await beta.saveVersion('prompt', 'shared-id', { v: 'b1' }, { description: 'b1' });

      const betaRows = dbManager.query<{ version: number }>(
        `SELECT version FROM version_history WHERE tenant_id = 'ws-beta' ORDER BY version`
      );
      const alphaRows = dbManager.query<{ version: number }>(
        `SELECT version FROM version_history WHERE tenant_id = 'ws-alpha' ORDER BY version`
      );

      expect(betaRows.map((r) => r.version)).toEqual([1]);
      expect(alphaRows.map((r) => r.version)).toEqual([1, 2]);

      // Reads are scoped too, not just writes: alpha sees its own two versions and none of beta's.
      expect(await alpha.getLatestVersion('prompt', 'shared-id')).toBe(2);
      expect(await beta.getLatestVersion('prompt', 'shared-id')).toBe(1);
    });
  });

  describe('Rollback Workflow', () => {
    it('should rollback to previous version and restore state', async () => {
      const manager = new SimulatedResourceManager({
        versionHistoryService,
        resourceType: 'framework',
        resourceId: 'custom',
      });

      // Version history flow:
      // create: saves v1 { phases: ['analyze'] }
      // update 1: saves pre-update state as v2 { phases: ['analyze'] }, then updates to ['analyze', 'plan']
      // update 2: saves pre-update state as v3 { phases: ['analyze', 'plan'] }, then updates to full

      await manager.create({ name: 'Custom Framework', phases: ['analyze'] });
      await manager.update({ phases: ['analyze', 'plan'] });
      await manager.update({ phases: ['analyze', 'plan', 'execute'] });

      // Current state should have 3 phases
      expect(manager.getCurrentState()['phases']).toEqual(['analyze', 'plan', 'execute']);

      // Rollback to v3 (which captured ['analyze', 'plan'] before last update)
      const rollbackResult = await manager.rollback(3);
      expect(rollbackResult.success).toBe(true);
      expect(rollbackResult.restoredState!['phases']).toEqual(['analyze', 'plan']);

      // Manager state should be restored
      expect(manager.getCurrentState()['phases']).toEqual(['analyze', 'plan']);

      // History should now have 4 versions (rollback creates pre-rollback snapshot)
      const history = await manager.history();
      expect(history!.versions.length).toBeGreaterThanOrEqual(4);
    });

    it('should fail rollback to non-existent version', async () => {
      const manager = new SimulatedResourceManager({
        versionHistoryService,
        resourceType: 'prompt',
        resourceId: 'test',
      });

      await manager.create({ name: 'Test' });

      const result = await manager.rollback(999);
      expect(result.success).toBe(false);
    });
  });

  describe('Version Comparison', () => {
    it('should compare two versions and identify changes', async () => {
      const manager = new SimulatedResourceManager({
        versionHistoryService,
        resourceType: 'prompt',
        resourceId: 'compare-test',
      });

      await manager.create({ name: 'Original', field1: 'value1', removed: 'will be removed' });
      await manager.update({ name: 'Changed', field1: 'value1' }); // removed 'removed', changed 'name'
      await manager.update({ name: 'Changed', field1: 'modified', added: 'new' }); // modified field1, added 'added'

      const diff = await manager.compare(1, 3);

      expect(diff.success).toBe(true);
      expect(diff.from_version).toBe(1);
      expect(diff.to_version).toBe(3);

      // Should detect changes
      expect(diff.changes).toBeDefined();
    });

    it('should handle comparison with invalid version', async () => {
      const manager = new SimulatedResourceManager({
        versionHistoryService,
        resourceType: 'prompt',
        resourceId: 'invalid',
      });

      await manager.create({ name: 'Test' });

      const diff = await manager.compare(1, 999);
      expect(diff.success).toBe(false);
      expect(diff.error).toBeDefined();
    });
  });

  describe('Config Hot-Reload Behavior', () => {
    it('should respect config changes during session', async () => {
      const manager = new SimulatedResourceManager({
        versionHistoryService,
        resourceType: 'prompt',
        resourceId: 'config-test',
      });

      // Start enabled
      await manager.create({ name: 'v1' });
      await manager.update({ name: 'v2' });

      let history = await manager.history();
      expect(history!.versions).toHaveLength(2);

      // Disable auto-versioning mid-session
      mockConfigProvider.setConfig({ auto_version: false });

      // This update should NOT create a version
      await manager.update({ name: 'v3' });

      history = await manager.history();
      expect(history!.versions).toHaveLength(2); // No new version

      // Re-enable
      mockConfigProvider.setConfig({ auto_version: true });

      await manager.update({ name: 'v4' });

      history = await manager.history();
      expect(history!.versions).toHaveLength(3); // New version created
    });

    it('should apply max_versions limit dynamically', async () => {
      // Start with high limit
      mockConfigProvider.setConfig({ max_versions: 100 });

      const manager = new SimulatedResourceManager({
        versionHistoryService,
        resourceType: 'prompt',
        resourceId: 'limit-test',
      });

      // Create 5 versions
      await manager.create({ name: 'v1' });
      for (let i = 2; i <= 5; i++) {
        await manager.update({ name: `v${i}` });
      }

      let history = await manager.history();
      expect(history!.versions).toHaveLength(5);

      // Reduce limit to 3
      mockConfigProvider.setConfig({ max_versions: 3 });

      // Next update should trigger pruning
      await manager.update({ name: 'v6' });

      history = await manager.history();
      expect(history!.versions).toHaveLength(3);
      expect(history!.versions[0].version).toBe(6); // Newest
    });
  });

  describe('Cross-Resource Type Isolation', () => {
    it('should maintain separate version histories per resource', async () => {
      const promptManager = new SimulatedResourceManager({
        versionHistoryService,
        resourceType: 'prompt',
        resourceId: 'shared-name',
      });

      const gateManager = new SimulatedResourceManager({
        versionHistoryService,
        resourceType: 'gate',
        resourceId: 'shared-name',
      });

      // Create and update prompt
      await promptManager.create({ type: 'prompt', name: 'Prompt v1' });
      await promptManager.update({ name: 'Prompt v2' });
      await promptManager.update({ name: 'Prompt v3' });

      // Create gate (fewer updates)
      await gateManager.create({ type: 'gate', name: 'Gate v1' });

      // Verify isolation
      const promptHistory = await promptManager.history();
      const gateHistory = await gateManager.history();

      expect(promptHistory!.resource_type).toBe('prompt');
      expect(promptHistory!.versions).toHaveLength(3);

      expect(gateHistory!.resource_type).toBe('gate');
      expect(gateHistory!.versions).toHaveLength(1);
    });
  });
});
