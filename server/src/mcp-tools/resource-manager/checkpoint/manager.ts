// @lifecycle canonical - Consolidated checkpoint manager for MCP.
/**
 * Consolidated Checkpoint Manager
 *
 * Provides MCP tool interface for git-based checkpoint management.
 * Wraps GitCheckpoint from gates/shell for resource_manager integration.
 *
 * Actions:
 * - create: Create a checkpoint (git stash) before risky operations
 * - rollback: Restore a checkpoint (git stash pop)
 * - list: List all active checkpoints
 * - delete: Remove a checkpoint without applying (git stash drop)
 * - clear: Clear all checkpoints
 */

import * as fs from 'node:fs/promises';
import * as path from 'node:path';

import { GitCheckpoint, createGitCheckpoint } from '../../../gates/shell/git-checkpoint.js';

import type {
  CheckpointManagerInput,
  CheckpointManagerDependencies,
  CheckpointRef,
  CheckpointState,
} from './types.js';
import type { ConfigManager } from '../../../config/index.js';
import type { Logger } from '../../../logging/index.js';
import type { ToolResponse } from '../../../types/index.js';

/**
 * Create a fresh empty checkpoint state.
 * Must be a function to avoid sharing state across instances.
 */
function createDefaultState(): CheckpointState {
  return {
    checkpoints: [],
    lastUpdated: new Date().toISOString(),
  };
}

/**
 * Consolidated Checkpoint Manager
 */
export class ConsolidatedCheckpointManager {
  private readonly logger: Logger;
  private readonly configManager: ConfigManager;
  private readonly gitCheckpoint: GitCheckpoint;
  private state: CheckpointState = createDefaultState();

  constructor(deps: CheckpointManagerDependencies) {
    this.logger = deps.logger;
    this.configManager = deps.configManager;
    // Use server root as workspace directory for git operations
    this.gitCheckpoint = createGitCheckpoint(deps.logger, deps.configManager.getServerRoot());

    this.logger.debug('ConsolidatedCheckpointManager initialized');
  }

  /**
   * Initialize the manager (load state from disk)
   */
  async initialize(): Promise<void> {
    await this.loadState();
  }

  /**
   * Handle checkpoint manager action
   */
  async handleAction(
    args: CheckpointManagerInput,
    _context: Record<string, unknown>
  ): Promise<ToolResponse> {
    const { action } = args;

    try {
      switch (action) {
        case 'create':
          return await this.handleCreate(args);
        case 'rollback':
          return await this.handleRollback(args);
        case 'list':
          return await this.handleList();
        case 'delete':
          return await this.handleDelete(args);
        case 'clear':
          return await this.handleClear(args);
        default:
          return this.createErrorResponse(`Unknown checkpoint action: ${action}`);
      }
    } catch (error) {
      this.logger.error('checkpoint_manager error:', error);
      return this.createErrorResponse(
        `Error in checkpoint_manager: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  // ============================================================================
  // Action Handlers
  // ============================================================================

  private async handleCreate(args: CheckpointManagerInput): Promise<ToolResponse> {
    const { name, description } = args;

    if (name == null || name.trim() === '') {
      return this.createErrorResponse('Checkpoint name is required for create action');
    }

    // Check if checkpoint with this name already exists
    if (this.state.checkpoints.some((cp) => cp.name === name)) {
      return this.createErrorResponse(
        `Checkpoint '${name}' already exists. Use a different name or delete it first.`
      );
    }

    // Create the git checkpoint
    const result = await this.gitCheckpoint.createCheckpoint();

    if (!result.success) {
      return this.createErrorResponse(`Failed to create checkpoint: ${result.message}`);
    }

    // If no changes to stash, still track the checkpoint (empty)
    const checkpoint: CheckpointRef = {
      name,
      ref: result.ref ?? '',
      createdAt: new Date().toISOString(),
      description: description ?? `Checkpoint before ${name}`,
      fileCount: result.ref != null ? this.extractFileCount(result.message) : 0,
    };

    this.state.checkpoints.push(checkpoint);
    await this.saveState();

    const fileInfo =
      checkpoint.fileCount > 0 ? `${checkpoint.fileCount} file(s) saved` : 'No tracked changes';

    return this.createSuccessResponse(
      `✅ Checkpoint '${name}' created\n\n` +
        `📁 ${fileInfo}\n` +
        `📝 ${checkpoint.description}\n\n` +
        `💡 Use \`resource_manager(resource_type:"checkpoint", action:"rollback", name:"${name}")\` to restore`
    );
  }

  private async handleRollback(args: CheckpointManagerInput): Promise<ToolResponse> {
    const { name, confirm } = args;

    if (name == null || name.trim() === '') {
      return this.createErrorResponse('Checkpoint name is required for rollback action');
    }

    const checkpoint = this.state.checkpoints.find((cp) => cp.name === name);

    if (checkpoint == null) {
      return this.createErrorResponse(
        `Checkpoint '${name}' not found. Use action:"list" to see available checkpoints.`
      );
    }

    if (confirm !== true) {
      return this.createErrorResponse(
        `⚠️ Rollback requires confirmation.\n\n` +
          `This will restore your working directory to the state when '${name}' was created.\n\n` +
          `To proceed, set confirm: true`
      );
    }

    // If checkpoint has no ref (no files were stashed), just remove it
    if (checkpoint.ref === '') {
      this.state.checkpoints = this.state.checkpoints.filter((cp) => cp.name !== name);
      await this.saveState();

      return this.createSuccessResponse(
        `✅ Checkpoint '${name}' was empty (no tracked changes were saved)\n\n` +
          `📁 Working directory unchanged\n` +
          `🗑️ Checkpoint removed from registry`
      );
    }

    // Perform the rollback
    const result = await this.gitCheckpoint.rollbackToCheckpoint(checkpoint.ref);

    if (!result.success) {
      return this.createErrorResponse(`Failed to rollback: ${result.message}`);
    }

    // Remove the checkpoint from state (stash was popped)
    this.state.checkpoints = this.state.checkpoints.filter((cp) => cp.name !== name);
    await this.saveState();

    return this.createSuccessResponse(
      `✅ Rolled back to checkpoint '${name}'\n\n` +
        `📁 Working directory restored\n` +
        `🗑️ Checkpoint consumed (no longer available)`
    );
  }

  private async handleList(): Promise<ToolResponse> {
    if (this.state.checkpoints.length === 0) {
      return this.createSuccessResponse(
        `📋 No checkpoints found\n\n` +
          `💡 Create a checkpoint with:\n` +
          `   resource_manager(resource_type:"checkpoint", action:"create", name:"my-checkpoint")`
      );
    }

    const checkpointList = this.state.checkpoints
      .map((cp) => {
        const age = this.formatAge(cp.createdAt);
        const files = cp.fileCount > 0 ? `${cp.fileCount} files` : 'empty';
        return `  📌 ${cp.name} (${files}, ${age})\n     ${cp.description}`;
      })
      .join('\n\n');

    return this.createSuccessResponse(
      `📋 Checkpoints (${this.state.checkpoints.length})\n\n${checkpointList}`
    );
  }

  private async handleDelete(args: CheckpointManagerInput): Promise<ToolResponse> {
    const { name, confirm } = args;

    if (name == null || name.trim() === '') {
      return this.createErrorResponse('Checkpoint name is required for delete action');
    }

    const checkpoint = this.state.checkpoints.find((cp) => cp.name === name);

    if (checkpoint == null) {
      return this.createErrorResponse(
        `Checkpoint '${name}' not found. Use action:"list" to see available checkpoints.`
      );
    }

    if (confirm !== true) {
      return this.createErrorResponse(
        `⚠️ Delete requires confirmation.\n\n` +
          `This will permanently delete checkpoint '${name}' without restoring changes.\n\n` +
          `To proceed, set confirm: true`
      );
    }

    // Clear the stash if it has a ref
    if (checkpoint.ref !== '') {
      await this.gitCheckpoint.clearCheckpoint(checkpoint.ref);
    }

    // Remove from state
    this.state.checkpoints = this.state.checkpoints.filter((cp) => cp.name !== name);
    await this.saveState();

    return this.createSuccessResponse(
      `✅ Checkpoint '${name}' deleted\n\n` + `📁 Stashed changes discarded permanently`
    );
  }

  private async handleClear(args: CheckpointManagerInput): Promise<ToolResponse> {
    const { confirm } = args;

    if (this.state.checkpoints.length === 0) {
      return this.createSuccessResponse('📋 No checkpoints to clear');
    }

    if (confirm !== true) {
      return this.createErrorResponse(
        `⚠️ Clear requires confirmation.\n\n` +
          `This will delete all ${this.state.checkpoints.length} checkpoint(s).\n\n` +
          `To proceed, set confirm: true`
      );
    }

    // Clear all stashes
    for (const checkpoint of this.state.checkpoints) {
      if (checkpoint.ref !== '') {
        await this.gitCheckpoint.clearCheckpoint(checkpoint.ref);
      }
    }

    const count = this.state.checkpoints.length;
    this.state.checkpoints = [];
    await this.saveState();

    return this.createSuccessResponse(`✅ Cleared ${count} checkpoint(s)`);
  }

  // ============================================================================
  // State Persistence
  // ============================================================================

  private getStatePath(): string {
    const serverRoot = this.configManager.getServerRoot();
    return path.join(serverRoot, 'runtime-state', 'checkpoints.json');
  }

  private async loadState(): Promise<void> {
    const statePath = this.getStatePath();

    try {
      const content = await fs.readFile(statePath, 'utf8');
      const parsed = JSON.parse(content) as CheckpointState;

      // Validate structure
      if (Array.isArray(parsed.checkpoints)) {
        this.state = parsed;
        this.logger.debug(`Loaded ${this.state.checkpoints.length} checkpoints from state`);
      }
    } catch (error) {
      // File doesn't exist or is invalid - use default
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.logger.warn('Failed to load checkpoint state:', error);
      }
      this.state = createDefaultState();
    }
  }

  private async saveState(): Promise<void> {
    const statePath = this.getStatePath();

    try {
      // Ensure directory exists
      const dir = path.dirname(statePath);
      await fs.mkdir(dir, { recursive: true });

      // Update timestamp
      this.state.lastUpdated = new Date().toISOString();

      // Write state
      await fs.writeFile(statePath, JSON.stringify(this.state, null, 2), 'utf8');
      this.logger.debug(`Saved ${this.state.checkpoints.length} checkpoints to state`);
    } catch (error) {
      this.logger.error('Failed to save checkpoint state:', error);
      throw error; // Propagate error to caller
    }
  }

  // ============================================================================
  // Helpers
  // ============================================================================

  private extractFileCount(message: string): number {
    // Parse "Checkpointed N tracked file(s)" message
    const match = message.match(/(\d+)\s+tracked\s+file/);
    if (match?.[1] == null) return 0;
    return parseInt(match[1], 10);
  }

  private formatAge(dateString: string): string {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}d ago`;
  }

  private createSuccessResponse(text: string): ToolResponse {
    return {
      content: [{ type: 'text', text }],
      isError: false,
    };
  }

  private createErrorResponse(text: string): ToolResponse {
    return {
      content: [{ type: 'text', text: `❌ ${text}` }],
      isError: true,
    };
  }
}

/**
 * Create consolidated checkpoint manager
 */
export function createConsolidatedCheckpointManager(
  deps: CheckpointManagerDependencies
): ConsolidatedCheckpointManager {
  return new ConsolidatedCheckpointManager(deps);
}
