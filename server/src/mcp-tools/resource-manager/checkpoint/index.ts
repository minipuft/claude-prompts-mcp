// @lifecycle canonical - Checkpoint manager barrel export.
/**
 * Checkpoint Manager Module
 *
 * Git-based checkpoint/rollback functionality for resource_manager.
 */

export { ConsolidatedCheckpointManager, createConsolidatedCheckpointManager } from './manager.js';
export type {
  CheckpointAction,
  CheckpointRef,
  CheckpointState,
  CheckpointManagerInput,
  CheckpointManagerDependencies,
  CheckpointOperationResult,
} from './types.js';
