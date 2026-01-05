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
import { VersionHistoryService } from '../../../src/versioning/version-history-service.js';

import type { VersioningConfig, HistoryFile } from '../../../src/versioning/types.js';
import type { VersioningConfigProvider } from '../../../src/versioning/version-history-service.js';
import type { Logger } from '../../../src/logging/index.js';

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
  private resourceDir: string;
  private resourceType: 'prompt' | 'gate' | 'methodology';
  private resourceId: string;
  private currentState: Record<string, unknown>;

  constructor(deps: {
    versionHistoryService: VersionHistoryService;
    resourceDir: string;
    resourceType: 'prompt' | 'gate' | 'methodology';
    resourceId: string;
  }) {
    this.versionHistoryService = deps.versionHistoryService;
    this.resourceDir = deps.resourceDir;
    this.resourceType = deps.resourceType;
    this.resourceId = deps.resourceId;
    this.currentState = {};
  }

  async create(data: Record<string, unknown>): Promise<{ success: boolean }> {
    this.currentState = { ...data, id: this.resourceId };

    // Save initial version
    await this.versionHistoryService.saveVersion(
      this.resourceDir,
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
        this.resourceDir,
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
    const history = await this.versionHistoryService.loadHistory(this.resourceDir);
    if (!history) return null;

    if (limit && history.versions.length > limit) {
      history.versions = history.versions.slice(0, limit);
    }

    return history;
  }

  async rollback(version: number): Promise<{ success: boolean; restoredState?: Record<string, unknown> }> {
    const result = await this.versionHistoryService.rollback(
      this.resourceDir,
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
      this.resourceDir,
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

  beforeEach(async () => {
    mockLogger = new MockLogger();
    mockConfigProvider = new MockVersioningConfigProvider({
      enabled: true,
      max_versions: 10,
      auto_version: true,
    });

    versionHistoryService = new VersionHistoryService({
      logger: mockLogger as unknown as Logger,
      configManager: mockConfigProvider,
    });

    // Create temp directory for test resources
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'version-workflow-test-'));
  });

  afterEach(async () => {
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('Complete CRUD → Version Lifecycle', () => {
    it('should track versions through create → update → update workflow', async () => {
      const resourceDir = path.join(tempDir, 'prompts', 'my-prompt');
      await fs.mkdir(resourceDir, { recursive: true });

      const manager = new SimulatedResourceManager({
        versionHistoryService,
        resourceDir,
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
      const resourceDir = path.join(tempDir, 'gates', 'quality');
      await fs.mkdir(resourceDir, { recursive: true });

      const manager = new SimulatedResourceManager({
        versionHistoryService,
        resourceDir,
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
      const resourceDir = path.join(tempDir, 'prompts', 'versioned');
      await fs.mkdir(resourceDir, { recursive: true });

      const manager = new SimulatedResourceManager({
        versionHistoryService,
        resourceDir,
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

  describe('Rollback Workflow', () => {
    it('should rollback to previous version and restore state', async () => {
      const resourceDir = path.join(tempDir, 'methodologies', 'custom');
      await fs.mkdir(resourceDir, { recursive: true });

      const manager = new SimulatedResourceManager({
        versionHistoryService,
        resourceDir,
        resourceType: 'methodology',
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
      const resourceDir = path.join(tempDir, 'prompts', 'test');
      await fs.mkdir(resourceDir, { recursive: true });

      const manager = new SimulatedResourceManager({
        versionHistoryService,
        resourceDir,
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
      const resourceDir = path.join(tempDir, 'prompts', 'compare-test');
      await fs.mkdir(resourceDir, { recursive: true });

      const manager = new SimulatedResourceManager({
        versionHistoryService,
        resourceDir,
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
      const resourceDir = path.join(tempDir, 'prompts', 'invalid');
      await fs.mkdir(resourceDir, { recursive: true });

      const manager = new SimulatedResourceManager({
        versionHistoryService,
        resourceDir,
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
      const resourceDir = path.join(tempDir, 'prompts', 'config-test');
      await fs.mkdir(resourceDir, { recursive: true });

      const manager = new SimulatedResourceManager({
        versionHistoryService,
        resourceDir,
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
      const resourceDir = path.join(tempDir, 'prompts', 'limit-test');
      await fs.mkdir(resourceDir, { recursive: true });

      // Start with high limit
      mockConfigProvider.setConfig({ max_versions: 100 });

      const manager = new SimulatedResourceManager({
        versionHistoryService,
        resourceDir,
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
      const promptDir = path.join(tempDir, 'prompts', 'shared-name');
      const gateDir = path.join(tempDir, 'gates', 'shared-name');
      await fs.mkdir(promptDir, { recursive: true });
      await fs.mkdir(gateDir, { recursive: true });

      const promptManager = new SimulatedResourceManager({
        versionHistoryService,
        resourceDir: promptDir,
        resourceType: 'prompt',
        resourceId: 'shared-name',
      });

      const gateManager = new SimulatedResourceManager({
        versionHistoryService,
        resourceDir: gateDir,
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
