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
 * ORPHANED DECLARATIONS FAIL THE CHECK, naming the file. `knip.json` credits every hand-written
 * `.d.ts` under `scripts/` and `eslint-rules/` as used, through recursive entry globs, because tsc
 * resolves a declaration beside the `.js` it describes and knip's graph cannot see that edge. The
 * glob cannot tell a live declaration from one whose module was deleted, so without this check an
 * orphan would never be reported by knip or counted here. The roots are read from `knip.json`
 * itself, so a new glob of that shape is covered without editing this file.
 *
 * Usage:
 * - Update baseline (intentional): `npm run knip-ratchet:baseline`
 * - Check (default in CI):          `npm run validate:knip-ratchet`
 * - Prove the comparison logic:     `npm run validate:knip-ratchet:self-test`
 */

import { existsSync, readdirSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';

const BASELINE_PATH = path.resolve(process.cwd(), '.knip-ratchet-baseline.json');
const KNIP_CONFIG_PATH = path.resolve(process.cwd(), 'knip.json');

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

/** The root of every `knip.json` entry that credits all `.d.ts` files beneath it. */
function declarationRootsFromKnipEntries(entries) {
  return (entries ?? [])
    .map((pattern) => /^(.+)\/\*\*\/\*\.d\.ts$/.exec(pattern)?.[1])
    .filter((root) => root !== undefined);
}

/** Declarations whose sibling `.js` does not exist. `exists` is injected to keep this pure. */
function findOrphanedDeclarations(declarationFiles, exists) {
  return declarationFiles.filter((file) => !exists(`${file.slice(0, -'.d.ts'.length)}.js`)).sort();
}

async function findOrphanedDeclarationsOnDisk() {
  const config = JSON.parse(await readFile(KNIP_CONFIG_PATH, 'utf8'));
  const declarations = declarationRootsFromKnipEntries(config.entry).flatMap((root) =>
    existsSync(root)
      ? readdirSync(root, { recursive: true })
          .filter((relative) => relative.endsWith('.d.ts'))
          .map((relative) => path.join(root, relative))
      : []
  );
  return findOrphanedDeclarations(declarations, existsSync);
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

/**
 * Parse repeatable `--allow-increase <key> <reason>` pairs from the argv tail.
 *
 * Shape kept identical across all three ratchets (eslint-ratchet.js, knip-ratchet.js,
 * typecheck-tests-ratchet.js) even though the logic is duplicated rather than shared: none of
 * the three currently import from a common `lib/` module, and this repo's existing convention
 * (each ratchet reimplements its own `compareSummaries`/`compare`) already accepts that
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
        '[knip-ratchet] --allow-increase requires two arguments: <category> "<reason>". ' +
          `Got: ${JSON.stringify(argv.slice(i, i + 3))}`
      );
    }
    overrides.set(key, reason);
    i += 2;
  }
  return overrides;
}

/**
 * A category's ceiling may only rise when the caller named it via `--allow-increase`.
 *
 * A category absent from the baseline compares against an implicit 0, so a brand-new category
 * with findings is an increase from zero and needs the same explicit override as any tracked
 * one. A category that disappears entirely compares against an implicit 0 on the CURRENT side,
 * which is a decrease — never an increase — so it never needs an override; `check()` already
 * reports that case as `vanished` (reporter-shape change) rather than progress.
 */
function findUnauthorizedIncreases(baselineByCategory, currentByCategory, overrides) {
  const increases = [];
  const allCategories = new Set([
    ...Object.keys(baselineByCategory ?? {}),
    ...Object.keys(currentByCategory ?? {}),
  ]);

  for (const category of allCategories) {
    const before = baselineByCategory?.[category] ?? 0;
    const after = currentByCategory?.[category] ?? 0;

    if (after > before && !overrides.has(category)) {
      increases.push({ category, before, after });
    }
  }

  return increases.sort((a, b) => a.category.localeCompare(b.category));
}

function formatRefusal(increases) {
  const example = increases[0];
  return [
    `[knip-ratchet] Refusing to update baseline: ${increases.length} categor${
      increases.length === 1 ? 'y' : 'ies'
    } would increase without an explicit override.`,
    '',
    'Lowering a ceiling is always free. Raising one requires naming the category:',
    ...increases.map((i) => `- ${i.category}: baseline=${i.before} current=${i.after}`),
    '',
    'To accept one of these intentionally, pass --allow-increase <category> "<reason>" for EACH',
    'category listed above (repeatable flag), e.g.:',
    `  npm run knip-ratchet:baseline -- --allow-increase ${example.category} "reason for the increase"`,
    '',
    'The reason is written into the committed baseline file (overrideLog), where a reviewer',
    'sees it in the same diff as the ceiling change.',
  ].join('\n');
}

async function writeBaseline(summary, { previousBaseline, overrides } = {}) {
  const generatedAt = new Date().toISOString();
  const overrideLog = [...(previousBaseline?.overrideLog ?? [])];

  for (const [category, reason] of overrides ?? []) {
    const before = previousBaseline?.byCategory?.[category] ?? 0;
    const after = summary.byCategory[category] ?? 0;
    const wasNeeded = after > before;
    if (wasNeeded) {
      overrideLog.push({ date: generatedAt, category, reason, before, after });
    } else {
      console.log(
        `[knip-ratchet] Note: --allow-increase ${category} was passed but ${category} did not ` +
          'increase this run; ignored.'
      );
    }
  }

  const baseline = {
    schemaVersion: 1,
    generatedAt,
    totals: summary.totals,
    byCategory: summary.byCategory,
    ...(overrideLog.length > 0 ? { overrideLog } : {}),
  };
  await writeFile(BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`, 'utf8');
}

function formatCategoryList(summary) {
  return Object.entries(summary.byCategory)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([category, count]) => `${category}=${count}`)
    .join(', ');
}

async function handleUpdateBaseline(argv) {
  const overrides = parseAllowIncreaseArgs(argv);
  const report = runKnip();
  const summary = summarizeKnipReport(report.issues);

  // No prior baseline (first run) leaves this null — nothing to compare against, nothing to refuse.
  let previousBaseline = null;
  try {
    previousBaseline = await loadBaselineOrThrow();
  } catch {
    // Keep the pre-initialized null.
  }

  if (previousBaseline) {
    const unauthorized = findUnauthorizedIncreases(
      previousBaseline.byCategory ?? {},
      summary.byCategory,
      overrides
    );
    if (unauthorized.length > 0) {
      throw new Error(formatRefusal(unauthorized));
    }
  }

  await writeBaseline(summary, { previousBaseline, overrides });
  console.log(
    `[knip-ratchet] Baseline updated: ${summary.totals.findings} findings (${formatCategoryList(summary)})`
  );
}

async function handleCheck() {
  const baseline = await loadBaselineOrThrow();
  const report = runKnip();
  const current = summarizeKnipReport(report.issues);
  const { regressions, vanished, decreases } = compareSummaries(baseline, current);
  const orphans = await findOrphanedDeclarationsOnDisk();

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

  if (regressions.length === 0 && vanished.length === 0 && orphans.length === 0) {
    console.log(
      `[knip-ratchet] OK: ${current.totals.findings} findings (no regressions)${decreaseLines.join('\n')}`
    );
    return;
  }

  const problems = regressions.length + vanished.length + orphans.length;
  const lines = [`[knip-ratchet] FAIL: ${problems} problem(s) detected.`];

  if (orphans.length > 0) {
    lines.push(
      '',
      'Declaration files knip.json credits as used, with no sibling .js (delete the ' +
        'declaration, or restore its module):',
      ...orphans.map((file) => `- ${file}`)
    );
  }

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

  // --- orphaned declarations --------------------------------------------------------------
  check(
    'a recursive .d.ts entry yields its root, and any other entry yields none',
    (() => {
      const roots = declarationRootsFromKnipEntries([
        'scripts/verify-handoff.mjs',
        'scripts/**/*.d.ts',
        'eslint-rules/**/*.d.ts',
      ]);
      return roots.length === 2 && roots[0] === 'scripts' && roots[1] === 'eslint-rules';
    })()
  );
  const syntheticDisk = new Set(['scripts/lib/paired.js']);
  const onSyntheticDisk = (file) => syntheticDisk.has(file);
  check(
    'a declaration with no sibling .js is an orphan, named by its path',
    (() => {
      const orphans = findOrphanedDeclarations(['scripts/zz-orphan.d.ts'], onSyntheticDisk);
      return orphans.length === 1 && orphans[0] === 'scripts/zz-orphan.d.ts';
    })()
  );
  check(
    'a declaration beside its .js is not an orphan',
    findOrphanedDeclarations(['scripts/lib/paired.d.ts'], onSyntheticDisk).length === 0
  );

  // --- baseline-increase guard (parseAllowIncreaseArgs / findUnauthorizedIncreases) --------
  check(
    'an unauthorized increase is refused, naming the category',
    (() => {
      const unauthorized = findUnauthorizedIncreases({ exports: 10 }, { exports: 12 }, new Map());
      return (
        unauthorized.length === 1 &&
        unauthorized[0].category === 'exports' &&
        unauthorized[0].before === 10 &&
        unauthorized[0].after === 12
      );
    })()
  );
  check(
    'a brand-new category with findings needs an override too (implicit baseline of 0)',
    findUnauthorizedIncreases({}, { brandNew: 4 }, new Map()).some(
      (i) => i.category === 'brandNew' && i.before === 0 && i.after === 4
    )
  );
  check(
    'an explicit override for the increasing category clears the refusal',
    findUnauthorizedIncreases({ exports: 10 }, { exports: 12 }, new Map([['exports', 'reason']]))
      .length === 0
  );
  check(
    'an override for an unrelated category does not clear a different increase',
    findUnauthorizedIncreases(
      { exports: 10, types: 5 },
      { exports: 12, types: 5 },
      new Map([['types', 'reason']])
    ).some((i) => i.category === 'exports')
  );
  check(
    'a category that disappears entirely is a decrease, never needs an override',
    findUnauthorizedIncreases({ retiring: 3 }, {}, new Map()).length === 0
  );
  check(
    'a decrease never needs an override',
    findUnauthorizedIncreases({ exports: 10 }, { exports: 5 }, new Map()).length === 0
  );
  check(
    'parseAllowIncreaseArgs reads repeatable --allow-increase <key> <reason> pairs',
    (() => {
      const overrides = parseAllowIncreaseArgs([
        '--allow-increase',
        'exports',
        'reason one',
        '--allow-increase',
        'types',
        'reason two',
      ]);
      return (
        overrides.size === 2 &&
        overrides.get('exports') === 'reason one' &&
        overrides.get('types') === 'reason two'
      );
    })()
  );
  check(
    'parseAllowIncreaseArgs throws when a pair is incomplete',
    (() => {
      try {
        parseAllowIncreaseArgs(['--allow-increase', 'exports']);
        return false;
      } catch (error) {
        return error instanceof Error && error.message.includes('--allow-increase');
      }
    })()
  );

  if (failures > 0) {
    console.error(`\n❌ self-test: ${failures} case(s) failed`);
    process.exitCode = 1;
    return;
  }
  console.log(
    '\n✅ self-test: summarize counts per-category correctly (symbol-level, group-level ' +
      'duplicates, derived categories), compare distinguishes regressions/decreases/vanished, an ' +
      'orphaned declaration is named, and the baseline-increase guard refuses an unauthorized ' +
      'rise while an explicit --allow-increase override clears it\n'
  );
}

const mode = process.argv[2] ?? 'check';

try {
  if (process.argv.includes('--self-test')) {
    runSelfTest();
  } else if (mode === 'update-baseline') {
    await handleUpdateBaseline(process.argv.slice(3));
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
