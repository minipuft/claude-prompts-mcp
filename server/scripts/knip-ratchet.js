#!/usr/bin/env node
// @lifecycle canonical - Prevents knip debt (unused exports/files/types) from increasing (ratchet).
/**
 * Knip Ratchet
 *
 * `npm run lint:unused` (`npx knip --reporter compact`) reports the project's unused-export
 * debt but is not a member of `validate:all` — CLAUDE.md's "declared and never consumed" gate
 * family covers "declared and never called" (`validate:state-field-writers`,
 * `validate:no-phantom-columns`) but not "declared and never imported" until this file.
 * Measured 2026-08-17: knip's report currently finds unused exports/types across
 * `src/shared/types/**`, `src/shared/utils/**` and more, plus 1 duplicate export. Enabling
 * `lint:unused` as a straight pass/fail would fail `validate:all` on day one over a backlog
 * unrelated to whatever change triggered the run — the same problem `eslint-ratchet.js` and
 * `typecheck-tests-ratchet.js` already solved for lint and test-type debt.
 *
 * SAME SHAPE AS `eslint-ratchet.js`: run the tool's JSON reporter, sum findings PER CATEGORY,
 * compare against a committed baseline, and fail only when a category's count increases.
 * Categories are knip's own issue-type vocabulary (`exports`, `types`, `files`, `duplicates`,
 * `dependencies`, `unlisted`, ...) derived from whatever keys the report actually contains —
 * not a hardcoded list — so a knip upgrade that adds a category is counted rather than
 * silently ignored, the same reasoning `eslint-ratchet.js` applies to `byRule`.
 *
 * CATEGORY COUNT, NOT FILE COUNT. Knip's own `compact`/`symbols` reporter headers
 * ("Unused exports (120)") are FILE counts, not finding counts — measured 2026-08-17: 120
 * files carry 498 flagged export symbols between them, and "Unused exported types (136)"
 * is 136 files carrying 679 symbols. A ratchet keyed on the file count would let a file that
 * already has one finding accumulate nine more silently, because the file was already
 * "counted". Keying on the symbol-level total (summing every category array's length across
 * every issue entry) closes that gap the same way `eslint-ratchet.js` counts individual
 * violations, not files.
 *
 * `--self-test` proves the summarize/compare logic against synthetic knip JSON, not the real
 * report — a regression in the comparison logic must fail even when the codebase itself has no
 * new debt, and running the real `knip` binary in a unit-test-shaped check would make the test
 * as slow and as environment-dependent as the gate it is supposed to protect.
 *
 * DECREASES ARE REPORTED EXPLICITLY, unlike `eslint-ratchet.js`/`typecheck-tests-ratchet.js`
 * (neither prints anything when a rule/file's count drops). A ratchet nobody tightens is a
 * floor wearing a ratchet's name, so `check` always surfaces every category whose count
 * dropped since the baseline was recorded, with the regeneration command, whether or not the
 * run otherwise passes.
 *
 * Usage:
 * - Update baseline (intentional): `npm run knip-ratchet:baseline`
 * - Check (default in CI):          `npm run validate:knip-ratchet`
 * - Prove the comparison logic:     `npm run validate:knip-ratchet:self-test`
 */

import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';

const BASELINE_PATH = path.resolve(process.cwd(), '.knip-ratchet-baseline.json');

function getKnipBinPath() {
  const binName = process.platform === 'win32' ? 'knip.cmd' : 'knip';
  return path.resolve(process.cwd(), 'node_modules', '.bin', binName);
}

/**
 * Run knip's JSON reporter and return the parsed report.
 *
 * `--reporter json --no-progress` writes clean JSON to stdout with no leading/trailing prose
 * (verified 2026-08-17 — the default `symbols` reporter's progress bar only appears in a TTY,
 * but `--no-progress` is passed explicitly rather than relying on non-TTY detection, the same
 * belt-and-suspenders reasoning `typecheck-tests-ratchet.js` applies to `--pretty false`).
 *
 * Exit codes: 0 -> no issues, 1 -> issues found, anything else -> knip itself failed to run
 * (bad config, crash). That must throw rather than be read as a report — an empty result from
 * a dead process is indistinguishable from a clean codebase unless something checks.
 */
function runKnip() {
  const knipBin = getKnipBinPath();
  const result = spawnSync(knipBin, ['--reporter', 'json', '--no-progress'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });

  if (result.error) {
    throw new Error(`[knip-ratchet] Failed to run knip: ${result.error.message}`);
  }
  if (result.status !== 0 && result.status !== 1) {
    throw new Error(
      `[knip-ratchet] knip failed to run (exit code ${result.status}). stderr:\n${result.stderr ?? ''}`
    );
  }

  let report;
  try {
    report = JSON.parse(result.stdout);
  } catch {
    throw new Error(
      `[knip-ratchet] knip exited ${result.status} but stdout did not parse as JSON — refusing ` +
        `to read that as a clean report. First 200 chars: ${JSON.stringify(result.stdout.slice(0, 200))}`
    );
  }
  if (!Array.isArray(report.issues)) {
    throw new Error(
      '[knip-ratchet] knip JSON report has no "issues" array — the reporter shape changed.'
    );
  }
  return report;
}

/**
 * Sum findings per category across every file entry knip reported.
 *
 * Iterates every array-valued key on each issue entry except `file` — knip's own vocabulary,
 * rather than a hardcoded list, so a category this file has never named is still counted (a
 * knip upgrade adding one is picked up automatically). `duplicates` is an array of GROUPS
 * (each entry a group of co-exported symbol positions); one group counts as one finding here,
 * consistent with every other category counting one array element as one finding — the group
 * is the unit a developer resolves, not the individual symbols inside it.
 */
function summarizeKnipReport(issues) {
  const byCategory = {};
  for (const entry of issues) {
    for (const [key, value] of Object.entries(entry)) {
      if (key === 'file' || !Array.isArray(value)) continue;
      byCategory[key] = (byCategory[key] ?? 0) + value.length;
    }
  }
  const totalFindings = Object.values(byCategory).reduce((sum, count) => sum + count, 0);
  return { totals: { findings: totalFindings }, byCategory };
}

/**
 * Compare a baseline summary against the current one.
 *
 * Three independent findings:
 *
 * - `regressions` — a category's count went UP (including a category with no baseline entry
 *   at all, which compares against an implicit 0). The original purpose of the ratchet.
 * - `vanished`    — a category the baseline knew about, with findings, produced no key at all
 *   in this run. Knip's issue-type vocabulary is a fixed schema, so this firing means the
 *   reporter shape itself changed (a category renamed or removed) rather than a normal debt
 *   entry reaching zero — the same "0 is not greater than N" blind spot `eslint-ratchet.js`
 *   guards against for a lint rule that stops loading.
 * - `decreases`   — a category's count went DOWN but the key still reports (possibly at 0).
 *   Surfaced on every run, pass or fail, so the baseline gets tightened instead of sitting as
 *   a permanent ceiling.
 */
function compareSummaries(baseline, current) {
  const regressions = [];
  const vanished = [];
  const decreases = [];

  const baselineCategories = baseline.byCategory ?? {};
  const currentCategories = current.byCategory ?? {};
  const allCategories = new Set([
    ...Object.keys(baselineCategories),
    ...Object.keys(currentCategories),
  ]);

  for (const category of allCategories) {
    const before = baselineCategories[category] ?? 0;
    const after = currentCategories[category] ?? 0;
    const wasTracked = Object.hasOwn(baselineCategories, category);
    const stillReports = Object.hasOwn(currentCategories, category);

    if (wasTracked && !stillReports && before > 0) {
      vanished.push({ category, baseline: before });
      continue;
    }

    if (after > before) {
      regressions.push({ category, baseline: before, current: after });
    } else if (after < before) {
      decreases.push({ category, baseline: before, current: after });
    }
  }

  return { regressions, vanished, decreases };
}

async function loadBaselineOrThrow() {
  try {
    return JSON.parse(await readFile(BASELINE_PATH, 'utf8'));
  } catch {
    throw new Error(
      `[knip-ratchet] Missing baseline at ${path.relative(process.cwd(), BASELINE_PATH)}. ` +
        'Run: npm run knip-ratchet:baseline'
    );
  }
}

async function writeBaseline(summary) {
  const baseline = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    totals: summary.totals,
    byCategory: summary.byCategory,
  };
  await writeFile(BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`, 'utf8');
}

function formatCategoryList(summary) {
  return Object.entries(summary.byCategory)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([category, count]) => `${category}=${count}`)
    .join(', ');
}

async function handleUpdateBaseline() {
  const report = runKnip();
  const summary = summarizeKnipReport(report.issues);
  await writeBaseline(summary);
  console.log(
    `[knip-ratchet] Baseline updated: ${summary.totals.findings} findings (${formatCategoryList(summary)})`
  );
}

async function handleCheck() {
  const baseline = await loadBaselineOrThrow();
  const report = runKnip();
  const current = summarizeKnipReport(report.issues);
  const { regressions, vanished, decreases } = compareSummaries(baseline, current);

  const decreaseLines =
    decreases.length === 0
      ? []
      : [
          '',
          `${decreases.length} categor${decreases.length === 1 ? 'y' : 'ies'} improved since the baseline was recorded:`,
          ...decreases
            .sort((a, b) => a.category.localeCompare(b.category))
            .map(
              (d) =>
                `- ${d.category}: baseline=${d.baseline} current=${d.current} (-${d.baseline - d.current})`
            ),
          '',
          'A ratchet nobody tightens is a floor, not a ratchet — run ' +
            '`npm run knip-ratchet:baseline` to lock these in.',
        ];

  if (regressions.length === 0 && vanished.length === 0) {
    console.log(
      `[knip-ratchet] OK: ${current.totals.findings} findings (no regressions)${decreaseLines.join('\n')}`
    );
    return;
  }

  const problems = regressions.length + vanished.length;
  const lines = [`[knip-ratchet] FAIL: ${problems} category problem(s) detected.`];

  if (regressions.length > 0) {
    lines.push(
      '',
      'Categories that increased (fix these or intentionally regenerate the baseline):',
      ...regressions
        .sort((a, b) => a.category.localeCompare(b.category))
        .map(
          (r) =>
            `- ${r.category}: baseline=${r.baseline} current=${r.current} (+${r.current - r.baseline})`
        )
    );
  }

  if (vanished.length > 0) {
    lines.push(
      '',
      'Categories the baseline tracked that reported nothing this run (the knip reporter ' +
        "shape likely changed — verify before trusting a clean read; this isn't a normal " +
        'debt-paid-down decrease, see byCategory in the JSON report):',
      ...vanished
        .sort((a, b) => a.category.localeCompare(b.category))
        .map((v) => `- ${v.category}: baseline=${v.baseline} -> absent`)
    );
  }

  lines.push(...decreaseLines);

  console.error(lines.join('\n'));
  process.exitCode = 1;
}

/**
 * Prove the summarize/compare logic on synthetic data — never spawns the real `knip` binary,
 * so this stays fast and deterministic regardless of the codebase's actual debt.
 */
function runSelfTest() {
  console.log('\nknip-ratchet self-test — summarize + compare logic on synthetic data\n');
  let failures = 0;
  const check = (label, condition) => {
    console.log(`  ${condition ? 'ok  ' : 'FAIL'}  ${label}`);
    if (!condition) failures += 1;
  };

  // --- summarizeKnipReport ---------------------------------------------------------------
  const syntheticIssues = [
    { file: 'a.ts', exports: [{ name: 'x' }, { name: 'y' }], types: [], duplicates: [], files: [] },
    {
      file: 'b.ts',
      exports: [{ name: 'z' }],
      types: [{ name: 'T' }],
      duplicates: [[{ name: 'p' }, { name: 'q' }]],
      files: [],
    },
    { file: 'c.ts', exports: [], types: [], duplicates: [], files: [{ name: 'c.ts' }] },
    // A category this script has never named — proves categories are derived, not hardcoded.
    {
      file: 'd.ts',
      exports: [],
      types: [],
      duplicates: [],
      files: [],
      futureCategory: [{ name: 'w' }],
    },
  ];
  const summary = summarizeKnipReport(syntheticIssues);

  check(
    'exports counted at the symbol level (3), not the file level (2)',
    summary.byCategory.exports === 3
  );
  check('types counted correctly', summary.byCategory.types === 1);
  check(
    'a duplicate GROUP counts as 1 finding, not 2 members',
    summary.byCategory.duplicates === 1
  );
  check('unused files counted correctly', summary.byCategory.files === 1);
  check(
    'an undeclared category key is still counted (derived, not hardcoded)',
    summary.byCategory.futureCategory === 1
  );
  check('totals.findings sums every category', summary.totals.findings === 3 + 1 + 1 + 1 + 1);

  // --- compareSummaries -------------------------------------------------------------------
  const baseline = { byCategory: { exports: 10, types: 5, files: 2, duplicates: 1, retiring: 3 } };
  const current = {
    byCategory: { exports: 12, types: 5, files: 1, duplicates: 1 /* retiring absent */ },
  };
  const { regressions, vanished, decreases } = compareSummaries(baseline, current);

  check(
    'a category whose count went up is a regression',
    regressions.some((r) => r.category === 'exports' && r.baseline === 10 && r.current === 12)
  );
  check(
    'an unchanged category produces neither a regression nor a decrease',
    !regressions.some((r) => r.category === 'types') &&
      !decreases.some((d) => d.category === 'types')
  );
  check(
    'a category whose count dropped but still reports is a decrease, not a regression',
    decreases.some((d) => d.category === 'files' && d.baseline === 2 && d.current === 1) &&
      !regressions.some((r) => r.category === 'files')
  );
  check(
    'a category the baseline tracked that stopped reporting entirely is vanished, not a decrease',
    vanished.some((v) => v.category === 'retiring' && v.baseline === 3) &&
      !decreases.some((d) => d.category === 'retiring')
  );
  check(
    'a brand-new category with findings is a regression against an implicit baseline of 0',
    (() => {
      const { regressions: brandNewRegressions } = compareSummaries(
        { byCategory: {} },
        { byCategory: { brandNew: 4 } }
      );
      return brandNewRegressions.some(
        (r) => r.category === 'brandNew' && r.baseline === 0 && r.current === 4
      );
    })()
  );
  check(
    'an equal baseline and current produce no findings at all',
    (() => {
      const equalResult = compareSummaries(
        { byCategory: { exports: 5 } },
        { byCategory: { exports: 5 } }
      );
      return (
        equalResult.regressions.length === 0 &&
        equalResult.vanished.length === 0 &&
        equalResult.decreases.length === 0
      );
    })()
  );

  if (failures > 0) {
    console.error(`\n❌ self-test: ${failures} case(s) failed`);
    process.exitCode = 1;
    return;
  }
  console.log(
    '\n✅ self-test: summarize counts per-category correctly (symbol-level, group-level ' +
      'duplicates, derived categories) and compare distinguishes regressions/decreases/vanished\n'
  );
}

const mode = process.argv[2] ?? 'check';

try {
  if (process.argv.includes('--self-test')) {
    runSelfTest();
  } else if (mode === 'update-baseline') {
    await handleUpdateBaseline();
  } else if (mode === 'check') {
    await handleCheck();
  } else {
    throw new Error(
      `[knip-ratchet] Unknown mode "${mode}". Expected: "check", "update-baseline", or "--self-test".`
    );
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
