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

import process from 'node:process';

import {
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
} from './table-contracts-reader.js';

const LABEL = '[table-contracts]';

interface Problem {
  readonly subject: string;
  readonly message: string;
}

/** An exception must name its exit, or it is a permanent bypass. */
/**
 * Parse `SCHEMA_VERSION`, `DROPPED_ON_THIS_BUMP`, and `DROPPED_AT_VERSION` out of the engine source.
 *
 * Read as text rather than imported, for the same reason `parseSchemaDdl` is: `table-contracts.ts`
 * imports nothing so gates can run without pulling `node:sqlite` and the engine singleton into a
 * validation process. Importing the engine here to reach three consts would undo that.
 */
export function parseBumpExclusion(engineSource: string): {
  schemaVersion: number | null;
  declaredAt: number | null;
  excluded: string[];
} {
  const schemaVersion = /^const SCHEMA_VERSION = (\d+);/m.exec(engineSource);
  const declaredAt = /^const DROPPED_AT_VERSION = (\d+);/m.exec(engineSource);
  const setLiteral =
    /^const DROPPED_ON_THIS_BUMP: ReadonlySet<string> = new Set\(\[([^\]]*)\]\);/m.exec(
      engineSource
    );

  const excluded =
    setLiteral === undefined || setLiteral === null
      ? []
      : (setLiteral[1] ?? '')
          .split(',')
          .map((entry) => entry.trim().replace(/^['"`]|['"`]$/g, ''))
          .filter((entry) => entry.length > 0);

  return {
    schemaVersion: schemaVersion ? Number(schemaVersion[1]) : null,
    declaredAt: declaredAt ? Number(declaredAt[1]) : null,
    excluded,
  };
}

/**
 * A one-time durable-table exclusion must retire with the bump that declared it.
 *
 * `DROPPED_ON_THIS_BUMP` names durable tables deliberately NOT carried across a schema recreate.
 * That is correct exactly once. Left behind, it silently discards a table whose rows exist nowhere
 * else on the next, unrelated bump. This is the `closedBy` rule above applied to a construct that
 * is not an AcceptedException: a bypass must name what retires it, and something must notice when
 * it has not.
 */
function checkBumpExclusionRetired(engineSource: string, problems: Problem[]): void {
  const { schemaVersion, declaredAt, excluded } = parseBumpExclusion(engineSource);

  if (schemaVersion === null) {
    problems.push({
      subject: 'sqlite-engine.ts',
      message: 'could not parse SCHEMA_VERSION — this check cannot verify the bump exclusion',
    });
    return;
  }

  if (excluded.length === 0) {
    return;
  }

  if (declaredAt === null) {
    problems.push({
      subject: 'DROPPED_ON_THIS_BUMP',
      message:
        `excludes [${excluded.join(', ')}] but DROPPED_AT_VERSION is absent — an exclusion with ` +
        'no recorded version has no retirement condition',
    });
    return;
  }

  if (schemaVersion !== declaredAt) {
    problems.push({
      subject: 'DROPPED_ON_THIS_BUMP',
      message:
        `still excludes [${excluded.join(', ')}] from the durable snapshot, but it was declared ` +
        `for v${declaredAt} and SCHEMA_VERSION is now v${schemaVersion}. Empty the set and move ` +
        'DROPPED_AT_VERSION, or these durable tables are dropped by an unrelated schema change.',
    });
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

function checkSingleWriter(problems: Problem[]): string[] {
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

  // The bump exclusion must retire with the version that declared it. Both arms matter: a stale
  // set has to fail, and a matching version has to pass, or the check is either always-red
  // (blocking every bump) or always-green (the state this replaced).
  const staleSource = [
    'const SCHEMA_VERSION = 21;',
    "const DROPPED_ON_THIS_BUMP: ReadonlySet<string> = new Set(['version_history']);",
    'const DROPPED_AT_VERSION = 20;',
  ].join('\n');
  const staleProblems: Problem[] = [];
  checkBumpExclusionRetired(staleSource, staleProblems);
  if (staleProblems.length !== 1) {
    failures.push(
      `a bump exclusion left behind past its declared version was not rejected (got ${staleProblems.length})`
    );
  }

  const currentSource = [
    'const SCHEMA_VERSION = 20;',
    "const DROPPED_ON_THIS_BUMP: ReadonlySet<string> = new Set(['version_history']);",
    'const DROPPED_AT_VERSION = 20;',
  ].join('\n');
  const currentProblems: Problem[] = [];
  checkBumpExclusionRetired(currentSource, currentProblems);
  if (currentProblems.length !== 0) {
    failures.push('an exclusion declared for the current version was wrongly rejected');
  }

  const emptySource = [
    'const SCHEMA_VERSION = 21;',
    'const DROPPED_ON_THIS_BUMP: ReadonlySet<string> = new Set([]);',
    'const DROPPED_AT_VERSION = 20;',
  ].join('\n');
  const emptyProblems: Problem[] = [];
  checkBumpExclusionRetired(emptySource, emptyProblems);
  if (emptyProblems.length !== 0) {
    failures.push('an emptied exclusion was wrongly rejected after a later bump');
  }

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

function main(): void {
  if (process.argv.slice(2).includes('--self-test')) {
    runSelfTest();
    return;
  }

  const problems: Problem[] = [];

  checkSetEquality(problems);
  checkBumpExclusionRetired(readEngineSource(), problems);
  for (const contract of TABLE_CONTRACTS) {
    checkPostureCoherence(contract, problems);
    checkReaders(contract, problems);
    checkExceptionHygiene(contract, problems);
  }
  const acknowledged = checkSingleWriter(problems);

  if (problems.length > 0) {
    console.error(`${LABEL} FAIL: ${problems.length} contract problem(s).`);
    for (const problem of problems) {
      console.error(`  - ${problem.subject}: ${problem.message}`);
    }
    process.exitCode = 1;
    return;
  }

  if (acknowledged.length > 0) {
    console.log(`${LABEL} ${acknowledged.length} accepted foreign writer(s) pending removal:`);
    acknowledged.forEach((entry) => console.log(`  - ${entry}`));
  }

  console.log(
    `${LABEL} OK: ${TABLE_CONTRACTS.length} tables and ${VIEW_CONTRACTS.length} view(s) ` +
      'declared, matched against the embedded schema.'
  );
}

main();
