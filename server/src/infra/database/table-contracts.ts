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
 *   scope     — what the identity columns mean HERE. Until v20 `tenant_id` carried a server PID
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

/** What the identity columns (`run_owner_pid`/`tenant_id`, `workspace_id`, `organization_id`) mean in a table. */
export type ScopeKind =
  /** No meaningful scope — the table is global to the file. */
  | 'none'
  /** Rows are partitioned per workspace, resolved via `resolveContinuityScopeId`. */
  | 'workspace'
  /** `run_owner_pid` holds the OS process id of the server that owns the run. */
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
  // `tenants` was deleted by Tier 6.3 (F10). It held one seeded row, had no reader outside tests
  // that inserted into it only to prove it existed, and no foreign key referenced it — `tenant_id`
  // on the other tables is a bare TEXT column, never a REFERENCES. It was a registry nothing
  // registered with. `readers: []` is what surfaced it.
  {
    table: 'chain_sessions',
    owner: 'src/modules/chains/manager.ts',
    posture: 'derived',
    rebuiltFrom:
      'chain_runs + chain_run_nodes, via ChainSessionStore.projectToHookView in the same ' +
      'transaction that writes them',
    scope: 'run-owner-pid',
    retention: 'unbounded-justified',
    retentionRationale:
      'Holds only live runs; rows are DELETEd per-PID by cleanupStalePidRows when a server exits.',
    readers: ['hooks/lib/db_reader.py', 'src/infra/database/sqlite-engine.ts'],
    // F3 closed at v20: the PID column is now named `run_owner_pid`, so no column name means both
    // a run owner and a workspace. Scope columns remain `workspace_id`/`organization_id`, bound by
    // projectToHookView from the store's defaultScope (Tier 4) — run ownership and workspace scope
    // are separate questions and now have separate names.
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
    acceptedForeignWriters: [
      {
        subject: 'src/cli-shared/version-history.ts',
        reason:
          'The CLI still writes this table directly — the `cpm` binary has no server process to ' +
          'route through. What Tier 6.1 removed is the DIVERGENCE, not the second writer: it now ' +
          'uses node:sqlite against the engine-created schema, binds the same scope columns, and ' +
          'creates no DDL of its own (it reports a missing table instead). Retiring this needs ' +
          'the CLI to reach the server, not another rewrite of this module.',
        closedBy: 'A CLI-to-server transport, or an accepted permanent second writer',
      },
    ],
    // F6's divergent-DDL half is closed. The old `ensure_schema()` here created version_history
    // without organization_id/workspace_id and wrote no schema_version row, which left the engine
    // taking its "fresh database" path against an existing table — CREATE TABLE IF NOT EXISTS
    // no-opped, the scope columns stayed absent, and applySchema threw `no such column:
    // workspace_id`. Reproduced 2026-08-05; regression-tested in cli-schema-ownership.test.ts.
    //
    // Phantom exceptions removed by Tier 4: saveVersion now binds organization_id and workspace_id
    // from the service's injected scope. They were still listed after the writers landed, and the
    // gate said nothing — an exception suppresses its finding whether or not it is still true.
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
  // `chain_run_registry` was deleted at v22 (P3 Tier 4). It held one JSON blob per owning
  // process — every run, every node, every step's lifecycle, plus three chain-id mapping dicts
  // that were a second copy of facts the sessions already carried. Nothing about it was
  // queryable. The two tables below replace it. Its `acceptedForeignWriters` entry (manager.ts
  // deleting registry rows during stale-PID cleanup) is gone with it: the cleanup now asks the
  // owner to do the delete, so the exception has no subject rather than merely no deadline.
  {
    table: 'chain_runs',
    owner: 'src/modules/chains/run-registry.ts',
    posture: 'ephemeral',
    scope: 'run-owner-pid',
    retention: 'unbounded-justified',
    retentionRationale:
      'One row per live run of one owning process. Rows are DELETEd per-PID on every save and ' +
      'purged for dead owners at startup, so growth is bounded by concurrent runs, not by time.',
    readers: ['src/modules/chains/manager.ts'],
    // No Python reader: hooks read `chain_sessions` (and `v_execution_status` over it), which
    // projectToHookView rebuilds from these rows in the same transaction. `db_reader.py` keeps a
    // guarded legacy fallback naming the retired blob table; it catches OperationalError and
    // returns None, so the dropped table degrades to "no fallback row" rather than to an error.
  },
  {
    table: 'chain_run_nodes',
    owner: 'src/modules/chains/run-registry.ts',
    posture: 'ephemeral',
    scope: 'run-owner-pid',
    retention: 'unbounded-justified',
    retentionRationale:
      'One row per node of a live run; deleted with its run. Bounded by concurrent runs times ' +
      'chain length.',
    readers: ['src/modules/chains/manager.ts'],
    // Scope columns are deliberately absent rather than declared-and-unwritten: a node belongs
    // to exactly one run, and that run's row already carries run_owner_pid/workspace_id. A
    // duplicated scope here would be a second copy nothing keeps in step — and, on the evidence
    // of `execution_records.workspace_id`, the copy that ends up NULL.
    //
    // P4 (v23) added two provenance columns, both written by the owner's INSERT:
    //   origin            — 'planned' | 'inserted'. NOT NULL, and deliberately WITHOUT a DDL
    //                       DEFAULT: `validate:no-phantom-columns` exempts defaulted columns, so
    //                       a default would make this column unobservable to the very gate that
    //                       exists to catch a writer dropping it. Without one, the same mistake
    //                       fails on the NOT NULL constraint instead of quietly reading 'planned'.
    //   origin_unknown_id — the declared unknown that caused an insertion; NULL on planned rows.
    //                       Partial population BY ROW TYPE (the v21 execution_records pattern),
    //                       not the value-dead pattern: the writer binds a real id on every row
    //                       where the fact exists. It is a column rather than a substring of
    //                       node_id because `mintInsertionId` slugifies and collision-suffixes,
    //                       which has no decodable inverse.
    //
    // v24 added one more, also in the owner's INSERT list:
    //   declared_sections_json — the phase-guard section headers a step's prompt ACTUALLY
    //                       declared to the model, JSON array of verbatim header strings,
    //                       recorded by 18-execution-stage at render time and read back by
    //                       19-phase-guard-verification-stage. It exists because that fact has
    //                       no other source: `phases.yaml` is what the GUARD reads, so deriving
    //                       the declaration from it would make declared and guarded identical by
    //                       construction and the advisory branch unreachable. Nullable and
    //                       WITHOUT a DDL DEFAULT, for the same reason `origin` has none. NULL is
    //                       meaningful: no declaration was recorded, so the verification stage
    //                       blocks on nothing — the change can only relax enforcement, never
    //                       tighten it. Partial population BY ROW TYPE, like origin_unknown_id.
    // None needs an `acceptedPhantomColumns` entry — all appear in the owner's INSERT list.
  },
  {
    table: 'execution_records',
    owner: 'src/modules/chains/execution-record-store.ts',
    posture: 'ephemeral',
    scope: 'workspace',
    // 5000 rows, not a smaller number: this is an append-only per-STEP ledger, so a single busy
    // chain run contributes dozens of rows, and the `execution_history` action reads it newest-
    // first with a clamp of 500. A cap an order of magnitude above the largest readable page
    // keeps history the reader can actually reach while bounding a file shared across every
    // project on the machine. Enforced by `enforceRetention()` at startup — see retention.ts for
    // why only `maxRows` is enforced generically.
    retention: { maxRows: 5000 },
    readers: [
      'src/mcp/tools/system-control/handlers/execution-history-action-handler.ts',
      'src/infra/database/sqlite-engine.ts',
    ],
    finding:
      'F1 — queryBySession/queryByChain had zero callers, and the one documented consumer ' +
      '(v_execution_status) could not reach completed runs. F2 — workspace_id and ' +
      'organization_id were declared and indexed but structurally unwritable. ' +
      'Closed by Tier 3 (reader + direct view + terminal records), 4.1 (scope), 6.4 (retention). ' +
      "Posture is 'ephemeral' deliberately: the SCHEMA_VERSION 16 note records that v15 rows " +
      'decode to a lifecycle outside StepLifecycle, so these rows must not survive a bump. ' +
      'P2 (v21) added steps_planned, gates_fired, gate_retries, unknowns_opened and ' +
      'unknowns_closed. These are populated ONLY on terminal rows, by the two terminal-record ' +
      'writers (21-formatting-stage.ts, prompt-execution-pipeline.ts), and are NULL on per-step ' +
      '`working` rows. That is intentional partial population BY ROW TYPE — not the value-dead ' +
      'pattern F2 named: a writer binds a real number on every row where the fact exists. They ' +
      'are record-only (master decision D4): no consumer scores, weights, or routes on them. ' +
      'P3 (v22) added node_id: bound by the two per-step writers (18-execution-stage, ' +
      '20-gate-review-stage) and bound NULL explicitly by the two run-level terminal writers ' +
      '(21-formatting-stage, prompt-execution-pipeline), which describe a run rather than a node. ' +
      'P4 (v23) added nodes_inserted and nodes_skipped on the same terminal-rows-only terms: ' +
      'they ride the same getRunTelemetry object both terminal writers spread, so neither ' +
      'writer can bind the v21 group and miss these. They are the surviving audit of adaptive ' +
      'mutation once chain_run_nodes (ephemeral, PID-deleted at cleanup) is gone. ' +
      'S8 (v24) added delegation_skipped, bound by a THIRD row type: the capture-time ' +
      '`completed` step row StepCaptureService appends when a chain resume captures real step ' +
      'output. It is 1 when a delegated+gated step was captured without the contracted ' +
      "'Proposed Gate Review:' block (resolveDelegationSkipped, delegation/acknowledgment.ts), " +
      '0 when the block is present, and NULL wherever the fact does not exist — non-delegated ' +
      'steps, delegated steps with no gate text, and every render/terminal row. Same partial- ' +
      'population-BY-ROW-TYPE reading as the v21/v23 groups; record-only (R-4 — enforcement ' +
      'stays advisory, the server records what it cannot prevent), read back by the ' +
      'execution_history action. ' +
      'D-8 (v26) added interrupts_raised and remainders_accepted on the v21/v23 terms exactly: ' +
      'terminal rows only, riding the same getRunTelemetry object both terminal writers spread. ' +
      'They are the surviving audit of the mid-chain blocking-unknown interrupt once the ' +
      'unknowns ledger (chain_runs residual document) and origin=remainder (chain_run_nodes) are ' +
      'gone — both tables are ephemeral and PID-deleted, so nothing else outlives the process. ' +
      'UNITS, which the names do not carry: interrupts_raised counts blocking LEDGER ENTRIES ' +
      'rather than raise events (decideInterrupt is a function of open state and re-raises every ' +
      'step while an unknown is open), and remainders_accepted counts DISTINCT unknown ids — the ' +
      "same unit replaceRemainder's per-unknown-id cap counts, sharing one expression with it.",
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
    finding:
      'The declared reader does not actually read this view: measured 2026-08-11, ' +
      'execution-history-action-handler.ts sources rows via ExecutionRecordStore.queryRecent() ' +
      'against the raw table, and rg across src/ and hooks/ finds no other reader — only this ' +
      'contract entry and the DDL. The view therefore has zero code readers today. P2 ' +
      'deliberately did NOT project its five new columns here, nor add a steps_executed ' +
      'aggregate: columns on a reader-less view are the value-dead defect class this table has ' +
      'already produced twice (F2). The view gains columns when a real consumer exists, and ' +
      'this finding retires when that consumer lands or the view is deleted.',
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
