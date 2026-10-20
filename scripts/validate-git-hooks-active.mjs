#!/usr/bin/env node
/**
 * Fail when the current worktree is one where git silently skips every tracked hook.
 *
 * WHY THIS EXISTS. husky sets `core.hooksPath` to `.husky/_`: a RELATIVE path, resolved from each
 * worktree's own root, pointing at a directory husky GENERATES and then self-ignores
 * (`.husky/_/.gitignore` contains `*`). It is neither tracked nor copied by `git worktree add`, so
 * in a linked worktree the path does not resolve, and git's response to an unresolvable hooksPath
 * is to run nothing, report nothing, and exit 0.
 *
 * Measured once, side by side, with an identical non-conventional commit message: a worktree
 * created by `scripts/create-worktree.mjs` rejected the commit at `commit-msg`; a worktree created
 * by plain `git worktree add` accepted it with no hook output at all. Commits and pushes have gone
 * out of a hookless worktree this way with every local gate silent, because no local gate ran.
 *
 * WHICH HOOKS. The required list is derived, never a constant: every tracked `.husky/<name>` whose
 * name is one of git's own hooks. Anything under `.husky/_/` (husky's generated wrappers) and any
 * tracked non-hook file (`.husky/.gitignore`, a helper script) is not a hook. A repository that
 * tracks no hook has nothing to police, and the check skips with that reason.
 *
 * WHY A CHECK AND NOT JUST A DOC. A hook cannot police its own absence, so the detection has to
 * live somewhere that still runs: a validation suite that CI runs whole and contributors run by
 * hand.
 *
 * WHY IT IS SAFE IN CI. A CI checkout is a plain clone, where `--git-dir` and `--git-common-dir`
 * resolve to the same path, so the check reports "not a linked worktree" and passes without
 * inspecting hooks at all. It constrains local linked worktrees only.
 *
 * USAGE
 *   node scripts/validate-git-hooks-active.mjs [--root <dir>]
 *   node scripts/validate-git-hooks-active.mjs --self-test
 */

import { execFileSync } from "node:child_process";
import {
  accessSync,
  constants,
  existsSync,
  readdirSync,
  statSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const USAGE =
  "Usage: validate-git-hooks-active.mjs [--root <dir>] | validate-git-hooks-active.mjs --self-test";

const CREATE_WORKTREE =
  "node scripts/create-worktree.mjs <path> <branch> [--from <ref>]";

/** The hook names git itself invokes (githooks(5)); a tracked `.husky/<name>` outside this set is not a hook. */
export const GIT_HOOK_NAMES = Object.freeze([
  "applypatch-msg",
  "pre-applypatch",
  "post-applypatch",
  "pre-commit",
  "pre-merge-commit",
  "prepare-commit-msg",
  "commit-msg",
  "post-commit",
  "pre-rebase",
  "post-checkout",
  "post-merge",
  "pre-push",
  "pre-auto-gc",
  "post-rewrite",
  "sendemail-validate",
  "fsmonitor-watchman",
  "p4-changelist",
  "p4-prepare-changelist",
  "p4-post-changelist",
  "p4-pre-submit",
  "post-index-change",
]);

/**
 * Parse CLI arguments. Pure: returns `{ root, selfTest }`, or `{ error }` naming the usage.
 *
 * @param {string[]} argv arguments after the script path
 * @param {string} defaultRoot the root used when `--root` is absent
 */
export function parseArgs(argv, defaultRoot) {
  const args = argv.filter((arg) => arg !== "--");
  if (args.length === 1 && args[0] === "--self-test") {
    return { root: defaultRoot, selfTest: true };
  }
  if (args.length === 0) return { root: defaultRoot, selfTest: false };
  if (args.length === 2 && args[0] === "--root" && args[1]) {
    return { root: path.resolve(args[1]), selfTest: false };
  }
  return { error: USAGE };
}

/**
 * Pure classification of `git ls-files -- .husky` output into hook names: direct children of
 * `.husky/` only (so nothing under `.husky/_/`), and only names git invokes as hooks.
 *
 * @param {string[]} trackedPaths repository-relative paths
 * @returns {string[]} sorted hook names
 */
export function hooksFromTrackedPaths(trackedPaths) {
  const hooks = new Set();
  for (const tracked of trackedPaths) {
    if (!tracked.startsWith(".husky/")) continue;
    const rest = tracked.slice(".husky/".length);
    if (rest.includes("/")) continue;
    if (GIT_HOOK_NAMES.includes(rest)) hooks.add(rest);
  }
  return [...hooks].sort();
}

function git(root, args) {
  try {
    return execFileSync("git", ["-C", root, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });
  } catch {
    return null;
  }
}

/**
 * The derivation both this validator and `create-worktree.mjs` read: the hooks this repository
 * tracks under `.husky/`. Empty when the directory is not a git checkout or tracks no hook.
 *
 * @param {string} root a worktree root
 * @returns {string[]} sorted hook names
 */
export function trackedHooks(root) {
  const listed = git(root, ["ls-files", "-z", "--", ".husky"]);
  if (!listed) return [];
  return hooksFromTrackedPaths(listed.split("\0").filter(Boolean));
}

/**
 * Pure assessment. Takes already-resolved facts and the required hook list so the self-test and
 * the unit tests can drive every branch without creating real worktrees.
 *
 * @param {{isLinkedWorktree: boolean, hooksPath: string|null, presentHooks: string[]}} facts
 * @param {string[]} requiredHooks the derived tracked-hook list
 * @returns {{skipped: boolean, reason: string|null, problems: string[]}}
 */
export function assessHooks(facts, requiredHooks) {
  if (!facts.isLinkedWorktree) {
    return {
      skipped: true,
      reason:
        "not a linked worktree, so hook wiring is git's default path here",
      problems: [],
    };
  }
  if (requiredHooks.length === 0) {
    return {
      skipped: true,
      reason: "no hook is tracked under .husky/, so there is nothing to wire",
      problems: [],
    };
  }
  if (!facts.hooksPath) {
    return {
      skipped: false,
      reason: null,
      problems: [
        `core.hooksPath is unset in a linked worktree, so the tracked hooks (${requiredHooks.join(", ")}) are not wired here.`,
      ],
    };
  }
  const missing = requiredHooks.filter(
    (hook) => !facts.presentHooks.includes(hook),
  );
  if (missing.length === 0)
    return { skipped: false, reason: null, problems: [] };
  return {
    skipped: false,
    reason: null,
    problems: [
      `git will silently skip ${missing.join(", ")} in this linked worktree ` +
        `(core.hooksPath = ${facts.hooksPath}).`,
    ],
  };
}

function executableEntries(directory) {
  if (!existsSync(directory) || !statSync(directory).isDirectory()) return [];
  return readdirSync(directory).filter((name) => {
    try {
      accessSync(path.join(directory, name), constants.X_OK);
      return true;
    } catch {
      return false;
    }
  });
}

/** Resolve the real facts for the worktree rooted at `root`. */
export function gatherFacts(root) {
  const gitDir = git(root, ["rev-parse", "--git-dir"])?.trim();
  const commonDir = git(root, ["rev-parse", "--git-common-dir"])?.trim();
  if (!gitDir || !commonDir) {
    // Not a git checkout at all (a published tarball, a container copy). Nothing to police.
    return { isLinkedWorktree: false, hooksPath: null, presentHooks: [] };
  }
  // Resolve both: in the MAIN worktree they can differ textually (`/abs/.git` vs `.git`) while
  // naming the same directory. Comparing raw strings would report every main worktree as linked.
  const linked = path.resolve(root, gitDir) !== path.resolve(root, commonDir);

  const configured = git(root, ["config", "core.hooksPath"])?.trim();
  if (!configured) {
    return { isLinkedWorktree: linked, hooksPath: null, presentHooks: [] };
  }
  return {
    isLinkedWorktree: linked,
    hooksPath: configured,
    presentHooks: executableEntries(path.resolve(root, configured)),
  };
}

function selfTest() {
  let failures = 0;
  const check = (label, condition) => {
    if (condition) console.log(`  ok   ${label}`);
    else {
      console.error(`  FAIL ${label}`);
      failures += 1;
    }
  };

  const required = ["commit-msg", "pre-commit", "pre-push"];
  const linked = (presentHooks, hooksPath = ".husky/_") => ({
    isLinkedWorktree: true,
    hooksPath,
    presentHooks,
  });
  const bare = assessHooks(linked([]), required);
  const partial = assessHooks(linked(["pre-commit"]), required);

  check(
    "a wired linked worktree passes",
    assessHooks(linked(required), required).problems.length === 0,
  );
  check("a hookless linked worktree is a finding", bare.problems.length === 1);
  check(
    "the finding names every missing hook",
    required.every((hook) => bare.problems[0].includes(hook)),
  );
  check(
    "a PARTIALLY wired worktree is still a finding, naming only what is missing",
    partial.problems.length === 1 &&
      !partial.problems[0].includes("pre-commit"),
  );
  check(
    "a non-linked worktree (CI, plain clone) is skipped, not failed",
    assessHooks(
      { isLinkedWorktree: false, hooksPath: null, presentHooks: [] },
      required,
    ).skipped,
  );
  check(
    "core.hooksPath unset in a linked worktree is a finding when hooks are tracked",
    assessHooks(linked([], null), required).problems.length === 1,
  );
  check(
    "no tracked hook skips with a named reason, even with core.hooksPath unset",
    (() => {
      const result = assessHooks(linked([], null), []);
      return result.skipped && /no hook is tracked/.test(result.reason);
    })(),
  );
  // The check must not depend on hooks EXISTING to decide it is skipped; otherwise a hookless
  // main worktree would be excused by the same branch that excuses CI.
  check(
    "skip is decided by worktree kind, not by hook presence",
    assessHooks(
      { isLinkedWorktree: false, hooksPath: ".husky/_", presentHooks: [] },
      required,
    ).skipped && !assessHooks(linked([]), required).skipped,
  );
  check(
    "the derivation keeps direct hooks and drops .husky/_/, .gitignore and helpers",
    JSON.stringify(
      hooksFromTrackedPaths([
        ".husky/commit-msg",
        ".husky/pre-push",
        ".husky/.gitignore",
        ".husky/lib.sh",
        ".husky/_/pre-commit",
        "src/pre-commit",
      ]),
    ) === JSON.stringify(["commit-msg", "pre-push"]),
  );

  if (failures > 0) {
    console.error(`\nself-test: ${failures} check(s) failed`);
    return 1;
  }
  console.log(
    "\nself-test: fires on hookless and partially wired linked worktrees, skips plain clones and hookless repositories",
  );
  return 0;
}

function main(argv) {
  const defaultRoot = fileURLToPath(new URL("..", import.meta.url));
  const args = parseArgs(argv, defaultRoot);
  if (args.error) {
    console.error(args.error);
    return 2;
  }
  if (args.selfTest) return selfTest();

  const required = trackedHooks(args.root);
  const { skipped, reason, problems } = assessHooks(
    gatherFacts(args.root),
    required,
  );

  if (skipped) {
    console.log(`git hooks: skipped (${reason}).`);
    return 0;
  }
  if (problems.length === 0) {
    console.log(
      `git hooks: active in this linked worktree (${required.join(", ")}).`,
    );
    return 0;
  }
  console.error("\nGit hooks are not active in this worktree:\n");
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error(
    "\nGit does not warn about this: an unresolvable core.hooksPath means every hook is skipped\n" +
      "silently, so commits and pushes from here run no local validation at all.\n\n" +
      "Fix:  node <main-worktree>/node_modules/husky/bin.js        (run from THIS directory)\n" +
      `Next time, create worktrees with:  ${CREATE_WORKTREE}\n`,
  );
  return 1;
}

if (
  process.argv[1] &&
  import.meta.url === new URL(`file://${process.argv[1]}`).href
) {
  process.exit(main(process.argv.slice(2)));
}
