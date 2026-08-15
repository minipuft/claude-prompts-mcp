#!/usr/bin/env node

/**
 * Did the release actually LAND downstream, or was it only sent?
 *
 * `extension-publish.yml`'s `sync-downstream` job validates hard before it opens a PR — `npm ci`
 * agreement, an exact resolved lock version, marketplace url/ref/version assertions — and then
 * ends at `gh pr merge --auto`. Auto-merge lands the PR WHEN THE DOWNSTREAM'S OWN CI PASSES. If
 * that CI fails, or a required review never arrives, or the PR is closed, the PR sits open
 * forever and the upstream release is already green. Nothing upstream ever learns.
 *
 * The matrix is `fail-fast: false`, so the same silence covers a leg that never got that far:
 * the v4.0.0 run (2026-08-15) failed `codex-prompts` on a token permission at checkout while the
 * other three synced, and the only surface signal was a workflow-level red that reads identically
 * to "the release broke". Per-job truth existed; nothing asserted the FLEET.
 *
 * So this check reads the landed state on each downstream's default branch and compares it to the
 * released version. It answers "they got it", where every existing gate answers "we sent it".
 *
 * DELIBERATELY NOT `RELEASE_PLEASE_TOKEN`. That token going stale is one of the conditions this
 * check exists to detect; authenticating with it would make the detector fail in the same breath
 * as the thing it detects, and a detector that dies with its subject reports nothing. All four
 * downstreams are public, so the default workflow token reads them.
 *
 * NOT IN `validate:all`. It makes network calls to four other repositories and depends on their
 * merge state, neither of which belongs in a suite that gates every commit. It runs on a schedule
 * — detection, not prevention. `validate-suite-membership.js` carries the declared exception and
 * asserts the scheduled workflow still names it.
 *
 * MECHANISM: script — relation — compares a CI workflow matrix against files fetched from four
 * other repositories; no linter can see across repository boundaries
 *
 * Usage:
 *   node scripts/verify-downstream-sync.js [--version 4.0.1] [--grace-hours 24] [--json]
 *   node scripts/verify-downstream-sync.js --self-test
 */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

import { parseDownstreamMatrix } from './lib/downstream-matrix.js';

const ROOT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const WORKFLOW = join(ROOT_DIR, '.github', 'workflows', 'extension-publish.yml');
const UPSTREAM_REPO = 'minipuft/claude-prompts-mcp';
const ENGINE_PACKAGE = 'claude-prompts';

/**
 * How each downstream's INSTALLED engine version is read, keyed by the matrix `name`.
 *
 * An unrecognized name is an error rather than a skip, for the reason `render-targets.json`
 * gives about `renderKind`: a target with no declared probe would otherwise be audited in
 * silence, and "four of five checked" reports the same green as five of five. Adding a
 * downstream to the matrix therefore forces a decision here.
 */
const PROBES = {
  marketplace: {
    path: '.claude-plugin/marketplace.json',
    describe: 'marketplace listing version',
    // The listing carries a literal version that sync-downstream jq-writes. Reading the lock
    // instead would find nothing: this repo lists the plugin, it does not depend on the engine.
    read(text) {
      const listing = JSON.parse(text);
      const entry = (listing.plugins ?? []).find((plugin) => plugin.name === ENGINE_PACKAGE);
      if (!entry) throw new Error(`no ${ENGINE_PACKAGE} entry in the marketplace listing`);
      if (!entry.version) throw new Error(`the ${ENGINE_PACKAGE} entry carries no version`);
      return entry.version;
    },
  },
  gemini: npmLockProbe(),
  opencode: npmLockProbe(),
  codex: npmLockProbe(),
};

function npmLockProbe() {
  return {
    path: 'package-lock.json',
    describe: 'resolved lockfile version',
    // The lock, not the `dependencies` range. sync-downstream writes `^MAJOR.0.0`, so a patch
    // release leaves package.json byte-identical — the range is structurally incapable of
    // distinguishing 4.0.0 from 4.0.1. Only the lock records which version is actually installed.
    read(text) {
      const lock = JSON.parse(text);
      const version = lock.packages?.[`node_modules/${ENGINE_PACKAGE}`]?.version;
      if (!version) throw new Error(`${ENGINE_PACKAGE} is absent from the lockfile`);
      return version;
    },
  };
}

/** Matrix entries joined to their probe. Throws when a downstream has no declared probe. */
export function resolveTargets(workflowSource) {
  const entries = parseDownstreamMatrix(workflowSource);
  if (entries.length === 0) throw new Error('the downstream sync matrix has no repositories');
  return entries.map((entry) => {
    if (!entry.name) throw new Error(`${entry.repo} has no matrix name, so no probe can be chosen`);
    const probe = PROBES[entry.name];
    if (!probe) {
      throw new Error(
        `${entry.repo} (name: ${entry.name}) has no declared probe in verify-downstream-sync.js — ` +
          'add one rather than letting this downstream go unaudited'
      );
    }
    return { ...entry, probe };
  });
}

/**
 * Grade observations against the released version.
 *
 * `withinGrace` suppresses drift findings, not read failures: immediately after a release the
 * downstream PRs are legitimately open and auto-merge is still waiting on their CI, so flagging
 * them would make every release day red and train the signal to be ignored. A downstream we
 * cannot READ is reported regardless of grace — that is not "not landed yet", it is "this audit
 * cannot see this repository", and a probe that cannot fire is the failure mode this whole file
 * is modelled on.
 */
export function evaluate({ expectedVersion, observations, withinGrace = false }) {
  const findings = [];
  for (const observation of observations) {
    if (observation.error) {
      findings.push({
        repo: observation.repo,
        severity: 'unreadable',
        message: `could not read ${observation.probePath}: ${observation.error}`,
      });
      continue;
    }
    if (observation.version === expectedVersion) continue;
    findings.push({
      repo: observation.repo,
      severity: withinGrace ? 'pending' : 'drifted',
      message: `${observation.describe} is ${observation.version}, released ${expectedVersion}`,
    });
  }
  const blocking = findings.filter((finding) => finding.severity !== 'pending');
  return { findings, ok: blocking.length === 0 };
}

function gh(args) {
  return execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

function fetchFile(repo, path) {
  return gh(['api', `repos/${repo}/contents/${path}`, '-H', 'Accept: application/vnd.github.raw']);
}

function fetchLatestRelease() {
  const release = JSON.parse(gh(['api', `repos/${UPSTREAM_REPO}/releases/latest`]));
  return { version: String(release.tag_name).replace(/^v/, ''), publishedAt: release.published_at };
}

/**
 * Read the value after a flag whose index the CALLER resolved.
 *
 * The `process.argv.indexOf('--flag')` call stays at the call site rather than moving in here,
 * because that literal-in-idiom form is what `validate-documented-options.js` harvests as this
 * project's flag surface. Passing the flag name into a helper hides it: the flag would be real,
 * documented, and read as unbacked — the guard would fail on correct docs.
 */
function valueAfter(index, fallback) {
  return index === -1 ? fallback : process.argv[index + 1];
}

function runSelfTest() {
  const cases = [
    {
      rule: 'a downstream behind the release is reported',
      run: () =>
        !evaluate({
          expectedVersion: '4.0.1',
          observations: [{ repo: 'o/r', version: '4.0.0', describe: 'lock' }],
        }).ok,
    },
    {
      rule: 'a downstream at the release passes',
      run: () =>
        evaluate({
          expectedVersion: '4.0.1',
          observations: [{ repo: 'o/r', version: '4.0.1', describe: 'lock' }],
        }).ok,
    },
    {
      rule: 'drift inside the grace window is pending, not blocking',
      run: () =>
        evaluate({
          expectedVersion: '4.0.1',
          observations: [{ repo: 'o/r', version: '4.0.0', describe: 'lock' }],
          withinGrace: true,
        }).ok,
    },
    {
      rule: 'an unreadable downstream is reported EVEN inside the grace window',
      run: () =>
        !evaluate({
          expectedVersion: '4.0.1',
          observations: [{ repo: 'o/r', error: 'HTTP 404', probePath: 'package-lock.json' }],
          withinGrace: true,
        }).ok,
    },
    {
      rule: 'a matrix entry with no declared probe is an error, not a silent skip',
      run: () => {
        try {
          resolveTargets(
            '      matrix:\n        include:\n          - repo: o/new\n            name: brandnew\n            merge_mode: auto\n    steps:\n'
          );
          return false;
        } catch (error) {
          return /no declared probe/.test(error.message);
        }
      },
    },
    {
      rule: 'an empty matrix is an error rather than a vacuous pass',
      run: () => {
        try {
          resolveTargets('      matrix:\n        include:\n    steps:\n');
          return false;
        } catch (error) {
          return /no repositories/.test(error.message);
        }
      },
    },
    {
      rule: 'the real workflow matrix resolves a probe for every downstream',
      run: () => resolveTargets(readFileSync(WORKFLOW, 'utf8')).length >= 4,
    },
    {
      rule: 'the lock probe reads the resolved version, not the declared range',
      run: () =>
        PROBES.gemini.read(
          JSON.stringify({
            packages: { [`node_modules/${ENGINE_PACKAGE}`]: { version: '4.0.1' } },
          })
        ) === '4.0.1',
    },
    {
      rule: 'the marketplace probe rejects a listing whose entry lost its version',
      run: () => {
        try {
          PROBES.marketplace.read(JSON.stringify({ plugins: [{ name: ENGINE_PACKAGE }] }));
          return false;
        } catch (error) {
          return /carries no version/.test(error.message);
        }
      },
    },
  ];
  let failures = 0;
  for (const { rule, run } of cases) {
    // `passed` stays false when `run()` throws: the assignment never completes, so the catch
    // has nothing to reset and re-assigning there is dead (no-useless-assignment).
    let passed = false;
    try {
      passed = run() === true;
    } catch (error) {
      console.error(`    ${error.message}`);
    }
    console.log(`  ${passed ? 'ok  ' : 'FAIL'}  ${rule}`);
    if (!passed) failures += 1;
  }
  process.exit(failures === 0 ? 0 : 1);
}

function main() {
  if (process.argv.includes('--self-test')) return runSelfTest();

  const graceHours = Number(valueAfter(process.argv.indexOf('--grace-hours'), '24'));
  if (!Number.isFinite(graceHours) || graceHours < 0) {
    console.error('ERROR: --grace-hours must be a non-negative number');
    process.exitCode = 1;
    return;
  }

  let targets;
  try {
    targets = resolveTargets(readFileSync(WORKFLOW, 'utf8'));
  } catch (error) {
    console.error(`ERROR: ${error.message}`);
    process.exitCode = 1;
    return;
  }

  const override = valueAfter(process.argv.indexOf('--version'), null);
  let expectedVersion = override;
  let withinGrace = false;
  if (!override) {
    const release = fetchLatestRelease();
    expectedVersion = release.version;
    const ageHours = (Date.now() - Date.parse(release.publishedAt)) / 3_600_000;
    withinGrace = ageHours < graceHours;
    console.log(
      `Released ${expectedVersion} ${ageHours.toFixed(1)}h ago` +
        (withinGrace ? ` — inside the ${graceHours}h auto-merge grace window` : '')
    );
  }

  const observations = targets.map((target) => {
    try {
      return {
        repo: target.repo,
        describe: target.probe.describe,
        probePath: target.probe.path,
        version: target.probe.read(fetchFile(target.repo, target.probe.path)),
      };
    } catch (error) {
      return {
        repo: target.repo,
        describe: target.probe.describe,
        probePath: target.probe.path,
        error: error.message.trim().split('\n').pop(),
      };
    }
  });

  const { findings, ok } = evaluate({ expectedVersion, observations, withinGrace });

  for (const observation of observations) {
    const state = observation.error ? `ERROR ${observation.error}` : observation.version;
    console.log(`  ${observation.repo.padEnd(28)} ${observation.describe}: ${state}`);
  }

  if (process.argv.includes('--json')) {
    console.log(JSON.stringify({ expectedVersion, observations, findings, ok }, null, 2));
  }

  if (!ok) {
    for (const finding of findings) {
      if (finding.severity === 'pending') continue;
      console.error(`::error::${finding.repo} ${finding.severity}: ${finding.message}`);
    }
    console.error(
      `FAILED: ${findings.filter((f) => f.severity !== 'pending').length} downstream(s) did not land ${expectedVersion}`
    );
    process.exitCode = 1;
    return;
  }

  const pending = findings.filter((finding) => finding.severity === 'pending');
  for (const finding of pending) console.log(`  PENDING ${finding.repo}: ${finding.message}`);
  console.log(
    `PASSED: ${observations.length - pending.length}/${observations.length} downstream(s) serve ${expectedVersion}`
  );
}

main();
