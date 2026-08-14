#!/usr/bin/env node

/** Guard release artifact and downstream merge contracts in extension-publish.yml. */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const WORKFLOW = join(ROOT_DIR, '.github', 'workflows', 'extension-publish.yml');
const MERGE_MODES = new Set(['auto']);
const REQUIRED_RELEASE_PATHS = [
  'cpm-${{ steps.version.outputs.version }}.js',
  'cpm-${{ steps.version.outputs.version }}.js.sha256',
  'claude-prompts-${{ steps.version.outputs.version }}-sourcemaps.tar.gz',
];

function downstreamEntries(source) {
  const matrixStart = source.indexOf('      matrix:\n');
  const stepsStart = source.indexOf('    steps:\n', matrixStart);
  if (matrixStart === -1 || stepsStart === -1) return [];
  const matrix = source.slice(matrixStart, stepsStart);
  const entries = [];
  let current;
  for (const line of matrix.split(/\r?\n/)) {
    const repo = line.match(/^\s+- repo:\s*(\S+)\s*$/);
    if (repo) {
      current = { repo: repo[1] };
      entries.push(current);
      continue;
    }
    const mode = line.match(/^\s+merge_mode:\s*(\S+)\s*$/);
    if (mode && current) current.mergeMode = mode[1];
  }
  return entries;
}

function findViolations(source) {
  const violations = [];
  const entries = downstreamEntries(source);
  if (entries.length === 0) violations.push('downstream matrix has no repositories');
  for (const entry of entries) {
    if (!entry.mergeMode) violations.push(`${entry.repo} has no merge_mode`);
    else if (!MERGE_MODES.has(entry.mergeMode)) {
      violations.push(`${entry.repo} has unknown merge_mode ${entry.mergeMode}`);
    }
  }
  for (const mode of MERGE_MODES) {
    if (!source.includes(`${mode})`)) violations.push(`merge command has no ${mode} branch`);
  }
  if (source.includes('direct)')) violations.push('direct merge branch must not exist');
  if (!source.includes('synchronize-downstream-lock.js')) {
    violations.push('downstream lock update does not use bounded registry propagation retries');
  }
  if (!source.includes('[ "$installed" = "$VERSION" ]')) {
    violations.push('installed downstream version is not required to equal the release');
  }
  // The marketplace install URL has no redirect mechanism, so a listing pointing at a rename
  // redirect breaks every install the day the old name is reclaimed — and nothing else looks.
  // This assertion previously lived in `validate-versions.js --distribution`, which was reachable
  // only from a workflow with zero runs; it was deleted 2026-08-13 and rebuilt HERE, in the job
  // that already edits the marketplace entry and can block the release. Guarded rather than
  // merely written, because the last copy was removable without anything noticing.
  if (!source.includes('[ "$actual_url" = "${REPOSITORY}.git" ]')) {
    violations.push('marketplace source url is not asserted against the canonical repository');
  }
  if (!source.includes('[ "$actual_ref" = "dist" ]')) {
    violations.push('marketplace source ref is not asserted to be the published dist branch');
  }
  // Derived, not hardcoded: a literal slug here is a second thing to update at the next rename,
  // which is how the previous guard's URL went stale in `fleet.json`.
  if (
    source.includes('marketplace') &&
    !source.includes("require('./upstream/plugin.json').repository")
  ) {
    violations.push(
      'marketplace source url assertion does not derive the repository from plugin.json'
    );
  }
  for (const path of REQUIRED_RELEASE_PATHS) {
    if (!source.includes(path)) violations.push(`release asset is not explicit: ${path}`);
  }
  if (
    !source.includes(
      "github.event_name == 'workflow_run' && github.event.workflow_run.head_sha || github.ref"
    )
  ) {
    violations.push('checkout does not support both workflow_run and workflow_dispatch');
  }
  return violations;
}

function runSelfTest() {
  const healthy = `
      matrix:
        include:
          - repo: owner/protected
            merge_mode: auto
          - repo: owner/also-protected
            merge_mode: auto
    steps:
      auto)
      synchronize-downstream-lock.js
      [ "$installed" = "$VERSION" ]
      marketplace)
      require('./upstream/plugin.json').repository
      [ "$actual_url" = "\${REPOSITORY}.git" ]
      [ "$actual_ref" = "dist" ]
      cpm-\${{ steps.version.outputs.version }}.js
      cpm-\${{ steps.version.outputs.version }}.js.sha256
      claude-prompts-\${{ steps.version.outputs.version }}-sourcemaps.tar.gz
      github.event_name == 'workflow_run' && github.event.workflow_run.head_sha || github.ref
  `;
  const cases = [
    ['missing merge mode', healthy.replace('            merge_mode: auto\n', '')],
    ['unknown merge mode', healthy.replace('merge_mode: auto', 'merge_mode: guess')],
    ['direct merge regression', healthy.replace('      auto)\n', '      auto)\n      direct)\n')],
    [
      'missing bounded lock synchronization',
      healthy.replace('      synchronize-downstream-lock.js\n', ''),
    ],
    [
      'missing exact installed version assertion',
      healthy.replace('      [ "$installed" = "$VERSION" ]\n', ''),
    ],
    [
      'missing marketplace source url assertion',
      healthy.replace('      [ "$actual_url" = "${REPOSITORY}.git" ]\n', ''),
    ],
    [
      'missing marketplace source ref assertion',
      healthy.replace('      [ "$actual_ref" = "dist" ]\n', ''),
    ],
    [
      // The regression that matters most: re-hardcoding the slug. It passes the url assertion
      // above while re-creating the drift that left `fleet.json` on the pre-rename name.
      'marketplace url hardcoded instead of derived',
      healthy.replace("      require('./upstream/plugin.json').repository\n", ''),
    ],
    [
      'missing release asset',
      healthy.replace('cpm-${{ steps.version.outputs.version }}.js.sha256', ''),
    ],
    [
      'single-trigger checkout',
      healthy.replace(
        "github.event_name == 'workflow_run' && github.event.workflow_run.head_sha || github.ref",
        'github.event.workflow_run.head_sha'
      ),
    ],
  ];
  let failures = 0;
  for (const [name, source] of cases) {
    const rejected = findViolations(source).length > 0;
    console.log(`  ${rejected ? 'ok  ' : 'FAIL'}  ${name}`);
    if (!rejected) failures += 1;
  }
  const accepted = findViolations(healthy).length === 0;
  console.log(`  ${accepted ? 'ok  ' : 'FAIL'}  healthy workflow`);
  if (!accepted) failures += 1;
  process.exit(failures === 0 ? 0 : 1);
}

function main() {
  if (process.argv.includes('--self-test')) return runSelfTest();
  const violations = findViolations(readFileSync(WORKFLOW, 'utf8'));
  if (violations.length) {
    for (const violation of violations) console.error(`ERROR: ${violation}`);
    process.exitCode = 1;
    return;
  }
  console.log('PASSED: release assets and downstream merge modes are explicit');
}

main();
