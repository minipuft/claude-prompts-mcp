// @lifecycle canonical - Git checkpoint utilities for verify rollback support.
import { exec } from 'child_process';
import { promisify } from 'util';

import { Logger } from '../../logging/index.js';

const execAsync = promisify(exec);

/**
 * Result of a git checkpoint operation.
 */
export interface CheckpointResult {
  success: boolean;
  ref: string | null;
  message: string;
}

/**
 * Git checkpoint utilities for verify rollback support.
 *
 * Provides git stash-based checkpointing for safe verification:
 * - createCheckpoint(): Stash tracked changes before verification
 * - rollbackToCheckpoint(): Restore stashed changes on failure
 * - clearCheckpoint(): Drop stash if verification passes
 *
 * Only affects tracked files (untracked files are preserved).
 */
export class GitCheckpoint {
  private readonly logger: Logger;
  private readonly workingDir: string;

  constructor(logger: Logger, workingDir: string) {
    this.logger = logger;
    this.workingDir = workingDir;
  }

  /**
   * Create a git stash checkpoint before verification.
   *
   * Stashes only tracked files to preserve work in case verification fails.
   * Returns the stash reference for later rollback/clear.
   */
  async createCheckpoint(): Promise<CheckpointResult> {
    try {
      // Check if we're in a git repo
      await execAsync('git rev-parse --is-inside-work-tree', { cwd: this.workingDir });

      // Check for changes to stash (tracked files only)
      const { stdout: statusOutput } = await execAsync('git status --porcelain', {
        cwd: this.workingDir,
      });

      // Filter to only tracked files (modified/deleted, not untracked '??')
      const trackedChanges = statusOutput
        .split('\n')
        .filter((line) => line.trim() !== '' && !line.startsWith('??'));

      if (trackedChanges.length === 0) {
        this.logger.debug('[GitCheckpoint] No tracked changes to stash');
        return {
          success: true,
          ref: null,
          message: 'No tracked changes to checkpoint',
        };
      }

      // Create stash with timestamp
      const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
      const stashMessage = `verify-checkpoint-${timestamp}`;

      await execAsync(`git stash push -m "${stashMessage}"`, {
        cwd: this.workingDir,
      });

      this.logger.info(`[GitCheckpoint] Created checkpoint: ${stashMessage}`);

      return {
        success: true,
        ref: stashMessage,
        message: `Checkpointed ${trackedChanges.length} tracked file(s)`,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.warn(`[GitCheckpoint] Failed to create checkpoint: ${errorMessage}`);

      return {
        success: false,
        ref: null,
        message: `Checkpoint failed: ${errorMessage}`,
      };
    }
  }

  /**
   * Rollback to a previously created checkpoint.
   *
   * Restores the stashed changes, effectively undoing work since checkpoint.
   * Uses 'git stash pop' to apply and remove the stash.
   */
  async rollbackToCheckpoint(ref: string | null): Promise<CheckpointResult> {
    if (ref === null || ref === '') {
      return {
        success: true,
        ref: null,
        message: 'No checkpoint to rollback (no changes were stashed)',
      };
    }

    try {
      // Find the stash by message
      const { stdout: stashList } = await execAsync('git stash list', {
        cwd: this.workingDir,
      });

      const stashMatch = stashList.split('\n').find((line) => line.includes(ref));

      if (stashMatch === undefined) {
        this.logger.warn(`[GitCheckpoint] Stash not found: ${ref}`);
        return {
          success: false,
          ref,
          message: `Checkpoint not found: ${ref}`,
        };
      }

      // Extract stash index (e.g., "stash@{0}")
      const stashIndex = stashMatch.split(':')[0];

      // Pop the stash to restore changes
      await execAsync(`git stash pop ${stashIndex}`, {
        cwd: this.workingDir,
      });

      this.logger.info(`[GitCheckpoint] Rolled back to checkpoint: ${ref}`);

      return {
        success: true,
        ref,
        message: `Rolled back to checkpoint: ${ref}`,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.error(`[GitCheckpoint] Rollback failed: ${errorMessage}`);

      return {
        success: false,
        ref,
        message: `Rollback failed: ${errorMessage}`,
      };
    }
  }

  /**
   * Clear a checkpoint after successful verification.
   *
   * Drops the stash without applying changes (they're already in working tree).
   */
  async clearCheckpoint(ref: string | null): Promise<CheckpointResult> {
    if (ref === null || ref === '') {
      return {
        success: true,
        ref: null,
        message: 'No checkpoint to clear',
      };
    }

    try {
      // Find the stash by message
      const { stdout: stashList } = await execAsync('git stash list', {
        cwd: this.workingDir,
      });

      const stashMatch = stashList.split('\n').find((line) => line.includes(ref));

      if (stashMatch === undefined) {
        // Already cleared or never existed - that's fine
        return {
          success: true,
          ref,
          message: 'Checkpoint already cleared',
        };
      }

      // Extract stash index
      const stashIndex = stashMatch.split(':')[0];

      // Drop the stash (don't apply)
      await execAsync(`git stash drop ${stashIndex}`, {
        cwd: this.workingDir,
      });

      this.logger.debug(`[GitCheckpoint] Cleared checkpoint: ${ref}`);

      return {
        success: true,
        ref,
        message: `Cleared checkpoint: ${ref}`,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.logger.warn(`[GitCheckpoint] Failed to clear checkpoint: ${errorMessage}`);

      // Non-fatal - don't fail the whole operation
      return {
        success: true,
        ref,
        message: `Clear checkpoint warning: ${errorMessage}`,
      };
    }
  }
}

/**
 * Factory function to create a GitCheckpoint instance.
 */
export function createGitCheckpoint(logger: Logger, workingDir: string): GitCheckpoint {
  return new GitCheckpoint(logger, workingDir);
}
