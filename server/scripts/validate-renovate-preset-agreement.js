#!/usr/bin/env node

/**
 * This repository's Renovate policy must not silently diverge from the fleet's shared preset.
 *
 * `minipuft/repository-standards` publishes `renovate/default.json` — "shared fail-closed
 * dependency policy for minipuft repositories". Measured 2026-08-15, this repository's
 * `.github/renovate.json5` agrees with it on 20 of 23 keys and differs on 3.
 *
 * WHY THIS IS NOT SOLVED BY `extends`. The obvious fix — extend the preset and delete the 20
 * agreeing keys — was tried and rejected on reading the file. Three reasons, all local:
 *
 *   1. Several of those keys carry reasoning the preset does not and should not have.
 *      `platformAutomerge: false` is four lines about GitHub platform automerge merging while
 *      Renovate's stability-days status is still pending, which is what makes `minimumReleaseAge`
 *      an effective guard HERE. Deleting the key orphans the paragraph explaining it.
 *   2. The preset carries three `packageRules`. This repository has fourteen, covering the same
 *      ground more specifically. Extending merges all seventeen, leaving three redundant rules
 *      whose only effect is to be overridden by the ones after them.
 *   3. `validate-renovate-extraction.js` asserts the RESOLVED policy by rule DESCRIPTION. Adopting
 *      the preset's rules means adopting its wording into a gate that encodes intent.
 *
 * So the values stay written here, and this gate makes the agreement CHECKED instead of
 * coincidental. Convergent policy that nothing compares is indistinguishable from policy that has
 * already drifted — the same shape as four version references nobody compared
 * (`validate-standards-pins.js`), reached from the other direction.
 *
 * A divergence is not a defect. It is a decision that has to be WRITTEN DOWN: every key this
 * repository sets differently must appear in `DECLARED_OVERRIDES` with a reason. An override whose
 * value has since converged back to the preset is reported too — a stale exception is a lie about
 * a decision, and `cleanup-standards.md` treats a satisfied exception as a finding.
 *
 * READS THE VENDORED COPY, not the network. `@minipuft/repository-standards-validation` is a
 * pinned tarball dependency, so the preset this compares against is exactly the version this
 * repository consumes — and `validate-standards-pins.js` asserts that version agrees with the
 * three other references to the same upstream. Fetching `main` instead would compare against a
 * preset nothing here uses.
 *
 * MECHANISM: script — relation — compares a JSON5 config against a vendored JSON preset from
 * another repository; no linter reads both, and neither file references the other
 *
 * Usage:
 *   node scripts/validate-renovate-preset-agreement.js
 *   node scripts/validate-renovate-preset-agreement.js --self-test
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';

import JSON5 from 'json5';

const SERVER_ROOT = path.resolve(new URL('..', import.meta.url).pathname);
const REPO = path.resolve(SERVER_ROOT, '..');
const CONFIG = path.join(REPO, '.github', 'renovate.json5');
const PRESET = path.join(
  SERVER_ROOT,
  'node_modules',
  '@minipuft',
  'repository-standards-validation',
  'renovate',
  'default.json'
);

/** Metadata, not policy — comparing these would report noise on every edit. */
const IGNORED_KEYS = new Set(['$schema', 'description']);

/**
 * Keys this repository deliberately sets differently from the shared preset.
 *
 * Each needs a reason that survives being read by someone who did not write it. "We want it
 * different" is not a reason; what this repository is or does that the fleet is not, is.
 */
const DECLARED_OVERRIDES = {
  prCreation: {
    ours: 'immediate',
    reason:
      'the fleet preset uses "not-pending" to hide PRs until their branch status settles; this repository wants the PR to exist while CI runs, because its own validator workflow is the thing being watched',
  },
  lockFileMaintenance: {
    reason:
      'carries the npm cooldown and `minimumReleaseAgeBehaviour: timestamp-optional`, which validate-renovate-extraction.js asserts on the resolved config; the preset predates both',
  },
  packageRules: {
    reason:
      'fourteen rules against the preset three — TypeScript ceilings, the CLI TS6 migration, the MCP SDK, and pinned Python tooling are this repository, not the fleet',
  },
};

export function compare(ours, preset, overrides = DECLARED_OVERRIDES) {
  const violations = [];
  const agreed = [];
  for (const key of Object.keys(preset)) {
    if (IGNORED_KEYS.has(key)) continue;
    const declared = overrides[key];
    const missing = !(key in ours);
    const same = !missing && JSON.stringify(ours[key]) === JSON.stringify(preset[key]);
    if (declared) {
      // A satisfied exception is a finding: the override says a decision was made, and the values
      // now agree, so the decision either was reverted or never existed.
      if (same)
        violations.push(
          `${key}: declared as an override but now equals the preset — remove the entry`
        );
      continue;
    }
    if (missing) {
      violations.push(
        `${key}: set by the shared preset, absent here — adopt it or declare the override`
      );
      continue;
    }
    if (!same) {
      violations.push(
        `${key}: diverges from the shared preset (ours ${JSON.stringify(ours[key])}, preset ${JSON.stringify(preset[key])}) — declare the override with a reason`
      );
      continue;
    }
    agreed.push(key);
  }
  for (const key of Object.keys(overrides)) {
    if (!(key in preset)) {
      violations.push(`${key}: declared as an override of a key the shared preset no longer sets`);
    }
  }
  return { violations, agreed };
}

function runSelfTest() {
  const preset = {
    $schema: 'x',
    description: 'y',
    timezone: 'UTC',
    automerge: false,
    prCreation: 'not-pending',
  };
  const ours = { timezone: 'UTC', automerge: false, prCreation: 'immediate' };
  const overrides = { prCreation: { reason: 'because' } };
  const cases = [
    {
      rule: 'agreeing keys plus a declared override pass',
      run: () => compare(ours, preset, overrides).violations.length === 0,
    },
    {
      rule: 'an undeclared divergence is reported',
      run: () =>
        compare({ ...ours, timezone: 'America/New_York' }, preset, overrides).violations.some((v) =>
          /timezone: diverges/.test(v)
        ),
    },
    {
      rule: 'a preset key absent here is reported',
      run: () => {
        const { timezone: _drop, ...withoutTimezone } = ours;
        return compare(withoutTimezone, preset, overrides).violations.some((v) =>
          /timezone: .*absent here/.test(v)
        );
      },
    },
    {
      rule: 'an override whose value converged back to the preset is reported as stale',
      run: () =>
        compare({ ...ours, prCreation: 'not-pending' }, preset, overrides).violations.some((v) =>
          /now equals the preset/.test(v)
        ),
    },
    {
      rule: 'an override of a key the preset stopped setting is reported',
      run: () =>
        compare(ours, preset, { ...overrides, gone: { reason: 'r' } }).violations.some((v) =>
          /no longer sets/.test(v)
        ),
    },
    {
      rule: 'every declared override carries a non-empty reason',
      run: () =>
        Object.values(DECLARED_OVERRIDES).every((entry) => entry.reason?.trim().length > 20),
    },
    {
      rule: 'the real config and the vendored preset agree on every undeclared key',
      run: () => compare(loadConfig(), loadPreset()).violations.length === 0,
    },
  ];
  let failures = 0;
  for (const { rule, run } of cases) {
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

const loadConfig = () => JSON5.parse(readFileSync(CONFIG, 'utf8'));
const loadPreset = () => JSON.parse(readFileSync(PRESET, 'utf8'));

function main() {
  if (process.argv.includes('--self-test')) return runSelfTest();
  const { violations, agreed } = compare(loadConfig(), loadPreset());
  if (violations.length) {
    for (const violation of violations) console.error(`ERROR: ${violation}`);
    process.exitCode = 1;
    return;
  }
  console.log(
    `PASSED: Renovate policy matches the shared preset on ${agreed.length} key(s), ${Object.keys(DECLARED_OVERRIDES).length} declared override(s)`
  );
}

main();
