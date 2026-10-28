#!/usr/bin/env tsx

/**
 * Enforces that every table in `state.db` has a declared contract, and that the declaration
 * is internally coherent and matches the embedded schema.
 *
 * WHY THIS EXISTS: the SQLite layer accumulated eleven findings without a single one of them
 * being a bug in isolation. Each was two modules assuming different answers to a question no
 * file ever asked — who owns this table, does it survive a schema bump, what does its scope
 * column mean, and what bounds its growth. Documentation would not have caught any of them,
 * because documentation does not fail CI.
 *
 * WHAT IT CHECKS
 *   1. Set equality — every CREATE TABLE in applySchema() has a contract, and every contract
 *      names a real table. Same for views. SQLite's own tables (sqlite_sequence) are excluded.
 *   2. Coherence — `derived` names where rows come back from; `ephemeral`/`durable` do not
 *      claim to; `unbounded-justified` states why it is bounded elsewhere.
 *   3. Readers — a table with no reader is a finding, not a default. It is either a missing
 *      consumer or a redundant channel, and which one it is has to be decided, not defaulted.
 *      Declared reader paths must exist on disk, so a moved file surfaces here.
 *   4. Single writer — INSERT/UPDATE/DELETE or CREATE TABLE for a contracted table, in a file
 *      other than its owner, is a violation unless declared in `acceptedForeignWriters`.
 *   5. Exception hygiene — every accepted exception names what closes it, and `finding` text
 *      must reference a tier or explicitly say no tier owns it.
 *
 * KNOWN BLIND SPOT — dynamically-named tables. Table names are matched literally, so SQL built
 * by interpolating a table name (`SqliteStateStore` takes its table from config) is invisible
 * to check 4. This is deliberate: the store abstraction is the sanctioned write path, and the
 * violations worth catching are hand-written SQL. Widening this to trace config values would
 * flag the abstraction itself on every call site.
 *
 * RETIREMENT CONDITION: none expected. This encodes an invariant, not a migration. Individual
 * `acceptedForeignWriters` entries retire as their named tiers land.
 */

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import {
  DURABLE_MIGRATIONS,
  type DurableMigration,
} from '../src/infra/database/durable-migrations.js';
import {
  DURABLE_TABLE_NAMES,
  SQLITE_INTERNAL_TABLES,
  TABLE_CONTRACTS,
  VIEW_CONTRACTS,
  type TableContract,
} from '../src/infra/database/table-contracts.js';
import {
  ENGINE_RELATIVE_PATH,
  contractPathExists,
  findSqlSites,
  parseSchemaDdl,
  parseSchemaViews,
  readEngineSource,
  sqlScanFileSet,
} from './table-contracts-reader.js';
import { VERDICT, auditExceptions } from './lib/exception-hygiene.js';

const LABEL = '[table-contracts]';

interface Problem {
  readonly subject: string;
  readonly message: string;
}

/**
 * Parse `SCHEMA_VERSION` out of the engine source.
 *
 * Read as text rather than imported, for the same reason `parseSchemaDdl` is: `table-contracts.ts`
 * imports nothing so gates can run without pulling `node:sqlite` and the engine singleton into a
 * validation process. Importing the engine here to reach one const would undo that.
 */
export function parseSchemaVersion(engineSource: string): number | null {
  const match = /^const SCHEMA_VERSION = (\d+);/m.exec(engineSource);
  return match ? Number(match[1]) : null;
}

/** sha256 per durable table over its normalized `CREATE TABLE` / `CREATE INDEX` statements. */
type DurableFingerprint = Readonly<Record<string, string>>;

interface DurableSchemaSnapshot {
  readonly schemaVersion: number;
  readonly tables: DurableFingerprint;
}

/** The committed record of the durable schema at the last `--update`, plus the one before it. */
interface DurableSchemaLock extends DurableSchemaSnapshot {
  readonly previous?: DurableSchemaSnapshot;
}

const LOCK_RELATIVE_PATH = 'src/infra/database/durable-schema.lock.json';
const UPDATE_COMMAND = 'npm run validate:table-contracts -- --update';

function lockFilePath(): string {
  return fileURLToPath(new URL(`../${LOCK_RELATIVE_PATH}`, import.meta.url));
}

/** Whitespace-insensitive, so reformatting a statement is not a schema change. */
export function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim();
}

interface SchemaObjectRow {
  readonly type: string;
  readonly name: string;
  readonly tbl_name: string;
  readonly sql: string;
}

/** Pure: group `sqlite_master` rows by table and hash each table's statements. */
export function fingerprintDurableTables(
  rows: readonly SchemaObjectRow[],
  durableTables: readonly string[]
): DurableFingerprint {
  const fingerprint: Record<string, string> = {};
  for (const table of [...durableTables].sort()) {
    const statements = rows
      .filter((row) => row.tbl_name === table)
      .sort(
        (left, right) => left.type.localeCompare(right.type) || left.name.localeCompare(right.name)
      )
      .map((row) => normalizeSql(row.sql));
    fingerprint[table] = createHash('sha256').update(statements.join('\n')).digest('hex');
  }
  return fingerprint;
}

/**
 * The durable schema as the engine really creates it: initialize a scratch database and read
 * `sqlite_master`. Hashing the engine's own output, not the DDL text, means a column added by any
 * path that reaches a fresh database is seen.
 */
async function computeDurableFingerprint(): Promise<DurableFingerprint> {
  const { SqliteEngine } = await import('../src/infra/database/sqlite-engine.js');
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'durable-schema-'));
  const silent = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
  const engine = await SqliteEngine.getInstance(silent, {
    dbPath: path.join(scratch, 'state.db'),
  });
  try {
    await engine.initialize();
    const placeholders = DURABLE_TABLE_NAMES.map(() => '?').join(', ');
    const rows = engine
      .getDb()
      .prepare(
        `SELECT type, name, tbl_name, sql FROM sqlite_master
         WHERE type IN ('table', 'index') AND sql IS NOT NULL AND tbl_name IN (${placeholders})`
      )
      .all(...DURABLE_TABLE_NAMES) as unknown as SchemaObjectRow[];
    return fingerprintDurableTables(rows, DURABLE_TABLE_NAMES);
  } finally {
    await engine.shutdown();
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

/** Tables whose hash differs between two snapshots, including ones added or removed. */
function changedTables(before: DurableFingerprint, after: DurableFingerprint): string[] {
  const names = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...names].filter((name) => before[name] !== after[name]).sort();
}

/** Check (c): every table that moved between `previous` and `lock` is named by a step at `lock`. */
export function undeclaredTableChanges(
  lock: DurableSchemaLock,
  migrations: readonly DurableMigration[]
): Problem[] {
  if (lock.previous === undefined) return [];
  const declared = new Set(
    migrations
      .filter((step) => step.toVersion === lock.schemaVersion)
      .flatMap((step) => step.tables)
  );
  return changedTables(lock.previous.tables, lock.tables)
    .filter((table) => !declared.has(table))
    .map((table) => ({
      subject: table,
      message:
        `durable table ${table} changed at v${lock.schemaVersion} with no migration step naming ` +
        'it. Add a step to DURABLE_MIGRATIONS with this toVersion and the table in `tables`.',
    }));
}

/** The lock gate as a pure function, so the self-test needs no database. */
export function checkDurableSchemaLock(input: {
  readonly lock: DurableSchemaLock | undefined;
  readonly computed: DurableFingerprint;
  readonly schemaVersion: number;
  readonly migrations: readonly DurableMigration[];
}): Problem[] {
  const { lock, computed, schemaVersion, migrations } = input;
  const problems: Problem[] = [];

  if (lock === undefined) {
    return [
      {
        subject: 'durable-schema.lock.json',
        message: `lock file is missing at ${LOCK_RELATIVE_PATH}; create it with \`${UPDATE_COMMAND}\``,
      },
    ];
  }

  if (lock.schemaVersion !== schemaVersion) {
    problems.push({
      subject: 'durable-schema.lock.json',
      message:
        `lock is at v${lock.schemaVersion} but SCHEMA_VERSION is v${schemaVersion}; schema ` +
        `version moved, run \`${UPDATE_COMMAND}\``,
    });
  } else {
    for (const table of changedTables(lock.tables, computed)) {
      problems.push({
        subject: table,
        message:
          'durable schema changed without updating the lock; bump SCHEMA_VERSION, add a ' +
          `migration step, then \`${UPDATE_COMMAND}\``,
      });
    }
  }

  problems.push(...undeclaredTableChanges(lock, migrations));
  return problems;
}

/** What `--update` writes, or the reasons it refuses. Pure. */
export function planLockUpdate(input: {
  readonly lock: DurableSchemaLock | undefined;
  readonly computed: DurableFingerprint;
  readonly schemaVersion: number;
  readonly migrations: readonly DurableMigration[];
}): { next: DurableSchemaLock } | { refusals: Problem[] } {
  const { lock, computed, schemaVersion, migrations } = input;

  if (lock === undefined) return { next: { schemaVersion, tables: computed } };

  if (schemaVersion < lock.schemaVersion) {
    return {
      refusals: [
        {
          subject: 'durable-schema.lock.json',
          message: `SCHEMA_VERSION v${schemaVersion} is below the lock's v${lock.schemaVersion}`,
        },
      ],
    };
  }

  if (schemaVersion === lock.schemaVersion) {
    const drifted = changedTables(lock.tables, computed);
    if (drifted.length > 0) {
      return {
        refusals: drifted.map((table) => ({
          subject: table,
          message:
            `durable schema changed but SCHEMA_VERSION is still v${schemaVersion}; bump ` +
            'SCHEMA_VERSION and add a migration step before updating the lock',
        })),
      };
    }
    return { next: lock };
  }

  const next: DurableSchemaLock = {
    schemaVersion,
    tables: computed,
    previous: { schemaVersion: lock.schemaVersion, tables: lock.tables },
  };
  const missing = undeclaredTableChanges(next, migrations);
  return missing.length > 0 ? { refusals: missing } : { next };
}

/** Stable bytes: table names sorted, 2-space indent, trailing newline. */
function serializeLock(lock: DurableSchemaLock): string {
  const sorted = (tables: DurableFingerprint): DurableFingerprint =>
    Object.fromEntries(Object.entries(tables).sort(([a], [b]) => a.localeCompare(b)));
  const out: DurableSchemaLock = {
    schemaVersion: lock.schemaVersion,
    tables: sorted(lock.tables),
    ...(lock.previous !== undefined && {
      previous: {
        schemaVersion: lock.previous.schemaVersion,
        tables: sorted(lock.previous.tables),
      },
    }),
  };
  return `${JSON.stringify(out, null, 2)}\n`;
}

/** The committed lock, or `undefined` when no lock file exists yet. */
function readLock(): DurableSchemaLock | undefined {
  const file = lockFilePath();
  if (!fs.existsSync(file)) return undefined;
  return JSON.parse(fs.readFileSync(file, 'utf8')) as DurableSchemaLock;
}

/**
 * The truth half of exception hygiene, as opposed to the form half below.
 *
 * `checkExceptionHygiene` asks whether an entry NAMES what retires it. This asks whether the entry
 * is still describing reality — whether the foreign write it excuses still happens. Both are
 * required and neither implies the other: an entry with an impeccable `closedBy` can be excusing a
 * write that was removed two tiers ago, and nothing said so. That is the blind spot
 * `.claude/rules/sqlite-persistence.md` names, measured 6× in one initiative.
 */
function checkForeignWriterTruth(used: ReadonlySet<string>, problems: Problem[]): void {
  const scanned = sqlScanFileSet();

  for (const contract of TABLE_CONTRACTS) {
    const audit = auditExceptions({
      gate: 'table-contracts',
      entries: contract.acceptedForeignWriters ?? [],
      describe: (exception) => `${contract.table} <- ${exception.subject}`,
      closedBy: (exception) => exception.closedBy,
      classify: (exception) => {
        if (used.has(foreignWriterKey(contract.table, exception.subject))) {
          return { verdict: VERDICT.LOAD_BEARING };
        }
        if (!contractPathExists(exception.subject)) {
          return { verdict: VERDICT.SUBJECT_MISSING, detail: 'the module no longer exists' };
        }
        if (!scanned.has(exception.subject)) {
          return {
            verdict: VERDICT.UNREACHABLE,
            detail: 'outside the SQL scan, which reads server/src/**/*.ts only',
          };
        }
        return { verdict: VERDICT.SATISFIED, detail: 'the module no longer writes this table' };
      },
    });

    for (const problem of audit.problems) {
      problems.push({ subject: problem.subject, message: problem.message });
    }
  }
}

function checkExceptionHygiene(contract: TableContract, problems: Problem[]): void {
  const exceptions = [
    ...(contract.acceptedForeignWriters ?? []),
    ...(contract.acceptedPhantomColumns ?? []),
  ];

  for (const exception of exceptions) {
    if (exception.closedBy.trim().length === 0) {
      problems.push({
        subject: contract.table,
        message: `accepted exception '${exception.subject}' has an empty closedBy — name what removes it`,
      });
    }
  }

  if (contract.finding !== undefined && !/Tier|Not closed/i.test(contract.finding)) {
    problems.push({
      subject: contract.table,
      message:
        'finding names no tier and does not say "Not closed by any current tier" — ' +
        'an open finding with no owner is invisible',
    });
  }
}

function checkPostureCoherence(contract: TableContract, problems: Problem[]): void {
  if (contract.posture === 'derived' && contract.rebuiltFrom === undefined) {
    problems.push({
      subject: contract.table,
      message: "posture 'derived' must name rebuiltFrom — where do the rows come back from?",
    });
  }

  if (contract.posture !== 'derived' && contract.rebuiltFrom !== undefined) {
    problems.push({
      subject: contract.table,
      message: `posture '${contract.posture}' must not claim rebuiltFrom — only derived tables are reconstructible`,
    });
  }

  if (contract.retention === 'unbounded-justified' && contract.retentionRationale === undefined) {
    problems.push({
      subject: contract.table,
      message: "retention 'unbounded-justified' must state what bounds the table elsewhere",
    });
  }
}

function checkReaders(contract: TableContract, problems: Problem[]): void {
  if (contract.readers.length === 0 && contract.finding === undefined) {
    problems.push({
      subject: contract.table,
      message:
        'no readers declared. A table written and never read is a missing consumer or a ' +
        'redundant channel — decide which, then record it in `finding`',
    });
  }

  for (const reader of contract.readers) {
    if (!contractPathExists(reader)) {
      problems.push({
        subject: contract.table,
        message: `declared reader does not exist: ${reader}`,
      });
    }
  }

  if (!contractPathExists(contract.owner)) {
    problems.push({
      subject: contract.table,
      message: `declared owner does not exist: ${contract.owner}`,
    });
  }
}

function checkSetEquality(problems: Problem[]): void {
  const engineSource = readEngineSource();
  const ddlTables = parseSchemaDdl(engineSource);
  const ddlViews = new Set(parseSchemaViews(engineSource));

  const declaredTables = new Set(TABLE_CONTRACTS.map((contract) => contract.table));
  const declaredViews = new Set(VIEW_CONTRACTS.map((contract) => contract.view));

  for (const table of ddlTables.keys()) {
    if (!declaredTables.has(table) && !SQLITE_INTERNAL_TABLES.includes(table)) {
      problems.push({
        subject: table,
        message: `declared in ${ENGINE_RELATIVE_PATH} with no contract entry`,
      });
    }
  }

  for (const table of declaredTables) {
    if (!ddlTables.has(table)) {
      problems.push({
        subject: table,
        message: `has a contract but no CREATE TABLE in ${ENGINE_RELATIVE_PATH}`,
      });
    }
  }

  for (const view of ddlViews) {
    if (!declaredViews.has(view)) {
      problems.push({ subject: view, message: 'view declared in the schema with no contract' });
    }
  }

  for (const view of declaredViews) {
    if (!ddlViews.has(view)) {
      problems.push({ subject: view, message: 'view has a contract but no CREATE VIEW' });
    }
  }
}

/** Identity of one accepted foreign writer, stable across the scan and the audit. */
function foreignWriterKey(table: string, subject: string): string {
  return `${table}::${subject}`;
}

function checkSingleWriter(problems: Problem[], used: Set<string>): string[] {
  const byTable = new Map(TABLE_CONTRACTS.map((contract) => [contract.table, contract]));
  const sites = findSqlSites(new Set(byTable.keys()));
  const acknowledged: string[] = [];

  for (const site of sites) {
    const contract = byTable.get(site.table);
    if (!contract) continue;

    // The engine owns all DDL; a contract's `owner` names the DML owner.
    const permitted =
      site.file === contract.owner ||
      (site.kind === 'ddl' && site.file === ENGINE_RELATIVE_PATH) ||
      site.file === ENGINE_RELATIVE_PATH;
    if (permitted) continue;

    const accepted = contract.acceptedForeignWriters?.find(
      (exception) => exception.subject === site.file
    );

    if (accepted) {
      used.add(foreignWriterKey(site.table, accepted.subject));
      acknowledged.push(
        `${site.table}: ${site.file}:${site.line} (${site.kind}) — accepted, closed by ${accepted.closedBy}`
      );
      continue;
    }

    problems.push({
      subject: site.table,
      message:
        `${site.kind.toUpperCase()} at ${site.file}:${site.line} is outside the owner ` +
        `(${contract.owner}). Route it through the owner, or declare it in ` +
        'acceptedForeignWriters with the tier that removes it',
    });
  }

  return acknowledged;
}

/** Self-test for the lock gate: each arm must fail for its own reason, and the pass arms must pass. */
function checkLockSelfTest(failures: string[]): void {
  const step = (toVersion: number, tables: string[]): DurableMigration => ({
    toVersion,
    tables,
    summary: 'fixture',
    migrate: (snapshot) => snapshot,
  });
  const lock35: DurableSchemaLock = { schemaVersion: 35, tables: { a: 'h1', b: 'h2' } };
  const expect = (name: string, problems: Problem[], count: number, fragment?: string): void => {
    const text = problems.map((problem) => problem.message).join(' | ');
    if (problems.length !== count || (fragment !== undefined && !text.includes(fragment))) {
      failures.push(
        `lock gate: ${name}: expected ${count} problem(s) ${fragment ?? ''}, got ${text || 'none'}`
      );
    }
  };

  expect(
    'unchanged passes',
    checkDurableSchemaLock({
      lock: lock35,
      computed: lock35.tables,
      schemaVersion: 35,
      migrations: [],
    }),
    0
  );
  expect(
    'DDL changed at the same version fails (b)',
    checkDurableSchemaLock({
      lock: lock35,
      computed: { a: 'h1', b: 'changed' },
      schemaVersion: 35,
      migrations: [],
    }),
    1,
    'without updating the lock'
  );
  expect(
    'version bumped, lock not updated, fails (a)',
    checkDurableSchemaLock({
      lock: lock35,
      computed: lock35.tables,
      schemaVersion: 36,
      migrations: [],
    }),
    1,
    'schema version moved'
  );

  const lock36: DurableSchemaLock = {
    schemaVersion: 36,
    tables: { a: 'h1', b: 'h3' },
    previous: lock35,
  };
  expect(
    'changed table with a naming step passes',
    checkDurableSchemaLock({
      lock: lock36,
      computed: lock36.tables,
      schemaVersion: 36,
      migrations: [step(36, ['b'])],
    }),
    0
  );
  expect(
    'changed table with no step fails (c)',
    checkDurableSchemaLock({
      lock: lock36,
      computed: lock36.tables,
      schemaVersion: 36,
      migrations: [],
    }),
    1,
    'durable table b changed at v36 with no migration step naming it'
  );
  expect(
    'a step at another version does not count',
    checkDurableSchemaLock({
      lock: lock36,
      computed: lock36.tables,
      schemaVersion: 36,
      migrations: [step(35, ['b'])],
    }),
    1,
    'durable table b'
  );
  const added: DurableSchemaLock = { ...lock36, tables: { a: 'h1', b: 'h2', c: 'h4' } };
  expect(
    'a table added without a step fails (c)',
    checkDurableSchemaLock({
      lock: added,
      computed: added.tables,
      schemaVersion: 36,
      migrations: [],
    }),
    1,
    'durable table c'
  );
  const removed: DurableSchemaLock = { ...lock36, tables: { a: 'h1' } };
  expect(
    'a table removed without a step fails (c)',
    checkDurableSchemaLock({
      lock: removed,
      computed: removed.tables,
      schemaVersion: 36,
      migrations: [],
    }),
    1,
    'durable table b'
  );

  const refusal = planLockUpdate({
    lock: lock35,
    computed: { a: 'h1', b: 'changed' },
    schemaVersion: 35,
    migrations: [],
  });
  if (!('refusals' in refusal))
    failures.push('lock gate: --update at an unchanged version did not refuse drift');
  const unstepped = planLockUpdate({
    lock: lock35,
    computed: { a: 'h1', b: 'h3' },
    schemaVersion: 36,
    migrations: [],
  });
  if (!('refusals' in unstepped))
    failures.push('lock gate: --update wrote a changed table with no step');
  const stepped = planLockUpdate({
    lock: lock35,
    computed: { a: 'h1', b: 'h3' },
    schemaVersion: 36,
    migrations: [step(36, ['b'])],
  });
  if (!('next' in stepped) || stepped.next.previous?.schemaVersion !== 35) {
    failures.push('lock gate: --update did not record the old lock as previous');
  }

  expect(
    'missing lock fails in check mode',
    checkDurableSchemaLock({
      lock: undefined,
      computed: lock35.tables,
      schemaVersion: 35,
      migrations: [],
    }),
    1,
    UPDATE_COMMAND
  );
  const created = planLockUpdate({
    lock: undefined,
    computed: lock35.tables,
    schemaVersion: 35,
    migrations: [],
  });
  if (
    !('next' in created) ||
    created.next.schemaVersion !== 35 ||
    created.next.previous !== undefined ||
    JSON.stringify(created.next.tables) !== JSON.stringify(lock35.tables)
  ) {
    failures.push('lock gate: --update with no lock did not yield the computed fingerprint');
  }

  const normalized = normalizeSql('CREATE  TABLE t (\n  a INTEGER\n)');
  if (normalized !== 'CREATE TABLE t ( a INTEGER )') {
    failures.push(`lock gate: normalizeSql wrong: ${normalized}`);
  }
}

function runSelfTest(): void {
  const failures: string[] = [];

  const ddl = parseSchemaDdl(`
    CREATE TABLE IF NOT EXISTS widget (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      -- a commented_out_column TEXT should not be read as real
      label TEXT NOT NULL,
      created_at TEXT DEFAULT (datetime('now')),
      orphan TEXT,
      UNIQUE (label, orphan)
    );
    CREATE VIEW IF NOT EXISTS v_widget AS SELECT * FROM widget;
  `);

  const widget = ddl.get('widget');
  if (!widget) {
    failures.push('parseSchemaDdl did not find the widget table');
  } else {
    const names = widget.columns.map((column) => column.name);
    if (JSON.stringify(names) !== JSON.stringify(['id', 'label', 'created_at', 'orphan'])) {
      failures.push(`column parse wrong: ${JSON.stringify(names)}`);
    }
    if (names.includes('commented_out_column')) {
      failures.push('a commented-out column was parsed as real');
    }
    if (widget.columns.find((column) => column.name === 'created_at')?.hasDefault !== true) {
      failures.push('DEFAULT (datetime(...)) was not detected — nested parens broke the parse');
    }
    if (widget.columns.find((column) => column.name === 'orphan')?.hasDefault !== false) {
      failures.push('a column with no default was reported as defaulted');
    }
    if (widget.columns.find((column) => column.name === 'id')?.isAutoIncrement !== true) {
      failures.push('AUTOINCREMENT was not detected');
    }
  }

  if (
    JSON.stringify(parseSchemaViews('CREATE VIEW IF NOT EXISTS v_a AS SELECT 1;')) !== '["v_a"]'
  ) {
    failures.push('view parse failed');
  }

  // A contract that violates every coherence rule must produce four problems.
  const broken: TableContract = {
    table: 'broken',
    owner: 'src/does/not/exist.ts',
    posture: 'derived',
    scope: 'none',
    retention: 'unbounded-justified',
    readers: [],
  };
  const brokenProblems: Problem[] = [];
  checkPostureCoherence(broken, brokenProblems);
  checkReaders(broken, brokenProblems);
  if (brokenProblems.length !== 4) {
    failures.push(
      `expected 4 problems for the broken fixture (rebuiltFrom, rationale, readers, owner), got ` +
        `${brokenProblems.length}: ${brokenProblems.map((p) => p.message).join(' | ')}`
    );
  }

  // An exception with no exit must be rejected.
  const noExit: TableContract = {
    ...broken,
    acceptedForeignWriters: [{ subject: 'src/x.ts', reason: 'legacy', closedBy: '  ' }],
  };
  const exitProblems: Problem[] = [];
  checkExceptionHygiene(noExit, exitProblems);
  if (exitProblems.length !== 1) {
    failures.push('an accepted exception with an empty closedBy was not rejected');
  }

  checkLockSelfTest(failures);

  if (failures.length > 0) {
    console.error(`${LABEL} SELF-TEST FAILED:`);
    failures.forEach((failure) => console.error(`  - ${failure}`));
    process.exitCode = 1;
    return;
  }

  console.log(
    'validate:table-contracts self-test OK — parses nested-paren defaults, ignores commented ' +
      'columns and table constraints, and rejects a derived table with no rebuiltFrom, an ' +
      'unjustified unbounded retention, a missing owner/reader path, and an exception with no exit.'
  );
}

async function checkLockAgainstEngine(problems: Problem[]): Promise<void> {
  const schemaVersion = parseSchemaVersion(readEngineSource());
  if (schemaVersion === null) {
    problems.push({
      subject: 'sqlite-engine.ts',
      message: 'could not parse SCHEMA_VERSION — the durable schema lock cannot be checked',
    });
    return;
  }
  problems.push(
    ...checkDurableSchemaLock({
      lock: readLock(),
      computed: await computeDurableFingerprint(),
      schemaVersion,
      migrations: DURABLE_MIGRATIONS,
    })
  );
}

async function updateLock(): Promise<void> {
  const schemaVersion = parseSchemaVersion(readEngineSource());
  if (schemaVersion === null) {
    console.error(`${LABEL} REFUSED: could not parse SCHEMA_VERSION from the engine source.`);
    process.exitCode = 1;
    return;
  }
  const lock = readLock();
  const plan = planLockUpdate({
    lock,
    computed: await computeDurableFingerprint(),
    schemaVersion,
    migrations: DURABLE_MIGRATIONS,
  });
  if ('refusals' in plan) {
    console.error(`${LABEL} REFUSED: lock not written.`);
    plan.refusals.forEach((p) => console.error(`  - ${p.subject}: ${p.message}`));
    process.exitCode = 1;
    return;
  }
  fs.writeFileSync(lockFilePath(), serializeLock(plan.next));
  const tableCount = Object.keys(plan.next.tables).length;
  console.log(
    `${LABEL} lock at v${plan.next.schemaVersion} (${tableCount} durable tables) written to ` +
      `${LOCK_RELATIVE_PATH}${lock === undefined ? ' (created: no lock existed)' : ''}.`
  );
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes('--self-test')) {
    runSelfTest();
    return;
  }
  if (args.includes('--update')) {
    await updateLock();
    return;
  }

  const problems: Problem[] = [];

  checkSetEquality(problems);
  await checkLockAgainstEngine(problems);
  for (const contract of TABLE_CONTRACTS) {
    checkPostureCoherence(contract, problems);
    checkReaders(contract, problems);
    checkExceptionHygiene(contract, problems);
  }
  const usedForeignWriters = new Set<string>();
  const acknowledged = checkSingleWriter(problems, usedForeignWriters);
  checkForeignWriterTruth(usedForeignWriters, problems);

  if (problems.length > 0) {
    console.error(`${LABEL} FAIL: ${problems.length} contract problem(s).`);
    for (const problem of problems) {
      console.error(`  - ${problem.subject}: ${problem.message}`);
    }
    process.exitCode = 1;
    return;
  }

  if (acknowledged.length > 0) {
    // Sites, not entries — 2 declared exceptions cover these 5 writes. Saying "5 accepted foreign
    // writers" reads as 5 declarations and is how a count gets quoted wrong somewhere else.
    console.log(
      `${LABEL} ${acknowledged.length} accepted foreign write site(s) pending removal ` +
        `(from ${usedForeignWriters.size} declared exception(s)):`
    );
    acknowledged.forEach((entry) => console.log(`  - ${entry}`));
  }

  console.log(
    `${LABEL} OK: ${TABLE_CONTRACTS.length} tables and ${VIEW_CONTRACTS.length} view(s) ` +
      'declared, matched against the embedded schema.'
  );
}

main().catch((error: unknown) => {
  console.error(`${LABEL} crashed:`, error);
  process.exitCode = 1;
});
