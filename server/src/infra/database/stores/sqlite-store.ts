// @lifecycle canonical - SQLite-based state store with continuity-scope isolation.
/**
 * SQLite State Store
 *
 * Implements StateStore using native node:sqlite (via SqliteEngine).
 * Provides continuity-scope isolation via workspace/organization identity.
 *
 * Features:
 * - ACID transactions for data integrity
 * - Continuity scope isolation by default
 * - Queryable state (vs opaque JSON files)
 * - Automatic table creation and schema management
 * - File-backed natively (no manual persist() needed)
 *
 * Prerequisites:
 * - SqliteEngine must be initialized before using this store
 * - Table schema is defined in SqliteEngine's embedded schema
 */

import { resolveContinuityScopeId } from '../../../shared/utils/request-identity-scope.js';

import type { SqliteStateStoreConfig } from './interface.js';
import type {
  DatabasePort,
  StateStore,
  StateStoreOptions,
} from '../../../shared/types/persistence.js';
import type { Logger } from '../../logging/index.js';

const DEFAULT_SCOPE_ID = 'default';

type TableColumnRow = { name?: string };
type StateScopeColumns = {
  hasTenantId: boolean;
  hasWorkspaceId: boolean;
  hasOrganizationId: boolean;
};
type ResolvedStateScope = {
  continuityScopeId: string;
  workspaceId?: string;
  organizationId?: string;
  storageScopeId: string;
};

export class SqliteStateStore<T> implements StateStore<T> {
  private readonly tableName: string;
  private readonly stateColumn: string;
  private readonly discriminatorKey?: string;
  private readonly defaultState: () => T;
  private readonly logger?: Logger;
  private readonly db: DatabasePort;
  private scopeColumnsCache?: StateScopeColumns;

  constructor(db: DatabasePort, config: SqliteStateStoreConfig, logger?: Logger) {
    this.db = db;
    this.tableName = config.tableName;
    this.stateColumn = config.stateColumn ?? 'state';
    this.discriminatorKey = config.key;
    this.defaultState = config.defaultState as () => T;
    this.logger = logger;
  }

  async ensureInitialized(): Promise<void> {
    // SqliteEngine handles initialization and schema creation
    if (!this.db.isInitialized()) {
      throw new Error(
        `[SqliteStateStore] SqliteEngine not initialized. Call SqliteEngine.initialize() first.`
      );
    }
    this.logger?.debug?.(`[SqliteStateStore] Store ready for table: ${this.tableName}`);
  }

  async load(options?: StateStoreOptions): Promise<T> {
    const scope = this.resolveScope(options);

    try {
      const result = this.findRowByScope(scope);

      if (!result) {
        this.logger?.debug?.(
          `[SqliteStateStore] No state found for scope ${scope.continuityScopeId} in ${this.tableName}, using default`
        );
        return this.defaultState();
      }

      const stateData = result[this.stateColumn];
      if (typeof stateData === 'string') {
        return JSON.parse(stateData) as T;
      }

      // State might already be parsed (depending on SQLite driver behavior)
      return stateData as T;
    } catch (error) {
      this.logger?.warn?.(
        `[SqliteStateStore] Failed to load state: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      return this.defaultState();
    }
  }

  async save(state: T, options?: StateStoreOptions): Promise<void> {
    const scope = this.resolveScope(options);

    try {
      const stateJson = JSON.stringify(state);
      const now = new Date().toISOString();
      const scopeColumns = this.getScopeColumns();

      const columns = [`${this.stateColumn}`, 'updated_at'];
      const values: Array<string | null> = [stateJson, now];

      if (scopeColumns.hasTenantId) {
        columns.unshift('tenant_id');
        values.unshift(scope.storageScopeId);
      }
      if (scopeColumns.hasOrganizationId) {
        columns.splice(scopeColumns.hasTenantId ? 1 : 0, 0, 'organization_id');
        values.splice(scopeColumns.hasTenantId ? 1 : 0, 0, scope.organizationId ?? null);
      }
      if (scopeColumns.hasWorkspaceId) {
        const workspaceIndex = scopeColumns.hasTenantId ? 2 : 1;
        columns.splice(workspaceIndex, 0, 'workspace_id');
        values.splice(workspaceIndex, 0, scope.workspaceId ?? scope.continuityScopeId);
      }
      if (this.discriminatorKey != null) {
        columns.push('key');
        values.push(this.discriminatorKey);
      }

      const placeholders = columns.map(() => '?').join(', ');
      this.db.run(
        `INSERT OR REPLACE INTO ${this.tableName} (${columns.join(', ')})
         VALUES (${placeholders})`,
        values
      );

      this.logger?.debug?.(
        `[SqliteStateStore] Persisted state for scope ${scope.continuityScopeId} in ${this.tableName}`
      );
    } catch (error) {
      this.logger?.error?.(
        `[SqliteStateStore] Failed to persist state: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      throw error;
    }
  }

  async exists(options?: StateStoreOptions): Promise<boolean> {
    const scope = this.resolveScope(options);

    try {
      return this.findRowByScope(scope) != null;
    } catch {
      return false;
    }
  }

  async delete(options?: StateStoreOptions): Promise<void> {
    const scope = this.resolveScope(options);

    try {
      const scopeColumns = this.getScopeColumns();
      const keyClause = this.discriminatorKey != null ? ' AND key = ?' : '';
      const keyParam: string[] = this.discriminatorKey != null ? [this.discriminatorKey] : [];
      if (scopeColumns.hasWorkspaceId) {
        this.db.run(`DELETE FROM ${this.tableName} WHERE workspace_id = ?${keyClause}`, [
          scope.continuityScopeId,
          ...keyParam,
        ]);
      }
      if (scopeColumns.hasTenantId) {
        this.db.run(`DELETE FROM ${this.tableName} WHERE tenant_id = ?${keyClause}`, [
          scope.storageScopeId,
          ...keyParam,
        ]);
      }
      if (!scopeColumns.hasWorkspaceId && !scopeColumns.hasTenantId) {
        throw new Error(
          `[SqliteStateStore] Table ${this.tableName} has no identity column for delete()`
        );
      }
      this.logger?.debug?.(
        `[SqliteStateStore] Deleted state for scope ${scope.continuityScopeId} from ${this.tableName}`
      );
    } catch (error) {
      this.logger?.error?.(
        `[SqliteStateStore] Failed to delete state: ${
          error instanceof Error ? error.message : String(error)
        }`
      );
      throw error;
    }
  }

  /**
   * Get the table name (for debugging/testing)
   */
  getTableName(): string {
    return this.tableName;
  }

  /**
   * Execute a custom query on this store's table
   * Useful for domain-specific queries beyond simple CRUD
   */
  query<R>(sql: string, params?: unknown[]): R[] {
    return this.db.query<R>(sql, params as (string | number | boolean | null | undefined)[]);
  }

  /**
   * Execute a custom query returning a single result
   */
  queryOne<R>(sql: string, params?: unknown[]): R | null {
    return this.db.queryOne<R>(sql, params as (string | number | boolean | null | undefined)[]);
  }

  private normalizeScopeComponent(value: unknown): string | undefined {
    if (typeof value !== 'string') {
      return undefined;
    }
    const normalized = value.trim();
    return normalized.length > 0 ? normalized : undefined;
  }

  private resolveScope(options?: StateStoreOptions): ResolvedStateScope {
    const continuityScopeId = this.normalizeScopeComponent(options?.continuityScopeId);
    const workspaceId = this.normalizeScopeComponent(options?.workspaceId);
    const organizationId = this.normalizeScopeComponent(options?.organizationId);

    const resolvedScopeId = resolveContinuityScopeId({
      workspaceId: continuityScopeId ?? workspaceId,
      organizationId,
    });

    return {
      continuityScopeId: resolvedScopeId,
      workspaceId: continuityScopeId ?? workspaceId ?? resolvedScopeId,
      organizationId,
      storageScopeId: resolvedScopeId ?? DEFAULT_SCOPE_ID,
    };
  }

  private getScopeColumns(): StateScopeColumns {
    if (this.scopeColumnsCache) {
      return this.scopeColumnsCache;
    }

    const rows = this.db.query<TableColumnRow>(`PRAGMA table_info(${this.tableName})`);
    const columns = new Set(
      rows
        .map((row) => row.name)
        .filter((name): name is string => typeof name === 'string' && name.length > 0)
    );
    this.scopeColumnsCache = {
      hasTenantId: columns.has('tenant_id'),
      hasWorkspaceId: columns.has('workspace_id'),
      hasOrganizationId: columns.has('organization_id'),
    };
    return this.scopeColumnsCache;
  }

  private findRowByScope(scope: ResolvedStateScope): Record<string, unknown> | null {
    const scopeColumns = this.getScopeColumns();
    const seen = new Set<string>();
    const candidates: Array<{ sql: string; value: string }> = [];
    const keyClause = this.discriminatorKey != null ? ' AND key = ?' : '';

    const addCandidate = (sql: string, value?: string): void => {
      if (value == null || value.length === 0) {
        return;
      }
      const finalSql = sql + keyClause;
      const cacheKey = `${finalSql}::${value}`;
      if (seen.has(cacheKey)) {
        return;
      }
      seen.add(cacheKey);
      candidates.push({ sql: finalSql, value });
    };

    if (scopeColumns.hasWorkspaceId) {
      addCandidate(
        `SELECT ${this.stateColumn} FROM ${this.tableName} WHERE workspace_id = ?`,
        scope.workspaceId
      );
      addCandidate(
        `SELECT ${this.stateColumn} FROM ${this.tableName} WHERE workspace_id = ?`,
        scope.continuityScopeId
      );
    }
    if (scopeColumns.hasOrganizationId) {
      addCandidate(
        `SELECT ${this.stateColumn} FROM ${this.tableName} WHERE organization_id = ?`,
        scope.organizationId
      );
    }
    if (scopeColumns.hasTenantId) {
      addCandidate(
        `SELECT ${this.stateColumn} FROM ${this.tableName} WHERE tenant_id = ?`,
        scope.storageScopeId
      );
    }

    const keyParam: string[] = this.discriminatorKey != null ? [this.discriminatorKey] : [];
    for (const candidate of candidates) {
      const row = this.db.queryOne<Record<string, unknown>>(candidate.sql, [
        candidate.value,
        ...keyParam,
      ]);
      if (row != null) {
        return row;
      }
    }
    return null;
  }
}
