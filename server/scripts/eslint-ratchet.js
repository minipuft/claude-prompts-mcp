// @lifecycle canonical - Prevents ESLint debt from increasing (ratchet).
/**
 * ESLint Ratchet
 *
 * Goal: allow incremental cleanup by preventing new lint violations from being introduced
 * while the existing backlog is paid down.
 *
 * The ratchet compares the current lint error/warn counts (by ruleId) against a committed
 * baseline and fails if any rule count increases.
 *
 * Usage:
 * - Update baseline (intentional): `npm run lint:ratchet:baseline`
 * - Check (default in CI):        `npm run lint:ratchet`
 */

import { readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';

const BASELINE_PATH = path.resolve(process.cwd(), '.eslint-ratchet-baseline.json');

function getEslintBinPath() {
  const binName = process.platform === 'win32' ? 'eslint.cmd' : 'eslint';
  return path.resolve(process.cwd(), 'node_modules', '.bin', binName);
}

/**
 * What the ratchet lints.
 *
 * `scripts` and `eslint-rules` were added 2026-08-11 (row 4.5). The target was `src` alone, so the
 * only gate that runs ESLint could not see the directory where this repo keeps its **gates** — and
 * `npm run lint` (`eslint .`), which does see it, is not a member of the validation suite. Two
 * consequences, both live at the time:
 *
 *   - 15 errors sat in `scripts/` reported by nothing, 13 of them caused by a config gap rather
 *     than by code: `scripts/**\/*.ts` had no parser block, so every TypeScript gate failed to
 *     parse and was silently unlinted in full.
 *   - Both ESLint rules this plan ADDED as gates — `claude/require-guard-mechanism-verdict` and
 *     `claude/require-exception-audit` — are scoped to `scripts/`, so neither was enforced by
 *     anything. A rule that fires correctly and is never run is not a gate.
 *
 * Keep this in sync with `eslintTarget` in the baseline; `check` fails loudly when they diverge,
 * because a baseline measured over a different file set is not a baseline.
 */
const ESLINT_TARGETS = ['src', 'scripts', 'eslint-rules'];

function runEslintJsonReport() {
  const reportPath = path.join(os.tmpdir(), `eslint-ratchet-${Date.now()}.json`);
  const eslintBin = getEslintBinPath();

  const result = spawnSync(
    eslintBin,
    [...ESLINT_TARGETS, '--format', 'json', '--output-file', reportPath],
    {
      stdio: 'inherit',
      encoding: 'utf8',
    }
  );

  // ESLint exit codes:
  // 0 -> no problems
  // 1 -> lint problems found
  // 2 -> config/runtime error (should fail)
  if (result.status !== 0 && result.status !== 1) {
    const detail =
      typeof result.status === 'number' ? `exit code ${result.status}` : 'unknown failure';
    throw new Error(`ESLint failed to run (${detail}).`);
  }

  return reportPath;
}

function summarizeEslintReport(results) {
  const summary = {
    totals: { errors: 0, warnings: 0 },
    byRule: {},
  };

  for (const fileResult of results) {
    for (const message of fileResult.messages ?? []) {
      const ruleId = message.ruleId ?? '__unknown__';
      const severity = message.severity ?? 0;

      if (!summary.byRule[ruleId]) {
        summary.byRule[ruleId] = { errors: 0, warnings: 0 };
      }

      if (severity === 2) {
        summary.totals.errors += 1;
        summary.byRule[ruleId].errors += 1;
      } else if (severity === 1) {
        summary.totals.warnings += 1;
        summary.byRule[ruleId].warnings += 1;
      }
    }
  }

  return summary;
}

/**
 * Compare a baseline summary against the current one.
 *
 * Returns two independent findings:
 *
 * - `regressions` — a rule's count went UP. The original purpose of the ratchet.
 * - `vanished`    — a rule the baseline knew about produced no report at all.
 *
 * The second exists because the first cannot see it. A rule that stops running reports
 * zero, and `0 > N` is false, so a plugin that was renamed, removed, or silently failed
 * to load reads as an improvement and the totals drop. That is indistinguishable from
 * progress if you only watch the totals — which is exactly how a lint rule can quietly
 * stop protecting anything while CI stays green.
 *
 * A rule also vanishes when every one of its violations is genuinely fixed, and counts
 * alone cannot separate that from a rule that died. Both are reported, because both
 * require the baseline to be updated deliberately rather than drifting; the printed
 * message names both readings so the reader can tell which one they are looking at.
 */
function compareSummaries(baseline, current) {
  const regressions = [];
  const vanished = [];

  const allRuleIds = new Set([
    ...Object.keys(baseline.byRule ?? {}),
    ...Object.keys(current.byRule ?? {}),
  ]);

  for (const ruleId of allRuleIds) {
    const baselineCounts = baseline.byRule?.[ruleId] ?? { errors: 0, warnings: 0 };
    const currentCounts = current.byRule?.[ruleId] ?? { errors: 0, warnings: 0 };

    const wasTracked = Object.hasOwn(baseline.byRule ?? {}, ruleId);
    const stillReports = Object.hasOwn(current.byRule ?? {}, ruleId);
    const hadFindings = baselineCounts.errors > 0 || baselineCounts.warnings > 0;

    if (wasTracked && !stillReports && hadFindings) {
      vanished.push({
        ruleId,
        errors: baselineCounts.errors,
        warnings: baselineCounts.warnings,
      });
    }

    if (currentCounts.errors > baselineCounts.errors) {
      regressions.push({
        ruleId,
        type: 'errors',
        baseline: baselineCounts.errors,
        current: currentCounts.errors,
      });
    }

    if (currentCounts.warnings > baselineCounts.warnings) {
      regressions.push({
        ruleId,
        type: 'warnings',
        baseline: baselineCounts.warnings,
        current: currentCounts.warnings,
      });
    }
  }

  return { regressions, vanished };
}

async function loadJson(filePath) {
  const content = await readFile(filePath, 'utf8');
  return JSON.parse(content);
}

async function writeBaseline(summary) {
  const baseline = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    eslintTarget: ESLINT_TARGETS.join(','),
    totals: summary.totals,
    byRule: summary.byRule,
  };

  await writeFile(BASELINE_PATH, `${JSON.stringify(baseline, null, 2)}\n`, 'utf8');
}

async function handleUpdateBaseline() {
  const reportPath = runEslintJsonReport();
  const results = await loadJson(reportPath);
  const summary = summarizeEslintReport(results);

  await writeBaseline(summary);

  // Provide quick visibility for reviewers.

  console.log(
    `[eslint-ratchet] Baseline updated: ${summary.totals.errors} errors, ${summary.totals.warnings} warnings`
  );
}

async function handleCheck() {
  let baseline;
  try {
    baseline = await loadJson(BASELINE_PATH);
  } catch {
    throw new Error(
      `[eslint-ratchet] Missing baseline at ${path.relative(process.cwd(), BASELINE_PATH)}. Run: npm run lint:ratchet:baseline`
    );
  }

  // A baseline measured over a different file set is not a baseline: widening the target makes
  // every pre-existing finding in the new directories read as a regression, and narrowing it makes
  // real findings vanish silently. Both are worse than an explicit stop.
  const expectedTarget = ESLINT_TARGETS.join(',');
  if (baseline.eslintTarget !== expectedTarget) {
    throw new Error(
      `[eslint-ratchet] Baseline covers "${baseline.eslintTarget}" but this run lints ` +
        `"${expectedTarget}". The two are not comparable. If the target change is intended, ` +
        `run: npm run lint:ratchet:baseline`
    );
  }

  const reportPath = runEslintJsonReport();
  const results = await loadJson(reportPath);
  const current = summarizeEslintReport(results);

  const { regressions, vanished } = compareSummaries(baseline, current);
  if (regressions.length === 0 && vanished.length === 0) {
    console.log(
      `[eslint-ratchet] OK: ${current.totals.errors} errors, ${current.totals.warnings} warnings (no regressions)`
    );
    return;
  }

  const problems = regressions.length + vanished.length;
  const lines = [`[eslint-ratchet] FAIL: ${problems} rule problems detected.`];

  if (regressions.length > 0) {
    lines.push(
      '',
      'Rules that increased (fix these or intentionally regenerate the baseline):',
      ...regressions
        .sort((a, b) => a.ruleId.localeCompare(b.ruleId) || a.type.localeCompare(b.type))
        .map(
          (r) =>
            `- ${r.ruleId} (${r.type}): baseline=${r.baseline} current=${r.current} (+${
              r.current - r.baseline
            })`
        )
    );
  }

  if (vanished.length > 0) {
    lines.push(
      '',
      'Rules that stopped reporting entirely (the baseline tracked them, this run did not):',
      ...vanished
        .sort((a, b) => a.ruleId.localeCompare(b.ruleId))
        .map((r) => `- ${r.ruleId}: baseline=${r.errors} errors, ${r.warnings} warnings -> absent`),
      '',
      'Two readings, and the counts cannot tell them apart:',
      '  1. The violations were fixed. Good — run `npm run lint:ratchet:baseline` to lock it in.',
      '  2. The rule stopped running (plugin renamed, removed, or failed to load). The debt is',
      '     still in the code and nothing is watching it. Restore the rule before re-baselining.',
      'Renaming a plugin is case 2 even though it looks like case 1: rename the baseline keys',
      'in place so the counts carry over, rather than regenerating.'
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
      `[eslint-ratchet] Unknown mode "${mode}". Expected: "check" or "update-baseline".`
    );
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
