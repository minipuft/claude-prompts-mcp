// @lifecycle canonical - Declares the per-table contract every state.db table must satisfy
/**
 * Table Contracts — the SSOT for what each table in `state.db` IS.
 *
 * Four properties went undeclared for the life of this schema, and every one of the findings
 * in `plans/sqlite-layer-remediation-2026-08-03.md` traces back to one of them being assumed
 * differently by two modules:
 *
 *   owner     — exactly one module may write the table. A second writer is how `version_history`
 *               ended up with two divergent CREATE statements, and how `kv_state` acquired a raw
 *               SQL writer that bypasses the scope columns the store populates.
 *   posture   — whether rows may be discarded when the schema is recreated. Treating this as a
 *               binary ("ephemeral or not") is what silently destroyed resource rollback history:
 *               `resource_index` and `version_history` are both "not ephemeral" yet need opposite
 *               handling.
 *   scope     — what the identity columns mean HERE. `tenant_id` currently carries a server PID
 *               in some tables, a workspace id in others, and the literal 'default' in the rest.
 *   retention — an append-only table with no declared bound grows until the disk does. `state.db`
 *               is shared across every project on the machine, so "small in my repo" is not a bound.
 *
 * This file is data, not behavior: it imports nothing so that build-time gates can read it
 * without pulling `node:sqlite` or the engine singleton into a validation process.
 *
 * Consumers:
 *   - `sqlite-engine.ts` — derives the durable set for schema recreate, and asserts at startup
 *     that the live schema matches these declarations
 *   - `scripts/validate-table-contracts.js` — DDL/declaration set equality, ownership, readers
 *   - `scripts/validate-no-phantom-columns.js` — every declared column has a writer
 */

/**
 * Whether a table's rows may be discarded when SCHEMA_VERSION changes.
 *
 * - `derived`   — reconstructible from a source outside the database. MUST name `rebuiltFrom`.
 * - `ephemeral` — not reconstructible, but losing it is accepted (live-run state the restart
 *                 already invalidated, or rows coupled to the schema version being replaced).
 * - `durable`   — exists nowhere else. Carried across a schema recreate; losing it is data loss.
 */
export type Posture = 'derived' | 'ephemeral' | 'durable';

/** What the identity columns (`tenant_id`, `workspace_id`, `organization_id`) mean in a table. */
export type ScopeKind =
  /** No meaningful scope — the table is global to the file. */
  | 'none'
  /** Rows are partitioned per workspace, resolved via `resolveContinuityScopeId`. */
  | 'workspace'
  /** `tenant_id` holds the OS process id of the server that owns the run. */
  | 'run-owner-pid'
  /** Rows are partitioned by export client + scope (skills sync). */
  | 'client-scope';

/** The declared growth bound. Every append-only table states one. */
export type Retention =
  | { readonly maxRows: number }
  | { readonly maxRowsPerResource: number }
  | { readonly maxAgeDays: number }
  /** Bounded by something outside the table (resource count, one row per key). State why. */
  | 'unbounded-justified';

/**
 * A violation that exists today and is tolerated until a named change removes it.
 *
 * `closedBy` is mandatory and is the whole point: an exception that cannot name what retires it
 * is a permanent bypass wearing a TODO's clothes. The gates print these, so an exception whose
 * tier has already shipped shows up as noise and gets deleted.
 */
export interface AcceptedException {
  /** A module path (foreign writer) or a column name (phantom column). */
  readonly subject: string;
  readonly reason: string;
  /** What removes this exception — e.g. 'Tier 4.2'. */
  readonly closedBy: string;
}

export interface TableContract {
  /** Table name exactly as it appears in `applySchema()`. */
  readonly table: string;
  /** Repo-relative path of the single module permitted to write this table. */
  readonly owner: string;
  readonly posture: Posture;
  readonly scope: ScopeKind;
  readonly retention: Retention;
  /** Why `retention` is what it is — required when retention is 'unbounded-justified'. */
  readonly retentionRationale?: string;
  /** Where rows come back from. Required when `posture` is 'derived', absent otherwise. */
  readonly rebuiltFrom?: string;
  /**
   * Repo-relative paths that read this table, excluding the owner's own read-back.
   *
   * An empty array is a FINDING, not a default: a table written and never read is either a
   * missing consumer or a redundant channel. Entries that are legitimately empty today must
   * carry `finding` naming the tier that closes them.
   */
  readonly readers: readonly string[];
  /** An accepted open violation. MUST name what closes it, so the exception cannot outlive it. */
  readonly finding?: string;
  /** Modules other than `owner` that write or declare DDL for this table today. */
  readonly acceptedForeignWriters?: readonly AcceptedException[];
  /** Declared columns with no writer in the owner today. */
  readonly acceptedPhantomColumns?: readonly AcceptedException[];
}

export interface ViewContract {
  readonly view: string;
  /** The table this view projects. Its owner also owns the view's DDL. */
  readonly sourceTable: string;
  readonly readers: readonly string[];
  readonly finding?: string;
}

/**
 * Tables SQLite creates on its own. They appear in `sqlite_master` but never in `applySchema()`,
 * so set-equality checks must exclude them or they report a permanent false mismatch.
 * `sqlite_sequence` materializes as soon as any table declares AUTOINCREMENT.
 */
export const SQLITE_INTERNAL_TABLES: readonly string[] = ['sqlite_sequence'];

export const TABLE_CONTRACTS: readonly TableContract[] = [
  {
    table: 'schema_version',
    owner: 'src/infra/database/sqlite-engine.ts',
    posture: 'derived',
    rebuiltFrom: 'applySchema() writes the current SCHEMA_VERSION on every recreate',
    scope: 'none',
    retention: { maxRows: 1 },
    readers: ['src/infra/database/sqlite-engine.ts'],
  },
  {
    table: 'tenants',
    owner: 'src/infra/database/sqlite-engine.ts',
    posture: 'derived',
    rebuiltFrom: 'applySchema() seeds the single default row',
    scope: 'none',
    retention: { maxRows: 1 },
    readers: [],
    finding:
      'F10 — no reader outside tests, which insert into it only to prove it exists. ' +
      'Closed by Tier 6.3 (delete the table and its seed).',
  },
  {
    table: 'chain_sessions',
    owner: 'src/modules/chains/manager.ts',
    posture: 'derived',
    rebuiltFrom:
      'chain_run_registry, via ChainSessionStore.projectToHookView in the same transaction',
    scope: 'run-owner-pid',
    retention: 'unbounded-justified',
    retentionRationale:
      'Holds only live runs; rows are DELETEd per-PID by cleanupStalePidRows when a server exits.',
    readers: ['hooks/lib/db_reader.py', 'src/infra/database/sqlite-engine.ts'],
    finding:
      'F3 — tenant_id holds a server PID here while carrying a workspace id in kv_state. ' +
      'Closed by Tier 6.5 (add run_owner_pid) and 6.6 (hook reads it with fallback).',
    // Phantom exceptions removed by Tier 4: projectToHookView now binds organization_id and
    // workspace_id from the store's defaultScope. tenant_id still holds the PID, so F3 above
    // stands — 6.5/6.6 remain the fix for run ownership, which is a separate question to scope.
  },
  {
    table: 'kv_state',
    owner: 'src/infra/database/stores/sqlite-store.ts',
    posture: 'ephemeral',
    scope: 'workspace',
    retention: 'unbounded-justified',
    retentionRationale:
      'One row per (scope, key) discriminator, so growth is bounded by workspace count. ' +
      "The key='arg_history' payload is itself capped at 50 entries per chain by its writer.",
    readers: [
      'src/engine/frameworks/framework-state-store.ts',
      'src/engine/gates/gate-state-store.ts',
      'src/infra/observability/tracking/resource-change-tracker.ts',
      'src/modules/text-refs/argument-history-tracker.ts',
    ],
    finding:
      'One open violation. F9 (argument-history-tracker.ts writing raw SQL with a hardcoded ' +
      "'default' scope) was closed by Tier 4.2 — it now receives a SqliteStateStore through the " +
      'StateStore interface, built by the composition root because neither modules/ nor mcp/ may ' +
      'import infra/. Still open: ' +
      "mixed posture — key='resource_hashes' is a cache, but key='framework', 'gates' and " +
      "'arg_history' are user state that today does not survive a SCHEMA_VERSION bump. The table " +
      'carries one posture while its discriminators need two. Not closed by any current tier — ' +
      'raised during Tier 1 and recorded in the deviation log for a scoping decision.',
    // Foreign-writer exception removed by Tier 4.2: the tracker no longer writes SQL at all.
    // It is still a reader above, but reads go through the injected store.
    acceptedPhantomColumns: [
      {
        subject: 'key',
        reason:
          'FALSE POSITIVE with the same cause as the two below, newly exposed by Tier 4.2. The ' +
          "tracker's raw INSERT was the only statement naming this column as a literal; now that " +
          'it goes through SqliteStateStore, the discriminator is bound from the PRAGMA-derived ' +
          'column list and no literal names it. The column is unambiguously written — every ' +
          'kv_state row in a live database has one.',
        closedBy:
          "Gate improvement: teach collectWrittenColumns to resolve the store's PRAGMA-derived " +
          'column list. Same fix as organization_id/workspace_id below.',
      },
      {
        subject: 'organization_id',
        reason:
          'FALSE POSITIVE, not a defect. SqliteStateStore assembles its column list at runtime ' +
          'from PRAGMA table_info, so no literal INSERT names this column anywhere. It IS ' +
          'written — tests/integration/database/sqlite-backend.test.ts asserts the canonical ' +
          'identity columns after a scoped save.',
        closedBy:
          "Gate improvement: teach collectWrittenColumns to resolve the store's PRAGMA-derived " +
          'column list. Until then this entry is what keeps the blind spot visible.',
      },
      {
        subject: 'workspace_id',
        reason:
          'FALSE POSITIVE for the same reason as organization_id — dynamically assembled INSERT.',
        closedBy: 'Gate improvement, as above.',
      },
    ],
  },
  {
    table: 'resource_index',
    owner: 'src/infra/database/resource-indexer.ts',
    posture: 'derived',
    rebuiltFrom: 'YAML resource files, rescanned on every startup and on hot reload',
    scope: 'none',
    retention: 'unbounded-justified',
    retentionRationale: 'One row per on-disk resource; bounded by the resource tree itself.',
    readers: ['hooks/lib/db_reader.py', 'src/modules/skills-sync/service.ts'],
  },
  {
    table: 'skills_sync_manifests',
    owner: 'src/modules/skills-sync/service.ts',
    posture: 'durable',
    scope: 'client-scope',
    retention: 'unbounded-justified',
    retentionRationale:
      'One row per exported resource per (client, scope); the owner rewrites the set on each export.',
    readers: ['src/mcp/tools/skills-sync.ts'],
  },
  {
    table: 'version_history',
    owner: 'src/modules/versioning/version-history-service.ts',
    posture: 'durable',
    scope: 'workspace',
    retention: { maxRowsPerResource: 50 },
    readers: ['src/cli-shared/version-history.ts'],
    finding:
      'F6 — src/cli-shared/version-history.ts is a second WRITER, reaching this table by ' +
      'spawning python3 with an embedded sqlite3 script and its own divergent CREATE TABLE. ' +
      'Closed by Tier 6.1 (rewrite on node:sqlite against the engine).',
    acceptedForeignWriters: [
      {
        subject: 'src/cli-shared/version-history.ts',
        reason:
          'Reaches state.db by spawning python3 with an embedded sqlite3 script, from a Node ' +
          'process that already has node:sqlite. Carries its own CREATE TABLE whose shape omits ' +
          'organization_id and workspace_id, so the two DDLs disagree.',
        closedBy: 'Tier 6.1',
      },
    ],
    acceptedPhantomColumns: [
      {
        subject: 'organization_id',
        reason:
          'Neither writer names it: the service INSERT lists (tenant_id, resource_type, ' +
          'resource_id, version, snapshot, diff_summary, description, created_at), and the ' +
          'spawned-Python path does not declare the column at all.',
        closedBy: 'Tier 6.1',
      },
      {
        subject: 'workspace_id',
        reason:
          'Indexed by idx_version_history_workspace and never written, so rollback history is ' +
          'global across every project sharing state.db.',
        closedBy: 'Tier 6.1',
      },
    ],
  },
  {
    table: 'resource_changes',
    owner: 'src/infra/observability/tracking/resource-change-tracker.ts',
    posture: 'derived',
    rebuiltFrom:
      'Regenerated as resources change. A truncatable audit trail — which is precisely why it ' +
      'cannot be the source for version_history, whose snapshots must never be evicted.',
    scope: 'workspace',
    retention: { maxRows: 1000 },
    readers: [],
    finding:
      'Written and read only by its owner, and currently sitting exactly at the 1000-row cap ' +
      '(actively evicting). Either a consumer is missing or this is a redundant channel. ' +
      'Not closed by any current tier — the posture comparison against version_history is ' +
      'recorded, but the zero-reader question is open.',
  },
  {
    table: 'chain_run_registry',
    owner: 'src/modules/chains/run-registry.ts',
    posture: 'ephemeral',
    scope: 'run-owner-pid',
    retention: 'unbounded-justified',
    retentionRationale: 'One blob row per owning process; cleared when that process exits.',
    readers: ['hooks/lib/db_reader.py', 'src/modules/chains/manager.ts'],
    finding:
      'Retired wholesale by the execution-ledger initiative at its Tier 10, which replaces the ' +
      'blob with per-row tables. Do not remediate here.',
    acceptedForeignWriters: [
      {
        subject: 'src/modules/chains/manager.ts',
        reason:
          'Deletes registry rows during stale-PID cleanup rather than asking the registry to do ' +
          'it, so cleanup and write live in different modules.',
        closedBy: 'execution-ledger Tier 10',
      },
    ],
    // Phantom exceptions removed by Tier 4: the INSERT now names both scope columns, and the
    // caller passes a merged scope (PID for tenant_id, workspace for the scope columns) rather
    // than the pid-only scope that left them NULL.
  },
  {
    table: 'execution_records',
    owner: 'src/modules/chains/execution-record-store.ts',
    posture: 'ephemeral',
    scope: 'workspace',
    retention: 'unbounded-justified',
    retentionRationale:
      'PLACEHOLDER — this table has no DELETE anywhere and state.db is shared across every ' +
      'project on the machine, so it is unbounded in fact rather than by justification. ' +
      'Tier 6.4 replaces this with a real cap.',
    readers: [],
    finding:
      'F1 — queryBySession/queryByChain have zero callers, and the one documented consumer ' +
      '(v_execution_status) cannot reach completed runs. F8 — no retention. F2 — workspace_id ' +
      'and organization_id are declared and indexed but structurally unwritable. ' +
      'Closed by Tier 3 (reader + direct view + terminal records), 4.1 (scope), 6.4 (retention). ' +
      "Posture is 'ephemeral' deliberately: the SCHEMA_VERSION 16 note records that v15 rows " +
      'decode to a lifecycle outside StepLifecycle, so these rows must not survive a bump.',
  },
];

export const VIEW_CONTRACTS: readonly ViewContract[] = [
  {
    view: 'v_execution_status',
    sourceTable: 'chain_sessions',
    readers: ['hooks/lib/db_reader.py'],
    finding:
      'Selects FROM chain_sessions, which is DELETEd per-PID at cleanup, so it structurally ' +
      'cannot report a completed run. Tier 3.3 adds v_execution_history reading ' +
      'execution_records directly rather than widening this view.',
  },
  {
    view: 'v_execution_history',
    sourceTable: 'execution_records',
    readers: ['src/mcp/tools/system-control/handlers/execution-history-action-handler.ts'],
  },
];

/** Tables whose rows are carried across a schema recreate. Derived — do not maintain by hand. */
export const DURABLE_TABLE_NAMES: readonly string[] = TABLE_CONTRACTS.filter(
  (contract) => contract.posture === 'durable'
).map((contract) => contract.table);

/** Every table name `applySchema()` is expected to declare. */
export const CONTRACTED_TABLE_NAMES: readonly string[] = TABLE_CONTRACTS.map(
  (contract) => contract.table
);
