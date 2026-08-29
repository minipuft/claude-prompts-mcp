// @lifecycle canonical - Database infrastructure barrel exports.
/**
 * Database Infrastructure Module
 *
 * Provides SQLite-based state storage via native node:sqlite (DatabaseSync):
 *
 * Architecture:
 * ```
 * SqliteStateStore<T>
 *   ├── SqliteEngine (singleton)
 *   │     ├── node:sqlite DatabaseSync
 *   │     ├── Embedded schema (version-based)
 *   │     └── runtime-state/state.db
 *   └── Continuity-scope isolation
 * ```
 *
 * Usage:
 * ```typescript
 * const engine = await SqliteEngine.getInstance(serverRoot, logger);
 * await engine.initialize();
 * const store = new SqliteStateStore<MyState>(engine, {
 *   tableName: 'my_state',
 *   defaultState: () => ({ version: 1 })
 * }, logger);
 *
 * // Common interface
 * await store.ensureInitialized();
 * const state = await store.load({ continuityScopeId: 'default' });
 * await store.save(state, { continuityScopeId: 'default' });
 * ```
 */

export { SqliteEngine, type DatabaseConfig } from './sqlite-engine.js';
export {
  ResourceIndexer,
  createResourceIndexer,
  type IndexedResource,
  type IndexedResourceType,
  type ResourceIndexerConfig,
  reportResourceSyncFailures,
  reportShadowedResources,
  type SyncFailure,
  type SyncResult,
  type ToolLoaderFn,
} from './resource-indexer.js';
export {
  SqliteStateStore,
  type StateStore,
  type SqliteStateStoreConfig,
  type StateStoreOptions,
} from './stores/index.js';
export type { DatabasePort } from '#shared/types/persistence.js';
