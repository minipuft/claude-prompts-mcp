// @lifecycle canonical - Unit tests for GitCheckpoint service.
/**
 * GitCheckpoint Unit Tests
 *
 * Tests the git checkpoint utilities including:
 * - Creating stash checkpoints
 * - Rolling back to checkpoints
 * - Clearing checkpoints
 * - Edge cases (non-git dirs, empty working tree)
 *
 * Note: These tests use a real temporary git repository to ensure
 * accurate behavior testing with actual git operations.
 */

import { describe, beforeEach, afterEach, it, expect, jest } from '@jest/globals';
import { mkdtemp, rm, writeFile, mkdir } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

import { GitCheckpoint, createGitCheckpoint } from '../../../../src/gates/shell/git-checkpoint.js';
import type { Logger } from '../../../../src/logging/index.js';

const execAsync = promisify(exec);

describe('GitCheckpoint', () => {
  let tempDir: string;
  let gitCheckpoint: GitCheckpoint;
  // Mock logger that suppresses output in tests
  const logger: Logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };

  beforeEach(async () => {
    // Create a temporary directory
    tempDir = await mkdtemp(join(tmpdir(), 'git-checkpoint-test-'));

    // Initialize git repo
    await execAsync('git init', { cwd: tempDir });
    await execAsync('git config user.email "test@test.com"', { cwd: tempDir });
    await execAsync('git config user.name "Test"', { cwd: tempDir });

    // Create initial commit (required for stash)
    await writeFile(join(tempDir, 'initial.txt'), 'initial content');
    await execAsync('git add .', { cwd: tempDir });
    await execAsync('git commit -m "Initial commit"', { cwd: tempDir });

    gitCheckpoint = createGitCheckpoint(logger, tempDir);
  });

  afterEach(async () => {
    // Cleanup temp directory
    try {
      await rm(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('createCheckpoint', () => {
    it('should create stash with timestamped message', async () => {
      // Modify a tracked file
      await writeFile(join(tempDir, 'initial.txt'), 'modified content');

      const result = await gitCheckpoint.createCheckpoint();

      expect(result.success).toBe(true);
      expect(result.ref).toMatch(/^verify-checkpoint-/);
      expect(result.message).toContain('Checkpointed');
    });

    it('should return success with null ref when no changes to stash', async () => {
      // No changes made after initial commit
      const result = await gitCheckpoint.createCheckpoint();

      expect(result.success).toBe(true);
      expect(result.ref).toBeNull();
      expect(result.message).toContain('No tracked changes');
    });

    it('should only stash tracked files (preserve untracked)', async () => {
      // Modify tracked file
      await writeFile(join(tempDir, 'initial.txt'), 'modified');

      // Create untracked file
      await writeFile(join(tempDir, 'untracked.txt'), 'untracked content');

      const result = await gitCheckpoint.createCheckpoint();

      expect(result.success).toBe(true);

      // Verify untracked file still exists
      const { stdout: status } = await execAsync('git status --porcelain', { cwd: tempDir });
      expect(status).toContain('?? untracked.txt');
    });

    it('should handle non-git directory gracefully', async () => {
      // Create a non-git temp directory
      const nonGitDir = await mkdtemp(join(tmpdir(), 'non-git-'));

      try {
        const nonGitCheckpoint = createGitCheckpoint(logger, nonGitDir);
        const result = await nonGitCheckpoint.createCheckpoint();

        expect(result.success).toBe(false);
        expect(result.ref).toBeNull();
        expect(result.message).toContain('failed');
      } finally {
        await rm(nonGitDir, { recursive: true, force: true });
      }
    });
  });

  describe('rollbackToCheckpoint', () => {
    it('should restore checkpoint with git stash pop', async () => {
      // Modify file and create checkpoint
      const originalContent = 'original';
      await writeFile(join(tempDir, 'initial.txt'), originalContent);
      await execAsync('git add .', { cwd: tempDir });
      await execAsync('git commit -m "Set original"', { cwd: tempDir });

      await writeFile(join(tempDir, 'initial.txt'), 'modified');

      const checkpointResult = await gitCheckpoint.createCheckpoint();
      expect(checkpointResult.ref).not.toBeNull();

      // Verify file is restored to committed state after stash
      const { stdout: content1 } = await execAsync('cat initial.txt', { cwd: tempDir });
      expect(content1.trim()).toBe(originalContent);

      // Now make different changes (simulating failed verification attempt)
      await writeFile(join(tempDir, 'initial.txt'), 'different changes');

      // Before rollback, discard conflicting changes (realistic workflow when verification fails)
      await execAsync('git checkout -- initial.txt', { cwd: tempDir });

      // Rollback should restore the stashed 'modified' content
      const rollbackResult = await gitCheckpoint.rollbackToCheckpoint(checkpointResult.ref);

      expect(rollbackResult.success).toBe(true);

      const { stdout: content2 } = await execAsync('cat initial.txt', { cwd: tempDir });
      expect(content2.trim()).toBe('modified');
    });

    it('should return success when no checkpoint to rollback (null ref)', async () => {
      const result = await gitCheckpoint.rollbackToCheckpoint(null);

      expect(result.success).toBe(true);
      expect(result.message).toContain('No checkpoint to rollback');
    });

    it('should return success when no checkpoint to rollback (empty ref)', async () => {
      const result = await gitCheckpoint.rollbackToCheckpoint('');

      expect(result.success).toBe(true);
      expect(result.message).toContain('No checkpoint to rollback');
    });

    it('should fail when stash ref not found', async () => {
      const result = await gitCheckpoint.rollbackToCheckpoint('nonexistent-stash-ref');

      expect(result.success).toBe(false);
      expect(result.message).toContain('not found');
    });
  });

  describe('clearCheckpoint', () => {
    it('should drop checkpoint without applying on clear', async () => {
      // Modify file and create checkpoint
      await writeFile(join(tempDir, 'initial.txt'), 'stashed content');

      const checkpointResult = await gitCheckpoint.createCheckpoint();
      expect(checkpointResult.ref).not.toBeNull();

      // Clear the checkpoint
      const clearResult = await gitCheckpoint.clearCheckpoint(checkpointResult.ref);

      expect(clearResult.success).toBe(true);
      expect(clearResult.message).toContain('Cleared');

      // Verify stash is gone
      const { stdout: stashList } = await execAsync('git stash list', { cwd: tempDir });
      expect(stashList).not.toContain(checkpointResult.ref!);
    });

    it('should return success when no checkpoint to clear (null ref)', async () => {
      const result = await gitCheckpoint.clearCheckpoint(null);

      expect(result.success).toBe(true);
      expect(result.message).toContain('No checkpoint to clear');
    });

    it('should return success when checkpoint already cleared', async () => {
      // Clear a ref that doesn't exist - should be non-fatal
      const result = await gitCheckpoint.clearCheckpoint('already-cleared-ref');

      expect(result.success).toBe(true);
      expect(result.message).toContain('already cleared');
    });
  });

  describe('integration scenarios', () => {
    it('should support full checkpoint-rollback cycle', async () => {
      // Step 1: Make changes
      await writeFile(join(tempDir, 'initial.txt'), 'working changes');

      // Step 2: Create checkpoint
      const checkpoint = await gitCheckpoint.createCheckpoint();
      expect(checkpoint.success).toBe(true);
      expect(checkpoint.ref).not.toBeNull();

      // Step 3: Make more changes (simulating failed verification)
      await writeFile(join(tempDir, 'initial.txt'), 'bad attempt');

      // Step 4: Discard conflicting changes before rollback (realistic workflow)
      await execAsync('git checkout -- initial.txt', { cwd: tempDir });

      // Step 5: Rollback
      const rollback = await gitCheckpoint.rollbackToCheckpoint(checkpoint.ref);
      expect(rollback.success).toBe(true);

      // Verify original working changes are restored
      const { stdout } = await execAsync('cat initial.txt', { cwd: tempDir });
      expect(stdout.trim()).toBe('working changes');
    });

    it('should support full checkpoint-clear cycle', async () => {
      // Step 1: Make changes
      await writeFile(join(tempDir, 'initial.txt'), 'working changes');

      // Step 2: Create checkpoint
      const checkpoint = await gitCheckpoint.createCheckpoint();
      expect(checkpoint.success).toBe(true);

      // Step 3: Verification passed - clear checkpoint
      const clear = await gitCheckpoint.clearCheckpoint(checkpoint.ref);
      expect(clear.success).toBe(true);

      // Verify stash is gone
      const { stdout: stashList } = await execAsync('git stash list', { cwd: tempDir });
      expect(stashList.trim()).toBe('');
    });
  });
});
