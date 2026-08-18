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
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
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
 *
 * `reads` records the SUBSTRATE — which bytes the step actually inspects. Vocabulary and the
 * evidence for it live in `lib/substrate.js`; `validate:suite-membership` RE-DERIVES this field
 * from each step's source and fails when the two disagree, so it cannot rot into decoration the
 * way a hand-maintained annotation does.
 *
 * Why the field exists: a gate reads some stand-in for the property it claims, and the stand-in
 * silently becomes the definition. Every "green while broken" case this repo has recorded is that
 * substitution — typecheck reading the working tree while claiming about HEAD (E7), gates walking
 * the filesystem while claiming about shipped content (E6), a ✓ meaning "I edited" rather than
 * "it is committed" (E11). Written down beside the claim, none of them are subtle.
 *
 * `converse` records the INVERSE implication and whether anything checks it. A gate enforcing
 * "X implies Y" almost always ships without "Y implies X", because the author traverses the
 * problem in one direction and the check inherits that direction. This suite has produced the
 * shape at least three times: a check that a declared step exists but not that an existing check
 * is declared; a stale ✓ caught while a stale ☐ was invisible; inbound citations verified while
 * outbound ones broke. `'unexamined'` is a legitimate value and is COUNTED in the gate's output —
 * an honest backlog beats thirty-six fabricated analyses, but it must stay visible to be a
 * backlog rather than a silence.
 */
// Exported so `validate:suite-membership` can compare the declared steps against every
// `validate:*`/`verify:*` script package.json defines. It reads this array rather than regexing
// this file, so the two cannot drift apart on a formatting change.
export const SUITE = [
  {
    script: 'lint:ratchet',
    io: 'read',
    reads: ['file', 'spawn'],
    converse: 'unexamined',
  },
  {
    script: 'typecheck:tests:ratchet',
    io: 'read',
    reads: ['file', 'spawn'],
    converse: 'unexamined',
  },
  {
    script: 'validate:knip-ratchet',
    io: 'read',
    reads: ['file', 'spawn'],
    converse: 'unexamined',
  },
  {
    // First, because every step after it is only as trustworthy as the tree it ran against.
    // A drifted node_modules is how a knip-ratchet baseline got measured with knip 6.32.1 and
    // committed against the lockfile's 6.32.2 (2026-08-19).
    script: 'validate:lockfile-sync',
    io: 'read',
    reads: ['file'],
    converse: 'unexamined',
  },
  {
    script: 'validate:format',
    io: 'read',
    reads: ['spawn', 'tracked'],
    converse: 'unexamined',
  },
  {
    script: 'validate:arch',
    io: 'read',
    reads: ['spawn'],
    converse: 'unexamined',
  },
  {
    script: 'validate:filesize',
    io: 'read',
    reads: ['file', 'walk'],
    converse: 'unexamined',
  },
  {
    script: 'verify:action-metadata',
    io: 'read',
    reads: ['file'],
    converse: 'unexamined',
  },
  {
    script: 'validate:contracts',
    io: 'read',
    reads: ['file', 'spawn', 'walk'],
    converse: 'unexamined',
  },
  // ruff and pytest write .ruff_cache/ and hooks/__pycache__/, both gitignored. The only
  // member of the suite that writes anything at all.
  {
    script: 'validate:python',
    io: 'write:cache',
    reads: ['spawn'],
    converse: 'unexamined',
  },
  {
    script: 'validate:frameworks',
    io: 'read',
    reads: ['file', 'walk'],
    converse: 'unexamined',
  },
  {
    script: 'validate:schemas',
    io: 'read',
    reads: ['file', 'spawn'],
    converse: 'unexamined',
  },
  {
    script: 'validate:config-schema',
    io: 'read',
    reads: ['file'],
    converse: 'unexamined',
  },
  {
    script: 'validate:gate-index',
    io: 'read',
    reads: ['file', 'walk'],
    converse: 'unexamined',
  },
  {
    script: 'validate:versions',
    io: 'read',
    reads: ['file'],
    converse: 'unexamined',
  },
  {
    script: 'validate:extension-artifact',
    io: 'read',
    reads: ['file', 'spawn', 'walk'],
    converse: 'unexamined',
  },
  {
    script: 'validate:github-action-pins',
    io: 'read',
    reads: ['file', 'walk'],
    converse: 'unexamined',
  },
  {
    script: 'validate:release-workflow',
    io: 'read',
    reads: ['file'],
    converse: 'unexamined',
  },
  {
    script: 'validate:renovate-preset-agreement',
    io: 'read',
    reads: ['file'],
    converse:
      'CHECKED both ways — an undeclared divergence from the shared preset is reported, AND a declared override whose value converged back to the preset is reported as stale',
  },
  {
    script: 'validate:standards-pins',
    io: 'read',
    reads: ['file', 'spawn', 'tracked'],
    converse:
      'CHECKED both ways — a reference naming a different version is reported, and finding NO reference at all is reported rather than passing vacuously; `plans/` and `CHANGELOG.md` are excluded as historical records and proven excluded',
  },
  {
    script: 'validate:readme',
    io: 'read',
    reads: ['file', 'index', 'spawn', 'tracked', 'walk'],
    converse: 'unexamined',
  },
  {
    // `spawn` is a TEXTUAL match, not a behavioural one: the SPAWN substrate pattern includes
    // /\bnpm run\b/, and validate-contributing.js carries that literal inside the regex that
    // extracts command references from CONTRIBUTING.md. The script shells out to nothing and
    // imports only node: builtins, which the docs CI route requires. Declared rather than worked
    // around, because the detector is textual by design and omitting a matched substrate fails.
    script: 'validate:contributing',
    io: 'read',
    reads: ['file', 'spawn'],
    converse: 'unexamined',
  },
  {
    script: 'validate:conformance-coverage',
    io: 'read',
    reads: ['file', 'walk'],
    converse: 'unexamined',
  },
  {
    script: 'validate:operator-registry-drift',
    io: 'read',
    reads: ['file', 'spawn', 'tracked'],
    converse: 'unexamined',
  },
  {
    script: 'validate:phase-header-drift',
    io: 'read',
    reads: ['file', 'walk'],
    converse: 'unexamined',
  },
  {
    script: 'validate:registry-coherence',
    io: 'read',
    reads: ['file', 'walk'],
    converse:
      'CHECKED both directions — an unclassified processor is a finding AND a classified processor no dispatch edge reaches is a finding. The second was added after the gate went green on its own first run with the entire gate router outside its scan',
  },
  {
    script: 'validate:plan-row-tracking',
    io: 'read',
    reads: ['file', 'spawn', 'tracked'],
    converse:
      'CHECKED both polarities — a stale ✓ claims work that does not exist, a stale ☐ disclaims work that does; the second direction was added 2026-08-12 after five ☐ rows were found already at HEAD',
  },
  {
    script: 'validate:no-legacy-sidecars',
    io: 'read',
    reads: ['file', 'spawn', 'tracked'],
    converse: 'unexamined',
  },
  {
    script: 'validate:no-stepstate',
    io: 'read',
    reads: ['file', 'spawn', 'tracked'],
    converse: 'unexamined',
  },
  {
    script: 'validate:no-methodology-vocab',
    io: 'read',
    reads: ['file', 'spawn', 'tracked'],
    converse: 'unexamined',
  },
  {
    script: 'validate:no-llm-client',
    io: 'read',
    reads: ['file', 'spawn', 'tracked'],
    converse: 'unexamined',
  },
  {
    script: 'validate:documented-options',
    io: 'read',
    reads: ['file', 'spawn', 'tracked'],
    converse: 'unexamined',
  },
  {
    script: 'validate:required-contexts',
    io: 'read',
    reads: ['file', 'walk'],
    converse: 'unexamined',
  },
  {
    script: 'validate:package-entries',
    io: 'read',
    reads: ['file'],
    converse: 'unexamined',
  },
  {
    script: 'validate:state-field-writers',
    io: 'read',
    reads: ['file'],
    converse: 'unexamined',
  },
  {
    script: 'validate:table-contracts',
    io: 'read',
    reads: ['declared'],
    converse:
      'CHECKED — set-equality against the embedded DDL is bidirectional by construction: a contract without a table and a table without a contract both fail',
  },
  {
    script: 'validate:no-phantom-columns',
    io: 'read',
    reads: ['file'],
    converse:
      'UNCHECKED and known — catches declaration-dead columns (no writer names them), NOT value-dead ones (a writer names the column and always binds NULL). Follows from substrate ',
  },
  {
    script: 'validate:hooks-registered',
    io: 'read',
    reads: ['file', 'walk'],
    converse:
      'CHECKED both ways — a registered hook whose file is absent, and a hook file no registration names',
  },
  {
    script: 'validate:hook-harness:self-test',
    io: 'read',
    reads: ['file'],
    converse: 'unexamined',
  },
  {
    script: 'validate:git-hooks-active',
    io: 'read',
    reads: ['file', 'spawn', 'walk'],
    converse:
      'UNCHECKED and known — verifies hooks CAN run in this worktree (core.hooksPath resolves to executable pre-commit/commit-msg/pre-push), NOT that they DID run for any commit already made. A commit pushed from a worktree before this gate was added is indistinguishable here from one the hooks passed; git records no evidence either way.',
  },
  {
    script: 'validate:suite-membership',
    io: 'read',
    reads: ['file', 'index', 'spawn', 'tracked'],
    converse:
      'CHECKED both ways — UNWIRED (a check in no SUITE) and FALSE REASON (an exception whose consumers vanished); the header records that only the first was guarded originally',
  },
  {
    script: 'validate:agent-plugins',
    io: 'read',
    reads: ['file', 'spawn'],
    converse: 'unexamined',
  },
  {
    script: 'validate:db-claim-order',
    io: 'read',
    reads: ['file', 'spawn', 'tracked'],
    converse: 'unexamined',
  },
  {
    script: 'plans:retire:check',
    io: 'read',
    reads: ['spawn'],
    converse:
      'CHECKED by the pinned shared executable — it rejects both cited done plans and orphaned configuration before this suite accepts the delegated verdict',
  },
  {
    script: 'validate:render-drift',
    io: 'read',
    reads: ['file'],
    converse:
      'CHECKED — the render direction is bidirectional by construction: mutating the PUBLISHED file and mutating the CANONICAL source each redden the same comparison, verified with three distinct seeded mutations (published byte, canonical byte, missing output) producing three distinct single-file failures. What it does NOT check is the converse of its own scope — that every published duplicate of a canonical field is declared as a render. A file rendered by hand and never added to render-targets.json is invisible to it.',
  },
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

/**
 * Where the suite records what it found.
 *
 * The runner is the ONLY thing that knows this. Measured 2026-08-20: a Bash PostToolUse hook
 * cannot learn it — `tool_response` carries no exit status under any name, and the hook does not
 * fire at all when a command exits non-zero. The plan-hygiene validation ledger tried to infer it
 * anyway and produced 91 of 91 entries reading `ran`, zero `ok`, zero `FAIL`, with a passing test
 * that fabricated the payload it wanted. So the verdict is written HERE, by the process holding
 * it, and nothing downstream has to guess.
 *
 * Gitignored (`.cache/`): this is session evidence, not authored content.
 */
const RECEIPT_PATH = path.join(SERVER_ROOT, '.cache', 'validation-receipt.json');

/** Previous run's receipt, or null. Never throws — a missing receipt is the normal first run. */
function readReceipt() {
  try {
    return JSON.parse(readFileSync(RECEIPT_PATH, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Record this run, carrying `firstSeen` forward for steps that were ALREADY failing.
 *
 * That carry-forward is the whole point. "2 of 44 failed" cannot tell you whether you broke
 * something or walked into it, and answering it by hand cost three separate investigations in one
 * session (2026-08-20) against a worktree shared with another agent. A step failing since before
 * this run is attributable to something else; a step whose `firstSeen` is this run is yours.
 *
 * Fails soft: a receipt that cannot be written must never turn a green suite red.
 */
function writeReceipt(results) {
  const previous = readReceipt();
  const seenBefore = new Map(
    (previous?.failing ?? []).map((entry) => [entry.script, entry.firstSeen])
  );
  const now = new Date().toISOString();
  const failing = results
    .filter((entry) => entry.status !== 0)
    .map((entry) => ({
      script: entry.script,
      status: entry.status,
      firstSeen: seenBefore.get(entry.script) ?? now,
    }));

  try {
    mkdirSync(path.dirname(RECEIPT_PATH), { recursive: true });
    writeFileSync(
      RECEIPT_PATH,
      `${JSON.stringify({ ts: now, steps: results.length, failing }, null, 2)}\n`
    );
  } catch {
    // Recording is a convenience; validating is the job.
  }
  return { failing, now };
}

function printSummary(results, totalMs, attribution) {
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
  const firstSeen = new Map((attribution?.failing ?? []).map((e) => [e.script, e.firstSeen]));
  for (const failure of failures) {
    // NEW vs pre-existing, so nobody re-derives it by hand against a shared worktree.
    const seen = firstSeen.get(failure.script);
    const origin =
      seen === undefined || seen === attribution?.now ? 'NEW this run' : `failing since ${seen}`;
    console.log(`\n── ${failure.script} (exit ${failure.status}) — ${origin} ──`);
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

  printSummary(results, totalMs, writeReceipt(results));
  process.exit(results.some((entry) => entry.status !== 0) ? 1 : 0);
}

// Guarded so importing `SUITE` does not run the 53-second suite as a side effect.
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`validation suite runner failed: ${error.message}`);
    process.exit(1);
  });
}
