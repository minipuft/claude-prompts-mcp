import { Logger } from '../../logging/index.js';
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
export declare class GitCheckpoint {
    private readonly logger;
    private readonly workingDir;
    constructor(logger: Logger, workingDir: string);
    /**
     * Create a git stash checkpoint before verification.
     *
     * Stashes only tracked files to preserve work in case verification fails.
     * Returns the stash reference for later rollback/clear.
     */
    createCheckpoint(): Promise<CheckpointResult>;
    /**
     * Rollback to a previously created checkpoint.
     *
     * Restores the stashed changes, effectively undoing work since checkpoint.
     * Uses 'git stash pop' to apply and remove the stash.
     */
    rollbackToCheckpoint(ref: string | null): Promise<CheckpointResult>;
    /**
     * Clear a checkpoint after successful verification.
     *
     * Drops the stash without applying changes (they're already in working tree).
     */
    clearCheckpoint(ref: string | null): Promise<CheckpointResult>;
}
/**
 * Factory function to create a GitCheckpoint instance.
 */
export declare function createGitCheckpoint(logger: Logger, workingDir: string): GitCheckpoint;
