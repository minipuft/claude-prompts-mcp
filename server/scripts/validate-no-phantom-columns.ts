#!/usr/bin/env tsx

/**
 * Flags columns that are declared and indexed in the schema but that no writer ever populates.
 *
 * THE DECLARED-BUT-NEVER-CONSUMED FAMILY. This gate is one of FOUR covering the same failure
 * shape at different layers: a value and its consumer both exist and never meet, so the feature
 * looks implemented, is measured as covered, and silently does nothing.
 *
 * THE LAYERS, ordered from declaration to delivery. Each member owns exactly one, and the
 * ordering is the useful part — a defect belongs to the FIRST layer at which the chain breaks:
 *
 *   1. EXPORT     `validate:knip-ratchet`        — declared, never imported
 *   2. COLUMN     `validate:no-phantom-columns`  — declared and indexed, no writer names it
 *   3. FIELD      `validate:state-field-writers` — an optional TS field with readers and no
 *                                                  writer, including dependency seams that
 *                                                  default to no-op
 *   4. PRODUCER   `validate:scope-producers`     — a value IS written, to a key its consumer
 *                                                  does not read
 *
 * WHEN A NEW INSTANCE ARRIVES: prefer extending the member that owns its layer. **If no member
 * owns that layer, add one — do not force the instance into the nearest member.** The original
 * wording of this charter said only "prefer an existing member rather than a fourth script", and
 * that instruction has a hole exactly where this family got hurt: nothing owned the producer
 * layer, so `sqlite-layer-remediation-2026-08-03` Tier 4.1 fixed one producer BY HAND, marked the
 * row done, and three siblings carrying the identical expression survived four months until an
 * unrelated security probe tripped over them (2026-08-27: the gate master switch could not
 * disable anything, `framework switch` never persisted, the advertised `inputSchema` never
 * narrowed). A hand-fix at one site is not a fix of a class. Adding the fourth member is what
 * this rule now requires, and naming the layers is what makes "does a member own this?"
 * answerable instead of a judgement call.
 *
 * A NEW MEMBER MUST catch its own motivating instances — demonstrated by reintroducing them and
 * observing the failure — and, if it accepts exceptions, audit them through
 * `lib/exception-hygiene.js` so a green run is never a run that reached nothing.
 *
 * NONE of them catches runtime unreachability: code that is wired, imported and written, but sits
 * on a branch the live path never takes. That class is what the `reached` pre-flight probe in
 * `~/.claude/rules/refactoring.md` exists for, and it is why a green suite is not evidence a new
 * path runs. Measured 2026-08-17: a feature passed 2619 unit tests on a path that never executed.
 *
 * WHY THIS IS ITS OWN GATE: this is the schema-level sibling of the phantom *field* class that
 * `validate-state-field-writers.js` catches on TypeScript interfaces, and it fails the same way
 * — worse than dead code, because the readers are reachable. A phantom column reads as NULL on
 * every row, so the feature it backs looks implemented, queries against it return empty rather
 * than erroring, and an index sits on it advertising intent.
 *
 * WHAT THIS GATE DOES **NOT** CATCH, stated plainly because the motivating case is an example:
 * `execution_records.workspace_id` and `organization_id` are NULL on every row, but this gate
 * passes them, because `execution-record-store.ts` does name both columns in its INSERT list.
 * The defect there is one level down — the caller structurally cannot supply a value, so the
 * bound parameter is always NULL. That is a *value*-level phantom; this gate sees only the
 * *declaration* level. The two are different checks, and a column can fail either one. Tier 4.1
 * fixes the value-level case at its source by making the scope resolver stop truncating.
 *
 * WHAT COUNTS AS WRITTEN
 *   - the column appears in the parenthesised column list of an INSERT into its table, or
 *   - it appears as an assignment target in an `UPDATE <table> SET ...`
 *   in the table's declared owner, or in any declared `acceptedForeignWriters` entry.
 *   A column list held in a template constant (`INSERT INTO t (${COLUMNS})`) is read as the text
 *   of `const COLUMNS = \`...\`` in the same file. A `${...}` left in a column list after that is
 *   an error naming the file and placeholder: skipping it would report every column it holds as
 *   unwritten (28 on 2026-10-15, when run-registry.ts moved its lists into constants).
 *
 * WHAT IS EXEMPT, and why
 *   - columns with a DDL `DEFAULT` — SQLite populates them; a writer naming them is optional
 *   - `AUTOINCREMENT` columns — SQLite allocates them
 * Everything else with no writer is either a missing feature or a column that should not exist.
 * Both need a decision; neither should be silent.
 *
 * KNOWN BLIND SPOT — dynamically assembled column lists. `SqliteStateStore` builds its INSERT
 * from a PRAGMA-derived column set, so its columns are not literal text anywhere. Tables it owns
 * would report false phantoms, which is why a false positive here is resolved by declaring an
 * `acceptedPhantomColumns` entry naming the dynamic writer rather than by loosening the parse:
 * loosening it to "the name appears anywhere in the file" would have passed the very columns
 * this exists to catch, since `workspace_id` appears throughout the codebase as a TS field.
 *
 * RETIREMENT CONDITION: none expected. Individual exceptions retire with their named tiers.
 */

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import { TABLE_CONTRACTS, type TableContract } from '../src/infra/database/table-contracts.js';
import {
  SERVER_DIR,
  collectWrittenColumns,
  parseSchemaDdl,
  readEngineSource,
  type DdlTable,
} from './table-contracts-reader.js';
import { VERDICT, auditExceptions } from './lib/exception-hygiene.js';

const LABEL = '[no-phantom-columns]';

interface Finding {
  readonly table: string;
  readonly column: string;
}

/** Every module permitted to write this table: the owner plus any accepted foreign writer. */
function writerPathsFor(contract: TableContract): string[] {
  return [
    contract.owner,
    ...(contract.acceptedForeignWriters ?? []).map((exception) => exception.subject),
  ];
}

function readIfPresent(relativePath: string): string {
  const absolute = path.join(SERVER_DIR, relativePath);
  return fs.existsSync(absolute) ? fs.readFileSync(absolute, 'utf8') : '';
}

/** `source` with each `${NAME}` naming a template-literal const in `source` replaced by its text. */
export function inlineTemplateConstants(source: string): string {
  const constants = new Map(
    [...source.matchAll(/const (\w+) = `([^`$]*)`/g)].map((m) => [m[1] ?? '', m[2] ?? ''])
  );
  return source.replace(/\$\{(\w+)\}/g, (held, name: string) => constants.get(name) ?? held);
}

/** Every `${...}` still standing in the column list of an INSERT into `table`. */
function unresolvedColumnPlaceholders(source: string, table: string): string[] {
  const insert = new RegExp(
    `INSERT\\s+(?:OR\\s+\\w+\\s+)?INTO\\s+["'\`]?${table}["'\`]?\\s*\\(([^)]*)\\)`,
    'gi'
  );
  return [...source.matchAll(insert)].flatMap((m) => (m[1] ?? '').match(/\$\{[^}]*\}?/g) ?? []);
}

function phantomColumnsFor(
  contract: TableContract,
  ddl: DdlTable
): { findings: Finding[]; unresolved: string[] } {
  const written = new Set<string>();
  const unresolved: string[] = [];
  for (const writerPath of writerPathsFor(contract)) {
    const source = inlineTemplateConstants(readIfPresent(writerPath));
    for (const placeholder of unresolvedColumnPlaceholders(source, contract.table)) {
      unresolved.push(
        `${writerPath}: an INSERT INTO ${contract.table} column list holds ${placeholder}, ` +
          'which names no template-literal const in that file, so its columns cannot be read.'
      );
    }
    for (const column of collectWrittenColumns(source, contract.table)) written.add(column);
  }

  const findings = ddl.columns
    .filter((column) => !column.hasDefault && !column.isAutoIncrement && !written.has(column.name))
    .map((column) => ({ table: contract.table, column: column.name }));
  return { findings, unresolved };
}

function runSelfTest(): void {
  const failures: string[] = [];

  const ddl = parseSchemaDdl(`
    CREATE TABLE IF NOT EXISTS gadget (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      label TEXT NOT NULL,
      tenant_id TEXT NOT NULL DEFAULT 'default',
      touched_at TEXT DEFAULT (datetime('now')),
      never_written TEXT,
      written_by_update TEXT
    );
  `);

  const gadget = ddl.get('gadget');
  if (!gadget) {
    failures.push('fixture table did not parse');
  } else {
    const ownerSource = `
      db.run("INSERT INTO gadget (label) VALUES (?)", [label]);
      db.run("UPDATE gadget SET written_by_update = ? WHERE id = ?", [value, id]);
      // A same-named column on another table must not count as a write here.
      db.run("INSERT INTO other_table (never_written) VALUES (?)", [x]);
      const never_written = 'a TS identifier must not count as a write either';
    `;

    const written = collectWrittenColumns(ownerSource, 'gadget');
    if (!written.has('label')) failures.push('INSERT column list was not collected');
    if (!written.has('written_by_update')) failures.push('UPDATE SET target was not collected');
    if (written.has('never_written')) {
      failures.push(
        'a column written on a DIFFERENT table (or appearing as a TS identifier) was counted'
      );
    }

    const phantoms = gadget.columns
      .filter(
        (column) => !column.hasDefault && !column.isAutoIncrement && !written.has(column.name)
      )
      .map((column) => column.name);

    if (JSON.stringify(phantoms) !== JSON.stringify(['never_written'])) {
      failures.push(`expected ['never_written'], flagged ${JSON.stringify(phantoms)}`);
    }
    if (phantoms.includes('tenant_id')) failures.push('a DEFAULTed column was flagged');
    if (phantoms.includes('touched_at')) failures.push('a datetime-defaulted column was flagged');
    if (phantoms.includes('id')) failures.push('an AUTOINCREMENT column was flagged');

    const held = inlineTemplateConstants(
      'const COLS = `label, never_written`;\nINSERT INTO gadget (${COLS}) VALUES (?)'
    );
    if (!collectWrittenColumns(held, 'gadget').has('never_written')) {
      failures.push('a column list held in a template constant was not read through it');
    }
    const lost = inlineTemplateConstants('INSERT INTO gadget (${COLZ}) VALUES (?)');
    if (unresolvedColumnPlaceholders(lost, 'gadget').join() !== '${COLZ}') {
      failures.push('a column-list placeholder naming no constant was not reported');
    }
  }

  if (failures.length > 0) {
    console.error(`${LABEL} SELF-TEST FAILED:`);
    failures.forEach((failure) => console.error(`  - ${failure}`));
    process.exitCode = 1;
    return;
  }

  console.log(
    'validate:no-phantom-columns self-test OK — flags a declared column with no writer, ' +
      'collects INSERT lists (including ones held in template constants) and UPDATE SET targets, ' +
      'reports a column-list placeholder naming no constant, exempts DEFAULT and AUTOINCREMENT columns, ' +
      'and is not fooled by the same column name written on another table.'
  );
}

function main(): void {
  if (process.argv.slice(2).includes('--self-test')) {
    runSelfTest();
    return;
  }

  const ddl = parseSchemaDdl(readEngineSource());
  const findings: Finding[] = [];
  const acknowledged: string[] = [];
  const exceptionProblems: string[] = [];
  const unresolved: string[] = [];

  for (const contract of TABLE_CONTRACTS) {
    const table = ddl.get(contract.table);
    if (!table) continue; // set-equality is validate:table-contracts' job, not this gate's

    const scan = phantomColumnsFor(contract, table);
    unresolved.push(...scan.unresolved);
    const stillPhantom = new Set<string>();
    for (const finding of scan.findings) {
      const accepted = contract.acceptedPhantomColumns?.find(
        (exception) => exception.subject === finding.column
      );
      if (accepted) {
        stillPhantom.add(finding.column);
        acknowledged.push(
          `${finding.table}.${finding.column} — accepted, closed by ${accepted.closedBy}`
        );
        continue;
      }
      findings.push(finding);
    }

    // An accepted phantom column is an exception like any other: it must still suppress a finding.
    // A column that GAINED a writer is the success case for the tier that owned it — and is
    // exactly the moment nothing was reporting that the entry had become unnecessary.
    const audit = auditExceptions({
      gate: 'no-phantom-columns',
      entries: contract.acceptedPhantomColumns ?? [],
      describe: (exception) => `${contract.table}.${exception.subject}`,
      closedBy: (exception) => exception.closedBy,
      classify: (exception) => {
        if (stillPhantom.has(exception.subject)) return { verdict: VERDICT.LOAD_BEARING };
        if (!table.columns.some((column) => column.name === exception.subject)) {
          return { verdict: VERDICT.SUBJECT_MISSING, detail: 'the column is no longer declared' };
        }
        return { verdict: VERDICT.SATISFIED, detail: 'the column now has a writer' };
      },
    });
    exceptionProblems.push(
      ...audit.problems.map((problem) => `${problem.subject}: ${problem.message}`)
    );
  }

  // First: an unread column list makes every column it holds look unwritten.
  if (unresolved.length > 0) {
    console.error(`${LABEL} FAIL: ${unresolved.length} column list(s) could not be read.`);
    for (const problem of unresolved) console.error(`  - ${problem}`);
    process.exitCode = 1;
    return;
  }

  if (exceptionProblems.length > 0) {
    console.error(`${LABEL} FAIL: ${exceptionProblems.length} stale accepted exception(s).`);
    for (const problem of exceptionProblems) console.error(`  - ${problem}`);
    process.exitCode = 1;
    return;
  }

  if (findings.length > 0) {
    console.error(`${LABEL} FAIL: ${findings.length} column(s) declared with no writer.`);
    for (const finding of findings) {
      console.error(
        `  - ${finding.table}.${finding.column}: declared in the schema, never populated. ` +
          'Write it, drop it, or declare it in acceptedPhantomColumns with the tier that fixes it.'
      );
    }
    process.exitCode = 1;
    return;
  }

  if (acknowledged.length > 0) {
    console.log(`${LABEL} ${acknowledged.length} accepted phantom column(s) pending a writer:`);
    acknowledged.forEach((entry) => console.log(`  - ${entry}`));
  }

  console.log(`${LABEL} OK: every declared column has a writer or a declared exception.`);
}

// Guarded: the resolver is exported to a test, and importing must not run the gate.
if (process.argv[1] === fileURLToPath(import.meta.url)) main();
