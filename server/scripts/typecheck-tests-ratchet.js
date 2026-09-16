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

/**
 * `--pretty false` is load-bearing, not cosmetic.
 *
 * Pretty output wraps the file path and the word `error` in ANSI escapes and switches the
 * position separator from `file(12,34):` to `file:12:34 -`. Both patterns above then match
 * NOTHING, so `summarize()` returns an empty `byFile` — and an empty parse is
 * indistinguishable from a clean backlog unless something checks. Measured 2026-08-14 on
 * TypeScript 6.0.3: a shell exporting `FORCE_COLOR=3` makes tsc emit pretty output even
 * through a pipe, at which point `check` reports all 70 baselined files as "absent" and
 * `update-baseline` writes `0 errors across 0 files` — destroying a 381-error ceiling and
 * blinding the gate permanently. CI never exports it, so this failed only on developer
 * machines, which is the worst place for it: the remedy the failure text recommends is the
 * thing that does the damage.
 *
 * The env is scrubbed as well as the flag passed. Either alone would do today; both means a
 * future default flip on one channel cannot re-open it through the other.
 */
function runTsc() {
  const env = { ...process.env };
  delete env.FORCE_COLOR;
  const result = spawnSync(
    getTscBinPath(),
    ['--noEmit', '--pretty', 'false', '--project', PROJECT],
    {
      encoding: 'utf8',
      maxBuffer: 64 * 1024 * 1024,
      env,
    }
  );

  if (result.error) {
    throw new Error(`[typecheck-tests-ratchet] Failed to run tsc: ${result.error.message}`);
  }

  return {
    output: `${result.stdout ?? ''}${result.stderr ?? ''}`,
    exitCode: result.status ?? 0,
  };
}

/**
 * Distinguish "read nothing" from "there was nothing to read".
 *
 * The FATAL_PATTERN guard above covers a compiler that stopped early with a config error.
 * It does not cover a compiler that ran fine and produced output this script cannot parse,
 * because that output does not match FATAL_PATTERN either — the ANSI case defeated both
 * guards at once. This check needs no knowledge of what went wrong: tsc exiting non-zero
 * means it had something to say, so parsing zero diagnostics AND zero fatals from a
 * non-empty stream means the parser, not the codebase, is the thing that changed.
 */
function assertParsed(summary, fatals, tscOutput, exitCode) {
  const parsedNothing = summary.totals.errors === 0 && fatals.length === 0;
  const tscComplained = exitCode !== 0 && tscOutput.trim().length > 0;
  if (parsedNothing && tscComplained) {
    throw new Error(
      `[typecheck-tests-ratchet] tsc exited ${exitCode} with ${tscOutput.split('\n').length} ` +
        'line(s) of output, but no diagnostic matched the parser. That is a parse failure, ' +
        'not a clean backlog — refusing to report or baseline it. First line was:\n  ' +
        JSON.stringify(tscOutput.split('\n').find((l) => l.trim().length > 0) ?? '')
    );
  }
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

/**
 * Parse repeatable `--allow-increase <key> <reason>` pairs from the argv tail.
 *
 * Shape kept identical across all three ratchets (eslint-ratchet.js, knip-ratchet.js,
 * typecheck-tests-ratchet.js) even though the logic is duplicated rather than shared: none of
 * the three currently import from a common `lib/` module, and this repo's existing convention
 * (each ratchet reimplements its own `compare`/`compareSummaries`) already accepts that
 * duplication over introducing a new shared module for three call sites.
 */
function parseAllowIncreaseArgs(argv) {
  const overrides = new Map();
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] !== '--allow-increase') continue;
    const key = argv[i + 1];
    const reason = argv[i + 2];
    if (!key || !reason || key.startsWith('--') || reason.startsWith('--')) {
      throw new Error(
        '[typecheck-tests-ratchet] --allow-increase requires two arguments: <file> "<reason>". ' +
          `Got: ${JSON.stringify(argv.slice(i, i + 3))}`
      );
    }
    overrides.set(key, reason);
    i += 2;
  }
  return overrides;
}

/**
 * A file's ceiling may only rise when the caller named it via `--allow-increase`.
 *
 * A file absent from the baseline compares against an implicit 0, so a file that starts failing
 * for the first time is an increase from zero and needs the same explicit override as a file
 * whose count grew. A file that disappears entirely compares against an implicit 0 on the
 * CURRENT side, which is a decrease — never an increase — so it never needs an override;
 * `check()` already reports that case as `vanished` (left the compiler's view) separately from
 * progress.
 */
function findUnauthorizedIncreases(baselineByFile, currentByFile, overrides) {
  const increases = [];
  const allFiles = new Set([
    ...Object.keys(baselineByFile ?? {}),
    ...Object.keys(currentByFile ?? {}),
  ]);

  for (const file of allFiles) {
    const before = baselineByFile?.[file] ?? 0;
    const after = currentByFile?.[file] ?? 0;

    if (after > before && !overrides.has(file)) {
      increases.push({ file, before, after });
    }
  }

  return increases.sort((a, b) => a.file.localeCompare(b.file));
}

function formatRefusal(increases) {
  const example = increases[0];
  return [
    `[typecheck-tests-ratchet] Refusing to update baseline: ${increases.length} file(s) would ` +
      'increase without an explicit override.',
    '',
    'Lowering a ceiling is always free. Raising one requires naming the file:',
    ...increases.map((i) => `- ${i.file}: baseline=${i.before} current=${i.after}`),
    '',
    'To accept one of these intentionally, pass --allow-increase <file> "<reason>" for EACH file',
    'listed above (repeatable flag), e.g.:',
    '  npm run typecheck:tests:ratchet:baseline -- --allow-increase ' +
      `${example.file} "reason for the increase"`,
    '',
    'The reason is written into the committed baseline file (overrideLog), where a reviewer',
    'sees it in the same diff as the ceiling change.',
  ].join('\n');
}

async function handleUpdateBaseline(argv) {
  const overrides = parseAllowIncreaseArgs(argv);
  const { output, exitCode } = runTsc();
  const { summary, fatals } = summarize(output);
  assertParsed(summary, fatals, output, exitCode);
  assertNoFatals(fatals);

  // No prior baseline (first run) leaves this null — nothing to compare against, nothing to refuse.
  let previousBaseline = null;
  try {
    previousBaseline = await loadJson(BASELINE_PATH);
  } catch {
    // Keep the pre-initialized null.
  }

  if (previousBaseline) {
    const unauthorized = findUnauthorizedIncreases(
      previousBaseline.byFile ?? {},
      summary.byFile,
      overrides
    );
    if (unauthorized.length > 0) {
      throw new Error(formatRefusal(unauthorized));
    }
  }

  const generatedAt = new Date().toISOString();
  const overrideLog = [...(previousBaseline?.overrideLog ?? [])];
  for (const [file, reason] of overrides) {
    const before = previousBaseline?.byFile?.[file] ?? 0;
    const after = summary.byFile[file] ?? 0;
    const wasNeeded = after > before;
    if (wasNeeded) {
      overrideLog.push({ date: generatedAt, file, reason, before, after });
    } else {
      console.log(
        `[typecheck-tests-ratchet] Note: --allow-increase ${file} was passed but ${file} did ` +
          'not increase this run; ignored.'
      );
    }
  }

  const baseline = {
    schemaVersion: 1,
    generatedAt,
    project: PROJECT,
    scope: 'tests/',
    totals: summary.totals,
    byCode: sortedByKey(summary.byCode),
    byFile: sortedByKey(summary.byFile),
    ...(overrideLog.length > 0 ? { overrideLog } : {}),
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

  const { output, exitCode } = runTsc();
  const { summary, fatals } = summarize(output);
  assertParsed(summary, fatals, output, exitCode);
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
    await handleUpdateBaseline(process.argv.slice(3));
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
