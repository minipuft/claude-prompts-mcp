// @lifecycle canonical - Framework tool handler MCP entrypoint for methodology CRUD operations.
/**
 * Framework Tool Handler MCP Tool
 *
 * Thin routing layer for methodology lifecycle management.
 * Domain logic delegated to services:
 * - FrameworkLifecycleProcessor: create, update, delete, reload, switch
 * - FrameworkDiscoveryProcessor: list, inspect
 * - FrameworkVersioningProcessor: history, rollback, compare
 * - FrameworkDraftValidator: scoring, error/success formatting
 * - FrameworkFileWriter: file I/O with merge support
 */

export { FrameworkToolHandler, createFrameworkToolHandler } from './core/manager.js';
export type { FrameworkResourceContext } from './core/context.js';
export type {
  FrameworkManagerActionId,
  FrameworkManagerInput,
  FrameworkManagerDependencies,
} from './core/types.js';
export {
  FrameworkFileWriter,
  FrameworkDraftValidator,
  FrameworkLifecycleProcessor,
  FrameworkDiscoveryProcessor,
  FrameworkVersioningProcessor,
  type FrameworkFileWriterDependencies,
  type ExistingFrameworkData,
  type FrameworkFileResult,
} from './services/index.js';
