#!/usr/bin/env node

/**
 * Runs every member of the validation suite and reports ALL failures, not just the first.
 *
 * `validate:all` was an `&&` chain of 30 npm scripts. A shell `&&` short-circuits, so one red
 * step hid every step after it. That is not a reporting nicety: during this plan's own execution
 * a `validate:format` failure masked 30 downstream steps three separate times, and the only way
 * to learn whether they passed was to run all 30 by hand. Drift accumulated invisibly behind the
 * first failure long enough for every count in the plan's inventory to go stale.
 *
 * The suite is declared here as DATA rather than as a shell string, because a summary can only
 * report what it can enumerate. `validate:all` still names the whole suite and CI still runs it
 * whole — the contract in CLAUDE.md ("add a step to `validate:all` first, which CI runs whole")
 * is unchanged; the list simply moved one file over so a runner can iterate it.
 *
 * WHY `npm run` PER STEP rather than the resolved command: npm costs ~138 ms per invocation
 * before the step does any work, so 30 steps carry roughly 4 s of pure startup. Resolving each
 * command out of package.json and running it directly would recover that, but it means
 * re-implementing npm's `node_modules/.bin` PATH setup and `cd ..` semantics inside the one
 * process the entire gate depends on. The saving is not worth making the gate's own runner a
 * source of divergence. Per-step timings are reported so the trade can be re-costed with data.
 */

import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * The validation suite, in execution order.
 *
 * `io` records what the step does to the filesystem WHEN INVOKED IN THIS MODE — measured
 * 2026-08-06 by locating every write call in each script and reading whether it is reachable
 * without `--update` / `--apply` / `--self-test`:
 *
 *   read        — no filesystem write is reachable in suite mode
 *   write:cache — writes only tool caches under gitignored paths (never a tracked artifact)
 *
 * Nothing in the suite writes a file another member reads. That matters for one open question
 * only — whether these could run in parallel — and it answers the half people assume is the
 * blocker. The remaining obstacles are CPU contention and interleaved output, not write
 * conflicts. Parallelism is deliberately NOT implemented here: sequential output is what makes
 * a failure attributable, and the suite is 47 s.
 */
// Exported so `validate:suite-membership` can compare the declared steps against every
// `validate:*`/`verify:*` script package.json defines. It reads this array rather than regexing
// this file, so the two cannot drift apart on a formatting change.
export const SUITE = [
  { script: 'lint:ratchet', io: 'read' },
  { script: 'typecheck:tests:ratchet', io: 'read' },
  { script: 'validate:format', io: 'read' },
  { script: 'validate:arch', io: 'read' },
  { script: 'validate:filesize', io: 'read' },
  { script: 'verify:action-metadata', io: 'read' },
  { script: 'validate:contracts', io: 'read' },
  // ruff and pytest write `.ruff_cache/` and `hooks/__pycache__/`, both gitignored. The only
  // member of the suite that writes anything at all.
  { script: 'validate:python', io: 'write:cache' },
  { script: 'validate:frameworks', io: 'read' },
  { script: 'validate:schemas', io: 'read' },
  { script: 'validate:config-schema', io: 'read' },
  { script: 'validate:gate-index', io: 'read' },
  { script: 'validate:versions', io: 'read' },
  { script: 'validate:extension-artifact', io: 'read' },
  { script: 'validate:github-action-pins', io: 'read' },
  { script: 'validate:release-workflow', io: 'read' },
  { script: 'validate:readme', io: 'read' },
  { script: 'validate:conformance-coverage', io: 'read' },
  { script: 'validate:operator-registry-drift', io: 'read' },
  { script: 'validate:no-legacy-sidecars', io: 'read' },
  { script: 'validate:no-stepstate', io: 'read' },
  { script: 'validate:no-methodology-vocab', io: 'read' },
  { script: 'validate:no-llm-client', io: 'read' },
  { script: 'validate:documented-options', io: 'read' },
  { script: 'validate:required-contexts', io: 'read' },
  { script: 'validate:package-entries', io: 'read' },
  { script: 'validate:state-field-writers', io: 'read' },
  { script: 'validate:table-contracts', io: 'read' },
  { script: 'validate:no-phantom-columns', io: 'read' },
  { script: 'validate:hooks-registered', io: 'read' },
  { script: 'validate:suite-membership', io: 'read' },
  { script: 'validate:agent-plugins', io: 'read' },
  { script: 'validate:db-claim-order', io: 'read' },
  { script: 'plans:retire:check', io: 'read' },
];

/**
 * Loads an alternate suite. Exists so the runner's own behaviour — that a failure does not stop
 * the run — can be asserted against deliberately broken steps without breaking the real gate.
 */
async function loadSuite(manifestPath) {
  if (!manifestPath) return SUITE;
  const resolved = path.resolve(process.cwd(), manifestPath);
  const module = await import(`file://${resolved}`);
  const suite = module.SUITE ?? module.default;
  if (!Array.isArray(suite) || suite.length === 0) {
    throw new Error(`Manifest ${manifestPath} exported no non-empty SUITE array`);
  }
  return suite;
}

function runStep(step, index, total) {
  console.log(`\n▶ [${index + 1}/${total}] ${step.script}`);
  const startedAt = process.hrtime.bigint();
  const result = spawnSync('npm', ['run', '--silent', step.script], {
    cwd: SERVER_ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 32 * 1024 * 1024,
  });
  const durationMs = Number((process.hrtime.bigint() - startedAt) / 1_000_000n);

  const output = [result.stdout, result.stderr]
    .filter((stream) => typeof stream === 'string' && stream.trim() !== '')
    .join('\n')
    .trimEnd();
  if (output) console.log(output);

  // `spawnSync` reports a failure to launch (npm missing, ENOENT) via `error` with a null status.
  // Treating that as exit 0 would report a step that never ran as passed.
  const status = result.error ? 1 : (result.status ?? 1);
  if (result.error) console.log(`  (failed to launch: ${result.error.message})`);
  console.log(`${status === 0 ? '✓' : '✗'} ${step.script} — ${durationMs} ms, exit ${status}`);

  return { script: step.script, status, durationMs, output };
}

function printSummary(results, totalMs) {
  const failures = results.filter((entry) => entry.status !== 0);
  const nameWidth = Math.max(...results.map((entry) => entry.script.length));

  console.log(`\n${'─'.repeat(nameWidth + 24)}`);
  console.log(`Validation suite — ${results.length} steps, ${(totalMs / 1000).toFixed(1)} s`);
  console.log('─'.repeat(nameWidth + 24));
  for (const entry of results) {
    const mark = entry.status === 0 ? 'PASS' : `FAIL(${entry.status})`;
    console.log(`  ${entry.script.padEnd(nameWidth)}  ${mark.padEnd(8)} ${entry.durationMs} ms`);
  }

  const stepMs = results.reduce((sum, entry) => sum + entry.durationMs, 0);
  console.log(
    `\n  step time ${(stepMs / 1000).toFixed(1)} s · runner overhead ${((totalMs - stepMs) / 1000).toFixed(1)} s`
  );

  if (failures.length === 0) {
    console.log(`\n✅ All ${results.length} validation steps passed.`);
    return;
  }

  // Re-printed rather than merely named. With 30 steps of output above, "steps 4 and 27 failed"
  // still means scrolling — and reading every failure at once is the entire point of the runner.
  console.log(`\n❌ ${failures.length} of ${results.length} steps failed:`);
  for (const failure of failures) {
    console.log(`\n── ${failure.script} (exit ${failure.status}) ──`);
    console.log(failure.output || '(no output)');
  }
}

async function main() {
  const manifestIndex = process.argv.indexOf('--manifest');
  const manifestPath = manifestIndex === -1 ? undefined : process.argv[manifestIndex + 1];
  const suite = await loadSuite(manifestPath);

  const startedAt = process.hrtime.bigint();
  const results = suite.map((step, index) => runStep(step, index, suite.length));
  const totalMs = Number((process.hrtime.bigint() - startedAt) / 1_000_000n);

  printSummary(results, totalMs);
  process.exit(results.some((entry) => entry.status !== 0) ? 1 : 0);
}

// Guarded so importing `SUITE` does not run the 53-second suite as a side effect.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`validation suite runner failed: ${error.message}`);
    process.exit(1);
  });
}
