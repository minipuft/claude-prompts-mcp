/**
 * Fails the test run when a suite writes into the PACKAGE resource tree.
 *
 * WHY THIS IS A GATE AND NOT A CLEANUP
 * `claims-conformance` left 7 `examples/conformance_*` prompt directories under
 * `server/resources/prompts` on a fully PASSING run (measured 2026-08-30, 105/105 green). Its own
 * plan row read "the suite cleans up unconditionally, including on failure" — but cleanup was never
 * the defect. The suite believed it was writing to an isolated temp workspace; a helper default
 * outranked the isolation it had asked for, so every mutation landed in the package tree while the
 * scenarios still went green. A cleanup hook would have hidden that and left the isolation broken.
 *
 * `examples/` is tracked, so the residue surfaces as untracked rather than ignored and a later
 * `git add -A` commits it — which happened once already (14 fixtures, reverted at `d881dad2`).
 *
 * WHY A DIFF AND NOT AN EMPTINESS CHECK
 * Asserting the tree is clean would fail on any pre-existing untracked file a developer legitimately
 * has sitting there, so it would be turned off. This records the entry set BEFORE the run and fails
 * only on what the RUN added — which is the property actually being claimed, and is the same
 * before/after shape the row's own falsifier names.
 *
 * It watches the tree by PATH rather than watching the suites that write to it, so a leak from a
 * suite nobody has written yet is caught by the same check.
 */

const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const PACKAGE_RESOURCES = path.join(__dirname, '..', '..', 'resources');

/** Same jest CLI process runs globalSetup and globalTeardown, so the pid keys the handoff. */
function snapshotPath() {
  return path.join(os.tmpdir(), `cpm-package-resources-${process.pid}.json`);
}

/** Every file beneath the package resource tree, as root-relative paths. */
function listEntries(dir, base = dir, found = []) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return found; // No tree is not a leak.
  }
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) listEntries(full, base, found);
    else found.push(path.relative(base, full));
  }
  return found;
}

function capture() {
  fs.writeFileSync(snapshotPath(), JSON.stringify(listEntries(PACKAGE_RESOURCES)), 'utf8');
}

function added() {
  const file = snapshotPath();
  if (!fs.existsSync(file)) return [];
  const before = new Set(JSON.parse(fs.readFileSync(file, 'utf8')));
  fs.rmSync(file, { force: true });
  return listEntries(PACKAGE_RESOURCES)
    .filter((entry) => !before.has(entry))
    .sort();
}

module.exports = { PACKAGE_RESOURCES, capture, added, listEntries };
