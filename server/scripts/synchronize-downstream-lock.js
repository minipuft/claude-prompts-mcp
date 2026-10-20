#!/usr/bin/env node

/**
 * Refresh a downstream npm lock until it resolves the released package version exactly.
 *
 * Two bounded phases, in order. First wait until the registry lists the released version
 * (npm took 2m38s for 5.1.1 and 6m13s for 5.1.0 to make a fresh publish installable), then
 * refresh the lock, retrying a few times because a listing and an installable resolution
 * are served by different caches. Either phase failing fails the run: a PR whose lock points
 * at another version is worse than no PR.
 */

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

/** Wait for the registry to list the version: 15 minutes in 15-second polls. */
const DEFAULT_PUBLICATION_BUDGET_MS = 900_000;
const DEFAULT_PUBLICATION_POLL_MS = 15_000;
const DEFAULT_ATTEMPTS = 6;
const DEFAULT_ATTEMPT_DELAY_MS = 20_000;

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!flag?.startsWith('--') || value === undefined)
      throw new Error(`invalid argument: ${flag}`);
    options[flag.slice(2)] = value;
  }
  for (const required of ['workspace', 'package', 'version']) {
    if (!options[required]) throw new Error(`missing --${required}`);
  }
  if (!/^(?:@[^/]+\/)?[a-z0-9][a-z0-9._-]*$/i.test(options.package)) {
    throw new Error(`invalid package name: ${options.package}`);
  }
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(options.version)) {
    throw new Error(`invalid version: ${options.version}`);
  }
  return {
    workspace: resolve(options.workspace),
    packageName: options.package,
    expectedVersion: options.version,
    attempts: Number(options.attempts ?? DEFAULT_ATTEMPTS),
    delayMs: Number(options['delay-ms'] ?? DEFAULT_ATTEMPT_DELAY_MS),
    publicationBudgetMs: Number(options['publication-budget-ms'] ?? DEFAULT_PUBLICATION_BUDGET_MS),
    publicationPollMs: Number(options['publication-poll-ms'] ?? DEFAULT_PUBLICATION_POLL_MS),
  };
}

function installedLockVersion(workspace, packageName) {
  const lockPath = resolve(workspace, 'package-lock.json');
  if (!existsSync(lockPath)) throw new Error(`package lock is missing: ${lockPath}`);
  const lock = JSON.parse(readFileSync(lockPath, 'utf8'));
  const version = lock.packages?.[`node_modules/${packageName}`]?.version;
  if (!version) throw new Error(`${packageName} is absent from ${lockPath}`);
  return version;
}

function refreshLock(workspace, packageName) {
  // `npm update <pkg>`, not `npm install`: install honors a lockfile that already
  // satisfies the declared range and never re-resolves, so a lock pinned at an
  // older in-range version stays there forever — every retry was an idempotent
  // no-op and the loop misread its own stall as registry propagation lag
  // (observed v3.2.1, 2026-08-07: six attempts, "resolved 3.1.1" each time).
  // update re-resolves the named package to the highest version the range admits.
  const result = spawnSync(
    'npm',
    [
      'update',
      packageName,
      '--package-lock-only',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--prefer-online',
    ],
    { cwd: workspace, encoding: 'utf8', stdio: 'inherit' }
  );
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`npm lock refresh exited ${result.status}`);
}

/** The version the registry lists for `packageName@version`, or '' while it lists nothing. */
function listedVersion(workspace, packageName, version) {
  const result = spawnSync(
    'npm',
    ['view', `${packageName}@${version}`, 'version', '--prefer-online'],
    { cwd: workspace, encoding: 'utf8' }
  );
  if (result.error) throw result.error;
  // A version that is not published yet exits non-zero (E404) or prints nothing, by npm major.
  return result.status === 0 ? result.stdout.trim() : '';
}

async function awaitPublication({
  packageName,
  expectedVersion,
  budgetMs,
  pollMs,
  lookup,
  wait,
  now,
  log,
}) {
  if (!Number.isInteger(budgetMs) || budgetMs < 0 || budgetMs > 3_600_000) {
    throw new Error(
      `publication-budget-ms must be an integer from 0 to 3600000, found ${budgetMs}`
    );
  }
  if (!Number.isInteger(pollMs) || pollMs < 1 || pollMs > 300_000) {
    throw new Error(`publication-poll-ms must be an integer from 1 to 300000, found ${pollMs}`);
  }
  const startedAt = now();
  for (;;) {
    const listed = lookup();
    const elapsedMs = now() - startedAt;
    if (listed === expectedVersion) return elapsedMs;
    if (elapsedMs >= budgetMs) {
      throw new Error(
        `${packageName}@${expectedVersion} was not listed by the registry within ${budgetMs} ms ` +
          `(last listing: ${listed || 'none'}); re-run the sync once \`npm view\` lists it`
      );
    }
    log(`${packageName}@${expectedVersion} not listed yet (${elapsedMs} of ${budgetMs} ms)`);
    await wait(Math.min(pollMs, budgetMs - elapsedMs));
  }
}

async function synchronizeAfterPublication({
  awaitOptions,
  expectedVersion,
  attempts,
  delayMs,
  runAttempt,
  wait,
}) {
  const waitedMs = await awaitPublication({ ...awaitOptions, expectedVersion, wait });
  const completed = await synchronizeVersion({
    expectedVersion,
    attempts,
    delayMs,
    runAttempt,
    wait,
  });
  return { waitedMs, completed };
}

async function synchronizeVersion({ expectedVersion, attempts, delayMs, runAttempt, wait }) {
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 10) {
    throw new Error(`attempts must be an integer from 1 to 10, found ${attempts}`);
  }
  if (!Number.isInteger(delayMs) || delayMs < 0 || delayMs > 120_000) {
    throw new Error(`delay-ms must be an integer from 0 to 120000, found ${delayMs}`);
  }
  let lastOutcome = 'no attempt completed';
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const resolvedVersion = runAttempt(attempt);
      lastOutcome = `resolved ${resolvedVersion}`;
      if (resolvedVersion === expectedVersion) return attempt;
    } catch (error) {
      lastOutcome = error.message;
    }
    if (attempt < attempts) await wait(delayMs);
  }
  throw new Error(
    `registry propagation did not resolve ${expectedVersion} after ${attempts} attempts (${lastOutcome})`
  );
}

/**
 * A simulated registry that lists the version only after `listedAfterMs` of simulated time and
 * installs it from then on. The clock advances only through `wait`, so nothing sleeps for real.
 */
function simulatedRegistry({ expectedVersion, listedAfterMs }) {
  let clockMs = 0;
  const isListed = () => clockMs >= listedAfterMs;
  return {
    now: () => clockMs,
    wait: async (delay) => {
      clockMs += delay;
    },
    lookup: () => (isListed() ? expectedVersion : ''),
    runAttempt: () => (isListed() ? expectedVersion : '4.0.1'),
  };
}

async function runPublicationLagFixtures() {
  const expectedVersion = '5.1.0';
  const lagMs = 6 * 60_000; // 5.1.0 took 6m13s to become installable
  const synchronize = (registry, publicationBudgetMs) =>
    synchronizeAfterPublication({
      awaitOptions: {
        packageName: 'claude-prompts',
        budgetMs: publicationBudgetMs,
        pollMs: DEFAULT_PUBLICATION_POLL_MS,
        lookup: registry.lookup,
        now: registry.now,
        log: () => {},
      },
      expectedVersion,
      attempts: DEFAULT_ATTEMPTS,
      delayMs: DEFAULT_ATTEMPT_DELAY_MS,
      runAttempt: registry.runAttempt,
      wait: registry.wait,
    });

  const registry = simulatedRegistry({ expectedVersion, listedAfterMs: lagMs });
  const { waitedMs, completed } = await synchronize(registry, DEFAULT_PUBLICATION_BUDGET_MS);
  if (waitedMs < lagMs || completed !== 1) {
    throw new Error(`default budget did not carry a ${lagMs} ms publication lag`);
  }

  let refused = '';
  try {
    await synchronize(simulatedRegistry({ expectedVersion, listedAfterMs: lagMs }), lagMs - 1);
  } catch (error) {
    refused = error.message;
  }
  if (!/was not listed by the registry within/.test(refused)) {
    throw new Error('a publication budget shorter than the lag did not fail');
  }
  console.log(`PASSED: ${lagMs} ms publication lag resolves under the default budget only`);
}

async function runSelfTest() {
  const attempts = [];
  const waits = [];
  const sequence = ['3.1.0', '3.1.0', '3.1.1'];
  const completed = await synchronizeVersion({
    expectedVersion: '3.1.1',
    attempts: 4,
    delayMs: 1,
    runAttempt: (attempt) => {
      attempts.push(attempt);
      return sequence.shift();
    },
    wait: async (delay) => waits.push(delay),
  });
  if (completed !== 3 || attempts.length !== 3 || waits.length !== 2) {
    throw new Error('bounded retry did not stop on the exact version');
  }
  let rejected = false;
  try {
    await synchronizeVersion({
      expectedVersion: '3.1.1',
      attempts: 2,
      delayMs: 0,
      runAttempt: () => '3.1.0',
      wait: async () => {},
    });
  } catch (error) {
    rejected = /after 2 attempts/.test(error.message);
  }
  if (!rejected) throw new Error('exhausted retry fixture passed');
  await runPublicationLagFixtures();
  console.log('PASSED: bounded downstream lock synchronization fixtures');
}

async function main() {
  if (process.argv.includes('--self-test')) return runSelfTest();
  const options = parseArguments(process.argv.slice(2));
  const lockPath = resolve(options.workspace, 'package-lock.json');
  if (!existsSync(lockPath)) throw new Error(`package lock is missing: ${lockPath}`);
  const { waitedMs, completed } = await synchronizeAfterPublication({
    awaitOptions: {
      packageName: options.packageName,
      budgetMs: options.publicationBudgetMs,
      pollMs: options.publicationPollMs,
      lookup: () => listedVersion(options.workspace, options.packageName, options.expectedVersion),
      now: Date.now,
      log: console.log,
    },
    ...options,
    runAttempt: (attempt) => {
      console.log(`Lock synchronization attempt ${attempt}/${options.attempts}`);
      refreshLock(options.workspace, options.packageName);
      return installedLockVersion(options.workspace, options.packageName);
    },
    wait: (delay) => new Promise((resolveWait) => setTimeout(resolveWait, delay)),
  });
  console.log(
    `Lock resolved ${options.packageName}@${options.expectedVersion} on attempt ${completed} ` +
      `after the registry listed it (${waitedMs} ms)`
  );
}

main().catch((error) => {
  console.error(`ERROR: ${error.message}`);
  process.exitCode = 1;
});
