/**
 * Unit tests for VersionHistoryService
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

import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import os from 'node:os';

import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';

import { MockLogger } from '../../helpers/test-helpers.js';
import { VersionHistoryService } from '../../../src/versioning/version-history-service.js';

import type { VersioningConfig } from '../../../src/versioning/types.js';
import type { VersioningConfigProvider } from '../../../src/versioning/version-history-service.js';

/**
 * Mock ConfigManager that implements VersioningConfigProvider
 * Allows tests to control versioning config dynamically
 */
class MockVersioningConfigProvider implements VersioningConfigProvider {
  private config: VersioningConfig;

  constructor(config: VersioningConfig) {
    this.config = config;
  }

  getVersioningConfig(): VersioningConfig {
    return this.config;
  }

  // Test helper to update config
  setConfig(config: Partial<VersioningConfig>): void {
    this.config = { ...this.config, ...config };
  }
}

describe('VersionHistoryService', () => {
  let service: VersionHistoryService;
  let mockLogger: MockLogger;
  let mockConfigProvider: MockVersioningConfigProvider;
  let tempDir: string;

  beforeEach(async () => {
    mockLogger = new MockLogger();
    mockConfigProvider = new MockVersioningConfigProvider({
      enabled: true,
      max_versions: 5,
      auto_version: true,
    });
    service = new VersionHistoryService({
      logger: mockLogger as unknown as import('../../../src/logging/index.js').Logger,
      configManager: mockConfigProvider,
    });

    // Create temp directory for test files
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'version-history-test-'));
  });

  afterEach(async () => {
    // Cleanup temp directory
    try {
      await fs.rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
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
      // Simulate config change via ConfigManager
      mockConfigProvider.setConfig({ enabled: false });
      expect(service.isEnabled()).toBe(false);
      expect(service.isAutoVersionEnabled()).toBe(false);
    });

    it('should reflect partial config updates', () => {
      mockConfigProvider.setConfig({ max_versions: 100 });
      expect(service.isEnabled()).toBe(true); // unchanged
    });
  });

  // ==========================================================================
  // saveVersion Tests
  // ==========================================================================

  describe('saveVersion', () => {
    it('should save first version successfully', async () => {
      const snapshot = { name: 'test', content: 'hello' };

      const result = await service.saveVersion(tempDir, 'prompt', 'test-prompt', snapshot, {
        description: 'Initial version',
      });

      expect(result.success).toBe(true);
      expect(result.version).toBe(1);

      // Verify history file was created
      const history = await service.loadHistory(tempDir);
      expect(history).not.toBeNull();
      expect(history!.current_version).toBe(1);
      expect(history!.versions).toHaveLength(1);
      expect(history!.versions[0].snapshot).toEqual(snapshot);
    });

    it('should increment version on subsequent saves', async () => {
      // Save first version
      await service.saveVersion(tempDir, 'prompt', 'test-prompt', { v: 1 });

      // Save second version
      const result = await service.saveVersion(tempDir, 'prompt', 'test-prompt', { v: 2 });

      expect(result.success).toBe(true);
      expect(result.version).toBe(2);

      const history = await service.loadHistory(tempDir);
      expect(history!.versions).toHaveLength(2);
      expect(history!.versions[0].version).toBe(2); // newest first
      expect(history!.versions[1].version).toBe(1);
    });

    it('should prune old versions when exceeding max_versions', async () => {
      // Save 6 versions (max is 5)
      for (let i = 1; i <= 6; i++) {
        await service.saveVersion(tempDir, 'prompt', 'test-prompt', { version: i });
      }

      const history = await service.loadHistory(tempDir);
      expect(history!.versions).toHaveLength(5);
      expect(history!.current_version).toBe(6);

      // Oldest version (1) should be pruned
      const versions = history!.versions.map((v) => v.version);
      expect(versions).toEqual([6, 5, 4, 3, 2]);
    });

    it('should include diff_summary and description in entry', async () => {
      await service.saveVersion(tempDir, 'gate', 'test-gate', { criteria: 'x' }, {
        description: 'Added criteria field',
        diff_summary: '+1/-0',
      });

      const history = await service.loadHistory(tempDir);
      expect(history!.versions[0].description).toBe('Added criteria field');
      expect(history!.versions[0].diff_summary).toBe('+1/-0');
    });

    it('should return version 0 when disabled', async () => {
      mockConfigProvider.setConfig({ enabled: false });

      const result = await service.saveVersion(tempDir, 'prompt', 'test', { x: 1 });

      expect(result.success).toBe(true);
      expect(result.version).toBe(0);

      // No history file should be created
      const history = await service.loadHistory(tempDir);
      expect(history).toBeNull();
    });

    it('should handle file write errors gracefully', async () => {
      // Point to non-existent nested directory
      const badDir = path.join(tempDir, 'nested', 'deep', 'path');

      const result = await service.saveVersion(badDir, 'prompt', 'test', { x: 1 });

      expect(result.success).toBe(false);
      expect(result.error).toBeDefined();
    });
  });

  // ==========================================================================
  // loadHistory Tests
  // ==========================================================================

  describe('loadHistory', () => {
    it('should return null for non-existent history', async () => {
      const history = await service.loadHistory(tempDir);
      expect(history).toBeNull();
    });

    it('should load existing history file', async () => {
      // Create history first
      await service.saveVersion(tempDir, 'methodology', 'test-method', { phases: [] });

      const history = await service.loadHistory(tempDir);
      expect(history).not.toBeNull();
      expect(history!.resource_type).toBe('methodology');
      expect(history!.resource_id).toBe('test-method');
    });

    it('should handle corrupted history file gracefully', async () => {
      // Write invalid JSON to history file
      const historyPath = path.join(tempDir, '.history.json');
      await fs.writeFile(historyPath, 'not valid json', 'utf8');

      const history = await service.loadHistory(tempDir);
      expect(history).toBeNull();

      // Should log error
      const errors = mockLogger.getLogsByLevel('error');
      expect(errors.length).toBeGreaterThan(0);
    });
  });

  // ==========================================================================
  // getVersion Tests
  // ==========================================================================

  describe('getVersion', () => {
    beforeEach(async () => {
      // Create history with multiple versions
      await service.saveVersion(tempDir, 'prompt', 'test', { state: 'v1' });
      await service.saveVersion(tempDir, 'prompt', 'test', { state: 'v2' });
      await service.saveVersion(tempDir, 'prompt', 'test', { state: 'v3' });
    });

    it('should retrieve specific version', async () => {
      const entry = await service.getVersion(tempDir, 2);

      expect(entry).not.toBeNull();
      expect(entry!.version).toBe(2);
      expect(entry!.snapshot).toEqual({ state: 'v2' });
    });

    it('should return null for non-existent version', async () => {
      const entry = await service.getVersion(tempDir, 99);
      expect(entry).toBeNull();
    });

    it('should return null when no history exists', async () => {
      const otherDir = await fs.mkdtemp(path.join(os.tmpdir(), 'no-history-'));
      try {
        const entry = await service.getVersion(otherDir, 1);
        expect(entry).toBeNull();
      } finally {
        await fs.rm(otherDir, { recursive: true, force: true });
      }
    });
  });

  // ==========================================================================
  // getLatestVersion Tests
  // ==========================================================================

  describe('getLatestVersion', () => {
    it('should return 0 when no history exists', async () => {
      const version = await service.getLatestVersion(tempDir);
      expect(version).toBe(0);
    });

    it('should return current version number', async () => {
      await service.saveVersion(tempDir, 'prompt', 'test', { x: 1 });
      await service.saveVersion(tempDir, 'prompt', 'test', { x: 2 });

      const version = await service.getLatestVersion(tempDir);
      expect(version).toBe(2);
    });
  });

  // ==========================================================================
  // rollback Tests
  // ==========================================================================

  describe('rollback', () => {
    beforeEach(async () => {
      // Create history: v1 -> v2 -> v3
      await service.saveVersion(tempDir, 'gate', 'test-gate', { criteria: 'original' });
      await service.saveVersion(tempDir, 'gate', 'test-gate', { criteria: 'modified' });
      await service.saveVersion(tempDir, 'gate', 'test-gate', { criteria: 'latest' });
    });

    it('should rollback to previous version successfully', async () => {
      const currentSnapshot = { criteria: 'current-state' };

      const result = await service.rollback(
        tempDir,
        'gate',
        'test-gate',
        1, // rollback to v1
        currentSnapshot
      );

      expect(result.success).toBe(true);
      expect(result.restored_version).toBe(1);
      expect(result.saved_version).toBe(4); // v4 = pre-rollback snapshot
      expect(result.snapshot).toEqual({ criteria: 'original' });

      // Verify history now has v4
      const history = await service.loadHistory(tempDir);
      expect(history!.current_version).toBe(4);
    });

    it('should fail when target version does not exist', async () => {
      const result = await service.rollback(tempDir, 'gate', 'test-gate', 99, { x: 1 });

      expect(result.success).toBe(false);
      expect(result.error).toContain('Version 99 not found');
    });

    it('should fail when versioning is disabled', async () => {
      mockConfigProvider.setConfig({ enabled: false });

      const result = await service.rollback(tempDir, 'gate', 'test-gate', 1, { x: 1 });

      expect(result.success).toBe(false);
      expect(result.error).toContain('disabled');
    });
  });

  // ==========================================================================
  // compareVersions Tests
  // ==========================================================================

  describe('compareVersions', () => {
    beforeEach(async () => {
      await service.saveVersion(tempDir, 'prompt', 'test', { content: 'version 1' });
      await service.saveVersion(tempDir, 'prompt', 'test', { content: 'version 2' });
    });

    it('should compare two existing versions', async () => {
      const result = await service.compareVersions(tempDir, 1, 2);

      expect(result.success).toBe(true);
      expect(result.from).toBeDefined();
      expect(result.to).toBeDefined();
      expect(result.from!.version).toBe(1);
      expect(result.to!.version).toBe(2);
      expect(result.from!.snapshot).toEqual({ content: 'version 1' });
      expect(result.to!.snapshot).toEqual({ content: 'version 2' });
    });

    it('should fail when from_version does not exist', async () => {
      const result = await service.compareVersions(tempDir, 99, 2);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Version 99 not found');
    });

    it('should fail when to_version does not exist', async () => {
      const result = await service.compareVersions(tempDir, 1, 99);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Version 99 not found');
    });
  });

  // ==========================================================================
  // deleteHistory Tests
  // ==========================================================================

  describe('deleteHistory', () => {
    it('should delete existing history file', async () => {
      // Create history
      await service.saveVersion(tempDir, 'prompt', 'test', { x: 1 });

      // Verify it exists
      let history = await service.loadHistory(tempDir);
      expect(history).not.toBeNull();

      // Delete
      const result = await service.deleteHistory(tempDir);
      expect(result).toBe(true);

      // Verify it's gone
      history = await service.loadHistory(tempDir);
      expect(history).toBeNull();
    });

    it('should return true when no history exists', async () => {
      const result = await service.deleteHistory(tempDir);
      expect(result).toBe(true);
    });
  });

  // ==========================================================================
  // formatHistoryForDisplay Tests
  // ==========================================================================

  describe('formatHistoryForDisplay', () => {
    it('should format history with table headers', async () => {
      await service.saveVersion(tempDir, 'prompt', 'test-prompt', { x: 1 }, {
        description: 'Initial',
      });

      const history = await service.loadHistory(tempDir);
      const formatted = service.formatHistoryForDisplay(history!, 10);

      expect(formatted).toContain('📜 **Version History**');
      expect(formatted).toContain('test-prompt');
      expect(formatted).toContain('| Version | Date | Changes | Description |');
      expect(formatted).toContain('Initial');
    });

    it('should mark current version', async () => {
      await service.saveVersion(tempDir, 'prompt', 'test', { x: 1 });
      await service.saveVersion(tempDir, 'prompt', 'test', { x: 2 });

      const history = await service.loadHistory(tempDir);
      const formatted = service.formatHistoryForDisplay(history!, 10);

      expect(formatted).toContain('(current)');
    });

    it('should respect limit parameter', async () => {
      // Create 5 versions
      for (let i = 1; i <= 5; i++) {
        await service.saveVersion(tempDir, 'prompt', 'test', { v: i });
      }

      const history = await service.loadHistory(tempDir);
      const formatted = service.formatHistoryForDisplay(history!, 2);

      expect(formatted).toContain('and 3 more versions');
    });

    it('should show diff_summary when present', async () => {
      await service.saveVersion(tempDir, 'prompt', 'test', { x: 1 }, {
        description: 'Test',
        diff_summary: '+5/-2',
      });

      const history = await service.loadHistory(tempDir);
      const formatted = service.formatHistoryForDisplay(history!, 10);

      expect(formatted).toContain('+5/-2');
    });
  });

  // ==========================================================================
  // Resource Type Tests
  // ==========================================================================

  describe('resource types', () => {
    it('should handle prompt resource type', async () => {
      await service.saveVersion(tempDir, 'prompt', 'my-prompt', { template: 'x' });

      const history = await service.loadHistory(tempDir);
      expect(history!.resource_type).toBe('prompt');
      expect(history!.resource_id).toBe('my-prompt');
    });

    it('should handle gate resource type', async () => {
      await service.saveVersion(tempDir, 'gate', 'code-quality', { criteria: 'y' });

      const history = await service.loadHistory(tempDir);
      expect(history!.resource_type).toBe('gate');
      expect(history!.resource_id).toBe('code-quality');
    });

    it('should handle methodology resource type', async () => {
      await service.saveVersion(tempDir, 'methodology', 'CAGEERF', { phases: [] });

      const history = await service.loadHistory(tempDir);
      expect(history!.resource_type).toBe('methodology');
      expect(history!.resource_id).toBe('CAGEERF');
    });
  });
});
