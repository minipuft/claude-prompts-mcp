/**
 * The tree-state guard reports what a run left behind, and can be shown to do so.
 *
 * The guard runs as jest's `globalTeardown`, which is the one place in the suite that CANNOT
 * assert on itself: a teardown that stopped detecting anything would report every run clean, and
 * every run would stay green. So its verdict is exercised here, from inside the suite it guards.
 *
 * WHAT IT MISSED BEFORE 2026-09-15: the guard watched `server/resources` alone, and a fully green
 * `test:e2e` (18/18 suites, 273 tests) left `logs/`, `runtime-state/` and `server/runtime-state/`
 * behind on every run. All three are gitignored, so plain `git status` was silent about them; the
 * one leak that had ever been noticed landed on tracked paths, and the guard's scope was fitted to
 * that leak rather than to where leaks can occur.
 *
 * NOTHING HERE TOUCHES THE REAL TREE. The verdict is driven over fabricated status lines, and the
 * substrate is driven against a scratch repository — planting a file in the real one to prove the
 * guard notices is the exact act the guard exists to prevent.
 */

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// A STATIC import, not `createRequire`: `knip` resolves static specifiers, so a dynamic require
// here would leave every export below reading as dead and push the unused-export ratchet up by
// four — a test that consumes a symbol only at runtime does not stop it being dead on paper.
import {
  DECLARED,
  KNOWN_LEAKS,
  classify,
  declarationFor,
  entryPath,
  listEntries,
} from '../../helpers/tree-state-guard.cjs';

const guard = { DECLARED, KNOWN_LEAKS, classify, declarationFor, entryPath, listEntries };
const SERVER_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');

describe('the verdict', () => {
  const BASE = ['!! node_modules', ' M server/src/index.ts'];

  it('reports a gitignored directory a run created', () => {
    const verdict = guard.classify(BASE, [...BASE, '!! runtime-state/']);
    expect(verdict.unreadable).toBeNull();
    expect(verdict.leaked).toEqual(['!! runtime-state/']);
  });

  it('reports an untracked file a run created', () => {
    const verdict = guard.classify(BASE, [
      ...BASE,
      '?? server/resources/prompts/leaked/prompt.yaml',
    ]);
    expect(verdict.leaked).toEqual(['?? server/resources/prompts/leaked/prompt.yaml']);
  });

  it('reports a tracked file a run MODIFIED', () => {
    // A suite that rewrites a committed fixture is the same class of defect as one that adds a
    // file, and a guard watching only additions would call that run clean.
    const verdict = guard.classify(BASE, [
      ...BASE,
      ' M server/resources/gates/code-quality/gate.yaml',
    ]);
    expect(verdict.leaked).toEqual([' M server/resources/gates/code-quality/gate.yaml']);
  });

  /**
   * The negative control. Every assertion above is also satisfied by a guard that calls
   * everything a leak, which would be turned off within a week.
   */
  it('reports nothing when the run changed nothing', () => {
    const verdict = guard.classify(BASE, [...BASE]);
    expect(verdict.leaked).toEqual([]);
    expect(verdict.unreadable).toBeNull();
  });

  it('does not report a path that pre-existed the run', () => {
    const withResidue = [...BASE, '!! logs/'];
    expect(guard.classify(withResidue, withResidue).leaked).toEqual([]);
  });

  it('routes a declared path to `declared`, not to `leaked`', () => {
    const verdict = guard.classify(BASE, [...BASE, '!! server/coverage/']);
    expect(verdict.leaked).toEqual([]);
    expect(verdict.declared).toEqual(['!! server/coverage/']);
  });

  /**
   * A guard that answers "clean" from an enumeration that failed is worse than no guard: it
   * converts an unmeasured run into a green one.
   */
  it.each([
    ['setup', null, ['!! logs/']],
    ['teardown', [], null],
  ])('refuses to call a run clean when git could not enumerate at %s', (_when, before, after) => {
    const verdict = guard.classify(before as string[] | null, after as string[] | null);
    expect(verdict.unreadable).not.toBeNull();
    expect(verdict.leaked).toEqual([]);
  });
});

describe('a known leak', () => {
  const BASE = ['!! node_modules'];

  it('is reported apart from both `leaked` and `declared`', () => {
    const verdict = guard.classify(BASE, [...BASE, '!! server/runtime-state/']);
    expect(verdict.leaked).toEqual([]);
    expect(verdict.declared).toEqual([]);
    expect(verdict.knownLeaks).toEqual(['!! server/runtime-state/']);
  });

  it('does not shelter a sibling path that merely shares a prefix word', () => {
    // `runtime-state/` at the REPO root is the leak the HOME/runtime-root pair fixed; it must stay
    // a failure, not ride on the server-root entry.
    const verdict = guard.classify(BASE, [...BASE, '!! runtime-state/']);
    expect(verdict.leaked).toEqual(['!! runtime-state/']);
  });

  /**
   * The satisfied-exception check. Each entry names the source line that causes it; when the
   * line is gone the defect is fixed, and an entry that outlives its cause would silently excuse
   * whatever writes to that path NEXT. So this fails, and the fix has to delete the entry.
   */
  it.each(guard.KNOWN_LEAKS.map((entry) => [entry.prefix, entry] as const))(
    '%s still has its cause at HEAD — delete the entry if this fails',
    (_prefix, entry) => {
      const source = readFileSync(path.join(SERVER_ROOT, entry.file), 'utf8');
      expect(source).toContain(entry.anchor);
      expect(entry.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(entry.flipsWhen.length).toBeGreaterThan(10);
    }
  );
});

describe('the porcelain path parser', () => {
  it.each([
    [' M server/src/index.ts', 'server/src/index.ts'],
    ['?? server/tests/new.test.ts', 'server/tests/new.test.ts'],
    ['!! runtime-state/', 'runtime-state/'],
    // A rename's DESTINATION is what the run created; the source is what it removed.
    ['R  docs/old.md -> docs/new.md', 'docs/new.md'],
  ])('reads %s as %s', (line, expected) => {
    expect(guard.entryPath(line)).toBe(expected);
  });
});

describe('every DECLARED entry', () => {
  it('names a generator as its reason', () => {
    expect(guard.DECLARED.length).toBeGreaterThan(0);
    for (const entry of guard.DECLARED) {
      expect(entry.prefix.length).toBeGreaterThan(0);
      // A reason short enough to be "generated" is not a reason — it has to name what writes there.
      expect(entry.reason.length).toBeGreaterThan(20);
    }
  });

  it('matches by path prefix', () => {
    expect(guard.declarationFor('server/coverage/lcov.info')).toBeDefined();
    expect(guard.declarationFor('runtime-state/state.db')).toBeUndefined();
  });
});

/**
 * The substrate, against a scratch repository.
 *
 * `git status` without `--ignored` is silent about exactly the paths this gate was blind to, so
 * the flags are load-bearing rather than incidental. This proves the enumeration reports an
 * ignored file, which is the property the whole widening rests on.
 */
describe('the substrate sees an ignored path', () => {
  let repo: string;

  beforeAll(() => {
    repo = mkdtempSync(path.join(os.tmpdir(), 'tree-state-guard-substrate-'));
    const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, stdio: 'ignore' });
    git('init', '--quiet');
    git('config', 'user.email', 'test@example.com');
    git('config', 'user.name', 'test');
    writeFileSync(path.join(repo, '.gitignore'), 'runtime-state/\n');
    git('add', '.gitignore');
    git('commit', '--quiet', '-m', 'seed');
  });

  afterAll(() => rmSync(repo, { recursive: true, force: true }));

  it('reports a file under an ignored directory', () => {
    const before = guard.listEntries(repo);
    expect(before).toEqual([]);

    mkdirSync(path.join(repo, 'runtime-state'), { recursive: true });
    writeFileSync(path.join(repo, 'runtime-state', 'state.db'), 'x');

    const after = guard.listEntries(repo);
    expect(after).not.toBeNull();
    expect(after?.some((line) => line.startsWith('!!') && line.includes('runtime-state'))).toBe(
      true
    );
    expect(guard.classify(before, after).leaked.length).toBe(1);
  });

  it('returns null rather than an empty list when the directory is not a repository', () => {
    const notARepo = mkdtempSync(path.join(os.tmpdir(), 'tree-state-guard-not-a-repo-'));
    try {
      // Depends on git refusing a non-repository; if it ever stopped refusing, `classify` would
      // read the empty result as "nothing leaked", which is the silent pass this asserts against.
      expect(guard.listEntries(notARepo)).toBeNull();
    } finally {
      rmSync(notARepo, { recursive: true, force: true });
    }
  });
});
