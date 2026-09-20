// @lifecycle canonical - Layer-neutral persistence interfaces consumed across all layers.
/**
 * Persistence Interfaces
 *
 * Pure interfaces for state stores and database access, with zero infra dependencies.
 * Defined in shared/types so modules/, engine/, and mcp/ can type against them
 * without importing from infra/database/ directly.
 *
 * Implementations live in infra/database/ (SqliteEngine, SqliteStateStore).
 */

/**
 * Common options for state store operations
 */
export interface StateStoreOptions {
  /** Canonical continuity scope ID (highest-priority explicit scope override) */
  continuityScopeId?: string;
  /** Canonical workspace scope for continuity isolation */
  workspaceId?: string;
  /** Canonical organization fallback when workspaceId is unavailable */
  organizationId?: string;
}

/**
 * Generic state store interface
 *
 * @typeParam T - The shape of the persisted state
 */
export interface StateStore<T> {
  /** Ensure the store is ready for operations (create tables, etc.) */
  ensureInitialized(): Promise<void>;
  /** Load state from the store */
  load(options?: StateStoreOptions): Promise<T>;
  /** Save state to the store */
  save(state: T, options?: StateStoreOptions): Promise<void>;
  /** Check if state exists for a given identity scope */
  exists(options?: StateStoreOptions): Promise<boolean>;
  /** Delete state (useful for testing and cleanup) */
  delete(options?: StateStoreOptions): Promise<void>;
}

/**
 * Which lock a transaction takes, and when.
 *
 * - `deferred` (SQLite's default) — no lock until the first write. Two connections may both read,
 *   and the second to write is refused; correct only for a body that reads OR writes, not both.
 * - `immediate` — the write lock is taken at BEGIN, so a read-then-write pair is one atomic unit.
 */
export type TransactionMode = 'deferred' | 'immediate';

/**
 * Database access port — consumed by modules that need raw SQL queries.
 *
 * Implemented by SqliteEngine in infra/database/. Modules type against this
 * interface and receive the concrete instance via constructor injection.
 */
export interface DatabasePort {
  /** Check if the database is ready for queries */
  isInitialized(): boolean;
  /** Ensure the database is initialized (idempotent) */
  initialize(): Promise<void>;
  /** Execute a SQL query and return all results */
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): T[];
  /** Execute a SQL query and return first result (or null) */
  queryOne<T = Record<string, unknown>>(sql: string, params?: unknown[]): T | null;
  /** Execute a SQL statement (no return value) */
  run(sql: string, params?: unknown[]): void;
  /**
   * Execute multiple statements in a transaction.
   *
   * `'immediate'` takes the write lock up front and is required whenever the body READS a value it
   * then writes back — a deferred transaction lets a second connection commit between the two, so
   * the write lands on a value that is already stale.
   */
  transaction<T>(fn: () => T | Promise<T>, mode?: TransactionMode): Promise<T>;
  /** Begin a manual transaction */
  beginTransaction(mode?: TransactionMode): void;
  /** Commit a manual transaction */
  commit(): void;
  /** Rollback a manual transaction */
  rollback(): void;
}

/**
 * Tool index entry — cross-layer contract for indexed script tools.
 * Defined here so modules/skills-sync can type against it without importing infra/.
 */
export interface ToolIndexEntry {
  id: string;
  name: string;
  runtime: string;
  inputSchema: import('./automation.js').JSONSchemaDefinition;
  execution: {
    trigger: string;
    confirm: boolean;
    strict: boolean;
    timeout?: number;
  };
  env?: Record<string, string>;
  promptId: string;
  category: string;
  description: string;
  toolDir: string;
  scriptPath: string;
  contentHash: string;
}
