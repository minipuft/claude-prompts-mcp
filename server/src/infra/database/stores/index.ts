// @lifecycle canonical - State store barrel exports.
/**
 * State Stores Module
 *
 * Provides SQLite-based state storage via native node:sqlite (DatabaseSync):
 * - SqliteStateStore: SQLite-based persistence (multi-tenant, ACID transactions)
 *
 * Usage:
 * ```typescript
 * const engine = await SqliteEngine.getInstance(logger, { dbPath: pathResolver.getStateDatabasePath() });
 * await engine.initialize();
 * const store = new SqliteStateStore<MyState>(engine, {
 *   tableName: 'my_state',
 *   defaultState: () => ({ version: 1 })
 * }, logger);
 *
 * // Common operations
 * await store.ensureInitialized();
 * const state = await store.load();
 * await store.save({ ...state, updated: true });
 * ```
 */

export { SqliteStateStore } from './sqlite-store.js';
export type { StateStore, SqliteStateStoreConfig, StateStoreOptions } from './interface.js';
