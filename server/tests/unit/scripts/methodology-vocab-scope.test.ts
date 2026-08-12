/**
 * What the methodology-vocab gate is allowed to look at.
 *
 * The gate was silently blind for months: ripgrep skips dot-paths without `--hidden`, and
 * `.gitignore` lists `CLAUDE.md` even though it is tracked. 57 tracked files were outside the scan
 * and four of them held 11 live occurrences while the gate reported success (plan row 0.8). The
 * scope is now the git-tracked set, which is the definition the old walk was approximating.
 *
 * Imported rather than spawned: `inScopeFiles` is pure, so the scope rules can be driven with
 * fabricated paths — no repository, no git, no ripgrep. The end-to-end behaviour is covered by
 * running the guard itself in `validate:all`.
 *
 * The load-bearing cases here are the two file classes the old scan could not reach, and the one
 * class it wrongly reached. A test that only checked the exclusions would have passed against the
 * blind version.
 */

import { describe, expect, it } from '@jest/globals';

import { inScopeFiles } from '../../../scripts/validate-no-methodology-vocab.js';

describe('methodology-vocab scope — files the old walk could not reach', () => {
  it.each([
    [
      '.github/ISSUE_TEMPLATE/feature_request.yml',
      'a dot-directory ripgrep skips without --hidden',
    ],
    ['.claude/rules/mcp-contracts.md', 'a second dot-directory, holding project rules'],
    ['.husky/pre-commit', 'hook scripts under a dot-directory'],
    ['CLAUDE.md', 'tracked, but listed in .gitignore — invisible to an ignore-aware walk'],
  ])('keeps %s in scope (%s)', (file) => {
    expect(inScopeFiles([file])).toEqual([file]);
  });
});

describe('methodology-vocab scope — deliberate exclusions', () => {
  it.each([
    ['plans/techincal_debt/some-plan.md', 'archived plan files'],
    ['plans/reference/nested/deep/notes.md', 'plans at any depth'],
    ['CHANGELOG.md', 'historical release record'],
    ['cli/dist/index.js', 'build artifact'],
    ['server/dist/index.js', 'build artifact'],
    ['server/node_modules/pkg/readme.md', 'third-party'],
  ])('drops %s (%s)', (file) => {
    expect(inScopeFiles([file])).toEqual([]);
  });

  it('does not drop a path that merely contains an excluded word', () => {
    // `plans/` is a path segment, not a substring: a file named `deployment-plans.md` ships.
    const kept = ['docs/deployment-plans.md', 'src/plansmith.ts', 'src/distributed-cache.ts'];
    expect(inScopeFiles(kept)).toEqual(kept);
  });
});

describe('methodology-vocab scope — scope is the input set', () => {
  it('returns only files it was given, so an untracked file cannot enter', () => {
    // The 2026-08-09 regression: a repo-root `.ignore` widened the walk to 17 untracked prompts
    // and turned the gate red on files that ship to nobody. Deriving scope from `git ls-files`
    // makes that unreachable — there is no walk left to widen.
    const tracked = ['src/a.ts', 'src/b.ts'];
    expect(inScopeFiles(tracked)).toEqual(tracked);
    expect(inScopeFiles([])).toEqual([]);
  });

  it('preserves order and does not duplicate', () => {
    const tracked = ['src/z.ts', 'CLAUDE.md', 'src/a.ts'];
    expect(inScopeFiles(tracked)).toEqual(tracked);
  });
});
