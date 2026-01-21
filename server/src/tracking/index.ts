/**
 * Tracking Module
 * Provides resource change tracking with source attribution and audit logging.
 *
 * Usage:
 * ```typescript
 * import { createResourceChangeTracker } from './tracking/index.js';
 *
 * const tracker = createResourceChangeTracker(logger, {
 *   runtimeStateDir: './runtime-state',
 *   maxEntries: 1000,
 * });
 *
 * await tracker.initialize();
 *
 * // Log a change from MCP tool
 * await tracker.logChange({
 *   source: 'mcp-tool',
 *   operation: 'modified',
 *   resourceType: 'prompt',
 *   resourceId: 'readme_improver',
 *   filePath: '/path/to/prompt.yaml',
 * });
 *
 * // Query recent changes
 * const changes = await tracker.getChanges({ limit: 10, source: 'filesystem' });
 * ```
 */

export {
  ResourceChangeTracker,
  createResourceChangeTracker,
  type ChangeSource,
  type ChangeOperation,
  type TrackedResourceType,
  type ResourceChangeEntry,
  type LogChangeParams,
  type GetChangesParams,
  type ResourceChangeTrackerConfig,
} from './resource-change-tracker.js';
