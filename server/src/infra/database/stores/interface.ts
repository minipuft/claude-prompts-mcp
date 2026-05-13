// @lifecycle canonical - Re-exports shared persistence interfaces + infra-specific config.
/**
 * State Store Interface
 *
 * StateStoreOptions and StateStore<T> are defined in shared/types/persistence.ts (Layer 0)
 * and re-exported here for backward compatibility. SqliteStateStoreConfig is infra-specific.
 */

export type { StateStoreOptions, StateStore } from '../../../shared/types/persistence.js';

/**
 * Options for creating a SQLite-based state store
 */
export interface SqliteStateStoreConfig {
  /** Table name in the database */
  tableName: string;
  /** Column name for the state data (default: 'state') */
  stateColumn?: string;
  /**
   * Optional discriminator key for shared tables (e.g., `kv_state`).
   *
   * When set, all reads/writes/deletes scope additionally by `WHERE key = ?`,
   * allowing multiple logically distinct state slots (framework, gates,
   * argument history, resource hashes) to share one physical table.
   *
   * When unset, the store uses the legacy single-table-per-purpose pattern.
   */
  key?: string;
  /** Default state to return when no record exists */
  defaultState: () => unknown;
}
