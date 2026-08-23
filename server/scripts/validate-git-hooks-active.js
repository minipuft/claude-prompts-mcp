#!/usr/bin/env node
/**
 * Fail when the current worktree is one where git silently skips every hook.
 *
 * WHY THIS EXISTS. `core.hooksPath` is `.husky/_`: a RELATIVE path, resolved from each worktree's
 * own root, pointing at a directory husky GENERATES and then self-ignores (`.husky/_/.gitignore`
 * contains `*`). It is neither tracked nor copied by `git worktree add`, so in a linked worktree
 * the path does not resolve — and git's response to an unresolvable hooksPath is to run nothing,
 * report nothing, and exit 0.
 *
 * Measured 2026-08-17, side by side, identical non-conventional commit message:
 *   worktree created by scripts/create-worktree.js  → commit REJECTED by commit-msg
 *   worktree created by plain `git worktree add`    → commit ACCEPTED, no hook output at all
 *
 * Three commits and two pushes on `feat/phase-guard-declaration-contract` (PR #239) went out of a
 * hookless worktree. Every local gate reported nothing because no local gate ran.
 *
 * WHY A CHECK AND NOT JUST A DOC. The remedy already existed — run husky in the new worktree — and
 * documenting it does not make anyone notice the day they forget. A hook cannot police its own
 * absence, so the detection has to live somewhere that still runs: this is registered in
 * `validate:all`, which CI runs whole and which any contributor runs by hand.
 *
 * WHY IT IS SAFE IN CI. GitHub's checkout is a plain clone, where `--git-dir` and `--git-common-dir`
 * resolve to the same path, so the check reports "not a linked worktree" and passes without
 * inspecting hooks at all. It constrains local worktrees only; it never asks CI to have hooks.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, statSync, readdirSync, constants, accessSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const REPO = path.dirname(SERVER);

/** Hooks that must be present for the repository's contract to hold. */
const REQUIRED_HOOKS = ['pre-commit', 'commit-msg', 'pre-push'];

/**
 * Pure assessment. Takes already-resolved facts so the self-test can drive every branch without
 * creating real worktrees — the checks that needed real ones are covered by the differential in
 * the docblock above, which is a one-time proof, not something to re-run per validation.
 *
 * @param {{isLinkedWorktree: boolean, hooksPath: string|null, presentHooks: string[]}} facts
 * @returns {{skipped: boolean, problems: string[]}}
 */
export function assessHooks(facts) {
  if (!facts.isLinkedWorktree) {
    return { skipped: true, problems: [] };
  }
  if (!facts.hooksPath) {
    return {
      skipped: false,
      problems: [
        'core.hooksPath is unset in a linked worktree, so husky hooks are not wired here.',
      ],
    };
  }
  const missing = REQUIRED_HOOKS.filter((hook) => !facts.presentHooks.includes(hook));
  if (missing.length === 0) {
    return { skipped: false, problems: [] };
  }
  return {
    skipped: false,
    problems: [
      `git will silently skip ${missing.join(', ')} in this linked worktree ` +
        `(core.hooksPath = ${facts.hooksPath}).`,
    ],
  };
}

function git(args) {
  try {
    return execFileSync('git', args, {
      cwd: REPO,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    }).trim();
  } catch {
    return '';
  }
}

/** Resolve the real facts for the worktree this script is running in. */
function gatherFacts() {
  const gitDir = git(['rev-parse', '--git-dir']);
  const commonDir = git(['rev-parse', '--git-common-dir']);
  if (!gitDir || !commonDir) {
    // Not a git checkout at all (a published tarball, a container copy). Nothing to police.
    return { isLinkedWorktree: false, hooksPath: null, presentHooks: [] };
  }
  // Resolve both: in the MAIN worktree these differ textually (`/abs/.git` vs `../.git`) while
  // naming the same directory. Comparing the raw strings would report every main worktree as
  // linked, which is how a check like this ends up disabled for being noisy.
  const linked = path.resolve(REPO, gitDir) !== path.resolve(REPO, commonDir);

  const configured = git(['config', 'core.hooksPath']);
  if (!configured) return { isLinkedWorktree: linked, hooksPath: null, presentHooks: [] };

  const hooksDir = path.resolve(REPO, configured);
  let presentHooks = [];
  if (existsSync(hooksDir) && statSync(hooksDir).isDirectory()) {
    presentHooks = readdirSync(hooksDir).filter((name) => {
      try {
        accessSync(path.join(hooksDir, name), constants.X_OK);
        return true;
      } catch {
        return false;
      }
    });
  }
  return { isLinkedWorktree: linked, hooksPath: configured, presentHooks };
}

function selfTest() {
  let failures = 0;
  const check = (label, condition) => {
    if (condition) console.log(`  ✓ ${label}`);
    else {
      console.error(`  ✗ ${label}`);
      failures += 1;
    }
  };

  const wired = { isLinkedWorktree: true, hooksPath: '.husky/_', presentHooks: REQUIRED_HOOKS };
  const bare = { isLinkedWorktree: true, hooksPath: '.husky/_', presentHooks: [] };
  const partial = { isLinkedWorktree: true, hooksPath: '.husky/_', presentHooks: ['pre-commit'] };
  const mainTree = { isLinkedWorktree: false, hooksPath: null, presentHooks: [] };

  check('a wired linked worktree passes', assessHooks(wired).problems.length === 0);
  check('a hookless linked worktree is a finding', assessHooks(bare).problems.length === 1);
  check(
    'the finding names every missing hook',
    REQUIRED_HOOKS.every((hook) => assessHooks(bare).problems[0].includes(hook))
  );
  check(
    'a PARTIALLY wired worktree is still a finding',
    assessHooks(partial).problems.length === 1 &&
      !assessHooks(partial).problems[0].includes('pre-commit')
  );
  check(
    'a non-linked worktree (CI, plain clone) is skipped, not failed',
    assessHooks(mainTree).skipped
  );
  check(
    'core.hooksPath unset in a linked worktree is a finding',
    assessHooks({ isLinkedWorktree: true, hooksPath: null, presentHooks: [] }).problems.length === 1
  );
  // The check must not depend on hooks EXISTING to decide it is skipped — otherwise a hookless
  // main worktree would be excused by the same branch that excuses CI.
  check(
    'skip is decided by worktree kind, not by hook presence',
    assessHooks({ isLinkedWorktree: false, hooksPath: '.husky/_', presentHooks: [] }).skipped &&
      !assessHooks({ isLinkedWorktree: true, hooksPath: '.husky/_', presentHooks: [] }).skipped
  );

  if (failures > 0) {
    console.error(`\n❌ self-test: ${failures} check(s) failed`);
    process.exit(1);
  }
  console.log(
    '\n✅ self-test: fires on hookless and partially wired linked worktrees, skips plain clones'
  );
}

function main() {
  if (process.argv.includes('--self-test')) {
    selfTest();
    return;
  }
  const facts = gatherFacts();
  const { skipped, problems } = assessHooks(facts);

  if (skipped) {
    console.log("✔ git hooks: not a linked worktree — hook wiring is git's default path here.");
    return;
  }
  if (problems.length === 0) {
    console.log(`✔ git hooks: active in this linked worktree (${REQUIRED_HOOKS.join(', ')}).`);
    return;
  }
  console.error('\n✖ Git hooks are not active in this worktree:\n');
  for (const problem of problems) console.error(`  - ${problem}`);
  console.error(
    '\nGit does not warn about this: an unresolvable core.hooksPath means every hook is skipped\n' +
      'silently, so commits and pushes from here run no local validation at all.\n\n' +
      'Fix:  npx --prefix <main-worktree> husky        (run from THIS directory)\n' +
      'Next time, create worktrees with:  npm run worktree:create -- <path> <branch>\n'
  );
  process.exit(1);
}

main();
