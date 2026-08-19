#!/usr/bin/env node
// @lifecycle canonical - Fails when the installed tree has drifted from package-lock.json.
/**
 * Lockfile Sync
 *
 * TWO DIFFERENT DRIFTS WEAR ONE NAME, and npm only handles the first:
 *
 *   A. `package.json` <-> `package-lock.json`. `npm ci` hard-fails on this (`EUSAGE ... can only
 *      install packages when your package.json and package-lock.json are in sync`). CI already
 *      covers it on every run; nothing here needs to.
 *   B. `package-lock.json` <-> the tree actually sitting in `node_modules`. npm exposes no
 *      first-class check. `npm ci --dry-run` reports it but ALWAYS exits 0, so a gate built on it
 *      has to parse prose npm is free to reword.
 *
 * B is the one that bites. Measured 2026-08-19: a local tree had drifted 18 packages from the
 * lockfile, including `knip` at 6.32.1 against the lockfile's 6.32.2 — and knip is what
 * `validate:knip-ratchet` counts findings with. The ratchet baseline was regenerated against the
 * wrong tool version and pushed. It happened to agree (1203 either way), which is luck, not a
 * gate. Every local `validate:*` result is only as trustworthy as the tree it ran against.
 *
 * MECHANISM: npm's own hidden lockfile. `node_modules/.package-lock.json` is written by npm on
 * every install and describes what is REALLY on disk — same `packages` keying as
 * `package-lock.json`, so the comparison is JSON against JSON with nothing inferred and no
 * subprocess. Deliberately NOT a `postinstall` stamp file: `files` in package.json does not
 * publish `scripts/`, so a lifecycle hook pointing here would fail for every consumer installing
 * the package from the registry.
 *
 * THREE FINDINGS, deliberately distinct:
 *   1. VERSION MISMATCH — same path, different version. The sharp one; this is the knip case.
 *   2. UNEXPECTED       — installed but absent from the lockfile.
 *   3. MISSING          — in the lockfile, not installed. Only counted for entries that are not
 *      `optional` and carry no `os`/`cpu` constraint, because a lockfile legitimately describes
 *      platform-specific packages this machine must not have.
 *
 * `--self-test` proves the comparison against synthetic pairs rather than the real tree: a
 * regression in the compare logic must fail even on a machine whose install is perfectly clean.
 *
 * Usage:
 * - Check (default, in `validate:all`): `npm run validate:lockfile-sync`
 * - Prove the comparison logic:         `npm run validate:lockfile-sync:self-test`
 * Exit: 0 = tree matches the lockfile, 1 = drift, 2 = invalid usage.
 */

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const LOCKFILE = 'package-lock.json';
const INSTALLED_LOCKFILE = path.join('node_modules', '.package-lock.json');
const MAX_REPORTED = 12;

/**
 * A lockfile entry describes a package this platform is not supposed to install.
 * `optional` covers optionalDependencies; `os`/`cpu` cover the per-platform binary packages
 * (esbuild, oxc, rollup) whose absence is correct, not drift.
 */
function isPlatformExcluded(entry) {
  return Boolean(entry?.optional || entry?.os || entry?.cpu || entry?.link);
}

/**
 * Compare a lockfile's `packages` map against the installed tree's.
 * Pure: both arguments are plain objects, so the self-test drives it without touching disk.
 */
export function comparePackages(locked, installed) {
  const findings = [];

  for (const [location, lockedEntry] of Object.entries(locked)) {
    if (location === '') continue;
    const installedEntry = installed[location];

    if (!installedEntry) {
      if (!isPlatformExcluded(lockedEntry)) {
        findings.push({ kind: 'missing', location, expected: lockedEntry.version });
      }
      continue;
    }

    if (lockedEntry.version !== installedEntry.version) {
      findings.push({
        kind: 'mismatch',
        location,
        expected: lockedEntry.version,
        actual: installedEntry.version,
      });
    }
  }

  for (const [location, installedEntry] of Object.entries(installed)) {
    if (location === '') continue;
    if (!locked[location]) {
      findings.push({ kind: 'unexpected', location, actual: installedEntry.version });
    }
  }

  return findings;
}

function describe(finding) {
  if (finding.kind === 'mismatch') {
    return `  ${finding.location}: lockfile ${finding.expected}, installed ${finding.actual}`;
  }
  if (finding.kind === 'missing') {
    return `  ${finding.location}: lockfile ${finding.expected}, not installed`;
  }
  return `  ${finding.location}: installed ${finding.actual}, absent from the lockfile`;
}

function readJson(file) {
  return JSON.parse(readFileSync(file, 'utf8'));
}

function check() {
  if (!existsSync(LOCKFILE)) {
    console.error(`[lockfile-sync] FAIL: ${LOCKFILE} not found. Run from server/.`);
    return 1;
  }
  if (!existsSync(INSTALLED_LOCKFILE)) {
    console.error(
      `[lockfile-sync] FAIL: ${INSTALLED_LOCKFILE} not found — nothing is installed, or the tree\n` +
        'was assembled by something other than npm. Run `npm ci`.'
    );
    return 1;
  }

  const findings = comparePackages(
    readJson(LOCKFILE).packages ?? {},
    readJson(INSTALLED_LOCKFILE).packages ?? {}
  );

  if (findings.length === 0) {
    console.log('[lockfile-sync] OK: the installed tree matches package-lock.json');
    return 0;
  }

  const counts = findings.reduce((acc, finding) => {
    acc[finding.kind] = (acc[finding.kind] ?? 0) + 1;
    return acc;
  }, {});

  console.error(
    `[lockfile-sync] FAIL: ${findings.length} package(s) differ from ${LOCKFILE} ` +
      `(${Object.entries(counts)
        .map(([kind, count]) => `${kind}=${count}`)
        .join(', ')}).\n`
  );
  for (const finding of findings.slice(0, MAX_REPORTED)) console.error(describe(finding));
  if (findings.length > MAX_REPORTED) {
    console.error(`  ... and ${findings.length - MAX_REPORTED} more`);
  }
  console.error(
    '\nEvery local validate:* result was measured against this tree, not against the one CI\n' +
      'installs. Run `npm ci` (from server/) and re-run whatever you were validating.'
  );
  return 1;
}

function selfTestCases() {
  return [
    {
      name: 'an identical tree produces no findings',
      locked: { '': {}, 'node_modules/knip': { version: '6.32.2' } },
      installed: { '': {}, 'node_modules/knip': { version: '6.32.2' } },
      expect: [],
    },
    {
      name: 'a version mismatch is reported (the measured knip case)',
      locked: { 'node_modules/knip': { version: '6.32.2' } },
      installed: { 'node_modules/knip': { version: '6.32.1' } },
      expect: ['mismatch'],
    },
    {
      name: 'a package in the lockfile but not installed is reported',
      locked: { 'node_modules/get-tsconfig': { version: '4.14.2' } },
      installed: {},
      expect: ['missing'],
    },
    {
      name: 'an installed package absent from the lockfile is reported',
      locked: {},
      installed: { 'node_modules/@emnapi/runtime': { version: '1.11.2' } },
      expect: ['unexpected'],
    },
    {
      name: 'an uninstalled optional package is NOT drift',
      locked: { 'node_modules/fsevents': { version: '2.3.3', optional: true } },
      installed: {},
      expect: [],
    },
    {
      name: 'an uninstalled platform-constrained package is NOT drift',
      locked: {
        'node_modules/@esbuild/darwin-arm64': { version: '0.28.0', os: ['darwin'], cpu: ['arm64'] },
      },
      installed: {},
      expect: [],
    },
    {
      name: 'the root entry is never compared',
      locked: { '': { version: '4.0.1' } },
      installed: { '': { version: '9.9.9' } },
      expect: [],
    },
  ];
}

function selfTest() {
  console.log('\nvalidate:lockfile-sync self-test — every rule must behave\n');
  let failed = 0;

  for (const { name, locked, installed, expect } of selfTestCases()) {
    const actual = comparePackages(locked, installed).map((finding) => finding.kind);
    const ok = actual.length === expect.length && actual.every((kind, i) => kind === expect[i]);
    console.log(`  ${ok ? 'ok  ' : 'FAIL'}  ${name}`);
    if (!ok) {
      failed += 1;
      console.log(`        expected [${expect}], got [${actual}]`);
    }
  }

  if (failed > 0) {
    console.log(`\n❌ self-test: ${failed} rule(s) are not falsifiable\n`);
    return 1;
  }
  console.log(
    `\n✅ self-test: all ${selfTestCases().length} comparison rules distinguish drift from` +
      ' legitimate platform exclusions\n'
  );
  return 0;
}

const args = process.argv.slice(2).filter((arg) => arg !== '--');
if (args.length > 1 || (args.length === 1 && args[0] !== '--self-test')) {
  console.error('Usage: validate-lockfile-sync.js [--self-test]');
  process.exit(2);
}

process.exit(args[0] === '--self-test' ? selfTest() : check());
