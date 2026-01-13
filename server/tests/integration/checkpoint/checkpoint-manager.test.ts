/**
 * Integration tests for ConsolidatedCheckpointManager.
 *
 * Tests checkpoint operations (create, rollback, list, delete, clear)
 * through the checkpoint manager interface.
 */

import { describe, test, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { promises as fs } from 'fs';
import path from 'path';
import os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';

import {
  ConsolidatedCheckpointManager,
  createConsolidatedCheckpointManager,
} from '../../../src/mcp-tools/resource-manager/checkpoint/index.js';
import type { CheckpointManagerInput } from '../../../src/mcp-tools/resource-manager/checkpoint/types.js';
import type { Logger } from '../../../src/logging/index.js';
import type { ConfigManager } from '../../../src/config/index.js';

describe('ConsolidatedCheckpointManager Integration', () => {
  let manager: ConsolidatedCheckpointManager;
  let mockLogger: Logger;
  let mockConfigManager: ConfigManager;
  let tempDir: string;
  let runtimeStateDir: string;

  beforeEach(async () => {
    // Create temp directory for testing
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'checkpoint-test-'));
    runtimeStateDir = path.join(tempDir, 'runtime-state');
    await fs.mkdir(runtimeStateDir, { recursive: true });

    // Initialize a git repo for checkpoint operations
    const execAsync = promisify(exec);
    await execAsync('git init', { cwd: tempDir });
    await execAsync('git config user.email "test@test.com"', { cwd: tempDir });
    await execAsync('git config user.name "Test"', { cwd: tempDir });

    // Create a test file and commit it
    await fs.writeFile(path.join(tempDir, 'test.txt'), 'initial content');
    await execAsync('git add test.txt', { cwd: tempDir });
    await execAsync('git commit -m "initial"', { cwd: tempDir });

    mockLogger = {
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      debug: jest.fn(),
    };

    mockConfigManager = {
      getServerRoot: jest.fn(() => tempDir),
    } as unknown as ConfigManager;

    manager = createConsolidatedCheckpointManager({
      logger: mockLogger,
      configManager: mockConfigManager,
    });

    await manager.initialize();
  });

  afterEach(async () => {
    // Cleanup temp directory
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('list action', () => {
    test('returns empty list when no checkpoints exist', async () => {
      const input: CheckpointManagerInput = { action: 'list' };

      const result = await manager.handleAction(input, {});

      expect(result.isError).toBe(false);
      expect(result.content[0]).toHaveProperty('text');
      const text = (result.content[0] as { text: string }).text;
      expect(text).toContain('No checkpoints found');
    });

    test('lists checkpoints after creation', async () => {
      // Create a checkpoint first
      await fs.writeFile(path.join(tempDir, 'test.txt'), 'modified content');
      await manager.handleAction(
        { action: 'create', name: 'test-checkpoint' },
        {}
      );

      const result = await manager.handleAction({ action: 'list' }, {});

      expect(result.isError).toBe(false);
      const text = (result.content[0] as { text: string }).text;
      expect(text).toContain('test-checkpoint');
    });
  });

  describe('create action', () => {
    test('requires name parameter', async () => {
      const input: CheckpointManagerInput = { action: 'create' };

      const result = await manager.handleAction(input, {});

      expect(result.isError).toBe(true);
      const text = (result.content[0] as { text: string }).text;
      expect(text).toContain('name is required');
    });

    test('creates checkpoint with changes', async () => {
      // Modify a tracked file
      await fs.writeFile(path.join(tempDir, 'test.txt'), 'modified for checkpoint');

      const input: CheckpointManagerInput = {
        action: 'create',
        name: 'pre-refactor',
        description: 'Checkpoint before refactoring',
      };

      const result = await manager.handleAction(input, {});

      expect(result.isError).toBe(false);
      const text = (result.content[0] as { text: string }).text;
      expect(text).toContain("Checkpoint 'pre-refactor' created");
      expect(text).toContain('file(s) saved');
    });

    test('creates empty checkpoint when no changes', async () => {
      const input: CheckpointManagerInput = {
        action: 'create',
        name: 'empty-checkpoint',
      };

      const result = await manager.handleAction(input, {});

      expect(result.isError).toBe(false);
      const text = (result.content[0] as { text: string }).text;
      expect(text).toContain('created');
      expect(text).toContain('No tracked changes');
    });

    test('rejects duplicate checkpoint names', async () => {
      await fs.writeFile(path.join(tempDir, 'test.txt'), 'modified');
      await manager.handleAction({ action: 'create', name: 'dup-test' }, {});

      // Try to create another with same name
      await fs.writeFile(path.join(tempDir, 'test.txt'), 'modified again');
      const result = await manager.handleAction(
        { action: 'create', name: 'dup-test' },
        {}
      );

      expect(result.isError).toBe(true);
      const text = (result.content[0] as { text: string }).text;
      expect(text).toContain('already exists');
    });
  });

  describe('rollback action', () => {
    test('requires name parameter', async () => {
      const input: CheckpointManagerInput = { action: 'rollback' };

      const result = await manager.handleAction(input, {});

      expect(result.isError).toBe(true);
      const text = (result.content[0] as { text: string }).text;
      expect(text).toContain('name is required');
    });

    test('requires confirmation', async () => {
      // Create checkpoint
      await fs.writeFile(path.join(tempDir, 'test.txt'), 'modified');
      await manager.handleAction({ action: 'create', name: 'rollback-test' }, {});

      const result = await manager.handleAction(
        { action: 'rollback', name: 'rollback-test' },
        {}
      );

      expect(result.isError).toBe(true);
      const text = (result.content[0] as { text: string }).text;
      expect(text).toContain('confirmation');
    });

    test('fails for non-existent checkpoint', async () => {
      const result = await manager.handleAction(
        { action: 'rollback', name: 'does-not-exist', confirm: true },
        {}
      );

      expect(result.isError).toBe(true);
      const text = (result.content[0] as { text: string }).text;
      expect(text).toContain('not found');
    });

    test('rolls back changes successfully', async () => {
      // Modify file and create checkpoint
      await fs.writeFile(path.join(tempDir, 'test.txt'), 'checkpointed content');
      await manager.handleAction({ action: 'create', name: 'restore-test' }, {});

      // Modify file again
      await fs.writeFile(path.join(tempDir, 'test.txt'), 'new content after checkpoint');

      // Rollback
      const result = await manager.handleAction(
        { action: 'rollback', name: 'restore-test', confirm: true },
        {}
      );

      expect(result.isError).toBe(false);
      const text = (result.content[0] as { text: string }).text;
      expect(text).toContain('Rolled back');

      // Verify file content was restored
      const content = await fs.readFile(path.join(tempDir, 'test.txt'), 'utf-8');
      expect(content).toBe('checkpointed content');
    });
  });

  describe('delete action', () => {
    test('requires name parameter', async () => {
      const result = await manager.handleAction({ action: 'delete' }, {});

      expect(result.isError).toBe(true);
      const text = (result.content[0] as { text: string }).text;
      expect(text).toContain('name is required');
    });

    test('requires confirmation', async () => {
      await fs.writeFile(path.join(tempDir, 'test.txt'), 'modified');
      await manager.handleAction({ action: 'create', name: 'delete-test' }, {});

      const result = await manager.handleAction(
        { action: 'delete', name: 'delete-test' },
        {}
      );

      expect(result.isError).toBe(true);
      const text = (result.content[0] as { text: string }).text;
      expect(text).toContain('confirmation');
    });

    test('deletes checkpoint without restoring', async () => {
      await fs.writeFile(path.join(tempDir, 'test.txt'), 'checkpointed');
      await manager.handleAction({ action: 'create', name: 'to-delete' }, {});

      // Change file again
      await fs.writeFile(path.join(tempDir, 'test.txt'), 'after checkpoint');

      // Delete checkpoint
      const result = await manager.handleAction(
        { action: 'delete', name: 'to-delete', confirm: true },
        {}
      );

      expect(result.isError).toBe(false);
      const text = (result.content[0] as { text: string }).text;
      expect(text).toContain('deleted');

      // Verify file was NOT restored
      const content = await fs.readFile(path.join(tempDir, 'test.txt'), 'utf-8');
      expect(content).toBe('after checkpoint');

      // Verify checkpoint is gone from list
      const listResult = await manager.handleAction({ action: 'list' }, {});
      const listText = (listResult.content[0] as { text: string }).text;
      expect(listText).not.toContain('to-delete');
    });
  });

  describe('clear action', () => {
    test('succeeds when no checkpoints exist', async () => {
      const result = await manager.handleAction({ action: 'clear' }, {});

      expect(result.isError).toBe(false);
      const text = (result.content[0] as { text: string }).text;
      expect(text).toContain('No checkpoints to clear');
    });

    test('requires confirmation when checkpoints exist', async () => {
      await fs.writeFile(path.join(tempDir, 'test.txt'), 'modified');
      await manager.handleAction({ action: 'create', name: 'cp1' }, {});

      const result = await manager.handleAction({ action: 'clear' }, {});

      expect(result.isError).toBe(true);
      const text = (result.content[0] as { text: string }).text;
      expect(text).toContain('confirmation');
    });

    test('clears all checkpoints', async () => {
      // Create multiple checkpoints
      await fs.writeFile(path.join(tempDir, 'test.txt'), 'v1');
      await manager.handleAction({ action: 'create', name: 'cp1' }, {});
      await fs.writeFile(path.join(tempDir, 'test.txt'), 'v2');
      await manager.handleAction({ action: 'create', name: 'cp2' }, {});

      // Clear all
      const result = await manager.handleAction(
        { action: 'clear', confirm: true },
        {}
      );

      expect(result.isError).toBe(false);
      const text = (result.content[0] as { text: string }).text;
      expect(text).toContain('Cleared 2 checkpoint');

      // Verify all gone
      const listResult = await manager.handleAction({ action: 'list' }, {});
      const listText = (listResult.content[0] as { text: string }).text;
      expect(listText).toContain('No checkpoints found');
    });
  });

  describe('state persistence', () => {
    test('persists checkpoints across manager instances', async () => {
      // Create checkpoint with first manager
      await fs.writeFile(path.join(tempDir, 'test.txt'), 'persisted');
      await manager.handleAction(
        { action: 'create', name: 'persist-test' },
        {}
      );

      // Create new manager instance
      const manager2 = createConsolidatedCheckpointManager({
        logger: mockLogger,
        configManager: mockConfigManager,
      });
      await manager2.initialize();

      // Verify checkpoint exists
      const result = await manager2.handleAction({ action: 'list' }, {});
      const text = (result.content[0] as { text: string }).text;
      expect(text).toContain('persist-test');
    });
  });
});
