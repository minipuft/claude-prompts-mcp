// @lifecycle canonical - Manages SQLite database lifecycle via node:sqlite (native)
/**
 * SQLite Engine
 *
 * Singleton that manages the native Node.js SQLite database lifecycle.
 * Uses node:sqlite (DatabaseSync) for file-backed storage with no WASM dependency.
 *
 * Key Features:
 * - File-backed natively (no manual persist() needed)
 * - WAL mode for concurrent reader access (Python hooks)
 * - Embedded schema with version-based drop-and-recreate
 * - Synchronous operations via DatabaseSync
 *
 * Schema Strategy:
 * The complete schema is embedded in this file (SSOT). On startup:
 * - Fresh DB: create all tables from embedded schema
 * - Matching version: skip (fast path)
 * - Version mismatch: snapshot durable tables, drop all, recreate, restore
 *
 * Most of state.db is reconstructible: resource_index (including tools) is rebuilt
 * from YAML on startup, chain sessions and framework state are interrupted by the
 * restart that triggers a schema change anyway.
 *
 * DURABLE_TABLES are the exception and must survive the recreate. Their rows exist
 * nowhere else — version_history holds the pre-update snapshots that back resource
 * rollback, and skills_sync_manifests is the record of which files were exported to
 * which client, without which already-exported files can no longer be detected as
 * orphans or pruned. Dropping either is unrecoverable user-visible data loss.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

import {
  CONTRACTED_TABLE_NAMES,
  DURABLE_TABLE_NAMES,
  SQLITE_INTERNAL_TABLES,
  VIEW_CONTRACTS,
} from './table-contracts.js';

import type { DatabasePort } from '#shared/types/persistence.js';
import type { Logger } from '../logging/index.js';

/**
 * Bump this when changing the embedded schema. Triggers drop-and-recreate.
 *
 * v18: drops pre-scoping `version_history` rows via `DROPPED_ON_THIS_BUMP`. Every row written
 * before Tier 4 carried the literal `tenant_id = 'default'`, and many projects sharing one
 * state.db wrote into it, so nothing distinguishes which workspace produced which row. Once reads
 * are workspace-scoped those rows are unreachable regardless; carrying them across would preserve
 * data no query can return. **This destroys rollback history predating the upgrade** — intended and
 * operator-approved, not incidental.
 *
 * The drop is expressed as a bump rather than as engine-resident purge code on purpose: F5 in the
 * remediation plan was migration logic that ran on every startup forever, and a one-time step
 * guarded by a marker in `kv_state` — an `ephemeral` table — would have been the same shape, since
 * anything clearing that table would re-arm the deletion against legitimately scoped rows.
 *
 * v17: added the `v_execution_history` view. A view is only created by `applySchema()`, which
 * runs only on a version mismatch, so adding one to the DDL without bumping leaves every existing
 * database without it — and `assertSchemaMatchesContracts()` then fails startup, because the
 * contract declares a view the live schema does not have. Any DDL addition implies a bump.
 *
 * Consequence, stated rather than discovered: this bump drops `execution_records`, whose declared
 * posture is `ephemeral`. Existing rows do not survive. That is the intended trade here — 35 of
 * the 64 rows present at the time were stuck in `working` because nothing emitted a terminal
 * record on the failure and abort paths (fixed in the same tier), so preserving them would carry
 * a majority of unterminated entries into the history feature that reads them. `version_history`
 * and `skills_sync_manifests` are `durable` and are snapshot/restored across this bump.
 *
 * v16: retired the `StepState` enum. Persisted step `state` values `rendered` and
 * `response_captured` no longer exist — both are now lifecycle `working`, distinguished by the
 * `renderedAt` / `respondedAt` substate timestamps. `StepSubstate.responseAt` was also renamed to
 * `respondedAt`, which changes the `substate_json` shape in `execution_records`. Rows written by
 * v15 would decode to a lifecycle value outside `StepLifecycle`, so they must not survive.
 */
const SCHEMA_VERSION = 18;

/**
 * Tables whose rows exist nowhere else and therefore survive a SCHEMA_VERSION bump.
 *
 * Declared in `table-contracts.ts` as `posture: 'durable'` rather than listed here, so the
 * classification lives with the rest of the table's contract and the validation gates read
 * the same source. Marking a table durable is a commitment: its rows are carried across the
 * drop-and-recreate by column intersection, so a column removed from the DDL drops silently
 * and a new NOT NULL column without a default fails the restore loudly rather than discarding
 * rows.
 */
const DURABLE_TABLES = DURABLE_TABLE_NAMES;

/**
 * Durable tables deliberately NOT carried across the current bump.
 *
 * This is the escape hatch for a one-time data migration that a recreate can express: rather than
 * shipping migration code that lives in the engine forever — the F5 anti-pattern this schema was
 * cleaned of — the drop IS the migration, and this set plus the SCHEMA_VERSION docblock are its
 * record. **Empty it at the next bump**; an entry left behind silently discards a durable table on
 * an unrelated schema change.
 */
const DROPPED_ON_THIS_BUMP: ReadonlySet<string> = new Set(['version_history']);

/**
 * The SCHEMA_VERSION that `DROPPED_ON_THIS_BUMP` was declared for.
 *
 * Without this the exclusion has no retirement condition: it reads as a permanent property of the
 * engine rather than a one-time act, and the next bump would silently discard a durable table on
 * an unrelated schema change. `validate:table-contracts` compares the two — once SCHEMA_VERSION
 * moves past this, a non-empty set is a hard failure naming each stale entry.
 *
 * Retiring the exclusion is therefore two edits that the gate forces to happen together: empty the
 * set, and move this to the new version.
 */
const DROPPED_AT_VERSION = 18;

/** Rows carried across a schema recreate, keyed by table name. */
type DurableSnapshot = Map<string, Array<Record<string, unknown>>>;

/**
 * Database configuration options
 */
export interface DatabaseConfig {
  /** Path to the database file (default: runtime-state/state.db) */
  dbPath?: string;
  /** Enable verbose SQL logging */
  verbose?: boolean;
}

/**
 * SQLite Engine - Singleton for native SQLite lifecycle management
 *
 * Replaces the former sql.js WASM-based DatabaseManager with node:sqlite.
 * All state writes go directly to the file — no persist() step needed.
 */
export class SqliteEngine implements DatabasePort {
  private static instance: SqliteEngine | null = null;

  private db: DatabaseSync | null = null;
  private readonly dbPath: string;
  private readonly logger: Logger;
  private readonly verbose: boolean;
  private initialized: boolean = false;

  private constructor(serverRoot: string, logger: Logger, config: DatabaseConfig = {}) {
    this.logger = logger;
    this.verbose = config.verbose ?? false;

    // Set paths
    this.dbPath = config.dbPath ?? path.join(serverRoot, 'runtime-state', 'state.db');
  }

  /**
   * Get or create the SqliteEngine singleton
   */
  static async getInstance(
    serverRoot: string,
    logger: Logger,
    config?: DatabaseConfig
  ): Promise<SqliteEngine> {
    if (!SqliteEngine.instance) {
      SqliteEngine.instance = new SqliteEngine(serverRoot, logger, config);
    }
    return SqliteEngine.instance;
  }

  /**
   * Check if database is initialized
   */
  isInitialized(): boolean {
    return this.initialized && this.db !== null;
  }

  /**
   * Initialize the database (lazy - call when needed)
   */
  async initialize(): Promise<void> {
    if (this.initialized) {
      this.logger.debug('SqliteEngine already initialized');
      return;
    }

    this.logger.info('Initializing SQLite database (node:sqlite)...');

    try {
      // Ensure runtime-state directory exists
      fs.mkdirSync(path.dirname(this.dbPath), { recursive: true });

      // Open file-backed database (creates file if not exists)
      this.db = new DatabaseSync(this.dbPath);

      // Enable WAL mode for concurrent reader access (Python hooks, skills-sync CLI)
      this.db.exec('PRAGMA journal_mode=WAL');

      // Ensure schema is current (creates or recreates if version mismatch)
      this.ensureSchema();
      this.assertSchemaMatchesContracts();

      this.initialized = true;
      this.logger.info('SQLite database initialized successfully');
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : undefined;
      this.logger.error(`Failed to initialize SQLite database: ${msg}`);
      if (stack) this.logger.error(`Stack: ${stack}`);
      throw error;
    }
  }

  /**
   * Get the database instance (throws if not initialized)
   */
  getDb(): DatabaseSync {
    if (!this.db) {
      throw new Error('Database not initialized. Call initialize() first.');
    }
    return this.db;
  }

  /**
   * Execute a SQL statement (no return value).
   * Uses exec() for DDL/unparam statements, prepare().run() for parameterized DML.
   */
  run(sql: string, params?: any[]): void {
    if (this.verbose) {
      this.logger.debug(`SQL: ${sql.slice(0, 100)}...`);
    }
    if (params && params.length > 0) {
      this.getDb()
        .prepare(sql)
        .run(...params);
    } else {
      this.getDb().exec(sql);
    }
  }

  /**
   * Execute a SQL query and return all results
   */
  query<T = Record<string, any>>(sql: string, params?: any[]): T[] {
    if (this.verbose) {
      this.logger.debug(`SQL Query: ${sql.slice(0, 100)}...`);
    }

    const stmt = this.getDb().prepare(sql);

    if (params && params.length > 0) {
      return stmt.all(...params) as T[];
    }
    return stmt.all() as T[];
  }

  /**
   * Execute a SQL query and return first result (or null)
   */
  queryOne<T = Record<string, any>>(sql: string, params?: any[]): T | null {
    const stmt = this.getDb().prepare(sql);
    const result = params && params.length > 0 ? stmt.get(...params) : stmt.get();
    return (result as T) ?? null;
  }

  /**
   * Begin a transaction
   */
  beginTransaction(): void {
    this.run('BEGIN TRANSACTION');
  }

  /**
   * Commit a transaction
   */
  commit(): void {
    this.run('COMMIT');
  }

  /**
   * Rollback a transaction
   */
  rollback(): void {
    this.run('ROLLBACK');
  }

  /**
   * Execute multiple statements in a transaction
   */
  async transaction<T>(fn: () => T | Promise<T>): Promise<T> {
    this.beginTransaction();
    try {
      const result = await fn();
      this.commit();
      return result;
    } catch (error) {
      this.rollback();
      throw error;
    }
  }

  /**
   * Ensure database schema is current.
   *
   * Strategy: embedded schema is the SSOT. On version mismatch, snapshot DURABLE_TABLES,
   * drop everything, recreate from the embedded schema, then restore the snapshot. The
   * snapshot/restore round-trip is what lets durable rows survive while still letting
   * their DDL evolve — preserving the table in place instead would freeze its shape,
   * because applySchema uses CREATE TABLE IF NOT EXISTS.
   */
  private ensureSchema(): boolean {
    const currentVersion = this.getCurrentSchemaVersion();

    if (currentVersion === SCHEMA_VERSION) {
      this.logger.info(`Database schema is up to date (version ${currentVersion})`);
      return false;
    }

    if (currentVersion === 0) {
      this.applySchema();
      this.logger.info(`Schema version ${SCHEMA_VERSION} applied`);
      // Not a recreate: a fresh database has no durable rows to protect, so the purge below runs
      // as a no-op and records its marker.
      return false;
    }

    this.logger.info(
      `Schema version mismatch (have ${currentVersion}, need ${SCHEMA_VERSION}), recreating...`
    );
    const preserved = this.snapshotDurableTables();
    this.dropAllTables();
    this.applySchema();
    this.restoreDurableTables(preserved);
    this.logger.info(`Schema version ${SCHEMA_VERSION} applied`);
    return true;
  }

  /**
   * Read every row of each durable table that exists in the outgoing schema.
   *
   * Absent tables and empty tables are skipped, so a fresh install and a bump that
   * predates a durable table both produce an empty snapshot.
   */
  private snapshotDurableTables(): DurableSnapshot {
    const snapshot: DurableSnapshot = new Map();

    // A stale exclusion is imminent data loss, not a lint problem: the set names durable tables
    // that will NOT be carried across the recreate about to happen. `validate:table-contracts`
    // catches this before it ships; this throws if it somehow reaches a running server, because
    // the alternative is silently discarding a table whose rows exist nowhere else.
    if (DROPPED_ON_THIS_BUMP.size > 0 && SCHEMA_VERSION !== DROPPED_AT_VERSION) {
      throw new Error(
        `DROPPED_ON_THIS_BUMP still contains [${[...DROPPED_ON_THIS_BUMP].join(', ')}] but was ` +
          `declared for schema v${DROPPED_AT_VERSION} and SCHEMA_VERSION is now ` +
          `v${SCHEMA_VERSION}. Empty the set and move DROPPED_AT_VERSION, or these durable ` +
          'tables are dropped by an unrelated schema change.'
      );
    }

    for (const table of DURABLE_TABLES) {
      if (DROPPED_ON_THIS_BUMP.has(table)) {
        this.logger.info(
          `Durable table ${table}: intentionally NOT carried across the v${SCHEMA_VERSION} recreate ` +
            '(see the SCHEMA_VERSION docblock for why).'
        );
        continue;
      }
      if (this.getTableColumns(table).size === 0) {
        continue;
      }
      const rows = this.query<Record<string, unknown>>(`SELECT * FROM "${table}"`);
      if (rows.length > 0) {
        snapshot.set(table, rows);
      }
    }

    return snapshot;
  }

  /**
   * Re-insert snapshotted rows into the freshly created schema.
   *
   * Only columns present in BOTH the snapshot and the new table are carried: a column
   * dropped from the DDL is discarded, and a column added to it takes its default. A
   * restore failure rethrows with the table named rather than losing the rows quietly —
   * the schema change needs a real migration at that point.
   */
  private restoreDurableTables(snapshot: DurableSnapshot): void {
    for (const [table, rows] of snapshot) {
      const newColumns = this.getTableColumns(table);
      const carried = Object.keys(rows[0] ?? {}).filter((column) => newColumns.has(column));

      if (carried.length === 0) {
        this.logger.warn(
          `Durable table ${table}: no columns survived the schema change, ${rows.length} row(s) discarded`
        );
        continue;
      }

      const columnList = carried.map((column) => `"${column}"`).join(', ');
      const placeholders = carried.map(() => '?').join(', ');
      const sql = `INSERT INTO "${table}" (${columnList}) VALUES (${placeholders})`;

      try {
        for (const row of rows) {
          this.run(
            sql,
            carried.map((column) => row[column] ?? null)
          );
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        throw new Error(
          `Failed to restore ${rows.length} durable row(s) into ${table} after schema recreate: ${msg}. ` +
            `This schema change needs an explicit migration for ${table}.`,
          { cause: error }
        );
      }

      this.logger.info(`Preserved ${rows.length} row(s) in durable table ${table}`);
    }
  }

  private getCurrentSchemaVersion(): number {
    try {
      const result = this.queryOne<{ version: number }>(
        'SELECT MAX(version) as version FROM schema_version'
      );
      return result?.version ?? 0;
    } catch {
      return 0;
    }
  }

  /**
   * Drop every table, durable ones included. Callers that need durable rows to survive
   * must bracket this with snapshotDurableTables/restoreDurableTables — ensureSchema is
   * the only such caller today.
   */
  private dropAllTables(): void {
    const tables = this.query<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name != 'sqlite_sequence'"
    );
    for (const { name } of tables) {
      this.run(`DROP TABLE IF EXISTS "${name}"`);
    }
  }

  /**
   * Apply the complete schema. This is the single source of truth for all tables.
   * Bump SCHEMA_VERSION at the top of this file when making changes here.
   *
   * Uses exec() to run the entire schema as a single multi-statement string.
   */
  private applySchema(): void {
    this.getDb().exec(`
      CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER PRIMARY KEY,
        applied_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS tenants (
        id TEXT PRIMARY KEY,
        name TEXT,
        created_at TEXT DEFAULT (datetime('now'))
      );

      INSERT OR IGNORE INTO tenants (id, name) VALUES ('default', 'Default Tenant');

      -- Derived hook-read view of chain_run_registry (the SSOT blob).
      -- Holds only the active subset of sessions for indexed PID-scoped queries
      -- by Python hooks. Writers MUST go through ChainSessionStore.projectToHookView,
      -- not direct INSERT/UPDATE — primary writes land on chain_run_registry and
      -- this table is rebuilt atomically inside the same transaction.
      CREATE TABLE IF NOT EXISTS chain_sessions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id TEXT NOT NULL DEFAULT 'default',
        organization_id TEXT,
        workspace_id TEXT,
        chain_id TEXT NOT NULL,
        run_number INTEGER NOT NULL,
        state TEXT NOT NULL,
        run_status TEXT NOT NULL DEFAULT 'working',
        run_completed_at INTEGER,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now')),
        UNIQUE (tenant_id, chain_id, run_number)
      );

      -- Shared key-value blob store for scoped state with a discriminator.
      -- Replaces what used to be 4 identical-shape tables (framework_state,
      -- gate_system_state, argument_history, resource_hash_cache) plus their
      -- per-table workspace/organization indexes. Consumers pass key to
      -- SqliteStateStoreConfig to claim a slot. chain_run_registry intentionally
      -- excluded -- retired separately by chain ledger Tier 10.
      CREATE TABLE IF NOT EXISTS kv_state (
        tenant_id TEXT NOT NULL DEFAULT 'default',
        organization_id TEXT,
        workspace_id TEXT,
        key TEXT NOT NULL,
        state TEXT NOT NULL DEFAULT '{}',
        updated_at TEXT DEFAULT (datetime('now')),
        PRIMARY KEY (tenant_id, key)
      );

      CREATE TABLE IF NOT EXISTS resource_index (
        id TEXT NOT NULL,
        type TEXT NOT NULL,
        name TEXT,
        category TEXT,
        description TEXT,
        content_hash TEXT,
        file_path TEXT,
        metadata_json TEXT,
        keywords TEXT,
        indexed_at TEXT DEFAULT (datetime('now')),
        PRIMARY KEY (id, type)
      );

      CREATE TABLE IF NOT EXISTS skills_sync_manifests (
        client TEXT NOT NULL,
        scope TEXT NOT NULL CHECK (scope IN ('user', 'project')),
        resource_key TEXT NOT NULL,
        resource_id TEXT NOT NULL,
        resource_type TEXT NOT NULL,
        source_hash TEXT NOT NULL,
        output_hash TEXT NOT NULL,
        output_files TEXT NOT NULL,
        exported_at TEXT NOT NULL,
        version INTEGER,
        version_date TEXT,
        config_hash TEXT NOT NULL,
        source_snapshot TEXT,
        PRIMARY KEY (client, scope, resource_key)
      );

      CREATE TABLE IF NOT EXISTS version_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id TEXT NOT NULL DEFAULT 'default',
        organization_id TEXT,
        workspace_id TEXT,
        resource_type TEXT NOT NULL,
        resource_id TEXT NOT NULL,
        version INTEGER NOT NULL,
        snapshot TEXT NOT NULL,
        diff_summary TEXT DEFAULT '',
        description TEXT DEFAULT '',
        created_at TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS resource_changes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tenant_id TEXT NOT NULL DEFAULT 'default',
        organization_id TEXT,
        workspace_id TEXT,
        timestamp TEXT NOT NULL,
        source TEXT NOT NULL,
        operation TEXT NOT NULL,
        resource_type TEXT NOT NULL,
        resource_id TEXT NOT NULL,
        file_path TEXT,
        content_hash TEXT,
        previous_hash TEXT
      );

      CREATE TABLE IF NOT EXISTS chain_run_registry (
        tenant_id TEXT PRIMARY KEY DEFAULT 'default',
        organization_id TEXT,
        workspace_id TEXT,
        state TEXT NOT NULL DEFAULT '{}',
        updated_at TEXT DEFAULT (datetime('now'))
      );

      -- Durable per-step (or per-chain when step_number IS NULL) execution records.
      -- Append-only series forms the queryable execution log.
      -- session_id is the application-level ChainSession.sessionId (TEXT), not chain_sessions.id.
      -- No FK constraint by design — matches existing schema convention; lookup is by index.
      CREATE TABLE IF NOT EXISTS execution_records (
        execution_id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL DEFAULT 'default',
        organization_id TEXT,
        workspace_id TEXT,
        session_id TEXT NOT NULL,
        chain_id TEXT,
        step_number INTEGER,
        prompt_id TEXT,
        status TEXT NOT NULL,
        substate_json TEXT,
        input_required_json TEXT,
        evidence_json TEXT,
        gate_verdicts_json TEXT NOT NULL DEFAULT '[]',
        error_message TEXT,
        started_at INTEGER NOT NULL,
        completed_at INTEGER,
        created_at TEXT DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_chain_sessions_tenant ON chain_sessions(tenant_id);
      CREATE INDEX IF NOT EXISTS idx_chain_sessions_workspace ON chain_sessions(workspace_id);
      CREATE INDEX IF NOT EXISTS idx_chain_sessions_organization ON chain_sessions(organization_id);
      CREATE INDEX IF NOT EXISTS idx_chain_sessions_chain ON chain_sessions(chain_id);
      CREATE INDEX IF NOT EXISTS idx_resource_index_type ON resource_index(type);
      CREATE INDEX IF NOT EXISTS idx_kv_state_workspace ON kv_state(workspace_id);
      CREATE INDEX IF NOT EXISTS idx_kv_state_organization ON kv_state(organization_id);
      CREATE INDEX IF NOT EXISTS idx_resource_changes_tenant ON resource_changes(tenant_id, timestamp);
      CREATE INDEX IF NOT EXISTS idx_ssm_client_scope ON skills_sync_manifests(client, scope);
      CREATE INDEX IF NOT EXISTS idx_version_history_resource ON version_history(tenant_id, resource_type, resource_id);
      CREATE INDEX IF NOT EXISTS idx_version_history_workspace ON version_history(workspace_id);
      CREATE INDEX IF NOT EXISTS idx_version_history_organization ON version_history(organization_id);
      CREATE INDEX IF NOT EXISTS idx_resource_changes_workspace ON resource_changes(workspace_id);
      CREATE INDEX IF NOT EXISTS idx_resource_changes_organization ON resource_changes(organization_id);
      CREATE INDEX IF NOT EXISTS idx_chain_run_registry_workspace ON chain_run_registry(workspace_id);
      CREATE INDEX IF NOT EXISTS idx_execution_records_session ON execution_records(session_id);
      CREATE INDEX IF NOT EXISTS idx_execution_records_chain ON execution_records(chain_id);
      CREATE INDEX IF NOT EXISTS idx_execution_records_started ON execution_records(started_at);
      CREATE INDEX IF NOT EXISTS idx_execution_records_tenant ON execution_records(tenant_id);
      CREATE INDEX IF NOT EXISTS idx_chain_sessions_run_status ON chain_sessions(run_status);

      -- Cross-language SSOT view consumed by both TS server and Python hooks (db_reader.py).
      -- Single query answers "where is this chain run right now and what's the next action?".
      -- ChainSession is serialized as JSON in chain_sessions.state; nested ChainState is at $.state.
      CREATE VIEW IF NOT EXISTS v_execution_status AS
      SELECT
        cs.id AS row_id,
        json_extract(cs.state, '$.sessionId') AS session_id,
        cs.chain_id,
        cs.run_number,
        cs.run_status,
        cs.run_completed_at,
        json_extract(cs.state, '$.state.currentStep') AS current_step,
        json_extract(cs.state, '$.state.totalSteps') AS total_steps,
        json_extract(cs.state, '$.lastActivity') AS last_activity,
        json_extract(cs.state, '$.lifecycle') AS lifecycle,
        json_extract(cs.state, '$.pendingGateReview') AS pending_gate_review,
        json_extract(cs.state, '$.pendingShellVerification') AS pending_shell_verification,
        cs.tenant_id,
        cs.organization_id,
        cs.workspace_id,
        (SELECT MAX(started_at) FROM execution_records er
          WHERE er.session_id = json_extract(cs.state, '$.sessionId')) AS last_execution_at,
        (SELECT er.error_message FROM execution_records er
          WHERE er.session_id = json_extract(cs.state, '$.sessionId')
            AND er.error_message IS NOT NULL
          ORDER BY er.started_at DESC LIMIT 1) AS last_error,
        cs.updated_at
      FROM chain_sessions cs;

      -- Companion to v_execution_status, reading the ledger DIRECTLY.
      --
      -- v_execution_status selects FROM chain_sessions, which is DELETEd per-PID at
      -- cleanup, so it structurally cannot report a run that finished: it returned 0 rows
      -- against 64 live execution_records when this view was added. Widening that view
      -- could not fix it -- its FROM clause is the defect -- so history gets its own view.
      --
      -- One row per session, carrying the latest record's state plus a count of the whole
      -- series. MAX(execution_id) identifies the newest record because execution ids are
      -- monotonic ULIDs (see ExecutionRecordStore), so lexical order IS creation order.
      CREATE VIEW IF NOT EXISTS v_execution_history AS
      SELECT
        latest.session_id,
        latest.chain_id,
        latest.prompt_id,
        latest.status              AS current_status,
        latest.step_number         AS current_step,
        latest.error_message,
        agg.record_count,
        agg.first_started_at,
        latest.started_at          AS last_started_at,
        latest.completed_at        AS last_completed_at,
        latest.tenant_id,
        latest.organization_id,
        latest.workspace_id
      FROM (
        SELECT session_id,
               COUNT(*)          AS record_count,
               MIN(started_at)   AS first_started_at,
               MAX(execution_id) AS latest_execution_id
        FROM execution_records
        GROUP BY session_id
      ) agg
      JOIN execution_records latest ON latest.execution_id = agg.latest_execution_id;

      INSERT OR IGNORE INTO schema_version (version) VALUES (${SCHEMA_VERSION});
    `);
  }

  /**
   * Fail startup when the live schema and TABLE_CONTRACTS disagree.
   *
   * A contract is worth what it is checked against. Without this, a table added to
   * applySchema() with no contract entry — or an entry for a table that was removed — stays
   * invisible until something downstream depends on a table nobody declared the ownership,
   * posture, or retention of. That is how all eleven audited findings accumulated.
   *
   * sqlite_master also lists tables SQLite creates for itself: sqlite_sequence materializes
   * as soon as any table declares AUTOINCREMENT. Those are excluded, not declared, because
   * their existence depends on unrelated DDL details.
   */
  private assertSchemaMatchesContracts(): void {
    const liveTables = this.listSchemaObjects('table').filter(
      (name) => !SQLITE_INTERNAL_TABLES.includes(name)
    );
    const liveViews = this.listSchemaObjects('view');

    const declaredTables = new Set(CONTRACTED_TABLE_NAMES);
    const declaredViews = new Set(VIEW_CONTRACTS.map((contract) => contract.view));

    const problems: string[] = [];
    const report = (label: string, names: string[]): void => {
      if (names.length > 0) {
        problems.push(`${label}: ${names.join(', ')}`);
      }
    };

    report(
      'tables present with no contract',
      liveTables.filter((name) => !declaredTables.has(name))
    );
    report(
      'contracted tables absent from the database',
      [...declaredTables].filter((name) => !liveTables.includes(name))
    );
    report(
      'views present with no contract',
      liveViews.filter((name) => !declaredViews.has(name))
    );
    report(
      'contracted views absent from the database',
      [...declaredViews].filter((name) => !liveViews.includes(name))
    );

    if (problems.length > 0) {
      throw new Error(
        `state.db does not match table-contracts.ts — ${problems.join('; ')}. ` +
          'Declare the change in src/infra/database/table-contracts.ts, including owner, ' +
          'posture, scope, and retention.'
      );
    }
  }

  private listSchemaObjects(type: 'table' | 'view'): string[] {
    return this.query<{ name: string }>('SELECT name FROM sqlite_master WHERE type = ?', [
      type,
    ]).map((row) => row.name);
  }

  private getTableColumns(tableName: string): Set<string> {
    const rows = this.query<{ name?: string }>(`PRAGMA table_info(${tableName})`);
    return new Set(
      rows
        .map((row) => row.name)
        .filter((name): name is string => typeof name === 'string' && name.length > 0)
    );
  }

  /**
   * Shut down the process-wide instance, if one was ever opened.
   *
   * Shutdown must not route through `getInstance()`, which CREATES an engine when none
   * exists — a teardown path that constructs the thing it is tearing down would open a
   * database handle during shutdown and log a checkpoint for a file nobody wrote.
   */
  static async shutdownInstance(): Promise<void> {
    if (SqliteEngine.instance) {
      await SqliteEngine.instance.shutdown();
    }
  }

  /**
   * Shutdown and cleanup
   */
  async shutdown(): Promise<void> {
    this.logger.info('Shutting down SqliteEngine...');

    if (this.db) {
      this.checkpointWal();
      this.db.close();
      this.db = null;
    }

    this.initialized = false;
    SqliteEngine.instance = null;

    this.logger.info('SqliteEngine shutdown complete');
  }

  /**
   * Truncate the write-ahead log so the next process opens a small file.
   *
   * SQLite checkpoints on its own when the LAST connection closes, which is why this
   * looks redundant. It is not: `state.db` typically has concurrent readers (Python
   * hooks, the skills-sync CLI), so this connection is often not the last one and that
   * automatic pass is skipped. Measured 2026-08-05 — a 4.2 MB WAL against a 598 KB
   * database, because shutdown never ran at all.
   *
   * A checkpoint may return SQLITE_BUSY while a reader holds the file. That is not a
   * shutdown failure: the WAL stays valid and replayable, and the next clean close
   * retries. So this logs and returns rather than throwing — a throw here would skip
   * `db.close()` below and leak the handle, trading a large file for a lost one.
   */
  private checkpointWal(): void {
    try {
      this.db?.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.warn(`WAL checkpoint skipped during shutdown: ${msg}`);
    }
  }

  /**
   * Get database file path (for testing/debugging)
   */
  getDbPath(): string {
    return this.dbPath;
  }

  /**
   * Get current schema version
   */
  getSchemaVersion(): number {
    try {
      const result = this.queryOne<{ version: number }>(
        'SELECT MAX(version) as version FROM schema_version'
      );
      return result?.version ?? 0;
    } catch {
      return 0;
    }
  }
}
