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

function runEslintJsonReport() {
  const reportPath = path.join(os.tmpdir(), `eslint-ratchet-${Date.now()}.json`);
  const eslintBin = getEslintBinPath();

  const result = spawnSync(
    eslintBin,
    ['src', '--format', 'json', '--output-file', reportPath],
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

function compareSummaries(baseline, current) {
  const regressions = [];

  const allRuleIds = new Set([
    ...Object.keys(baseline.byRule ?? {}),
    ...Object.keys(current.byRule ?? {}),
  ]);

  for (const ruleId of allRuleIds) {
    const baselineCounts = baseline.byRule?.[ruleId] ?? { errors: 0, warnings: 0 };
    const currentCounts = current.byRule?.[ruleId] ?? { errors: 0, warnings: 0 };

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

  return regressions;
}

async function loadJson(filePath) {
  const content = await readFile(filePath, 'utf8');
  return JSON.parse(content);
}

async function writeBaseline(summary) {
  const baseline = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    eslintTarget: 'src',
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

  const reportPath = runEslintJsonReport();
  const results = await loadJson(reportPath);
  const current = summarizeEslintReport(results);

  const regressions = compareSummaries(baseline, current);
  if (regressions.length === 0) {
     
    console.log(
      `[eslint-ratchet] OK: ${current.totals.errors} errors, ${current.totals.warnings} warnings (no regressions)`
    );
    return;
  }

  const lines = [
    `[eslint-ratchet] FAIL: ${regressions.length} rule regressions detected.`,
    '',
    'Rules that increased (fix these or intentionally regenerate the baseline):',
    ...regressions
      .sort((a, b) => a.ruleId.localeCompare(b.ruleId) || a.type.localeCompare(b.type))
      .map(
        (r) =>
          `- ${r.ruleId} (${r.type}): baseline=${r.baseline} current=${r.current} (+${
            r.current - r.baseline
          })`
      ),
  ];

   
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

