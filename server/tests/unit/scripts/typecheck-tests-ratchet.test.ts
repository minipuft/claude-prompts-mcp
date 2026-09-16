/**
 * Pins the typecheck-tests-ratchet.js baseline-increase guard: `update-baseline` used to write a
 * fresh ceiling unconditionally, with nothing comparing it against the previous baseline, so a
 * live regression could become the new floor silently. `findUnauthorizedIncreases` +
 * `buildOverrideLog` are the fix — this file is the automated proof the refusal actually works,
 * where before it was only checked by hand with a planted mutation (row B.39).
 *
 * Also pins that the guard, and `compare()` used by `check()`, read `byFile` only. `byCode` is
 * informational-only (see the comment on `summarize()` in typecheck-tests-ratchet.js): the same
 * file total can shift between TS codes run to run without the file's own error count changing,
 * and gating on `byCode` would misread that as a regression. There is no `byCode` guard to test
 * here because there is deliberately no `byCode` guard.
 *
 * The dispatcher at the bottom of typecheck-tests-ratchet.js is guarded by
 * `process.argv[1] === fileURLToPath(import.meta.url)`, so importing these functions here does
 * not spawn tsc or touch the committed baseline file.
 */

import { describe, expect, it } from '@jest/globals';

import {
  buildOverrideLog,
  compare,
  findUnauthorizedIncreases,
  parseAllowIncreaseArgs,
} from '../../../scripts/typecheck-tests-ratchet.js';

describe('typecheck-tests-ratchet findUnauthorizedIncreases', () => {
  it('refuses an increase and names the file', () => {
    const increases = findUnauthorizedIncreases(
      { 'tests/unit/example.test.ts': 1 },
      { 'tests/unit/example.test.ts': 2 },
      new Map()
    );

    expect(increases).toEqual([{ file: 'tests/unit/example.test.ts', before: 1, after: 2 }]);
  });

  it('treats a file missing from the baseline as an increase from an implicit zero', () => {
    const increases = findUnauthorizedIncreases(
      {},
      { 'tests/unit/new-file.test.ts': 1 },
      new Map()
    );

    expect(increases).toEqual([{ file: 'tests/unit/new-file.test.ts', before: 0, after: 1 }]);
  });

  it('clears the refusal once the file is named via an explicit override', () => {
    const increases = findUnauthorizedIncreases(
      { 'tests/unit/example.test.ts': 1 },
      { 'tests/unit/example.test.ts': 2 },
      new Map([['tests/unit/example.test.ts', 'reason']])
    );

    expect(increases).toEqual([]);
  });

  it('passes a decrease with no override needed', () => {
    const increases = findUnauthorizedIncreases(
      { 'tests/unit/example.test.ts': 5 },
      { 'tests/unit/example.test.ts': 2 },
      new Map()
    );

    expect(increases).toEqual([]);
  });

  it('passes a file that disappears entirely with no override needed', () => {
    const increases = findUnauthorizedIncreases({ 'tests/unit/deleted.test.ts': 3 }, {}, new Map());

    expect(increases).toEqual([]);
  });

  it('does not compare byCode — only byFile is a gated ceiling', () => {
    // Same file total (1), different TS code composition: this is exactly the shape measured
    // in the committed baseline on 2026-09-16 (TS2459 -> TS2345, file count unchanged). The
    // function signature only accepts byFile maps, so there is nothing to pass byCode into —
    // this test documents that omission is deliberate, not an oversight.
    const increases = findUnauthorizedIncreases(
      { 'tests/unit/example.test.ts': 1 },
      { 'tests/unit/example.test.ts': 1 },
      new Map()
    );

    expect(increases).toEqual([]);
  });
});

describe('typecheck-tests-ratchet buildOverrideLog', () => {
  it('records the reason for an override that was actually needed', () => {
    const { overrideLog, unused } = buildOverrideLog(
      undefined,
      new Map([['tests/unit/example.test.ts', 'planted for the demo']]),
      { 'tests/unit/example.test.ts': 1 },
      { 'tests/unit/example.test.ts': 2 },
      '2026-09-16T00:00:00.000Z'
    );

    expect(overrideLog).toEqual([
      {
        date: '2026-09-16T00:00:00.000Z',
        file: 'tests/unit/example.test.ts',
        reason: 'planted for the demo',
        before: 1,
        after: 2,
      },
    ]);
    expect(unused).toEqual([]);
  });

  it('appends to a previous overrideLog rather than replacing it', () => {
    const previous = [
      {
        date: '2026-09-01T00:00:00.000Z',
        file: 'tests/unit/other.test.ts',
        reason: 'earlier override',
        before: 3,
        after: 4,
      },
    ];

    const { overrideLog } = buildOverrideLog(
      previous,
      new Map([['tests/unit/example.test.ts', 'new override']]),
      { 'tests/unit/example.test.ts': 1 },
      { 'tests/unit/example.test.ts': 2 },
      '2026-09-16T00:00:00.000Z'
    );

    expect(overrideLog).toHaveLength(2);
    expect(overrideLog[0]).toEqual(previous[0]);
    expect(overrideLog[1].file).toBe('tests/unit/example.test.ts');
  });

  it('reports an override as unused, and does not log it, when nothing increased', () => {
    const { overrideLog, unused } = buildOverrideLog(
      undefined,
      new Map([['tests/unit/example.test.ts', 'not actually needed']]),
      { 'tests/unit/example.test.ts': 5 },
      { 'tests/unit/example.test.ts': 2 },
      '2026-09-16T00:00:00.000Z'
    );

    expect(overrideLog).toEqual([]);
    expect(unused).toEqual(['tests/unit/example.test.ts']);
  });
});

describe('typecheck-tests-ratchet parseAllowIncreaseArgs', () => {
  it('reads repeatable --allow-increase <file> <reason> pairs', () => {
    const overrides = parseAllowIncreaseArgs([
      '--allow-increase',
      'tests/unit/a.test.ts',
      'reason a',
      '--allow-increase',
      'tests/unit/b.test.ts',
      'reason b',
    ]);

    expect(overrides.get('tests/unit/a.test.ts')).toBe('reason a');
    expect(overrides.get('tests/unit/b.test.ts')).toBe('reason b');
  });

  it('throws when a pair is incomplete', () => {
    expect(() => parseAllowIncreaseArgs(['--allow-increase', 'tests/unit/a.test.ts'])).toThrow(
      /--allow-increase/
    );
  });
});

describe('typecheck-tests-ratchet compare (pre-existing check() logic)', () => {
  it('reports a file regression distinctly from a vanished file, reading byFile only', () => {
    const { regressions, vanished } = compare(
      { byFile: { 'tests/unit/up.test.ts': 1, 'tests/unit/gone.test.ts': 2 } },
      { byFile: { 'tests/unit/up.test.ts': 2 } }
    );

    expect(regressions).toEqual([{ file: 'tests/unit/up.test.ts', baseline: 1, current: 2 }]);
    expect(vanished).toEqual([{ file: 'tests/unit/gone.test.ts', baseline: 2 }]);
  });
});
