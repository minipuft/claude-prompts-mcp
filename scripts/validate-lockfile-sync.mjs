#!/usr/bin/env node
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
 * B is the one that bites: a local tree drifted 18 packages from its lockfile, including a lint
 * tool one patch version behind, and a ratchet baseline was regenerated against the wrong tool
 * version and pushed. Every local `validate:*` result is only as trustworthy as the tree it ran
 * against.
 *
 * MECHANISM: npm's own hidden lockfile. `node_modules/.package-lock.json` is written by npm on
 * every install and describes what is REALLY on disk: same `packages` keying as
 * `package-lock.json`, so the comparison is JSON against JSON with nothing inferred and no
 * subprocess. Deliberately NOT a `postinstall` stamp file: a lifecycle hook pointing at a script
 * would fail for every consumer installing the package from the registry when `scripts/` is not
 * published.
 *
 * THREE FINDINGS, deliberately distinct:
 *   1. VERSION MISMATCH: same path, different version. The sharp one.
 *   2. UNEXPECTED: installed but absent from the lockfile.
 *   3. MISSING: in the lockfile, not installed. Only counted for entries that are not
 *      `optional` and carry no `os`/`cpu` constraint, because a lockfile legitimately describes
 *      platform-specific packages this machine must not have.
 *
 * SCOPE: every tracked `package-lock.json` (root and workspaces-as-directories such as `server/`
 * or `cli/`), each checked against its sibling `node_modules/.package-lock.json`. npm only: a
 * contract answering `packageManager` other than `npm` exits 0, since the hidden lockfile is an
 * npm artifact.
 *
 * `--self-test` proves the comparison against synthetic pairs rather than the real tree: a
 * regression in the compare logic must fail even on a machine whose install is perfectly clean.
 *
 * Usage:
 * - Check:                       node scripts/validate-lockfile-sync.mjs [--root <dir>]
 * - Prove the comparison logic:  node scripts/validate-lockfile-sync.mjs --self-test
 * Exit: 0 = every tree matches its lockfile (or nothing to check), 1 = drift or not installed,
 * 2 = invalid usage.
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const LOCKFILE = "package-lock.json";
const INSTALLED_LOCKFILE = path.join("node_modules", ".package-lock.json");
const CONTRACT_FILE = ".delivery-contract.json";
const MAX_REPORTED = 12;
const USAGE =
  "Usage: validate-lockfile-sync.mjs [--root <dir>] | validate-lockfile-sync.mjs --self-test";

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
    if (location === "") continue;
    const installedEntry = installed[location];

    if (!installedEntry) {
      if (!isPlatformExcluded(lockedEntry)) {
        findings.push({
          kind: "missing",
          location,
          expected: lockedEntry.version,
        });
      }
      continue;
    }

    if (lockedEntry.version !== installedEntry.version) {
      findings.push({
        kind: "mismatch",
        location,
        expected: lockedEntry.version,
        actual: installedEntry.version,
      });
    }
  }

  for (const [location, installedEntry] of Object.entries(installed)) {
    if (location === "") continue;
    if (!locked[location]) {
      findings.push({
        kind: "unexpected",
        location,
        actual: installedEntry.version,
      });
    }
  }

  return findings;
}

function describe(finding) {
  if (finding.kind === "mismatch") {
    return `  VERSION MISMATCH ${finding.location}: lockfile ${finding.expected}, installed ${finding.actual}`;
  }
  if (finding.kind === "missing") {
    return `  MISSING ${finding.location}: lockfile ${finding.expected}, not installed`;
  }
  return `  UNEXPECTED ${finding.location}: installed ${finding.actual}, absent from the lockfile`;
}

function readJson(file) {
  return JSON.parse(readFileSync(file, "utf8"));
}

/** The package manager the contract declares; a missing file or answer means npm. */
function declaredPackageManager(rootDir) {
  const contractPath = path.join(rootDir, CONTRACT_FILE);
  if (!existsSync(contractPath)) return "npm";
  return readJson(contractPath).answers?.packageManager ?? "npm";
}

/**
 * Every tracked package-lock.json, relative to rootDir. Outside a git repository (a fixture, an
 * unpacked tarball) the root lockfile is the only candidate.
 */
export function listTrackedLockfiles(rootDir) {
  const listed = spawnSync(
    "git",
    ["-C", rootDir, "ls-files", "--", LOCKFILE, `*/${LOCKFILE}`],
    { encoding: "utf8" },
  );
  if (listed.status !== 0) {
    return existsSync(path.join(rootDir, LOCKFILE)) ? [LOCKFILE] : [];
  }
  return listed.stdout.split("\n").filter(Boolean);
}

function summarize(findings) {
  const counts = findings.reduce((acc, finding) => {
    acc[finding.kind] = (acc[finding.kind] ?? 0) + 1;
    return acc;
  }, {});
  return Object.entries(counts)
    .map(([kind, count]) => `${kind}=${count}`)
    .join(", ");
}

/** Check one lockfile against its sibling hidden lockfile; returns the directory's report. */
function checkDirectory(rootDir, lockfileRelative) {
  const directory = path.dirname(lockfileRelative);
  const label = directory === "." ? "." : directory;
  const installedPath = path.join(rootDir, directory, INSTALLED_LOCKFILE);
  const lockfilePath = path.join(rootDir, lockfileRelative);

  if (!existsSync(lockfilePath)) {
    return {
      label,
      failed: true,
      lines: [
        `[lockfile-sync] FAIL ${label}: ${lockfileRelative} is tracked but not on disk.`,
      ],
    };
  }
  if (!existsSync(installedPath)) {
    return {
      label,
      failed: true,
      lines: [
        `[lockfile-sync] FAIL ${label}: not installed. ${path.join(directory, INSTALLED_LOCKFILE)} ` +
          "not found: nothing is installed there, or the tree was assembled by something other than npm. " +
          `Run \`npm ci\` in ${label}.`,
      ],
    };
  }

  const findings = comparePackages(
    readJson(lockfilePath).packages ?? {},
    readJson(installedPath).packages ?? {},
  );
  if (findings.length === 0) {
    return {
      label,
      failed: false,
      lines: [
        `[lockfile-sync] OK ${label}: the installed tree matches ${LOCKFILE}`,
      ],
    };
  }

  const lines = [
    `[lockfile-sync] FAIL ${label}: ${findings.length} package(s) differ from ${lockfileRelative} (${summarize(findings)}).`,
    ...findings.slice(0, MAX_REPORTED).map(describe),
  ];
  if (findings.length > MAX_REPORTED) {
    lines.push(`  ... and ${findings.length - MAX_REPORTED} more`);
  }
  return { label, failed: true, lines };
}

/**
 * Check each listed lockfile (paths relative to rootDir). Prints per-directory reports and
 * returns the exit code: 1 when any directory has findings or is not installed.
 */
export function checkLockfiles(rootDir, lockfileRelatives) {
  if (lockfileRelatives.length === 0) {
    console.log(
      `[lockfile-sync] OK: no tracked ${LOCKFILE} under ${rootDir}, nothing to check`,
    );
    return 0;
  }

  const reports = lockfileRelatives.map((lockfileRelative) =>
    checkDirectory(rootDir, lockfileRelative),
  );
  for (const report of reports) {
    const stream = report.failed ? console.error : console.log;
    for (const line of report.lines) stream(line);
  }

  const failed = reports.filter((report) => report.failed);
  if (failed.length === 0) return 0;
  console.error(
    `\n[lockfile-sync] ${failed.length} of ${reports.length} director${reports.length === 1 ? "y" : "ies"} ` +
      `drifted (${failed.map((report) => report.label).join(", ")}). ` +
      "Every local validate:* result was measured against this tree, not against the one CI " +
      "installs. Run `npm ci` in each directory named above and re-run whatever you were validating.",
  );
  return 1;
}

/** The whole check for a repository root: contract gate, lockfile enumeration, comparison. */
export function checkRepository(rootDir) {
  const manager = declaredPackageManager(rootDir);
  if (manager !== "npm") {
    console.log(
      `[lockfile-sync] OK: packageManager is "${manager}"; this check is npm-only (it reads ` +
        "npm's node_modules/.package-lock.json), nothing to check",
    );
    return 0;
  }
  return checkLockfiles(rootDir, listTrackedLockfiles(rootDir));
}

function selfTestCases() {
  return [
    {
      name: "an identical tree produces no findings",
      locked: { "": {}, "node_modules/knip": { version: "6.32.2" } },
      installed: { "": {}, "node_modules/knip": { version: "6.32.2" } },
      expect: [],
    },
    {
      name: "a version mismatch is reported",
      locked: { "node_modules/knip": { version: "6.32.2" } },
      installed: { "node_modules/knip": { version: "6.32.1" } },
      expect: ["mismatch"],
    },
    {
      name: "a package in the lockfile but not installed is reported",
      locked: { "node_modules/get-tsconfig": { version: "4.14.2" } },
      installed: {},
      expect: ["missing"],
    },
    {
      name: "an installed package absent from the lockfile is reported",
      locked: {},
      installed: { "node_modules/@emnapi/runtime": { version: "1.11.2" } },
      expect: ["unexpected"],
    },
    {
      name: "an uninstalled optional package is NOT drift",
      locked: {
        "node_modules/fsevents": { version: "2.3.3", optional: true },
      },
      installed: {},
      expect: [],
    },
    {
      name: "an uninstalled platform-constrained package is NOT drift",
      locked: {
        "node_modules/@esbuild/darwin-arm64": {
          version: "0.28.0",
          os: ["darwin"],
          cpu: ["arm64"],
        },
      },
      installed: {},
      expect: [],
    },
    {
      name: "the root entry is never compared",
      locked: { "": { version: "4.0.1" } },
      installed: { "": { version: "9.9.9" } },
      expect: [],
    },
  ];
}

function selfTest() {
  console.log("\nvalidate-lockfile-sync self-test: every rule must behave\n");
  let failed = 0;

  for (const { name, locked, installed, expect } of selfTestCases()) {
    const actual = comparePackages(locked, installed).map(
      (finding) => finding.kind,
    );
    const ok =
      actual.length === expect.length &&
      actual.every((kind, i) => kind === expect[i]);
    console.log(`  ${ok ? "ok  " : "FAIL"}  ${name}`);
    if (!ok) {
      failed += 1;
      console.log(`        expected [${expect}], got [${actual}]`);
    }
  }

  if (failed > 0) {
    console.log(`\nself-test: ${failed} rule(s) are not falsifiable\n`);
    return 1;
  }
  console.log(
    `\nself-test: all ${selfTestCases().length} comparison rules distinguish drift from` +
      " legitimate platform exclusions\n",
  );
  return 0;
}

function main(argv) {
  const args = argv.filter((arg) => arg !== "--");
  if (args.length === 1 && args[0] === "--self-test") return selfTest();

  let rootDir = fileURLToPath(new URL("..", import.meta.url));
  if (args.length === 2 && args[0] === "--root" && args[1]) {
    rootDir = path.resolve(args[1]);
  } else if (args.length > 0) {
    console.error(USAGE);
    return 2;
  }
  return checkRepository(rootDir);
}

if (
  process.argv[1] &&
  import.meta.url === new URL(`file://${process.argv[1]}`).href
) {
  process.exit(main(process.argv.slice(2)));
}
