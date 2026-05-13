// @lifecycle canonical - Persists chain run registry data via SQLite.
import type { PersistedChainRunRegistry } from './types.js';
import type { DatabasePort, StateStoreOptions } from '../../shared/types/persistence.js';

export interface ChainRunRegistry {
  ensureInitialized(): Promise<void>;
  load(scope?: StateStoreOptions): Promise<PersistedChainRunRegistry>;
  save(store: PersistedChainRunRegistry, scope?: StateStoreOptions): Promise<void>;
}

/**
 * Chain run registry backed directly by DatabasePort (no infra/ dependency).
 * Used when DatabasePort is injected from the runtime layer to avoid modules/ → infra/ imports.
 */
export class DirectChainRunRegistry implements ChainRunRegistry {
  constructor(private readonly db: DatabasePort) {}

  async ensureInitialized(): Promise<void> {
    // Table created by SqliteEngine.applySchema() during db.initialize()
  }

  async load(scope?: StateStoreOptions): Promise<PersistedChainRunRegistry> {
    const tenantId =
      scope?.continuityScopeId ?? scope?.workspaceId ?? scope?.organizationId ?? 'default';
    const row = this.db.queryOne<{ state: string }>(
      'SELECT state FROM chain_run_registry WHERE tenant_id = ?',
      [tenantId]
    );
    return row ? (JSON.parse(row.state) as PersistedChainRunRegistry) : {};
  }

  async save(store: PersistedChainRunRegistry, scope?: StateStoreOptions): Promise<void> {
    const tenantId =
      scope?.continuityScopeId ?? scope?.workspaceId ?? scope?.organizationId ?? 'default';
    this.db.run('INSERT OR REPLACE INTO chain_run_registry (tenant_id, state) VALUES (?, ?)', [
      tenantId,
      JSON.stringify(store),
    ]);
  }
}
