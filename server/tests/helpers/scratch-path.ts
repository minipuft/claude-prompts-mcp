/**
 * A unique scratch path OUTSIDE the working tree, for a test that needs a real directory.
 *
 * Until 2026-09-16, twenty sites across nineteen files built scratch directories as
 * `path.join(process.cwd(), 'tests/tmp/<name>')`. Each removed its own subdirectory and left the
 * `tests/tmp/` parent behind, so every run left an entry in the tree — gitignored, and therefore
 * invisible until `tests/helpers/tree-state-guard.cjs` started watching the whole tree. Git reports
 * that directory as ONE collapsed entry whatever it holds, so declaring it as belonging to the run
 * would also have excused anything a failing suite left inside it.
 *
 * WHY NOT A FIXED NAME UNDER `os.tmpdir()`. The cwd-relative path had one real property: it was
 * per-worktree. This machine runs many linked worktrees whose suites run concurrently, and a fixed
 * `/tmp/<name>` would let two of them delete each other's database mid-test. The pid plus a random
 * suffix keeps that isolation.
 *
 * WHY THE PATH IS NOT CREATED. Every replaced site computed a path and then decided for itself
 * whether to `rm` it, `mkdir` it, or assert it absent. Returning an existing directory would change
 * that contract at twenty sites at once; returning a fresh, unused path keeps it byte-for-byte.
 */

import { randomUUID } from 'node:crypto';
import os from 'node:os';
import path from 'node:path';

/** `<os tmp>/cpm-<name>-<pid>-<uuid>` — unique, absent, and never inside the repository. */
export function testScratchPath(name: string): string {
  return path.join(os.tmpdir(), `cpm-${name}-${process.pid}-${randomUUID()}`);
}
