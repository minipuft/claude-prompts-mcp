/**
 * Fails the test run when a suite leaves anything behind in the WORKING TREE.
 *
 * WHY THIS IS A GATE AND NOT A CLEANUP
 * `claims-conformance` left 7 `examples/conformance_*` prompt directories under
 * `server/resources/prompts` on a fully PASSING run (measured 2026-08-30, 105/105 green). Its own
 * plan row read "the suite cleans up unconditionally, including on failure" — but cleanup was never
 * the defect. The suite believed it was writing to an isolated temp workspace; a helper default
 * outranked the isolation it had asked for, so every mutation landed in the package tree while the
 * scenarios still went green. A cleanup hook would have hidden that and left the isolation broken.
 *
 * WHY A DIFF AND NOT AN EMPTINESS CHECK
 * Asserting the tree is clean would fail on any pre-existing untracked file a developer legitimately
 * has sitting there, so it would be turned off. This records the entry set BEFORE the run and fails
 * only on what the RUN added — which is the property actually being claimed, and is the same
 * before/after shape the row's own falsifier names.
 *
 * It watches the tree by PATH rather than watching the suites that write to it, so a leak from a
 * suite nobody has written yet is caught by the same check.
 *
 * ── WHY THE WHOLE TREE, NOT JUST `server/resources` ──────────────────────────────────────────
 *
 * Until 2026-09-15 this guard watched exactly one directory, and a fully green `test:e2e` (18/18
 * suites, 273 tests) left three directories behind on every run that it could not see:
 *
 *     logs/mcp-server.log                   repo root
 *     runtime-state/state.db                repo root
 *     server/runtime-state/verify-state.db  server root
 *
 * All three are GITIGNORED, which is precisely why nobody noticed: `git status` is silent about
 * them, so the residue accumulated across every run anyone ever made. `server/resources` was
 * watched because its leak happened to land on TRACKED paths and reddened `git status`. The
 * narrowness was an artifact of which leak was found first, not of where leaks can occur.
 *
 * SUBSTRATE. `git status --porcelain --ignored=matching --untracked-files=all`, run at the repo
 * root — the one enumeration that sees ignored paths, sees modifications to tracked files, and
 * excludes `.git` by construction. A plain directory walk sees `.git` churning on every command
 * and does not know what `.gitignore` covers; plain `git status` cannot see the leak this gate
 * exists to catch. Measured at 6 ms over 44 entries, so it costs nothing to run twice.
 *
 * DECLARED, NOT IGNORED. A path a run may legitimately create is named in `DECLARED` with a
 * reason. There is no silent skip list: a generator that starts writing somewhere new fails this
 * gate until someone states why that is correct, which is the whole difference between a gate and
 * a filter.
 */

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SERVER_ROOT = path.join(__dirname, '..', '..');
const REPO_ROOT = path.join(SERVER_ROOT, '..');

/**
 * Paths a test run may legitimately create, each naming why.
 *
 * `prefix` is matched against the repo-relative path a status line carries. An entry is a claim
 * about a GENERATOR, so it names one; "some tool writes here" is not a reason.
 */
const DECLARED = [
  {
    prefix: 'server/coverage/',
    reason: "jest's own coverage reporter under `test:coverage` — gitignored, never committed",
  },
  {
    prefix: 'coverage/',
    reason: "jest's coverage reporter when run from the repo root",
  },
];

/**
 * Paths a run DOES create, because of a defect that is not fixed yet — deliberately NOT `DECLARED`.
 *
 * `DECLARED` asserts a path belongs to the run. These do not; putting them there would make the
 * defect read as a design decision. They are reported on every run instead of failing it, and
 * each names the source anchor of its cause, so `tests/unit/scripts/tree-state-guard.test.ts`
 * can assert the anchor still exists. The moment the defect is fixed that test fails, and the
 * entry has to be deleted in the same change — an exception list with no satisfied-exception
 * check is a place defects go to become permanent.
 *
 * `as of` / `flips when` are the two stamps an open marker needs to be checkable later.
 */
const KNOWN_LEAKS = [
  {
    prefix: 'server/runtime-state/',
    file: 'src/mcp/tools/prompt-engine/core/pipeline-builder.ts',
    anchor: "runtimeStateDir: path.join(deps.serverRoot, 'runtime-state')",
    defect:
      '`verify-state.db` is placed under `deps.serverRoot` — the PACKAGE directory — instead of ' +
      'the PathResolver runtime root, so it ignores MCP_RUNTIME_ROOT and MCP_WORKSPACE. The ' +
      'sixth consumer of the shape ConfigManager.get{Prompts,Frameworks,Gates,Scripts,Styles}' +
      'Directory() already fixed five times, and the only one still reading serverRoot.',
    asOf: '2026-09-16',
    flipsWhen: '`anchor` no longer appears in `file` — then delete this entry',
  },
];

/** The declared entry covering `entryPath`, or `undefined`. */
function declarationFor(entryPath) {
  return DECLARED.find((entry) => entryPath.startsWith(entry.prefix));
}

/** The known-leak entry covering `entryPath`, or `undefined`. */
function knownLeakFor(entryPath) {
  return KNOWN_LEAKS.find((entry) => entryPath.startsWith(entry.prefix));
}

/** Same jest CLI process runs globalSetup and globalTeardown, so the pid keys the handoff. */
function snapshotPath() {
  return path.join(os.tmpdir(), `cpm-tree-state-${process.pid}.json`);
}

/**
 * The repo-relative path a porcelain line refers to.
 *
 * Porcelain v1 is `XY <path>`, with a rename spelled `R  <old> -> <new>`; the destination is what
 * a run created. Quoted paths (non-ASCII, spaces) keep their quotes — they still compare equal
 * across the two snapshots, which is all the diff needs.
 */
function entryPath(line) {
  const rest = line.slice(3);
  const arrow = rest.indexOf(' -> ');
  return arrow === -1 ? rest : rest.slice(arrow + 4);
}

/**
 * Every working-tree entry git can see under `cwd`, ignored ones included.
 *
 * Returns `null` rather than `[]` when git cannot answer. An empty list from a failed command
 * would make the after-diff empty too, so the gate would pass having measured nothing — the exact
 * silent-success shape it exists to prevent.
 *
 * `cwd` is a parameter so the unit test can drive this against a scratch repository and prove the
 * substrate really does report an IGNORED file. Pointing the positive control at the real tree
 * would mean planting a file in it, which is the one thing this gate exists to make impossible.
 */
function listEntries(cwd = REPO_ROOT) {
  try {
    const stdout = execFileSync(
      'git',
      ['status', '--porcelain', '--ignored=matching', '--untracked-files=all'],
      { cwd, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }
    );
    return stdout.split('\n').filter((line) => line.trim() !== '');
  } catch {
    return null;
  }
}

/**
 * Split what appeared between two enumerations into declared and undeclared.
 *
 * Pure, and separate from the snapshot plumbing, so the verdict can be asserted over fabricated
 * inputs. `unreadable` is its own outcome rather than an empty result: a run whose before- or
 * after-state could not be enumerated has not been SHOWN to be clean, and a gate that reports
 * "nothing leaked" from a probe that never ran is the failure mode, not the success one.
 */
function classify(before, after) {
  if (before === null)
    return { unreadable: 'git could not enumerate the tree at setup', leaked: [] };
  if (after === null) {
    return { unreadable: 'git could not enumerate the tree at teardown', leaked: [] };
  }

  const known = new Set(before);
  const fresh = after.filter((line) => !known.has(line)).sort();
  const isDeclared = (line) => declarationFor(entryPath(line)) !== undefined;
  const isKnownLeak = (line) => knownLeakFor(entryPath(line)) !== undefined;
  return {
    unreadable: null,
    leaked: fresh.filter((line) => !isDeclared(line) && !isKnownLeak(line)),
    declared: fresh.filter(isDeclared),
    knownLeaks: fresh.filter((line) => !isDeclared(line) && isKnownLeak(line)),
  };
}

function capture() {
  fs.writeFileSync(snapshotPath(), JSON.stringify(listEntries()), 'utf8');
}

/** The run's verdict: what it added, split by whether anything declares it. */
function added() {
  const file = snapshotPath();
  if (!fs.existsSync(file)) return { unreadable: 'no snapshot from globalSetup', leaked: [] };

  const before = JSON.parse(fs.readFileSync(file, 'utf8'));
  fs.rmSync(file, { force: true });
  return classify(before, before === null ? null : listEntries());
}

module.exports = {
  REPO_ROOT,
  DECLARED,
  KNOWN_LEAKS,
  capture,
  added,
  classify,
  listEntries,
  entryPath,
  declarationFor,
};
