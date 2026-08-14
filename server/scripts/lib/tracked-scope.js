/**
 * Git-tracked file enumeration for gates whose declared scope is shipped content.
 *
 * WHY THIS EXISTS. A gate that says "no X may appear in our source" and implements that by
 * pointing ripgrep at a directory is not measuring its own claim. It is measuring "files ripgrep
 * chooses to visit", which differs from "files we ship" in both directions:
 *
 *   - ripgrep ADDS untracked files. Measured 2026-08-12: 18 untracked files sat inside the scan
 *     roots of four gates — a concurrent session's in-flight modules, scratch tests, and two
 *     brand-new scripts. In a shared worktree that means one session's uncommitted work can red
 *     another session's gate, which is a failure nobody can act on.
 *   - ripgrep DROPS tracked files it has been told to ignore, including every dot-path unless
 *     `--hidden`. That direction is what let `validate-no-methodology-vocab` report success over
 *     11 live violations in 4 files (plan row E4).
 *
 * `git ls-files` is the definition those walks were approximating, so both directions close at
 * once: an untracked file cannot enter, and no ignore rule can remove a tracked one.
 *
 * THE SET IS THE INDEX, NOT HEAD. A newly `git add`ed file is in scope, which is what the
 * pre-commit hook needs — it runs after staging. A file edited but not staged is scanned at its
 * working-tree content, matching what the committer is about to ship.
 *
 * @see validate-no-methodology-vocab.js — the first gate converted, and the incident that
 *      established the pattern.
 */

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

/**
 * Tracked files under the given path prefixes, as paths relative to `cwd`.
 *
 * Pathspecs resolve relative to `cwd`, so callers pass exactly the roots they used to hand to
 * ripgrep and get back the same shape of path.
 *
 * A tracked path deleted in the working tree is dropped: it has no content to search, and passing
 * it makes ripgrep exit 2 for a condition that is not a finding.
 *
 * @param {string[]} prefixes - Path prefixes to enumerate, relative to `cwd`.
 * @param {{cwd?: string}} [options]
 * @returns {string[]} Existing tracked files, relative to `cwd`.
 */
export function trackedFilesUnder(prefixes, options = {}) {
  const cwd = options.cwd ?? process.cwd();

  const output = execFileSync('git', ['ls-files', '--', ...prefixes], {
    cwd,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  });

  return output
    .split('\n')
    .filter((line) => line.trim() !== '')
    .filter((file) => existsSync(path.join(cwd, file)));
}

/**
 * Guard for the empty-scope case.
 *
 * Invoking ripgrep with zero paths makes it read STDIN, so a gate whose scope resolved to nothing
 * would hang or silently pass on empty input rather than report that its roots are wrong. Every
 * caller must decide explicitly; this exists so none of them forget.
 *
 * @param {string[]} files
 * @param {string[]} prefixes
 * @param {string} gateName
 */
export function assertNonEmptyScope(files, prefixes, gateName) {
  if (files.length > 0) return;
  console.error(
    `❌ ${gateName}: scope resolved to zero tracked files under ${prefixes.join(', ')}.\n` +
      '   The scan roots are wrong, or nothing is tracked there. Either way this gate cannot ' +
      'observe anything, so it is failing rather than reporting a vacuous pass.'
  );
  process.exit(1);
}
