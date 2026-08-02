// @lifecycle canonical - Prevents test-suite type debt from increasing (ratchet).
/**
 * Test Typecheck Ratchet
 *
 * `tsconfig.json` excludes `tests/`, so `npm run typecheck` cannot see a broken test
 * call site — only Jest can, and only for the paths a test actually executes. That gap
 * let two pipeline constructor changes land green while their test files were already
 * uncompilable.
 *
 * `tsconfig.test.json` closes the visibility gap but reports a large existing backlog,
 * so it cannot simply be added to CI. This ratchet does what `eslint-ratchet.js` does
 * for lint: compare per-file diagnostic counts against a committed baseline and fail
 * only when a count increases, allowing the backlog to be paid down incrementally.
 *
 * Usage:
 * - Update baseline (intentional): `npm run typecheck:tests:ratchet:baseline`
 * - Check (default in CI):         `npm run typecheck:tests:ratchet`
 */

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';

const BASELINE_PATH = path.resolve(process.cwd(), '.typecheck-tests-ratchet-baseline.json');
const PROJECT = 'tsconfig.test.json';

/** `path/to/file.ts(12,34): error TS1234: message` */
const DIAGNOSTIC_PATTERN = /^(?<file>[^(]+)\((?<line>\d+),(?<col>\d+)\): error (?<code>TS\d+): /;

/**
 * A diagnostic with no file position — `error TS5083: Cannot read file ...`.
 *
 * These are configuration failures, not type errors. They matter because tsc stops
 * before it type-checks anything, so the run reports few or no per-file diagnostics and
 * the ratchet would read a dead compiler as a cleared backlog.
 */
const FATAL_PATTERN = /^error (?<code>TS\d+): /;

function getTscBinPath() {
  const binName = process.platform === 'win32' ? 'tsc.cmd' : 'tsc';
  return path.resolve(process.cwd(), 'node_modules', '.bin', binName);
}

function runTsc() {
  const result = spawnSync(getTscBinPath(), ['--noEmit', '--project', PROJECT], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });

  if (result.error) {
    throw new Error(`[typecheck-tests-ratchet] Failed to run tsc: ${result.error.message}`);
  }

  return `${result.stdout ?? ''}${result.stderr ?? ''}`;
}

/**
 * Bucket diagnostics by file.
 *
 * By file rather than by error code: the point is to stop a newly broken test file from
 * landing, and a per-code total would let a new TS2554 in one file hide behind a fixed
 * TS2554 in another. Codes are still summarized, for the report only.
 *
 * Only `tests/` is counted. `tsconfig.test.json` also includes `src/`, which
 * `npm run typecheck` already checks against the stricter build config — counting it
 * here would double-report it and couple this baseline to unrelated source changes.
 */
function summarize(tscOutput) {
  const summary = { totals: { errors: 0 }, byFile: {}, byCode: {} };
  const fatals = [];

  for (const rawLine of tscOutput.split('\n')) {
    const line = rawLine.trimEnd();
    if (line.length === 0) continue;

    const diagnostic = DIAGNOSTIC_PATTERN.exec(line);
    if (diagnostic === null) {
      if (FATAL_PATTERN.test(line)) fatals.push(line);
      continue;
    }

    const file = diagnostic.groups.file.split(path.sep).join('/');
    if (!file.startsWith('tests/')) continue;

    const code = diagnostic.groups.code;
    summary.totals.errors += 1;
    summary.byFile[file] = (summary.byFile[file] ?? 0) + 1;
    summary.byCode[code] = (summary.byCode[code] ?? 0) + 1;
  }

  return { summary, fatals };
}

/**
 * Compare a baseline against the current run.
 *
 * `regressions` — a file's count went up, or a file not in the baseline reported at all.
 * `vanished`    — a file the baseline tracked produced no diagnostics.
 *
 * The second finding exists for the same reason it does in `eslint-ratchet.js`: zero is
 * not greater than N, so a file that stops being checked reads as a file that was fixed.
 * A test file can leave the compiler's view by being renamed, deleted, or dropped from
 * the `include` globs, and the totals fall in every case. Both readings are reported
 * because counts alone cannot separate them.
 */
function compare(baseline, current) {
  const regressions = [];
  const vanished = [];

  const baselineByFile = baseline.byFile ?? {};
  const currentByFile = current.byFile ?? {};

  for (const file of new Set([...Object.keys(baselineByFile), ...Object.keys(currentByFile)])) {
    const before = baselineByFile[file] ?? 0;
    const after = currentByFile[file] ?? 0;

    if (after > before) {
      regressions.push({ file, baseline: before, current: after });
    } else if (before > 0 && !Object.hasOwn(currentByFile, file)) {
      vanished.push({ file, baseline: before });
    }
  }

  return { regressions, vanished };
}

async function loadJson(filePath) {
  return JSON.parse(await readFile(filePath, 'utf8'));
}

function sortedByKey(record) {
  return Object.fromEntries(Object.entries(record).sort(([a], [b]) => a.localeCompare(b)));
}

function assertNoFatals(fatals) {
  if (fatals.length === 0) return;

  throw new Error(
    [
      `[typecheck-tests-ratchet] tsc reported ${fatals.length} configuration error(s) and did not`,
      'finish type-checking. The per-file counts from this run are meaningless — treating them',
      'as a result would record the dead compiler as a cleared backlog.',
      '',
      ...fatals.map((line) => `  ${line}`),
    ].join('\n')
  );
}

async function handleUpdateBaseline() {
  const { summary, fatals } = summarize(runTsc());
  assertNoFatals(fatals);

  const baseline = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    project: PROJECT,
    scope: 'tests/',
    totals: summary.totals,
    byCode: sortedByKey(summary.byCode),
    byFile: sortedByKey(summary.byFile),
  };

  await writeFile(BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`, 'utf8');
  console.log(
    `[typecheck-tests-ratchet] Baseline updated: ${summary.totals.errors} errors across ${
      Object.keys(summary.byFile).length
    } files`
  );
}

async function handleCheck() {
  let baseline;
  try {
    baseline = await loadJson(BASELINE_PATH);
  } catch {
    throw new Error(
      `[typecheck-tests-ratchet] Missing baseline at ${path.relative(process.cwd(), BASELINE_PATH)}. Run: npm run typecheck:tests:ratchet:baseline`
    );
  }

  const { summary, fatals } = summarize(runTsc());
  assertNoFatals(fatals);

  const { regressions, vanished } = compare(baseline, summary);
  if (regressions.length === 0 && vanished.length === 0) {
    console.log(
      `[typecheck-tests-ratchet] OK: ${summary.totals.errors} errors in tests/ (no regressions)`
    );
    return;
  }

  const lines = [
    `[typecheck-tests-ratchet] FAIL: ${regressions.length + vanished.length} file problems detected.`,
  ];

  if (regressions.length > 0) {
    lines.push(
      '',
      'Files whose type errors increased (fix these, or regenerate the baseline deliberately):',
      ...regressions
        .sort((a, b) => a.file.localeCompare(b.file))
        .map(
          (r) =>
            `- ${r.file}: baseline=${r.baseline} current=${r.current} (+${r.current - r.baseline})`
        ),
      '',
      `Reproduce with: npx tsc --noEmit --project ${PROJECT}`
    );
  }

  if (vanished.length > 0) {
    lines.push(
      '',
      'Files the baseline tracked that reported nothing this run:',
      ...vanished
        .sort((a, b) => a.file.localeCompare(b.file))
        .map((r) => `- ${r.file}: baseline=${r.baseline} -> absent`),
      '',
      'Two readings, and the counts cannot tell them apart:',
      '  1. The errors were fixed, or the file was intentionally deleted. Good — run',
      '     `npm run typecheck:tests:ratchet:baseline` to lock it in.',
      "  2. The file left the compiler's view (renamed, or dropped from the `include` globs",
      `     in ${PROJECT}). Its type debt is still there and nothing is watching it.`,
      'A rename is case 2 even though it looks like case 1: move the baseline key rather',
      'than regenerating, so the count carries over to the new path.'
    );
  }

  console.error(lines.join('\n'));
  process.exitCode = 1;
}

const mode = process.argv[2] ?? 'check';

try {
  if (mode === 'update-baseline') {
    await handleUpdateBaseline();
  } else if (mode === 'check') {
    await handleCheck();
  } else {
    throw new Error(
      `[typecheck-tests-ratchet] Unknown mode "${mode}". Expected: "check" or "update-baseline".`
    );
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
