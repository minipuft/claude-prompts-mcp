#!/usr/bin/env node
/**
 * Typecheck the COMMITTED state, not the working tree.
 *
 * WHY THIS EXISTS. `npm run typecheck` compiles the working tree, which is a state CI never sees.
 * CI checks out the commit. When those two disagree the local gate is green and CI is red, and the
 * disagreement is not exotic — it is what a shared worktree produces routinely:
 *
 *   commit A stages `consumer.ts`, which imports a symbol from `provider.ts`
 *   `provider.ts` is untracked, or its export is an unstaged hunk
 *   → working tree compiles (the provider is right there on disk)
 *   → the commit does not (the provider was never committed)
 *
 * Measured 2026-08-12: `8875ab42` did exactly this with three symbols across two parser files, and
 * every local gate passed. Two of the three providers belonged to a concurrent session editing the
 * same files; staging whole files took their consumer lines and left their providers behind.
 *
 * MECHANISM. A detached worktree at HEAD is the only way to compile the commit without disturbing
 * the working tree — `git stash` would, and in a shared worktree that means touching someone
 * else's uncommitted work. `node_modules` is symlinked rather than installed: type resolution
 * needs it, and a real install would cost minutes per push.
 *
 * SUBSET RELATION. This is a STRICTER subset of CI than the working-tree typecheck it joins, not a
 * new obligation: CI's typecheck runs against the checked-out commit, so this runs the same
 * compilation against the same input. Pre-commit keeps typechecking the tree — that is the right
 * scope for "is what I am about to commit coherent" — and this answers "is what I am about to push
 * coherent", which is a different question with a different answer.
 */

import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SERVER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const REPO = path.resolve(SERVER, '..');

function git(args, cwd = REPO) {
  return execFileSync('git', args, { cwd, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }).trim();
}

/**
 * When the working tree is identical to HEAD — no modifications, no untracked files — the two
 * compilations have the same input and the plain typecheck already covered it.
 *
 * Untracked files count. An untracked provider is the exact defect this check exists for, so
 * treating "only untracked files differ" as clean would skip the one case that matters.
 */
function treeMatchesHead() {
  return git(['status', '--porcelain']) === '';
}

function main() {
  if (treeMatchesHead()) {
    console.log('✅ typecheck:committed — working tree is identical to HEAD, already covered.');
    return;
  }

  const head = git(['rev-parse', '--short', 'HEAD']);
  const scratch = mkdtempSync(path.join(tmpdir(), 'cpm-committed-'));
  const worktree = path.join(scratch, 'tree');

  let failed = false;
  try {
    git(['worktree', 'add', '--detach', '--quiet', worktree, 'HEAD']);

    const modules = path.join(SERVER, 'node_modules');
    if (!existsSync(modules)) {
      console.error('❌ typecheck:committed: server/node_modules is missing — run `npm install`.');
      process.exitCode = 1;
      return;
    }
    symlinkSync(modules, path.join(worktree, 'server', 'node_modules'), 'dir');

    console.log(`   compiling committed state at ${head} (detached worktree)…`);
    const result = spawnSync(
      process.execPath,
      [path.join(modules, 'typescript', 'bin', 'tsc'), '--noEmit', '-p', 'tsconfig.json'],
      { cwd: path.join(worktree, 'server'), encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }
    );

    if (result.status !== 0) {
      failed = true;
      console.error(`\n❌ The COMMIT does not typecheck, although the working tree does.\n`);
      console.error(result.stdout?.trim() || result.stderr?.trim() || '(no compiler output)');
      console.error(
        '\nThis is almost always a consumer committed without its provider: a file that was\n' +
          'staged imports something that is still untracked or sits in an unstaged hunk. Commit\n' +
          'the missing definition — do not revert the consumer, and in a shared worktree do not\n' +
          'assume the missing file is yours.\n'
      );
    }
  } finally {
    // Order matters: prune the registration before deleting the directory, or git keeps a stale
    // worktree entry that makes the NEXT run fail on an unrelated "already exists".
    try {
      git(['worktree', 'remove', '--force', worktree]);
    } catch {
      rmSync(scratch, { recursive: true, force: true });
      try {
        git(['worktree', 'prune']);
      } catch {
        /* nothing further to clean */
      }
    }
    rmSync(scratch, { recursive: true, force: true });
  }

  if (failed) {
    process.exitCode = 1;
    return;
  }
  console.log(`✅ typecheck:committed — ${head} compiles standalone.`);
}

main();
