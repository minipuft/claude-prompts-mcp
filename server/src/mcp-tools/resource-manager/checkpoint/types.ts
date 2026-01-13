// @lifecycle canonical - Types for checkpoint manager.
/**
 * Checkpoint Manager Types
 *
 * Defines types for the checkpoint resource type in resource_manager.
 * Provides git-based checkpoint/rollback functionality for safe verification.
 */

import type { ConfigManager } from '../../../config/index.js';
import type { Logger } from '../../../logging/index.js';

/**
 * Checkpoint actions - simplified compared to other resource types
 */
export type CheckpointAction = 'create' | 'rollback' | 'list' | 'delete' | 'clear';

/**
 * Checkpoint reference stored in state
 */
export interface CheckpointRef {
  /** Unique checkpoint name/identifier */
  name: string;
  /** Git stash reference (internal) */
  ref: string;
  /** Creation timestamp */
  createdAt: string;
  /** Description of what the checkpoint contains */
  description: string;
  /** Number of files checkpointed */
  fileCount: number;
}

/**
 * Checkpoint state persisted to runtime-state/checkpoints.json
 */
export interface CheckpointState {
  /** Active checkpoints */
  checkpoints: CheckpointRef[];
  /** Last updated timestamp */
  lastUpdated: string;
}

/**
 * Input for checkpoint manager operations
 */
export interface CheckpointManagerInput {
  action: CheckpointAction;
  /** Checkpoint name (required for create, rollback, delete) */
  name?: string;
  /** Description for the checkpoint (optional for create) */
  description?: string;
  /** Safety confirmation for delete/rollback */
  confirm?: boolean;
  /** Reason for audit logging */
  reason?: string;
}

/**
 * Dependencies for CheckpointManager
 */
export interface CheckpointManagerDependencies {
  logger: Logger;
  configManager: ConfigManager;
}

/**
 * Result of a checkpoint operation
 */
export interface CheckpointOperationResult {
  success: boolean;
  message: string;
  checkpoint?: CheckpointRef;
  checkpoints?: CheckpointRef[];
  error?: string;
}
