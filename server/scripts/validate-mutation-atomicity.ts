#!/usr/bin/env tsx
/**
 * A resource's version record must be written INSIDE the transaction that writes its files.
 *
 * WHY THIS EXISTS. `recordEditResult` and `commitEdit` write to `version_history`, which is
 * durable and which nothing regenerates. For as long as one of them ran as its own step beside
 * the file write, the pair could only CHOOSE a failure mode: record first and a failed write
 * leaves a version row describing a state no file ever held; record second and a failed record
 * leaves a written file no version row describes, which is unrecoverable. Measured 2026-09-07
 * (P4.2 / SF-3): the split existed in all six lifecycle and versioning call sites — framework,
 * gate and prompt, update and rollback — while the plan row named one.
 *
 * Both orderings were shipped in this repo and one was reverted, which is the reason this is a
 * gate and not a comment. The fix was to pass the record to the file writer as its transaction's
 * `commit` step, so a failed write records nothing and a failed record restores the files. That
 * property is invisible to the type system and to any unit suite: the reverted attempt passed
 * typecheck, both ratchets, `validate:all` and 3026 unit tests. This check is what fails when a
 * seventh call site appears outside a `commit:`, rather than the class being rediscovered.
 *
 * WHAT IT CHECKS. Every call to `.recordEditResult(...)` or `.commitEdit(...)` under
 * `src/mcp/tools/` has a `commit:` property assignment among its ancestors.
 *
 * Parsed with the TypeScript AST rather than matched by text: a regex cannot tell a call inside a
 * `commit` callback from one merely near it, and brace counting misreads braces in strings and
 * template literals — a false PASS here is precisely the outcome the check exists to prevent.
 *
 * `--self-test` proves the predicate reports the pre-fix shape and stays silent on the fixed one.
 */

import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';

const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const SCAN_ROOT = path.join(SERVER_ROOT, 'src', 'mcp', 'tools');

/** The two version-history writers. Both persist and both throw; neither may stand alone. */
const RECORDING_METHODS = ['recordEditResult', 'commitEdit'] as const;

export interface UnguardedRecord {
  file: string;
  line: number;
  method: string;
}

/** True when some ancestor of `node` is the value of a `commit:` property. */
function insideCommitCallback(node: ts.Node): boolean {
  for (let current = node.parent; current !== undefined; current = current.parent) {
    if (
      ts.isPropertyAssignment(current) &&
      (ts.isIdentifier(current.name) || ts.isStringLiteral(current.name)) &&
      current.name.text === 'commit'
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Report every recording call in `source` that is not inside a `commit:` callback.
 *
 * Exported so the self-test drives the same function the run does — a self-test against a
 * reimplementation would prove the reimplementation.
 */
export function findUnguardedRecords(fileName: string, source: string): UnguardedRecord[] {
  const sourceFile = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true);
  const findings: UnguardedRecord[] = [];

  const visit = (node: ts.Node): void => {
    if (ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression)) {
      const method = node.expression.name.text;
      if (
        (RECORDING_METHODS as readonly string[]).includes(method) &&
        !insideCommitCallback(node)
      ) {
        findings.push({
          file: fileName,
          line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
          method,
        });
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return findings;
}

function typescriptFilesUnder(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...typescriptFilesUnder(full));
    } else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
      files.push(full);
    }
  }
  return files.sort();
}

/** Every recording call the scan can see, guarded or not — the probe's own denominator. */
function countRecordingCalls(source: string): number {
  return RECORDING_METHODS.reduce(
    (total, method) => total + (source.match(new RegExp(`\\.${method}\\(`, 'g'))?.length ?? 0),
    0
  );
}

const FIXED_SHAPE = `
class P {
  async handleUpdate() {
    return this.writer.write(data, {
      commit: async () => {
        await this.versionHistoryService.recordEditResult('gate', id, before, after);
      },
    });
  }
}
`;

const PRE_FIX_SHAPE = `
class P {
  async handleUpdate() {
    const saved = await this.versionHistoryService.recordEditResult('gate', id, before, after);
    return this.writer.write(data);
  }
}
`;

const ROLLBACK_PRE_FIX_SHAPE = `
class P {
  async handleRollback() {
    const saved = await this.versionHistoryService.commitEdit('gate', id, before, after);
    await this.writer.write(data);
  }
}
`;

/** A `commit:` on a DIFFERENT object must not launder a bare call — the check's own blind spot. */
const NEARBY_COMMIT_SHAPE = `
class P {
  async handleUpdate() {
    const options = { commit: async () => { await this.tx.noop(); } };
    await this.versionHistoryService.recordEditResult('gate', id, before, after);
    return this.writer.write(data, options);
  }
}
`;

function selfTest(): number {
  const cases: { name: string; source: string; expect: (_f: UnguardedRecord[]) => boolean }[] = [
    {
      name: 'a record inside a commit callback reports nothing',
      source: FIXED_SHAPE,
      expect: (f) => f.length === 0,
    },
    {
      name: 'record-before-write is reported (the motivating instance)',
      source: PRE_FIX_SHAPE,
      expect: (f) => f.length === 1 && f[0]?.method === 'recordEditResult',
    },
    {
      name: 'a bare commitEdit on the rollback path is reported',
      source: ROLLBACK_PRE_FIX_SHAPE,
      expect: (f) => f.length === 1 && f[0]?.method === 'commitEdit',
    },
    {
      name: 'a commit callback elsewhere in the method does not launder a bare call',
      source: NEARBY_COMMIT_SHAPE,
      expect: (f) => f.length === 1,
    },
  ];

  let failed = 0;
  for (const c of cases) {
    const ok = c.expect(findUnguardedRecords('probe.ts', c.source));
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${c.name}`);
    if (!ok) failed += 1;
  }

  // The real tree must be clean — the check the gate exists to make.
  const live = run(true);
  console.log(`${live === 0 ? 'PASS' : 'FAIL'}  this checkout records only inside transactions`);
  if (live !== 0) failed += 1;

  return failed === 0 ? 0 : 1;
}

function run(quiet = false): number {
  const files = typescriptFilesUnder(SCAN_ROOT);
  const findings: UnguardedRecord[] = [];
  let callsSeen = 0;

  for (const file of files) {
    const source = readFileSync(file, 'utf8');
    callsSeen += countRecordingCalls(source);
    findings.push(...findUnguardedRecords(path.relative(SERVER_ROOT, file), source));
  }

  // A null result needs a positive control. If the scan root moved or the methods were renamed,
  // every file would parse clean and this gate would pass having observed nothing at all.
  if (callsSeen === 0) {
    console.error(
      `✖ No call to ${RECORDING_METHODS.join(' or ')} found under ${path.relative(
        SERVER_ROOT,
        SCAN_ROOT
      )} — the probe cannot observe, so its silence is not evidence.`
    );
    return 1;
  }

  if (findings.length > 0) {
    for (const finding of findings) {
      console.error(
        `✖ ${finding.file}:${finding.line} calls ${finding.method}() outside a write ` +
          `transaction's \`commit\` callback`
      );
    }
    console.error(
      `\nA version record placed beside the file write rather than inside it can only choose a ` +
        `failure mode: a failed write leaves a row describing a state no file held, and a failed ` +
        `record leaves a file no row describes. Pass it to the writer as \`{ commit: async () => ` +
        `{ ... } }\` instead — see resource-mutation-transaction.ts.`
    );
    return 1;
  }

  if (!quiet) {
    console.log(
      `✅ Mutation atomicity: ${callsSeen} version record(s) across ${files.length} files, all ` +
        `inside a write transaction.`
    );
  }
  return 0;
}

// Guarded: `findUnguardedRecords` is exported, and a module-scope exit would terminate any
// process that imported it rather than running it.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exit(process.argv.includes('--self-test') ? selfTest() : run());
}
